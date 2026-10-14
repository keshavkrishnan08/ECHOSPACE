// CUDA kernels for batched RTI posterior apply and coherent back-projection.
// UNVERIFIED in this repository: see engine/cuda/README.md.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <memory>
#include <new>
#include <stdexcept>
#include <vector>

#include "cuda_util.cuh"
#include "echospace/dsp_cuda.h"

using echospace::cuda::check;
using echospace::cuda::CudaError;
using echospace::cuda::DeviceBuffer;
using echospace::cuda::blocks_for;
using echospace::cuda::norm_cdf_dev;

namespace {

constexpr unsigned kThreads = 256;
constexpr std::size_t kMaxGridY = 65535;

// One thread per (voxel, frame). Pi is stored transposed (L x V) so that neighbouring
// threads read neighbouring addresses. The frame's y vector is staged in shared memory.
__global__ void rti_apply_kernel(const double* __restrict__ pi_t,
                                 const double* __restrict__ null_std,
                                 const double* __restrict__ var_ratio,
                                 const double* __restrict__ y, std::size_t V, std::size_t L,
                                 double z0, double* __restrict__ image, double* __restrict__ z,
                                 double* __restrict__ occ) {
    extern __shared__ double ys[];
    const std::size_t f = blockIdx.y;
    for (std::size_t a = threadIdx.x; a < L; a += blockDim.x) ys[a] = y[f * L + a];
    __syncthreads();

    const std::size_t i = static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (i >= V) return;
    double s = 0.0;
    for (std::size_t a = 0; a < L; ++a) s += pi_t[a * V + i] * ys[a];
    const double sd = null_std[i];
    const double zi = sd > 1e-12 ? s / sd : 0.0;
    const std::size_t o = f * V + i;
    if (image) image[o] = s;
    if (z) z[o] = zi;
    occ[o] = var_ratio[i] > 0.95 ? 0.5 : norm_cdf_dev(zi - z0);
}

// One thread per voxel. tau is stored as (L * Mmax) x V for coalesced reads; the dynamic CSI
// is read by all threads of a warp at the same address (broadcast).
__global__ void backprojection_kernel(const double* __restrict__ tau_t,
                                      const std::int32_t* __restrict__ antennas,
                                      const double* __restrict__ dyn_re,
                                      const double* __restrict__ dyn_im,
                                      const std::uint8_t* __restrict__ link_valid,
                                      const double* __restrict__ norm, std::size_t V,
                                      std::size_t L, std::size_t Mmax, std::size_t K, double f0,
                                      double df, double* __restrict__ out) {
    const std::size_t v = static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (v >= V) return;
    const double two_pi = 6.283185307179586476925;
    double total = 0.0;
    for (std::size_t l = 0; l < L; ++l) {
        if (!link_valid[l]) continue;
        const std::size_t M = static_cast<std::size_t>(antennas[l]);
        double sr = 0.0;
        double si = 0.0;
        for (std::size_t m = 0; m < M; ++m) {
            const double t = tau_t[(l * Mmax + m) * V + v];
            double cr, ci, wr, wi;
            sincos(two_pi * f0 * t, &ci, &cr);
            sincos(two_pi * df * t, &wi, &wr);
            const double* dr = dyn_re + (l * Mmax + m) * K;
            const double* di = dyn_im + (l * Mmax + m) * K;
            for (std::size_t k = 0; k < K; ++k) {
                const double ar = dr[k];
                const double ai = di[k];
                if (!isnan(ar)) {
                    sr += ar * cr - ai * ci;
                    si += ar * ci + ai * cr;
                }
                const double nr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = nr;
            }
        }
        const double nl = norm[l];
        total += (sr * sr + si * si) / ((nl != 0.0 && !isnan(nl)) ? nl : 1.0);
    }
    out[v] = total;
}

template <typename F>
int guarded(F&& f) noexcept {
    try {
        f();
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

}  // namespace

struct es_cuda_rti {
    std::size_t V = 0, L = 0;
    DeviceBuffer<double> pi_t, null_std, var_ratio;
};

struct es_cuda_bp {
    std::size_t V = 0, L = 0, Mmax = 0, K = 0;
    double f0 = 0.0, df = 0.0;
    DeviceBuffer<double> tau_t;
    DeviceBuffer<std::int32_t> antennas;
    DeviceBuffer<double> dyn_re, dyn_im, norm, out;
    DeviceBuffer<std::uint8_t> link_valid;
};

extern "C" {

int es_cuda_device_count(int* count) {
    if (!count) return ES_ERR_NULL;
    int n = 0;
    if (cudaGetDeviceCount(&n) != cudaSuccess) {
        cudaGetLastError();  // clear the sticky error from a missing driver
        n = 0;
    }
    *count = n;
    return ES_OK;
}

int es_cuda_rti_create(const double* pi, const double* null_std, const double* var_ratio,
                       size_t V, size_t L, es_cuda_rti** out) {
    if (!pi || !null_std || !var_ratio || !out) return ES_ERR_NULL;
    if (V == 0 || L == 0) return ES_ERR_SIZE;
    *out = nullptr;
    return guarded([&] {
        auto ctx = std::make_unique<es_cuda_rti>();
        ctx->V = V;
        ctx->L = L;
        std::vector<double> t(V * L);
        for (std::size_t i = 0; i < V; ++i)
            for (std::size_t a = 0; a < L; ++a) t[a * V + i] = pi[i * L + a];
        ctx->pi_t = DeviceBuffer<double>(V * L);
        ctx->pi_t.upload(t.data(), t.size());
        ctx->null_std = DeviceBuffer<double>(V);
        ctx->null_std.upload(null_std, V);
        ctx->var_ratio = DeviceBuffer<double>(V);
        ctx->var_ratio.upload(var_ratio, V);
        *out = ctx.release();
    });
}

void es_cuda_rti_destroy(es_cuda_rti* ctx) { std::unique_ptr<es_cuda_rti> owned(ctx); }

int es_cuda_rti_apply_batch(es_cuda_rti* ctx, const double* y, size_t frames, double z0,
                            double* image, double* z, double* occupancy) {
    if (!ctx || !y || !occupancy) return ES_ERR_NULL;
    if (frames == 0) return ES_ERR_SIZE;
    return guarded([&] {
        const std::size_t V = ctx->V, L = ctx->L;
        DeviceBuffer<double> d_y(frames * L), d_occ(frames * V);
        DeviceBuffer<double> d_img(image ? frames * V : 0), d_z(z ? frames * V : 0);
        d_y.upload(y, frames * L);
        const std::size_t shmem = L * sizeof(double);
        for (std::size_t f0 = 0; f0 < frames; f0 += kMaxGridY) {
            const std::size_t nf = std::min(kMaxGridY, frames - f0);
            const dim3 grid(blocks_for(V, kThreads), static_cast<unsigned>(nf));
            rti_apply_kernel<<<grid, kThreads, shmem>>>(
                ctx->pi_t.get(), ctx->null_std.get(), ctx->var_ratio.get(), d_y.get() + f0 * L,
                V, L, z0, image ? d_img.get() + f0 * V : nullptr,
                z ? d_z.get() + f0 * V : nullptr, d_occ.get() + f0 * V);
            check(cudaGetLastError(), "rti_apply_kernel launch");
        }
        check(cudaDeviceSynchronize(), "rti_apply_kernel");
        d_occ.download(occupancy, frames * V);
        if (image) d_img.download(image, frames * V);
        if (z) d_z.download(z, frames * V);
    });
}

int es_cuda_bp_create(const double* tau, size_t V, size_t L, size_t Mmax, size_t K,
                      const int32_t* antennas, double f0, double df, es_cuda_bp** out) {
    if (!tau || !out) return ES_ERR_NULL;
    if (V == 0 || L == 0 || Mmax == 0 || K == 0) return ES_ERR_SIZE;
    *out = nullptr;
    return guarded([&] {
        auto ctx = std::make_unique<es_cuda_bp>();
        ctx->V = V;
        ctx->L = L;
        ctx->Mmax = Mmax;
        ctx->K = K;
        ctx->f0 = f0;
        ctx->df = df;
        const std::size_t LM = L * Mmax;
        std::vector<double> t(V * LM);
        for (std::size_t v = 0; v < V; ++v)
            for (std::size_t j = 0; j < LM; ++j) t[j * V + v] = tau[v * LM + j];
        ctx->tau_t = DeviceBuffer<double>(t.size());
        ctx->tau_t.upload(t.data(), t.size());

        std::vector<std::int32_t> ants(L, static_cast<std::int32_t>(Mmax));
        if (antennas) {
            for (std::size_t l = 0; l < L; ++l) {
                if (antennas[l] < 0 || static_cast<std::size_t>(antennas[l]) > Mmax)
                    throw std::invalid_argument("antenna count out of range");
                ants[l] = antennas[l];
            }
        }
        ctx->antennas = DeviceBuffer<std::int32_t>(L);
        ctx->antennas.upload(ants.data(), L);
        ctx->dyn_re = DeviceBuffer<double>(LM * K);
        ctx->dyn_im = DeviceBuffer<double>(LM * K);
        ctx->norm = DeviceBuffer<double>(L);
        ctx->link_valid = DeviceBuffer<std::uint8_t>(L);
        ctx->out = DeviceBuffer<double>(V);
        *out = ctx.release();
    });
}

void es_cuda_bp_destroy(es_cuda_bp* ctx) { std::unique_ptr<es_cuda_bp> owned(ctx); }

int es_cuda_bp_image(es_cuda_bp* ctx, const double* dyn_re, const double* dyn_im,
                     const uint8_t* link_valid, const double* norm, double* out) {
    if (!ctx || !dyn_re || !dyn_im || !norm || !out) return ES_ERR_NULL;
    return guarded([&] {
        const std::size_t n = ctx->L * ctx->Mmax * ctx->K;
        ctx->dyn_re.upload(dyn_re, n);
        ctx->dyn_im.upload(dyn_im, n);
        ctx->norm.upload(norm, ctx->L);
        std::vector<std::uint8_t> valid(ctx->L, 1);
        if (link_valid) valid.assign(link_valid, link_valid + ctx->L);
        ctx->link_valid.upload(valid.data(), ctx->L);
        backprojection_kernel<<<blocks_for(ctx->V, kThreads), kThreads>>>(
            ctx->tau_t.get(), ctx->antennas.get(), ctx->dyn_re.get(), ctx->dyn_im.get(),
            ctx->link_valid.get(), ctx->norm.get(), ctx->V, ctx->L, ctx->Mmax, ctx->K, ctx->f0,
            ctx->df, ctx->out.get());
        check(cudaGetLastError(), "backprojection_kernel launch");
        check(cudaDeviceSynchronize(), "backprojection_kernel");
        ctx->out.download(out, ctx->V);
    });
}

}  // extern "C"
