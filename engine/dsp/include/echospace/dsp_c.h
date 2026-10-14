/*
 * Stable C ABI of the ECHOSPACE native DSP engine.
 *
 * All functions return ES_OK (0) on success or a negative status code. Arrays are caller
 * owned, contiguous, row-major float64 unless stated otherwise. Semantics are documented in
 * echospace/dsp.hpp; the C names map one to one onto the C++ functions.
 *
 * ABI versioning: ES_ABI_VERSION changes whenever a signature or a documented behaviour
 * changes. Bindings should check es_abi_version() at load time.
 */
#ifndef ECHOSPACE_DSP_C_H
#define ECHOSPACE_DSP_C_H

#include <stddef.h>
#include <stdint.h>

#include "echospace/export.h"

#ifdef __cplusplus
extern "C" {
#endif

#define ES_ABI_VERSION 1

enum es_status {
    ES_OK = 0,
    ES_ERR_NULL = -1,          /* required pointer was NULL */
    ES_ERR_SIZE = -2,          /* inconsistent or zero dimensions */
    ES_ERR_NOT_POW2 = -3,      /* FFT length is not a power of two */
    ES_ERR_ALLOC = -4,         /* allocation failure */
    ES_ERR_INTERNAL = -5
};

ES_API int es_abi_version(void);
ES_API const char* es_status_string(int status);

ES_API int es_hann(double* w, size_t n);

ES_API int es_fft(double* re, double* im, size_t n, int inverse);
ES_API int es_fft_batch(double* re, double* im, size_t rows, size_t n, int inverse);

/* out_db: nfft values (batch: rows * nfft). */
ES_API int es_doppler_spectrum(const double* re, const double* im, size_t n, size_t nfft,
                               double* out_db);
ES_API int es_doppler_spectrum_batch(const double* re, const double* im, size_t rows, size_t n,
                                     size_t nfft, double* out_db);

/*
 * Sanitizes `packets` consecutive packets of shape [M x K]. x has K subcarrier offsets.
 * out_re/out_im/out_phase: packets * M * K (each may be NULL to skip).
 * out_slope/out_intercept: packets values (may be NULL). out_ref: packets ints (may be NULL).
 */
ES_API int es_sanitize_packets(const double* re, const double* im, size_t packets, size_t M,
                               size_t K, const double* x, double* out_re, double* out_im,
                               double* out_phase, double* out_slope, double* out_intercept,
                               int32_t* out_ref);

/* replaced may be NULL. */
ES_API int es_hampel(const double* x, size_t n, size_t half_window, double n_sigma, double* y,
                     size_t* replaced);

ES_API double es_norm_cdf(double x);

/* pi: V x L; outputs V values each (image/z may be NULL). */
ES_API int es_rti_apply(const double* pi, const double* null_std, const double* var_ratio,
                        size_t V, size_t L, const double* y, double z0, double* image,
                        double* z, double* occupancy);
/* y: frames x L; outputs frames x V (image/z may be NULL). */
ES_API int es_rti_apply_batch(const double* pi, const double* null_std,
                              const double* var_ratio, size_t V, size_t L, const double* y,
                              size_t frames, double z0, double* image, double* z,
                              double* occupancy);

/*
 * tau: V x L x Mmax; dyn_re/dyn_im: L x Mmax x K; link_valid: L bytes or NULL (all valid);
 * antennas: L int32 or NULL (Mmax each); norm: L values; out: V values.
 */
ES_API int es_backprojection(const double* tau, size_t V, size_t L, size_t Mmax, size_t K,
                             const double* dyn_re, const double* dyn_im,
                             const uint8_t* link_valid, const int32_t* antennas,
                             const double* norm, double f0, double df, double* out);

#ifdef __cplusplus
}
#endif

#endif /* ECHOSPACE_DSP_C_H */
