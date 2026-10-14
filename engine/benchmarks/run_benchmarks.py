#!/usr/bin/env python3
"""Run echospace_bench and time equivalent NumPy implementations with the same method.

Method (both sides): inputs are prepared once; `warmup` untimed calls; then `iterations`
individually timed calls (C++: std::chrono::steady_clock, Python: time.perf_counter_ns).
Statistics are min / median / p95 / p99 (nearest rank, only when n >= 100) per call.
Iteration and warm-up counts for the NumPy side are taken from the native results so both
sides use identical counts.

By default NumPy is limited to one BLAS/OpenMP thread, because the native kernels are
single-threaded; pass --numpy-threads 0 to leave the thread pools at their defaults.

Writes engine/benchmarks/results/<UTC timestamp>.json and prints a comparison table.

Usage:
  python engine/benchmarks/run_benchmarks.py [--build-dir engine/build] [--label TEXT]
                                             [--iterations N] [--numpy-threads N]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import platform
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[1]
MIN_TAIL_SAMPLES = 100


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--build-dir", type=Path, default=ENGINE / "build")
    ap.add_argument("--out-dir", type=Path, default=ENGINE / "benchmarks" / "results")
    ap.add_argument("--label", default=None, help="free-text label stored in the results")
    ap.add_argument("--iterations", type=int, default=None, help="override iterations for every benchmark")
    ap.add_argument("--warmup", type=int, default=None, help="override warm-up calls for every benchmark")
    ap.add_argument("--numpy-threads", type=int, default=1, help="BLAS/OpenMP threads for NumPy (0 = default)")
    ap.add_argument("--filter", default=None, help="only benchmarks whose name contains this")
    return ap.parse_args()


def find_bench(build_dir: Path) -> Path:
    for p in (build_dir / "bin" / "echospace_bench", build_dir / "benchmarks" / "echospace_bench"):
        if p.is_file():
            return p
    sys.exit(f"echospace_bench not found under {build_dir}; build the engine first:\n"
             "  cmake -S engine -B engine/build -DCMAKE_BUILD_TYPE=Release && cmake --build engine/build -j")


def run_native(bench: Path, args, label: str) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "native.json"
        cmd = [str(bench), "--json", str(out)]
        if args.iterations:
            cmd += ["--iterations", str(args.iterations)]
        if args.warmup is not None:
            cmd += ["--warmup", str(args.warmup)]
        if args.filter:
            cmd += ["--filter", args.filter]
        env = dict(os.environ, ECHOSPACE_BENCH_LABEL=label)
        subprocess.run(cmd, check=True, env=env)
        return json.loads(out.read_text())


def stats(ns: list[int]) -> dict:
    import math

    s = sorted(ns)
    n = len(s)
    med = s[n // 2] if n % 2 else 0.5 * (s[n // 2 - 1] + s[n // 2])

    def rank(p):
        return s[min(max(math.ceil(p / 100 * n), 1), n) - 1]

    tail = n >= MIN_TAIL_SAMPLES
    return {
        "iterations": n,
        "min_ns": float(s[0]),
        "median_ns": float(med),
        "mean_ns": float(sum(s) / n),
        "p95_ns": float(rank(95)) if tail else None,
        "p99_ns": float(rank(99)) if tail else None,
        "tail_note": None if tail else "insufficient samples (n < 100) for p95/p99",
    }


def numpy_workloads():
    """Same shapes and parameters as engine/benchmarks/bench.cpp."""
    import numpy as np
    from scipy.special import ndtr

    rng = np.random.default_rng(1)

    def crandn(*shape):
        return rng.standard_normal(shape) + 1j * rng.standard_normal(shape)

    w = {}

    x64 = crandn(1024, 64)
    w["fft_64_batch"] = lambda: np.fft.fft(x64, axis=1)
    x1k = crandn(64, 1024)
    w["fft_1024_batch"] = lambda: np.fft.fft(x1k, axis=1)

    dop = crandn(84, 128)

    def doppler():
        n, nfft = dop.shape[1], 256
        xw = (dop - dop.mean(axis=1, keepdims=True)) * np.hanning(n)
        X = np.fft.fftshift(np.fft.fft(xw, n=nfft, axis=1), axes=1)
        return 10 * np.log10(X.real ** 2 + X.imag ** 2 + 1e-12)

    w["doppler_spectrum"] = doppler

    P, M, K = 28, 3, 30
    h = crandn(P, M, K)
    xs = np.arange(K) - 14.5

    def sanitize():
        # Vectorised over packets; antenna 0 is the reference (finite in this data).
        unw = np.unwrap(np.angle(h), axis=-1)
        ref = unw[:, 0, :]
        xm = xs - xs.mean()
        slope = (ref - ref.mean(axis=1, keepdims=True)) @ xm / (xm @ xm)
        icpt = ref.mean(axis=1) - slope * xs.mean()
        corr = slope[:, None] * xs[None, :] + icpt[:, None]
        return h * np.exp(-1j * corr)[:, None, :], unw - corr[:, None, :]

    w["sanitize"] = sanitize

    V, L, F = 5280, 28, 100
    pi = 0.05 * rng.standard_normal((V, L))
    sd = rng.uniform(0.05, 0.5, V)
    vr = rng.uniform(0, 1, V)
    y1 = 2 * rng.standard_normal(L)
    yb = 2 * rng.standard_normal((F, L))

    def rti(y):
        img = y @ pi.T
        z = np.where(sd > 1e-12, img / sd, 0.0)
        occ = np.where(vr > 0.95, 0.5, ndtr(z - 1.5))
        return img, z, occ

    w["rti_apply"] = lambda: rti(y1)
    w["rti_apply_batch"] = lambda: rti(yb)

    Mb, Kb = 3, 30
    tau = rng.uniform(0, 40e-9, (V, L, Mb))
    dyn = crandn(L, Mb, Kb)
    norm = rng.uniform(0.5, 2.0, L)
    f = 5.18e9 + 312.5e3 * np.arange(Kb)
    chunk = 512  # voxels per chunk, bounds the V x L x M x K temporary to ~20 MB

    def backprojection():
        out = np.empty(V)
        for v0 in range(0, V, chunk):
            t = tau[v0 : v0 + chunk]
            s = np.einsum("vlmk,lmk->vl", np.exp(2j * np.pi * f * t[..., None]), dyn)
            out[v0 : v0 + chunk] = (np.abs(s) ** 2 / norm).sum(axis=1)
        return out

    w["backprojection"] = backprojection
    return w


def time_numpy(fn, warmup: int, iterations: int) -> dict:
    for _ in range(warmup):
        fn()
    ns = []
    for _ in range(iterations):
        t0 = time.perf_counter_ns()
        fn()
        ns.append(time.perf_counter_ns() - t0)
    return stats(ns)


def fmt_us(ns):
    return "n<100" if ns is None else f"{ns / 1e3:.1f}"


def main():
    args = parse_args()
    if args.numpy_threads > 0:
        for var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
            os.environ[var] = str(args.numpy_threads)
    import numpy as np
    import scipy

    now = dt.datetime.now(dt.timezone.utc)
    label = args.label or (
        f"Measured on this machine ({platform.node() or 'unknown host'}) in a single run on "
        f"{now:%Y-%m-%d}; not a controlled benchmarking environment."
    )

    native = run_native(find_bench(args.build_dir), args, label)
    workloads = numpy_workloads()

    rows, numpy_results = [], []
    for r in native["results"]:
        fn = workloads.get(r["name"])
        if fn is None:
            continue
        print(f"numpy: {r['name']} ({r['iterations']} iterations)...", flush=True)
        s = time_numpy(fn, r["warmup"], r["iterations"])
        s.update(name=r["name"], params=r["params"], warmup=r["warmup"])
        numpy_results.append(s)
        rows.append((r, s))

    machine = dict(native["machine"])
    machine.update(
        python=platform.python_version(),
        numpy=np.__version__,
        scipy=scipy.__version__,
        numpy_threads=args.numpy_threads or "default",
        hostname=platform.node(),
    )
    doc = {
        "label": label,
        "generated_by": "engine/benchmarks/run_benchmarks.py",
        "timestamp_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "method": {
            "native_clock": native["clock"],
            "numpy_clock": "time.perf_counter_ns",
            "percentiles": native["percentile_method"],
            "notes": "Same warm-up and iteration counts on both sides; one call per sample. "
            "Native kernels are single-threaded; NumPy thread pools limited as recorded in "
            "machine.numpy_threads.",
        },
        "machine": machine,
        "native": native["results"],
        "numpy": numpy_results,
        "comparison": [
            {
                "name": r["name"],
                "native_median_ns": r["median_ns"],
                "numpy_median_ns": s["median_ns"],
                "speedup_median": s["median_ns"] / r["median_ns"],
            }
            for r, s in rows
        ],
    }
    args.out_dir.mkdir(parents=True, exist_ok=True)
    path = args.out_dir / f"{now:%Y%m%dT%H%M%SZ}.json"
    path.write_text(json.dumps(doc, indent=2) + "\n")

    hdr = f"{'benchmark':<17} {'params':<32} {'native med us':>13} {'p95':>9} {'p99':>9} {'numpy med us':>13} {'p95':>9} {'p99':>9} {'speedup':>8}"
    print()
    print(hdr)
    print("-" * len(hdr))
    for r, s in rows:
        print(
            f"{r['name']:<17} {r['params']:<32} {r['median_ns'] / 1e3:>13.1f} {fmt_us(r['p95_ns']):>9} "
            f"{fmt_us(r['p99_ns']):>9} {s['median_ns'] / 1e3:>13.1f} {fmt_us(s['p95_ns']):>9} "
            f"{fmt_us(s['p99_ns']):>9} {s['median_ns'] / r['median_ns']:>7.2f}x"
        )
    print(f"\nmachine: {machine['cpu_model']}, {machine['logical_cores']} logical cores, {machine['compiler']}")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
