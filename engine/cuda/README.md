# Optional CUDA kernels

**Status: unverified.** Nothing in this directory has been compiled by nvcc or run on a GPU in
this repository. The machine the engine was developed on has no NVIDIA GPU and no CUDA
toolkit. Treat this code as a starting point that still has to be built and tested on a CUDA
machine. There are no performance numbers for it, and none should be quoted until the tests
below pass and the code has been benchmarked.

The only checking done so far: clang's CUDA frontend parses both `.cu` files (host and device
passes, `-Wall -Wextra`, no diagnostics) when run against hand-written stub headers that stand
in for `cuda_runtime.h` and `cufft.h`. That catches syntax and type errors in the kernels. It
does not show that the code links, runs, or gives correct results.

## What is here

| File | Contents |
| --- | --- |
| `include/echospace/dsp_cuda.h` | C ABI (`es_cuda_*`), host pointers in and out |
| `src/recon_kernels.cu` | batched RTI posterior apply; coherent delay-and-sum back-projection |
| `src/doppler_cufft.cu` | batched Doppler spectrum: mean removal, Hann window and zero-pad, cuFFT Z2Z, fftshift, dB |
| `src/cuda_util.cuh` | RAII device buffers, error checks, device A&S normal CDF |
| `tests/test_cuda_vs_cpu.cpp` | compares every CUDA entry point with the CPU library |

Design notes:

- RTI: `es_cuda_rti_create` uploads Π once, transposed to L×V so that neighbouring threads
  read neighbouring addresses, together with `null_std` and `var_ratio`. `es_cuda_rti_apply_batch`
  then uses one thread per (voxel, frame) and stages each frame's `y` in shared memory.
- Back-projection: `es_cuda_bp_create` uploads the delay table once, transposed to (L·M)×V.
  It uses one thread per voxel and the same phasor recurrence over subcarriers as the CPU code.
- Doppler: the cuFFT plan is created on every call. If this path gets used, cache the plan
  per (nfft, rows).
- Everything is float64, to match the CPU reference. On consumer GPUs float64 throughput is
  low, so a float32 variant may be worth evaluating. It would need its own tolerances.

## Building and verifying on a CUDA machine

Requires CUDA toolkit 12.0 or newer, because the host code is C++20.

```sh
cmake -S engine -B engine/build-cuda -DCMAKE_BUILD_TYPE=Release -DECHOSPACE_ENABLE_CUDA=ON \
      -DCMAKE_CUDA_ARCHITECTURES=native
cmake --build engine/build-cuda -j
ctest --test-dir engine/build-cuda --output-on-failure
```

`cuda.vs_cpu` (`tests/test_cuda_vs_cpu.cpp`) checks the following against the CPU
implementation, at the same sizes as the CPU benchmarks:

- `es_cuda_rti_apply_batch` vs `es_rti_apply_batch` (V=5280, L=28, 100 frames). Image and z
  use rtol 1e-9 plus an absolute floor of 1e-12·max|ref|. Occupancy uses atol 1e-12.
- `es_cuda_bp_image` vs `es_backprojection` (V=5280, L=28, M=3, K=30, with a NaN sample, a
  zero normaliser, an invalid link and a link with fewer antennas): rtol 1e-9 plus the same
  absolute floor.
- `es_cuda_doppler_spectrum_batch` vs `es_doppler_spectrum_batch` (three shapes, including
  truncation n > nfft): rtol 1e-9, atol 1e-9 dB.
- Argument errors (non-power-of-two nfft, NULL context).

The test exits with code 77, which CTest reports as skipped, when no CUDA device is visible.
A skip is not a pass.

## Fallback

The option `ECHOSPACE_ENABLE_CUDA` defaults to `OFF`. The default build neither needs nor
looks for CUDA. The CPU library `echospace_dsp` is always built and is the reference
implementation. The Python bindings (`engine/python/echospace_native`) only bind the CPU
library. Callers that want the GPU path should check `es_cuda_device_count()` and fall back to
the `es_*` CPU functions when it reports 0 devices or when any `es_cuda_*` call returns a
non-zero status.
