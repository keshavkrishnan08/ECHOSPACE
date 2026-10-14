// Batched Doppler spectrum on the GPU with cuFFT (Z2Z, double precision).
// Pipeline per call: row means -> mean removal, Hann window and zero-pad into a complex
// buffer -> cufftExecZ2Z -> fftshift and 10 log10(|X|^2 + 1e-12).
// UNVERIFIED in this repository: see engine/cuda/README.md.
#include <cufft.h>

#include <algorithm>
#include <cmath>
#include <new>
#include <stdexcept>
#include <string>
#include <vector>

#include "cuda_util.cuh"
#include "echospace/dsp.hpp"
#include "echospace/dsp_cuda.h"

using echospace::cuda::check;
using echospace::cuda::CudaError;
using echospace::cuda::DeviceBuffer;
using echospace::cuda::blocks_for;

namespace {

constexpr unsigned kThreads = 256;

void check_fft(cufftResult r, const char* what) {
    if (r != CUFFT_SUCCESS) throw CudaError(std::string(what) + ": cuFFT error " + std::to_string(r));
}

class FftHandle {
public:
    FftHandle(int nfft, int rows) {
        check_fft(cufftPlan1d(&h_, nfft, CUFFT_Z2Z, rows), "cufftPlan1d");
    }
    ~FftHandle() { cufftDestroy(h_); }
    FftHandle(const FftHandle&) = delete;
    FftHandle& operator=(const FftHandle&) = delete;
    cufftHandle get() const noexcept { return h_; }

private:
    cufftHandle h_{};
};

// One block per row: tree reduction of the complex mean.
__global__ void row_mean_kernel(const double* __restrict__ re, const double* __restrict__ im,
                                std::size_t n, double* __restrict__ mean_re,
                                double* __restrict__ mean_im) {
    __shared__ double sr[kThreads];
    __shared__ double si[kThreads];
    const std::size_t row = blockIdx.x;
    double ar = 0.0, ai = 0.0;
    for (std::size_t i = threadIdx.x; i < n; i += blockDim.x) {
        ar += re[row * n + i];
        ai += im[row * n + i];
    }
    sr[threadIdx.x] = ar;
    si[threadIdx.x] = ai;
    __syncthreads();
    for (unsigned s = blockDim.x / 2; s > 0; s >>= 1) {
        if (threadIdx.x < s) {
            sr[threadIdx.x] += sr[threadIdx.x + s];
            si[threadIdx.x] += si[threadIdx.x + s];
        }
        __syncthreads();
    }
    if (threadIdx.x == 0) {
        mean_re[row] = sr[0] / static_cast<double>(n);
        mean_im[row] = si[0] / static_cast<double>(n);
    }
}

__global__ void window_pad_kernel(const double* __restrict__ re, const double* __restrict__ im,
                                  const double* __restrict__ mean_re,
                                  const double* __restrict__ mean_im,
                                  const double* __restrict__ w, std::size_t rows, std::size_t n,
                                  std::size_t nfft, cufftDoubleComplex* __restrict__ x) {
    const std::size_t idx = static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (idx >= rows * nfft) return;
    const std::size_t row = idx / nfft;
    const std::size_t i = idx % nfft;
    cufftDoubleComplex v{0.0, 0.0};
    if (i < n) {
        v.x = (re[row * n + i] - mean_re[row]) * w[i];
        v.y = (im[row * n + i] - mean_im[row]) * w[i];
    }
    x[idx] = v;
}

__global__ void shift_db_kernel(const cufftDoubleComplex* __restrict__ X, std::size_t rows,
                                std::size_t nfft, double* __restrict__ out) {
    const std::size_t idx = static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (idx >= rows * nfft) return;
    const std::size_t row = idx / nfft;
    const std::size_t i = idx % nfft;
    const cufftDoubleComplex v = X[row * nfft + ((i + nfft / 2) & (nfft - 1))];
    out[idx] = 10.0 * log10(v.x * v.x + v.y * v.y + 1e-12);
}

}  // namespace

extern "C" int es_cuda_doppler_spectrum_batch(const double* re, const double* im, size_t rows,
                                              size_t n, size_t nfft, double* out_db) {
    if (!re || !im || !out_db) return ES_ERR_NULL;
    if (rows == 0 || n == 0 || nfft == 0) return ES_ERR_SIZE;
    if (!echospace::dsp::is_pow2(nfft)) return ES_ERR_NOT_POW2;
    if (nfft > 0x7fffffff || rows > 0x7fffffff) return ES_ERR_SIZE;
    try {
        std::vector<double> w(n);
        echospace::dsp::hann(w);  // host window from the CPU library: identical values

        DeviceBuffer<double> d_re(rows * n), d_im(rows * n), d_w(n), d_mr(rows), d_mi(rows),
            d_out(rows * nfft);
        DeviceBuffer<cufftDoubleComplex> d_x(rows * nfft);
        d_re.upload(re, rows * n);
        d_im.upload(im, rows * n);
        d_w.upload(w.data(), n);

        row_mean_kernel<<<static_cast<unsigned>(rows), kThreads>>>(d_re.get(), d_im.get(), n,
                                                                  d_mr.get(), d_mi.get());
        check(cudaGetLastError(), "row_mean_kernel launch");
        const unsigned blocks = blocks_for(rows * nfft, kThreads);
        window_pad_kernel<<<blocks, kThreads>>>(d_re.get(), d_im.get(), d_mr.get(), d_mi.get(),
                                                d_w.get(), rows, n, nfft, d_x.get());
        check(cudaGetLastError(), "window_pad_kernel launch");

        FftHandle plan(static_cast<int>(nfft), static_cast<int>(rows));
        check_fft(cufftExecZ2Z(plan.get(), d_x.get(), d_x.get(), CUFFT_FORWARD), "cufftExecZ2Z");

        shift_db_kernel<<<blocks, kThreads>>>(d_x.get(), rows, nfft, d_out.get());
        check(cudaGetLastError(), "shift_db_kernel launch");
        check(cudaDeviceSynchronize(), "doppler kernels");
        d_out.download(out_db, rows * nfft);
        return ES_OK;
    } catch (const CudaError&) {
        return ES_ERR_CUDA;
    } catch (const std::invalid_argument&) {
        return ES_ERR_SIZE;
    } catch (const std::bad_alloc&) {
        return ES_ERR_ALLOC;
    } catch (...) {
        return ES_ERR_INTERNAL;
    }
}
