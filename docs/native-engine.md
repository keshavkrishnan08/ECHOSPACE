# Native DSP engine

`engine/` holds a C++20 implementation of the hot numerical kernels of the TypeScript engine
(`packages/engine/src/dsp`, `packages/engine/src/recon`), with:

- a stable C ABI;
- ctypes bindings for Python;
- tests against NumPy/SciPy;
- a benchmark harness;
- an optional, unverified CUDA port;
- a protobuf contract for a future gRPC data plane.

Nothing in the running product calls it yet.

```
engine/
  CMakeLists.txt                  top-level build
  dsp/include/echospace/          dsp.hpp (C++ API), dsp_c.h (C ABI), spsc_ring.hpp, export.h
  dsp/src/                        fft.cpp, preprocess.cpp, recon.cpp, c_api.cpp
  dsp/tests/                      C++ unit tests (self-contained harness, registered with CTest)
  benchmarks/                     echospace_bench (C++), run_benchmarks.py, results/*.json
  python/echospace_native/        ctypes bindings
  tests/test_native_vs_numpy.py   pytest cross-checks against NumPy/SciPy
  cuda/                           optional CUDA kernels (unverified, off by default)
  transport/                      echospace.proto (planned gRPC contract)
```

## Building and testing

Requirements: a C++20 compiler (tested with GCC 13.3 and Clang 18) and CMake ≥ 3.20. No
third-party C++ dependencies, and nothing is fetched at configure time.

```sh
cmake -S engine -B engine/build -DCMAKE_BUILD_TYPE=Release
cmake --build engine/build -j
ctest --test-dir engine/build
```

The library is written to `engine/build/lib/libechospace_dsp.so`, and the executables to
`engine/build/bin/`.

Python cross-checks (they need the library built first, and are skipped with a reason
otherwise):

```sh
. .venv/bin/activate
pytest engine/tests -q
```

CMake options:

| Option | Default | Effect |
| --- | --- | --- |
| `ECHOSPACE_BUILD_TESTS` | ON | C++ unit tests and the benchmark smoke test |
| `ECHOSPACE_BUILD_BENCHMARKS` | ON | `echospace_bench` |
| `ECHOSPACE_WERROR` | OFF | `-Werror` (the build is warning-free with GCC 13 and Clang 18 under `-Wall -Wextra -Wpedantic -Wshadow`) |
| `ECHOSPACE_NATIVE_ARCH` | OFF | `-march=native`; not used for the results below |
| `ECHOSPACE_SANITIZE` | empty | `thread`, `address` or `undefined` |
| `ECHOSPACE_ENABLE_CUDA` | OFF | build `engine/cuda` (needs the CUDA toolkit ≥ 12) |

The ring buffer stress tests also pass under ThreadSanitizer, with no reports:

```sh
cmake -S engine -B engine/build-tsan -DECHOSPACE_SANITIZE=thread -DECHOSPACE_BUILD_BENCHMARKS=OFF
cmake --build engine/build-tsan -j && ctest --test-dir engine/build-tsan
```

## API overview

All arithmetic is float64. Complex data is passed as separate real and imaginary arrays, and
matrices are dense and row-major. The C++ functions throw `std::invalid_argument` on
inconsistent sizes. The C functions return `ES_OK` (0) or a negative `es_status`, and
`es_abi_version()` lets bindings detect a mismatched library.

| Operation | C++ (`echospace::dsp`) | C ABI | TypeScript reference |
| --- | --- | --- | --- |
| Hann window (symmetric) | `hann` | `es_hann` | `hann` (fft.ts) |
| Radix-2 FFT, in place, forward/inverse | `FftPlan`, `fft`, `fft_batch` | `es_fft`, `es_fft_batch` | `fft` |
| Doppler spectrum (dB, fft-shifted) | `doppler_spectrum`, `doppler_spectrum_batch` | `es_doppler_spectrum[_batch]` | `dopplerSpectrum` |
| Linear phase sanitization | `unwrap`, `sanitize_packet` | `es_sanitize_packets` | `sanitizePacket` (sanitize.ts) |
| Hampel filter | `hampel` | `es_hampel` | `hampel` (hampel.ts) |
| Normal CDF (A&S 7.1.26) | `norm_cdf` | `es_norm_cdf` | `normCdf` (linalg.ts) |
| RTI posterior apply | `rti_apply`, `rti_apply_batch` | `es_rti_apply[_batch]` | `RtiModel.reconstruct` (rti.ts) |
| Delay-and-sum back-projection | `backprojection` | `es_backprojection` | `BackProjectionModel.image` |
| SPSC ring buffer | `echospace::SpscRing<T>` (header-only) | - | `BoundedQueue` (queue.ts) |

