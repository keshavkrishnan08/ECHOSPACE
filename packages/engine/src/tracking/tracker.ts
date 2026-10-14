import type { Detection, Track, TrackEvent, TrackingConfig } from "@echospace/schemas";
import { Rng } from "../sim/rng";
import { hungarian } from "./hungarian";

/**
 * Multi-target tracker over floor-plane detections.
 *  - "kalman": constant-velocity Kalman filter (state x, y, vx, vy; white-acceleration noise q)
 *  - "ema":    exponential smoothing of position, velocity from smoothed differences
 *  - "none":   track position equals the associated detection
 * Association: Hungarian assignment on Euclidean distance between predicted track position and
 * detections, gated at `gateM`. A track is confirmed after `birthHits` hits and deleted after
 * `maxMisses` consecutive misses (tentative tracks after 2). Identities are ephemeral random
 * labels; nothing forces a track to keep a subject's identity through ambiguity.
 */

interface InternalTrack {
  id: string;
  x: Float64Array; // [x, y, vx, vy]
  P: Float64Array; // 4x4 row-major
  z: number;
  age: number;
  hits: number;
  misses: number;
  confirmed: boolean;
  lastScore: number;
  trail: Array<[number, number, number]>;
}

export class Tracker {
  private tracks: InternalTrack[] = [];
  private rng: Rng;

  constructor(private cfg: TrackingConfig, seed: number, private trailFrames: number) {
    this.rng = new Rng(seed);
  }

  configure(cfg: TrackingConfig, trailFrames: number) {
    this.cfg = cfg;
    this.trailFrames = trailFrames;
  }

  reset() {
    this.tracks = [];
  }

  private newId(): string {
    return `T-${this.rng.nextU32().toString(16).padStart(8, "0").slice(0, 4).toUpperCase()}`;
  }

