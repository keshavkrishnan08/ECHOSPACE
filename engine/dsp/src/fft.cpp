#include <algorithm>
#include <cmath>
#include <numbers>
#include <stdexcept>
#include <string>
#include <vector>

#include "echospace/dsp.hpp"
#include "errors.hpp"

namespace echospace::dsp {

void hann(std::span<double> w) {
    const std::size_t n = w.size();
    if (n == 1) {
        w[0] = 1.0;
        return;
    }
    const double scale = 2.0 * std::numbers::pi / static_cast<double>(n - 1);
    for (std::size_t i = 0; i < n; ++i) w[i] = 0.5 - 0.5 * std::cos(scale * static_cast<double>(i));
}

FftPlan::FftPlan(std::size_t n) : n_(n) {
    if (!is_pow2(n))
        throw detail::NotPow2Error("FFT length " + std::to_string(n) + " is not a power of two");
    if (n > (std::size_t{1} << 31)) throw std::invalid_argument("FFT length too large");

    for (std::size_t i = 1, j = 0; i < n; ++i) {
        std::size_t bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            swaps_.push_back(static_cast<std::uint32_t>(i));
            swaps_.push_back(static_cast<std::uint32_t>(j));
        }
    }
    // Twiddles are evaluated directly rather than by recurrence, so their error does not grow
    // with n.
    const std::size_t half = n / 2;
    wr_.resize(half);
    wi_.resize(half);
    for (std::size_t k = 0; k < half; ++k) {
        const double a = -2.0 * std::numbers::pi * static_cast<double>(k) / static_cast<double>(n);
        wr_[k] = std::cos(a);
        wi_[k] = std::sin(a);
    }
}

void FftPlan::run(std::span<double> re, std::span<double> im, bool inverse) const {
    if (re.size() != n_ || im.size() != n_)
        throw std::invalid_argument("FFT buffer size does not match plan");
    double* const xr = re.data();
    double* const xi = im.data();

    for (std::size_t p = 0; p < swaps_.size(); p += 2) {
        const std::size_t i = swaps_[p];
        const std::size_t j = swaps_[p + 1];
        std::swap(xr[i], xr[j]);
        std::swap(xi[i], xi[j]);
    }

    const double sign = inverse ? -1.0 : 1.0;  // conj(twiddle) for the inverse
    for (std::size_t len = 2; len <= n_; len <<= 1) {
        const std::size_t h = len / 2;
        const std::size_t stride = n_ / len;
        for (std::size_t i = 0; i < n_; i += len) {
            for (std::size_t j = 0; j < h; ++j) {
                const double cr = wr_[j * stride];
                const double ci = sign * wi_[j * stride];
                const std::size_t a = i + j;
                const std::size_t b = a + h;
                const double vr = xr[b] * cr - xi[b] * ci;
                const double vi = xr[b] * ci + xi[b] * cr;
                xr[b] = xr[a] - vr;
                xi[b] = xi[a] - vi;
                xr[a] += vr;
                xi[a] += vi;
            }
        }
    }

    if (inverse) {
        const double s = 1.0 / static_cast<double>(n_);
        for (std::size_t i = 0; i < n_; ++i) {
            xr[i] *= s;
            xi[i] *= s;
        }
    }
}

void FftPlan::run_batch(std::span<double> re, std::span<double> im, bool inverse) const {
    if (re.size() != im.size() || re.size() % n_ != 0)
        throw std::invalid_argument("batched FFT buffers must hold a whole number of rows");
    for (std::size_t off = 0; off < re.size(); off += n_)
        run(re.subspan(off, n_), im.subspan(off, n_), inverse);
}

void fft(std::span<double> re, std::span<double> im, bool inverse) {
    FftPlan(re.size()).run(re, im, inverse);
}

void fft_batch(std::span<double> re, std::span<double> im, std::size_t n, bool inverse) {
    FftPlan(n).run_batch(re, im, inverse);
}

namespace {

// Spectrum of one row using a prepared plan, window and scratch buffers of length nfft.
void doppler_row(const FftPlan& plan, std::span<const double> w, std::span<const double> re,
                 std::span<const double> im, std::span<double> xr, std::span<double> xi,
                 std::span<double> out) {
    const std::size_t n = re.size();
    const std::size_t nfft = plan.size();
    double mr = 0.0;
    double mi = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        mr += re[i];
        mi += im[i];
    }
    const double inv_n = n ? 1.0 / static_cast<double>(n) : 1.0;
    mr *= inv_n;
    mi *= inv_n;

    const std::size_t m = std::min(n, nfft);
    for (std::size_t i = 0; i < m; ++i) {
        xr[i] = (re[i] - mr) * w[i];
        xi[i] = (im[i] - mi) * w[i];
    }
    std::fill(xr.begin() + static_cast<std::ptrdiff_t>(m), xr.end(), 0.0);
    std::fill(xi.begin() + static_cast<std::ptrdiff_t>(m), xi.end(), 0.0);
    plan.forward(xr, xi);

    const std::size_t half = nfft / 2;
    for (std::size_t i = 0; i < nfft; ++i) {
        const std::size_t src = (i + half) & (nfft - 1);
        out[i] = 10.0 * std::log10(xr[src] * xr[src] + xi[src] * xi[src] + 1e-12);
    }
}

}  // namespace

void doppler_spectrum(std::span<const double> re, std::span<const double> im,
                      std::span<double> out_db) {
    doppler_spectrum_batch(re, im, re.size(), out_db.size(), out_db);
}

void doppler_spectrum_batch(std::span<const double> re, std::span<const double> im,
                            std::size_t n, std::size_t nfft, std::span<double> out_db) {
    if (re.size() != im.size()) throw std::invalid_argument("re/im size mismatch");
    if (n == 0 || re.size() % n != 0) throw std::invalid_argument("series length must divide input");
    const std::size_t rows = re.size() / n;
    if (out_db.size() != rows * nfft) throw std::invalid_argument("output size must be rows * nfft");

    const FftPlan plan(nfft);
    std::vector<double> w(n);
    hann(w);
    std::vector<double> xr(nfft), xi(nfft);
    for (std::size_t r = 0; r < rows; ++r)
        doppler_row(plan, w, re.subspan(r * n, n), im.subspan(r * n, n), xr, xi,
                    out_db.subspan(r * nfft, nfft));
}

}  // namespace echospace::dsp