Python: `engine/python/echospace_native` mirrors the C ABI with NumPy arrays in and out:
`hann`, `fft`, `fft_batch`, `doppler_spectrum[_batch]`, `sanitize_packets`, `hampel`,
`norm_cdf`, `rti_apply[_batch]` and `backprojection`.

- The library is found through `ECHOSPACE_NATIVE_LIB`, or else under `engine/build/lib/`.
- `available()` reports whether it loads.
- Every call raises `NativeUnavailable` if it does not load, with the build command in the
  message.
- `NativeError` (with `.status`) is raised for a non-zero status.
- The bindings only need NumPy and the shared library; nothing is compiled.

### Where the native code intentionally differs from the TypeScript

- **Output precision.** RTI image, z and occupancy, and the back-projection image, are float64.
  The TypeScript stores them in `Float32Array`.
- **Dense RTI inputs.** `rti_apply` takes Π for the active links only, and `y` for those
  links. Selecting the active set (dropping NaN links) and building Π stay with the caller, as
  does caching per active set (`RtiModel.operator`).
- **Back-projection layout.** Dynamic CSI is a dense `L × Mmax × K` array plus an optional
  per-link validity mask and antenna count. This replaces the TypeScript's array of nullable
  per-link objects. As in the TypeScript, a sample is skipped when its real part is NaN, and a
  normaliser of 0 or NaN is treated as 1.
- **FFT twiddles.** These are precomputed with direct `cos`/`sin` instead of the TypeScript
  rotation recurrence. The values agree to rounding, but the native error no longer grows with
  the stage length.
- **`sanitize_packet`.** There is no `enabled` flag (a caller that disables sanitization simply
  does not call it). Raw phase and magnitude are not returned, because they are one `atan2` or
  `hypot` away.
- **Doppler with n = 0.** An empty series is rejected (`ES_ERR_SIZE`) instead of producing a
  flat −120 dB spectrum.
- **Unwrap with NaN.** This follows `sanitize.ts`: only the NaN sample is NaN, and the jump
  across it is not corrected. `np.unwrap` behaves differently: it propagates NaN to every
  later sample, so the test reference reproduces the TypeScript rule explicitly.
- **Φ(0) = 0.5 + 5·10⁻¹⁰.** This is a property of the A&S coefficients (they sum to
  0.999999999), and the TypeScript has it as well.

### Ring buffer

`SpscRing<T>` is a bounded, lock-free, single-producer/single-consumer queue that never
allocates after construction:

- `drop_newest` rejects a push when the queue is full.
- `drop_oldest` evicts the oldest item and stores the new one.
- `drops()`, `pushed()` and `popped()` are counters, with `pushed == popped + drops + size`
  once the queue is quiescent.

Each slot carries a sequence number, as in Vyukov's bounded queue. The consumer claims an item
with a CAS on the head index before reading it, so the producer can evict under `drop_oldest`
by winning the same CAS.

One case is resolved in the safe direction. If the consumer has already claimed the oldest
item and is still moving it out, the producer cannot reuse that slot. That single push then
drops the new item instead (it is still counted as one drop). Each push records at most one
drop.

The tests cover FIFO order, wrap-around, both policies, capacity 1, and release of evicted
items. A two-thread stress test pushes 2 million sequence numbers through a 64-slot queue and
checks strictly increasing output and exact counter accounting under both policies. Over 1
million items are dropped in that run, so both drop paths are exercised.

## Numerical tolerances

The NumPy/SciPy references in `engine/tests/test_native_vs_numpy.py` are written from the
definitions (`np.fft.fft`, `np.unwrap`, `np.polyfit`, `scipy.signal.windows.hann(sym=True)`,
`scipy.special.ndtr`), not ported from the C++. The "observed" column is the largest error
from one run at the benchmark sizes on the machine below.

