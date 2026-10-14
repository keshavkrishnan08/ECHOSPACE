// RAII helpers for the CUDA kernels. Errors are thrown as CudaError and converted to status
// codes at the C ABI boundary.
#pragma once

#include <cuda_runtime.h>

#include <cstddef>
#include <stdexcept>
#include <string>

namespace echospace::cuda {

struct CudaError : std::runtime_error {
    using std::runtime_error::runtime_error;
};

inline void check(cudaError_t e, const char* what) {
    if (e != cudaSuccess) throw CudaError(std::string(what) + ": " + cudaGetErrorString(e));
}

template <typename T>
class DeviceBuffer {
public:
    DeviceBuffer() = default;
    explicit DeviceBuffer(std::size_t n) : n_(n) {
        if (n) check(cudaMalloc(reinterpret_cast<void**>(&p_), n * sizeof(T)), "cudaMalloc");
    }
    ~DeviceBuffer() {
        if (p_) cudaFree(p_);
    }
    DeviceBuffer(const DeviceBuffer&) = delete;
    DeviceBuffer& operator=(const DeviceBuffer&) = delete;
    DeviceBuffer(DeviceBuffer&& o) noexcept : p_(o.p_), n_(o.n_) {
        o.p_ = nullptr;
        o.n_ = 0;
    }
    DeviceBuffer& operator=(DeviceBuffer&& o) noexcept {
        if (this != &o) {
            if (p_) cudaFree(p_);
            p_ = o.p_;
            n_ = o.n_;
            o.p_ = nullptr;
            o.n_ = 0;
        }
        return *this;
    }

    T* get() const noexcept { return p_; }
    std::size_t size() const noexcept { return n_; }

    void upload(const T* host, std::size_t n) {
        if (n > n_) throw std::invalid_argument("upload larger than device buffer");
        check(cudaMemcpy(p_, host, n * sizeof(T), cudaMemcpyHostToDevice), "cudaMemcpy H2D");
    }
    void download(T* host, std::size_t n) const {
        if (n > n_) throw std::invalid_argument("download larger than device buffer");
        check(cudaMemcpy(host, p_, n * sizeof(T), cudaMemcpyDeviceToHost), "cudaMemcpy D2H");
    }

private:
    T* p_ = nullptr;
    std::size_t n_ = 0;
};

inline unsigned blocks_for(std::size_t n, unsigned threads) {
    return static_cast<unsigned>((n + threads - 1) / threads);
}

// A&S 7.1.26, same coefficients and branch structure as echospace::dsp::norm_cdf.
__device__ inline double norm_cdf_dev(double x) {
    const double z = fabs(x) / 1.41421356237309504880;  // divide, as on the CPU
    const double t = 1.0 / (1.0 + 0.3275911 * z);
    const double y =
        1.0 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
               0.254829592) *
                  t * exp(-z * z);
    return x >= 0.0 ? 0.5 * (1.0 + y) : 0.5 * (1.0 - y);
}

}  // namespace echospace::cuda