  step(dets: Detection[], dt: number, t: number): { tracks: Track[]; events: TrackEvent[] } {
    const events: TrackEvent[] = [];
    const cfg = this.cfg;
    const q = cfg.processNoise;
    const r2 = cfg.measurementStdM * cfg.measurementStdM;
    // Predict.
    for (const tr of this.tracks) {
      tr.age++;
      if (cfg.filter === "kalman") {
        const [x, y, vx, vy] = tr.x;
        tr.x[0] = x + vx * dt;
        tr.x[1] = y + vy * dt;
        // P = F P Fᵀ + Q (per-axis blocks; cross-axis terms stay zero)
        for (const [p, v] of [[0, 2], [1, 3]] as const) {
          const Ppp = tr.P[p * 4 + p];
          const Ppv = tr.P[p * 4 + v];
          const Pvv = tr.P[v * 4 + v];
          tr.P[p * 4 + p] = Ppp + 2 * dt * Ppv + dt * dt * Pvv + (q * dt * dt * dt) / 3;
          tr.P[p * 4 + v] = tr.P[v * 4 + p] = Ppv + dt * Pvv + (q * dt * dt) / 2;
          tr.P[v * 4 + v] = Pvv + q * dt;
        }
      } else if (cfg.filter === "ema") {
        tr.x[0] += tr.x[2] * dt * (1 - cfg.emaAlpha);
        tr.x[1] += tr.x[3] * dt * (1 - cfg.emaAlpha);
      }
    }
    // Associate.
    const cost = this.tracks.map((tr) => dets.map((d) => Math.hypot(d.position[0] - tr.x[0], d.position[1] - tr.x[1])));
    const assign = hungarian(cost, cfg.gateM);
    const usedDet = new Set<number>();
    this.tracks.forEach((tr, ti) => {
      const di = assign[ti];
      if (di < 0) {
        tr.misses++;
        return;
      }
      usedDet.add(di);
      const d = dets[di];
      tr.misses = 0;
      tr.hits++;
      tr.lastScore = d.score;
      tr.z = 0.7 * tr.z + 0.3 * d.position[2];
      if (cfg.filter === "kalman") {
        for (const [p, v, zi] of [[0, 2, 0], [1, 3, 1]] as const) {
          const Ppp = tr.P[p * 4 + p];
          const Ppv = tr.P[p * 4 + v];
          const Pvv = tr.P[v * 4 + v];
          const S = Ppp + r2;
          const kp = Ppp / S;
          const kv = Ppv / S;
          const innov = d.position[zi] - tr.x[p];
          tr.x[p] += kp * innov;
          tr.x[v] += kv * innov;
          tr.P[p * 4 + p] = (1 - kp) * Ppp;
          tr.P[p * 4 + v] = tr.P[v * 4 + p] = (1 - kp) * Ppv;
          tr.P[v * 4 + v] = Pvv - kv * Ppv;
        }
      } else if (cfg.filter === "ema") {
        const a = cfg.emaAlpha;
        const nx = a * d.position[0] + (1 - a) * tr.x[0];
        const ny = a * d.position[1] + (1 - a) * tr.x[1];
        tr.x[2] = a * ((nx - tr.x[0]) / dt) + (1 - a) * tr.x[2];
        tr.x[3] = a * ((ny - tr.x[1]) / dt) + (1 - a) * tr.x[3];
        tr.x[0] = nx;
        tr.x[1] = ny;
      } else {
        tr.x[2] = (d.position[0] - tr.x[0]) / dt;
        tr.x[3] = (d.position[1] - tr.x[1]) / dt;
        tr.x[0] = d.position[0];
        tr.x[1] = d.position[1];
      }
      if (!tr.confirmed && tr.hits >= cfg.birthHits) {
        tr.confirmed = true;
        events.push({ kind: "track-confirmed", timestampS: t, trackId: tr.id, message: `${tr.id} confirmed after ${tr.hits} hits`, severity: "info" });
      }
    });
    // Births.
    dets.forEach((d, di) => {
      if (usedDet.has(di)) return;
      const P = new Float64Array(16);
      P[0] = P[5] = r2;
      P[10] = P[15] = 1.0;
      const tr: InternalTrack = {
        id: this.newId(),
        x: Float64Array.from([d.position[0], d.position[1], 0, 0]),
        P,
        z: d.position[2],
        age: 0,
        hits: 1,
        misses: 0,
        confirmed: cfg.birthHits <= 1,
        lastScore: d.score,
        trail: [],
      };
      this.tracks.push(tr);
      events.push({ kind: "track-birth", timestampS: t, trackId: tr.id, message: `${tr.id} tentative at (${d.position[0].toFixed(2)}, ${d.position[1].toFixed(2)})`, severity: "info" });
    });
    // Deaths.
    this.tracks = this.tracks.filter((tr) => {
      const limit = tr.confirmed ? cfg.maxMisses : 2;
      if (tr.misses > limit) {
        if (tr.confirmed) events.push({ kind: "track-death", timestampS: t, trackId: tr.id, message: `${tr.id} terminated after ${tr.misses} missed frames`, severity: "info" });
        return false;
      }
      return true;
    });
    for (const tr of this.tracks) {
      tr.trail.push([tr.x[0], tr.x[1], tr.z]);
      if (tr.trail.length > this.trailFrames) tr.trail.splice(0, tr.trail.length - this.trailFrames);
    }
    const out: Track[] = this.tracks.map((tr) => {
      const cov: [number, number, number] = cfg.filter === "kalman" ? [tr.P[0], tr.P[1], tr.P[5]] : [r2, 0, r2];
      return {
        id: tr.id,
        position: [tr.x[0], tr.x[1], tr.z],
        velocity: [tr.x[2], tr.x[3], 0],
        covariance: cov,
        ageFrames: tr.age,
        hits: tr.hits,
        misses: tr.misses,
        confirmed: tr.confirmed,
        confidence: Math.max(0, Math.min(1, tr.lastScore * Math.exp(-tr.misses / 3))),
        trail: tr.trail.slice(),
      };
    });
    return { tracks: out, events };
  }
}