| Operation | Tolerance | Why | Observed max error |
| --- | --- | --- | --- |
| Hann | rtol 1e-9, atol 1e-15 | the end points are exactly 0 | 1.7e-16 |
| FFT / inverse FFT | rtol 1e-9 + atol 1e-12·max\|X\| | FFT error bounds are norm-wise, so bins near zero have no element-wise relative bound | 6e-16·max\|X\| |
| Doppler spectrum (dB) | rtol 1e-9, atol 1e-9 dB | dB of low-power bins; 1e-9 dB is a 2.3e-10 relative power error | 4.8e-13 dB |
| Sanitized CSI and phase | rtol 1e-9 + atol 1e-12·max | detrended phase is near zero by construction | 5e-15 relative to max |
| Slope / intercept | rtol 1e-9 (intercept atol 1e-12) | | ~2e-16 |
| Hampel | exact | only selects and copies samples, or averages two of them | 0 |
| Φ vs `scipy.special.ndtr` | atol 2e-7 | A&S 7.1.26 error is ≤ 1.5e-7 | 7.0e-8 |
| Φ vs the same A&S formula in NumPy | rtol 1e-12 | same formula | 2.4e-15 |
| RTI image, z | rtol 1e-9 + atol 1e-12·max | dot products with cancellation | 5e-16 relative to max |
| Back-projection | rtol 1e-9 + atol 1e-12·max | the reference uses direct `exp(j2πf_k τ)`, the engine uses the TypeScript phasor recurrence | 5.9e-14 element-wise relative |

The C++ unit tests additionally check each kernel against slow direct formulas (naive DFT,
explicit sums), check edge cases (non-power-of-two lengths, non-finite reference antennas,
zero null std, MAD = 0), and check that batched RTI is bit-identical to single-frame RTI.

## How benchmarks are measured

`echospace_bench` (C++) and `run_benchmarks.py` (NumPy) use the same procedure:

- Inputs are generated once, with fixed seeds.
- `warmup` calls run untimed, followed by `iterations` individually timed calls, with one
  sample per call. The C++ side uses `std::chrono::steady_clock` and the Python side
  `time.perf_counter_ns`.
- The in-place FFT input is reset outside the timed region.
- Statistics: min, median, mean, and p95/p99 by nearest rank. p95/p99 are reported only when
  n ≥ 100; otherwise they appear as "insufficient samples".
- Throughput is items per second at the median.
- The NumPy side reuses the native warm-up and iteration counts.
- The native kernels are single-threaded. NumPy is limited to one BLAS/OpenMP thread by
  default (`--numpy-threads`).
- The NumPy implementations are idiomatic and vectorised, not loops:
  - `np.fft.fft` (pocketfft, out of place);
  - vectorised sanitization;
  - `pi @ y` (BLAS) plus `scipy.special.ndtr` for RTI;
  - a chunked `einsum` over `exp(j2πfτ)` for back-projection.

Each run writes `engine/benchmarks/results/<UTC timestamp>.json`. The file holds machine
metadata (CPU model from `/proc/cpuinfo`, logical cores, OS, compiler and version, build type,
flags, Python/NumPy/SciPy versions, timestamp, and the git commit when `ECHOSPACE_GIT_COMMIT`
is set), the per-benchmark statistics for both sides, and a comparison.

```sh
python engine/benchmarks/run_benchmarks.py            # or: engine/build/bin/echospace_bench --json out.json
```

## Measured CPU results

These come from **one run** inside a shared VM/container. They are not from a controlled
benchmarking host.

- Machine: Intel(R) Xeon(R) Processor @ 2.80GHz, 4 logical cores (model string as reported by
  `/proc/cpuinfo`), Linux 6.18 x86_64
- Software: GCC 13.3.0, Release (`-O3 -DNDEBUG`, no `-march=native`), Python 3.13, NumPy
  2.5.4, SciPy 1.18.1, one NumPy thread
- Date: 2026-10-14
- Raw data: `engine/benchmarks/results/20261014T194308Z.json`

Times are in microseconds per call.

