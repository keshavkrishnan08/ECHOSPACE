"""Synthetic subject motion (port of packages/engine/src/sim/trajectory.ts).

A subject executes a list of actions (walk / stop / turn / sit), optionally looping back to its
start. Everything here is *ground truth*: it drives the channel simulator and the evaluation
metrics, and must never be presented as an inferred output.

Joints are stored as float32 like the TypeScript ``Float32Array``; the torso centre and scatter
points are then derived from those float32 values in float64 arithmetic, in the same order.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal

import numpy as np
import numpy.typing as npt

from .config import SitAction, StopAction, SubjectSpec, TurnAction, WalkAction
from .geometry import Vec3, js_hypot

Vec2 = tuple[float, float]
Posture = Literal["standing", "walking", "sitting", "turning"]

STRIDE_M = 1.4
SIT_TRANSITION_S = 0.8
_TWO_PI = 2 * math.pi


def _wrap_angle(a: float) -> float:
    return math.atan2(math.sin(a), math.cos(a))


@dataclass(frozen=True)
class Segment:
    kind: Literal["walk", "stop", "turn", "sit"]
    t0: float
    t1: float
    at: Vec2
    """Start point (walk) or fixed position (stop, turn, sit)."""
    heading: float
    to: Vec2 = (0.0, 0.0)
    speed: float = 0.0
    d0: float = 0.0
    """Distance walked before this segment (walk only)."""
    h1: float = 0.0
    """Final heading (turn only); `heading` is the initial heading."""
    z0: float = 0.0
    """Floor height under the subject at the start of the segment."""
    z1: float = 0.0
    """Floor height at the end of a walk (stairs); equals z0 otherwise."""


@dataclass(frozen=True)
class CompiledPath:
    spec: SubjectSpec
    segments: list[Segment]
    period: float


@dataclass
class SubjectState:
    present: bool
    position: Vec3
    velocity: Vec3
    heading: float
    posture: Posture
    sit_blend: float
    """0 = standing, 1 = fully seated."""
    gait_phase: float
    joints: npt.NDArray[np.float32]
    scatterers: list[tuple[float, float, float, float]] = field(default_factory=list)
    """Scatter centres (x, y, z, rcs fraction) used by the channel model."""
    axis_bottom: float = 0.0
    axis_top: float = 0.0
    """Vertical body axis used for shadowing: bottom and top z."""


def _simulate_end(spec: SubjectSpec) -> Vec2:
    p: Vec2 = (spec.start[0], spec.start[1])
    for a in spec.actions:
        if isinstance(a, WalkAction):
            p = (a.to[0], a.to[1])
    return p


def _end_elevation(spec: SubjectSpec) -> float:
    z = 0.0
    for a in spec.actions:
        if isinstance(a, WalkAction) and a.to_z is not None:
            z = a.to_z
    return z


def compile_path(spec: SubjectSpec) -> CompiledPath:
    segments: list[Segment] = []
    t = 0.0
    pos: Vec2 = (spec.start[0], spec.start[1])
    heading = (spec.start_heading_deg * math.pi) / 180
    walked = 0.0
    elev = 0.0
    actions = list(spec.actions)
    if spec.loop:
        end = _simulate_end(spec)
        if js_hypot(end[0] - spec.start[0], end[1] - spec.start[1]) > 1e-6:
            back_z = 0.0 if _end_elevation(spec) != 0 else None
            actions.append(WalkAction(type="walk", to=(spec.start[0], spec.start[1]), speed=1.0, to_z=back_z))
    for a in actions:
        if isinstance(a, WalkAction):
            dx = a.to[0] - pos[0]
            dy = a.to[1] - pos[1]
            length = js_hypot(dx, dy)
            if length < 1e-6:
                continue
            h = math.atan2(dy, dx)
            dur = length / a.speed
            to = (a.to[0], a.to[1])
            z1 = a.to_z if a.to_z is not None else elev
            segments.append(Segment("walk", t, t + dur, pos, h, to=to, speed=a.speed, d0=walked, z0=elev, z1=z1))
            elev = z1
            walked += length
            t += dur
            pos = to
            heading = h
        elif isinstance(a, StopAction):
            if a.duration_s <= 0:
                continue
            segments.append(Segment("stop", t, t + a.duration_s, pos, heading, z0=elev, z1=elev))
            t += a.duration_s
        elif isinstance(a, TurnAction):
            h1 = (a.heading_deg * math.pi) / 180
            h_end = heading + _wrap_angle(h1 - heading)
            segments.append(Segment("turn", t, t + a.duration_s, pos, heading, h1=h_end, z0=elev, z1=elev))
            t += a.duration_s
            heading = h1
        elif isinstance(a, SitAction):
            if a.duration_s <= 0:
                continue
            segments.append(Segment("sit", t, t + a.duration_s, pos, heading, z0=elev, z1=elev))
            t += a.duration_s
    if not segments:
        segments.append(Segment("stop", 0.0, 1.0, pos, heading))
        t = 1.0
    return CompiledPath(spec, segments, t)


def subject_state_at(path: CompiledPath, time: float) -> SubjectState:
    spec = path.spec
    local = time - spec.start_delay_s
    if local < 0 or (not spec.loop and local > path.period):
        return _absent_state()
    period = path.period
    tt = math.fmod(math.fmod(local, period) + period, period) if spec.loop else min(local, period)
    seg = path.segments[-1]
    for s in path.segments:
        if s.t0 <= tt < s.t1:
            seg = s
            break
    vx = 0.0
    vy = 0.0
    posture: Posture = "standing"
    sit_blend = 0.0
    gait_phase = 0.0
    x, y = seg.at
    heading = seg.heading
    elev = seg.z0
    vz = 0.0
    if seg.kind == "walk":
        f = min(1.0, max(0.0, (tt - seg.t0) / (seg.t1 - seg.t0)))
        x = seg.at[0] + (seg.to[0] - seg.at[0]) * f
        y = seg.at[1] + (seg.to[1] - seg.at[1]) * f
        elev = seg.z0 + (seg.z1 - seg.z0) * f
        vz = (seg.z1 - seg.z0) / (seg.t1 - seg.t0)
        vx = math.cos(heading) * seg.speed
        vy = math.sin(heading) * seg.speed
        posture = "walking"
        travelled = seg.d0 + seg.speed * (tt - seg.t0)
        gait_phase = math.fmod((travelled / STRIDE_M) * 2 * math.pi, _TWO_PI)
    elif seg.kind == "turn":
        f = min(1.0, max(0.0, (tt - seg.t0) / (seg.t1 - seg.t0)))
        heading = seg.heading + (seg.h1 - seg.heading) * f
        posture = "turning"
    elif seg.kind == "sit":
        dur = seg.t1 - seg.t0
        tr = min(SIT_TRANSITION_S, dur / 2)
        e = tt - seg.t0
        sit_blend = e / tr if e < tr else (dur - e) / tr if e > dur - tr else 1.0
        sit_blend = min(1.0, max(0.0, sit_blend))
        posture = "sitting" if sit_blend > 0.5 else "standing"

    joints = skeleton(x, y, heading, spec.height_m, gait_phase, posture == "walking", sit_blend)
    if elev != 0:
        # float64 add then float32 store, as the TypeScript Float32Array does
        joints[2::3] = (joints[2::3].astype(np.float64) + elev).astype(np.float32)
    jl: list[float] = joints.astype(np.float64).tolist()

    def joint(i: int) -> tuple[float, float, float]:
        return (jl[i * 3], jl[i * 3 + 1], jl[i * 3 + 2])

    centre_z = (jl[5 * 3 + 2] + jl[6 * 3 + 2] + jl[11 * 3 + 2] + jl[12 * 3 + 2]) / 4
    torso = (
        (jl[5 * 3] + jl[6 * 3] + jl[11 * 3] + jl[12 * 3]) / 4,
        (jl[5 * 3 + 1] + jl[6 * 3 + 1] + jl[11 * 3 + 1] + jl[12 * 3 + 1]) / 4,
        centre_z,
    )
    scatterers = [
        (*torso, 0.5),
        (*joint(0), 0.1),
        (*joint(13), 0.15),
        (*joint(14), 0.15),
        (*joint(9), 0.05),
        (*joint(10), 0.05),
    ]
    return SubjectState(
        present=True,
        position=(x, y, centre_z),
        velocity=(vx, vy, vz),
        heading=heading,
        posture=posture,
        sit_blend=sit_blend,
        gait_phase=gait_phase,
        joints=joints,
        scatterers=scatterers,
        axis_bottom=elev + 0.05,
        axis_top=jl[2] + 0.08,
    )


def _absent_state() -> SubjectState:
    return SubjectState(
        present=False,
        position=(0.0, 0.0, 0.0),
        velocity=(0.0, 0.0, 0.0),
        heading=0.0,
        posture="standing",
        sit_blend=0.0,
        gait_phase=0.0,
        joints=np.zeros(51, dtype=np.float32),
    )


COCO_JOINTS = (
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist",
    "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle",
)  # fmt: skip
"""COCO-17 joint order."""

COCO_BONES: tuple[tuple[int, int], ...] = (
    (0, 1), (0, 2), (1, 3), (2, 4), (5, 6), (5, 7), (7, 9), (6, 8), (8, 10),
    (5, 11), (6, 12), (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
)  # fmt: skip


def skeleton(
    x: float, y: float, heading: float, h: float, phase: float, walking: bool, sit: float
) -> npt.NDArray[np.float32]:
    """Parametric 17-joint skeleton in world coordinates (synthetic ground truth only), float32 [17*3]."""
    s = h / 1.75
    ch = math.cos(heading)
    sh = math.sin(heading)
    swing = 0.38 * math.sin(phase) if walking else 0.0
    arm_swing = 0.3 * math.sin(phase) if walking else 0.0
    hip_z_stand = 0.52 * h
    hip_z = hip_z_stand + (0.47 - hip_z_stand) * sit
    lift = hip_z - hip_z_stand
    thigh = 0.245 * h
    shin = 0.245 * h
    # Local frame: f = forward, l = left, z = up.
    local: list[tuple[float, float, float]] = [(0.0, 0.0, 0.0)] * 17
    local[0] = (0.09 * s, 0.0, 0.935 * h + lift)
    local[1] = (0.08 * s, 0.03 * s, 0.955 * h + lift)
    local[2] = (0.08 * s, -0.03 * s, 0.955 * h + lift)
    local[3] = (0.0, 0.075 * s, 0.945 * h + lift)
    local[4] = (0.0, -0.075 * s, 0.945 * h + lift)
    local[5] = (0.0, 0.2 * s, 0.82 * h + lift)
    local[6] = (0.0, -0.2 * s, 0.82 * h + lift)
    upper = 0.17 * h
    fore = 0.15 * h
    for side, sh0, el, wr, sign in ((1, 5, 7, 9, 1), (-1, 6, 8, 10, -1)):
        a = arm_swing * -sign
        sp = local[sh0]
        e = (sp[0] + upper * math.sin(a), sp[1] + 0.02 * side * s, sp[2] - upper * math.cos(a))
        forearm = a + (0.25 if walking else 0.1) + 0.9 * sit
        local[el] = e
        local[wr] = (e[0] + fore * math.sin(forearm), e[1], e[2] - fore * math.cos(forearm))
    local[11] = (0.0, 0.1 * s, hip_z)
    local[12] = (0.0, -0.1 * s, hip_z)
    for hip, knee, ankle, sign in ((11, 13, 15, 1), (12, 14, 16, -1)):
        hp = local[hip]
        thigh_angle = swing * sign * (1 - sit) + (math.pi / 2) * sit
        k = (hp[0] + thigh * math.sin(thigh_angle), hp[1], hp[2] - thigh * math.cos(thigh_angle))
        bend = max(0.0, 0.7 * math.sin(phase * sign + math.pi / 2)) if walking else 0.0
        shin_angle = thigh_angle * (1 - sit) - bend * (1 - sit)
        local[knee] = k
        local[ankle] = (k[0] + shin * math.sin(shin_angle), k[1], max(0.03, k[2] - shin * math.cos(shin_angle)))
    out = np.empty(51, dtype=np.float64)
    for i, (f, lft, z) in enumerate(local):
        out[i * 3] = x + f * ch - lft * sh
        out[i * 3 + 1] = y + f * sh + lft * ch
        out[i * 3 + 2] = z
    return out.astype(np.float32)
