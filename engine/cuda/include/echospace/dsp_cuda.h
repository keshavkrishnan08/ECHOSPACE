/*
 * Optional CUDA implementation of selected ECHOSPACE kernels (C ABI).
 *
 * UNVERIFIED: this code has not been compiled or run in the ECHOSPACE repository. See
 * engine/cuda/README.md. The CPU implementation in dsp_c.h is the reference and the fallback.
 *
 * All pointers passed to these functions are host pointers; transfers are handled inside.
 * Operators whose inputs are fixed for a session (the RTI projection, back-projection
 * delays) are uploaded once into an opaque context. Semantics match the CPU functions of the
 * same name in dsp_c.h.
 */
#ifndef ECHOSPACE_DSP_CUDA_H
#define ECHOSPACE_DSP_CUDA_H

#include <stddef.h>
#include <stdint.h>

#include "echospace/dsp_c.h"

#ifdef __cplusplus
extern "C" {
#endif

#define ES_ERR_CUDA (-10)   /* CUDA runtime or cuFFT error */
#define ES_ERR_NO_DEVICE (-11)

/* Number of visible CUDA devices (0 if none or no driver). */
ES_API int es_cuda_device_count(int* count);

typedef struct es_cuda_rti es_cuda_rti;

/* Uploads Pi (V x L row-major, stored transposed on the device), null_std and var_ratio. */
ES_API int es_cuda_rti_create(const double* pi, const double* null_std, const double* var_ratio,
                              size_t V, size_t L, es_cuda_rti** out);
ES_API void es_cuda_rti_destroy(es_cuda_rti* ctx);
/* y: frames x L; outputs frames x V (image/z may be NULL). */
ES_API int es_cuda_rti_apply_batch(es_cuda_rti* ctx, const double* y, size_t frames, double z0,
                                   double* image, double* z, double* occupancy);

typedef struct es_cuda_bp es_cuda_bp;

/* tau: V x L x Mmax (seconds); antennas: L counts or NULL (Mmax each). */
ES_API int es_cuda_bp_create(const double* tau, size_t V, size_t L, size_t Mmax, size_t K,
                             const int32_t* antennas, double f0, double df, es_cuda_bp** out);
ES_API void es_cuda_bp_destroy(es_cuda_bp* ctx);
/* dyn_re/dyn_im: L x Mmax x K; link_valid: L bytes or NULL; norm: L; out: V. */
ES_API int es_cuda_bp_image(es_cuda_bp* ctx, const double* dyn_re, const double* dyn_im,
                            const uint8_t* link_valid, const double* norm, double* out);

/* cuFFT-based batched Doppler spectrum; same convention as es_doppler_spectrum_batch. */
ES_API int es_cuda_doppler_spectrum_batch(const double* re, const double* im, size_t rows,
                                          size_t n, size_t nfft, double* out_db);

#ifdef __cplusplus
}
#endif

#endif /* ECHOSPACE_DSP_CUDA_H */
