// extern "C" wrappers. Exceptions never cross the ABI boundary.
#include <new>
#include <stdexcept>

#include "echospace/dsp.hpp"
#include "echospace/dsp_c.h"
#include "errors.hpp"

namespace dsp = echospace::dsp;

namespace {

template <typename F>
int guarded(F&& f) noexcept {
    try {
        f();
        return ES_OK;
    } catch (const dsp::detail::NotPow2Error&) {
        return ES_ERR_NOT_POW2;
    } catch (const std::invalid_argument&) {
        return ES_ERR_SIZE;
    } catch (const std::bad_alloc&) {
        return ES_ERR_ALLOC;
    } catch (...) {
        return ES_ERR_INTERNAL;
    }
}

template <typename T>
std::span<T> span_or_empty(T* p, std::size_t n) {
    return p ? std::span<T>(p, n) : std::span<T>();
}

}  // namespace

extern "C" {

int es_abi_version(void) { return ES_ABI_VERSION; }

const char* es_status_string(int status) {
    switch (status) {
        case ES_OK: return "ok";
        case ES_ERR_NULL: return "required pointer is NULL";
        case ES_ERR_SIZE: return "inconsistent or zero dimensions";
        case ES_ERR_NOT_POW2: return "FFT length is not a power of two";
        case ES_ERR_ALLOC: return "allocation failure";
        case ES_ERR_INTERNAL: return "internal error";
        default: return "unknown status";
    }
}

int es_hann(double* w, size_t n) {
    if (!w && n) return ES_ERR_NULL;
    return guarded([&] { dsp::hann({w, n}); });
}

int es_fft(double* re, double* im, size_t n, int inverse) {
    if (!re || !im) return ES_ERR_NULL;
    return guarded([&] { dsp::fft({re, n}, {im, n}, inverse != 0); });
}

int es_fft_batch(double* re, double* im, size_t rows, size_t n, int inverse) {
    if (!re || !im) return ES_ERR_NULL;
    return guarded([&] { dsp::fft_batch({re, rows * n}, {im, rows * n}, n, inverse != 0); });
}

int es_doppler_spectrum(const double* re, const double* im, size_t n, size_t nfft,
                        double* out_db) {
    return es_doppler_spectrum_batch(re, im, 1, n, nfft, out_db);
}

int es_doppler_spectrum_batch(const double* re, const double* im, size_t rows, size_t n,
                              size_t nfft, double* out_db) {
    if (!re || !im || !out_db) return ES_ERR_NULL;
    if (rows == 0) return ES_ERR_SIZE;
    return guarded([&] {
        dsp::doppler_spectrum_batch({re, rows * n}, {im, rows * n}, n, nfft,
                                    {out_db, rows * nfft});
    });
}

int es_sanitize_packets(const double* re, const double* im, size_t packets, size_t M, size_t K,
                        const double* x, double* out_re, double* out_im, double* out_phase,
                        double* out_slope, double* out_intercept, int32_t* out_ref) {
    if (!re || !im || !x) return ES_ERR_NULL;
    if (packets == 0 || M == 0 || K == 0) return ES_ERR_SIZE;
    const size_t n = M * K;
    return guarded([&] {
        for (size_t p = 0; p < packets; ++p) {
            const size_t off = p * n;
            const dsp::LineFit fit = dsp::sanitize_packet(
                {re + off, n}, {im + off, n}, M, K, {x, K},
                span_or_empty(out_re ? out_re + off : nullptr, n),
                span_or_empty(out_im ? out_im + off : nullptr, n),
                span_or_empty(out_phase ? out_phase + off : nullptr, n));
            if (out_slope) out_slope[p] = fit.slope;
            if (out_intercept) out_intercept[p] = fit.intercept;
            if (out_ref) out_ref[p] = fit.ref_antenna;
        }
    });
}

int es_hampel(const double* x, size_t n, size_t half_window, double n_sigma, double* y,
              size_t* replaced) {
    if ((!x || !y) && n) return ES_ERR_NULL;
    return guarded([&] {
        const size_t r = dsp::hampel({x, n}, half_window, n_sigma, {y, n});
        if (replaced) *replaced = r;
    });
}

double es_norm_cdf(double x) { return dsp::norm_cdf(x); }

int es_rti_apply(const double* pi, const double* null_std, const double* var_ratio, size_t V,
                 size_t L, const double* y, double z0, double* image, double* z,
                 double* occupancy) {
    return es_rti_apply_batch(pi, null_std, var_ratio, V, L, y, 1, z0, image, z, occupancy);
}

int es_rti_apply_batch(const double* pi, const double* null_std, const double* var_ratio,
                       size_t V, size_t L, const double* y, size_t frames, double z0,
                       double* image, double* z, double* occupancy) {
    if (!pi || !null_std || !var_ratio || !y || !occupancy) return ES_ERR_NULL;
    if (V == 0 || L == 0 || frames == 0) return ES_ERR_SIZE;
    return guarded([&] {
        const dsp::RtiOperator op{{pi, V * L}, {null_std, V}, {var_ratio, V}, V, L};
        dsp::rti_apply_batch(op, {y, frames * L}, frames, z0, span_or_empty(image, frames * V),
                             span_or_empty(z, frames * V), {occupancy, frames * V});
    });
}

int es_backprojection(const double* tau, size_t V, size_t L, size_t Mmax, size_t K,
                      const double* dyn_re, const double* dyn_im, const uint8_t* link_valid,
                      const int32_t* antennas, const double* norm, double f0, double df,
                      double* out) {
    if (!tau || !dyn_re || !dyn_im || !norm || !out) return ES_ERR_NULL;
    if (V == 0 || L == 0 || Mmax == 0 || K == 0) return ES_ERR_SIZE;
    return guarded([&] {
        dsp::BackProjectionInput in;
        in.tau = {tau, V * L * Mmax};
        in.dyn_re = {dyn_re, L * Mmax * K};
        in.dyn_im = {dyn_im, L * Mmax * K};
        in.link_valid = span_or_empty(link_valid, L);
        in.antennas = span_or_empty(antennas, L);
        in.norm = {norm, L};
        in.V = V;
        in.L = L;
        in.Mmax = Mmax;
        in.K = K;
        in.f0 = f0;
        in.df = df;
        dsp::backprojection(in, {out, V});
    });
}

}  // extern "C"