| Benchmark | Parameters | Native median | Native p95 | Native p99 | Native min | NumPy median | NumPy p95 | NumPy p99 | NumPy median / native median |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|
| fft_64_batch | rows=1024 n=64 forward in-place (n=300) | 946.3 | 1,681.8 | 2,010.1 | 603.1 | 581.5 | 677.2 | 796.1 | 0.61x |
| fft_1024_batch | rows=64 n=1024 forward in-place (n=300) | 1,289.4 | 2,173.6 | 2,256.7 | 945.2 | 792.7 | 992.9 | 1,198.3 | 0.61x |
| doppler_spectrum | rows=84 n=128 nfft=256 (n=300) | 723.5 | 1,106.0 | 1,487.8 | 671.6 | 844.7 | 982.0 | 1,360.5 | 1.17x |
| sanitize | packets=28 M=3 K=30 (n=1000) | 167.2 | 225.2 | 277.1 | 164.9 | 264.7 | 427.8 | 874.1 | 1.58x |
| rti_apply | V=5280 L=28 frames=1 (n=1000) | 174.5 | 330.4 | 417.3 | 163.7 | 237.6 | 472.3 | 597.6 | 1.36x |
| rti_apply_batch | V=5280 L=28 frames=100 (n=200) | 22,765.5 | 36,273.9 | 38,215.6 | 20,044.5 | 23,071.0 | 31,875.2 | 32,264.5 | 1.01x |
| backprojection | V=5280 L=28 M=3 K=30 (n=100) | 70,457.2 | 97,185.2 | 111,571.7 | 63,701.6 | 716,893.8 | 920,937.3 | 1,205,319.9 | 10.17x |

Native throughput at the median:

| Benchmark | Throughput |
| --- | --- |
| FFT n=64 | 6.9·10⁷ points/s |
| FFT n=1024 | 5.1·10⁷ points/s |
| Doppler | 1.2·10⁵ series/s |
| Sanitization | 1.7·10⁵ packets/s |
| RTI, single frame | 5.7·10³ frames/s |
| RTI, batch of 100 | 4.4·10³ frames/s |
| Back-projection | 7.5·10⁴ voxels/s, i.e. 14 images/s |

How to read the results:

- **Noise.** The host is noisy. p95 is often 1.5-2× the median, and medians move between runs.
  In an earlier run minutes before (before the RTI change, same FFT code), fft_64_batch had a
  native median of 650 µs instead of 946 µs. Ratios below about 1.5× should not be treated as
  significant.
- **FFT.** The native FFT is a plain scalar radix-2, as specified. NumPy's pocketfft
  (mixed-radix, SIMD) is faster at both sizes. If FFT throughput matters, use a tuned library
  (pocketfft, FFTW, or cuFFT on the GPU path) instead of tuning this one.
- **Back-projection.** Here the native code is about 10× faster. It advances the phasor by
  recurrence (two cos/sin pairs per voxel, link and antenna), while the vectorised NumPy version
  evaluates `exp` for every subcarrier.
- **RTI.** On a CPU, batching frames does not help: the per-frame cost is dominated by the
  `exp` in Φ, not by memory traffic. The batched entry point exists as the unit of work for
  an accelerator.

## CUDA status

`engine/cuda/` contains:

- kernels for batched RTI apply and back-projection, each with an upload-once context;
- a cuFFT batched Doppler spectrum;
- a C ABI (`dsp_cuda.h`);
- a CPU-vs-GPU test (`cuda.vs_cpu`).

**This code is unverified.** It has never been compiled by nvcc or run, because the
development machine has no GPU or CUDA toolkit. The only check so far is that clang's CUDA
frontend parses it against stub headers. No performance claims are made for it. See
`engine/cuda/README.md` for how to build it and what the test checks.

## Fallback behaviour

- `ECHOSPACE_ENABLE_CUDA` defaults to OFF. The default build neither needs nor probes for CUDA.
  Configuring with it ON on a machine without the toolkit stops with CMake's "Could not find
  nvcc" error.
- The CPU library `echospace_dsp` is always built. It is the reference implementation, and the
  path to use when no GPU is present (`es_cuda_device_count() == 0`) or when any `es_cuda_*`
  call fails.
- The Python bindings load only the CPU library. When it has not been built,
  `echospace_native.available()` returns False and every call raises `NativeUnavailable`. That
  lets callers keep the existing TypeScript or NumPy paths. `pytest engine/tests` skips with
  that reason instead of failing.

## Transport

`engine/transport/echospace.proto` defines `CsiPacket`, `FeatureFrame`,
`ReconstructionFrame` (with `StageTiming`) and `DspService.Process(stream CsiPacket) returns
(stream ReconstructionFrame)`. The product today uses the JSON WebSocket envelope in
`packages/schemas/src/stream.ts`. The gRPC contract is the planned high-throughput interface
and is not served by anything yet. See `engine/transport/README.md`.
