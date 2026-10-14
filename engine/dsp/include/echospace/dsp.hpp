// C++ API of the ECHOSPACE native DSP engine.
//
// Conventions shared with the TypeScript reference (packages/engine/src):
//   * complex data is split into separate real / imaginary arrays;
//   * matrices are row-major and dense;
//   * all arithmetic is float64.
// Functions throw std::invalid_argument on inconsistent sizes. The C ABI in dsp_c.h wraps
// these and maps exceptions to status codes.
#pragma once

#include <cstddef>
#include <cstdint>
#include <span>
#include <vector>

#include "echospace/export.h"

namespace echospace::dsp {

// ---------------------------------------------------------------------------------------------
// Windows and FFT

// Symmetric Hann window: w[i] = 0.5 - 0.5 cos(2 pi i / (n - 1)); w = {1} for n == 1.
ES_API void hann(std::span<double> w);

constexpr bool is_pow2(std::size_t n) noexcept { return n != 0 && (n & (n - 1)) == 0; }

// Radix-2 complex FFT plan for a fixed power-of-two length. Twiddles and the bit-reversal
// permutation are computed once; transforms are in place. The inverse is scaled by 1/n.
class ES_API FftPlan {
public:
    explicit FftPlan(std::size_t n);

    std::size_t size() const noexcept { return n_; }

    void forward(std::span<double> re, std::span<double> im) const { run(re, im, false); }
    void inverse(std::span<double> re, std::span<double> im) const { run(re, im, true); }
    void run(std::span<double> re, std::span<double> im, bool inverse) const;

    // `rows` contiguous transforms of length size(): re/im hold rows * size() values.
    void run_batch(std::span<double> re, std::span<double> im, bool inverse) const;

private:
    std::size_t n_;
    std::vector<std::uint32_t> swaps_;  // (i, j) pairs with i < j, flattened
    std::vector<double> wr_, wi_;       // forward twiddles exp(-2 pi i k / n), k < n/2
};

// One-shot helpers that build a plan internally.
ES_API void fft(std::span<double> re, std::span<double> im, bool inverse = false);
ES_API void fft_batch(std::span<double> re, std::span<double> im, std::size_t n, bool inverse = false);

// Doppler power spectrum in dB of one complex series (same convention as dopplerSpectrum in
// fft.ts): subtract the complex mean, apply a Hann window of the series length, zero-pad (or
// truncate) to nfft = out_db.size(), FFT, fftshift, then 10 log10(|X|^2 + 1e-12).
// Index 0 of the output corresponds to -fs/2. nfft must be a power of two.
ES_API void doppler_spectrum(std::span<const double> re, std::span<const double> im,
                             std::span<double> out_db);

// `rows` series of length n each (re/im: rows * n), output rows * nfft.
ES_API void doppler_spectrum_batch(std::span<const double> re, std::span<const double> im,
                                   std::size_t n, std::size_t nfft, std::span<double> out_db);

// ---------------------------------------------------------------------------------------------
// CSI preprocessing

// Phase unwrapping along a 1-D sequence (unwrap in sanitize.ts).
ES_API void unwrap(std::span<const double> phase, std::span<double> out);

struct LineFit {
    double slope = 0.0;
    double intercept = 0.0;
    int ref_antenna = -1;  // -1 when no antenna has a finite first sample
};

// Linear phase sanitization of one CSI packet laid out [M x K] (antenna-major), as in
// sanitizePacket (sanitize.ts): unwrap the phase of the first antenna whose first sample is
// finite, least-squares fit phase = slope * x + intercept against the subcarrier offsets x
// (length K), and rotate every antenna by -(slope * x + intercept). out_phase receives each
// antenna's own unwrapped phase minus the fitted line. Any output span may be empty to skip it.
ES_API LineFit sanitize_packet(std::span<const double> re, std::span<const double> im,
                               std::size_t M, std::size_t K, std::span<const double> x,
                               std::span<double> out_re, std::span<double> out_im,
                               std::span<double> out_phase);

// Hampel identifier (hampel.ts): a sample further than n_sigma * 1.4826 * MAD from the median
// of its window [i - half_window, i + half_window] (finite samples only, clipped at the
// edges) is replaced by that median. Windows with fewer than 3 finite samples, or MAD == 0,
// leave the sample untouched. Returns the number of replaced samples.
ES_API std::size_t hampel(std::span<const double> x, std::size_t half_window, double n_sigma,
                          std::span<double> y);

// ---------------------------------------------------------------------------------------------
// Reconstruction

// Standard normal CDF via the Abramowitz-Stegun 7.1.26 erf approximation (|error| < 1.5e-7),
// identical to normCdf in recon/linalg.ts.
ES_API double norm_cdf(double x) noexcept;

// Posterior apply of the Bayesian RTI operator (RtiModel.reconstruct in rti.ts) for a dense
// set of active links:
//   image = Pi y                         Pi: V x L row-major
//   z     = image / null_std             (0 where null_std <= 1e-12)
//   occ   = 0.5 if var_ratio > 0.95 else Phi(z - z0)
struct RtiOperator {
    std::span<const double> pi;         // V * L
    std::span<const double> null_std;   // V
    std::span<const double> var_ratio;  // V
    std::size_t V = 0;
    std::size_t L = 0;
};

ES_API void rti_apply(const RtiOperator& op, std::span<const double> y, double z0,
                      std::span<double> image, std::span<double> z, std::span<double> occupancy);

// Batched over frames: y is frames x L, outputs frames x V.
ES_API void rti_apply_batch(const RtiOperator& op, std::span<const double> y, std::size_t frames,
                            double z0, std::span<double> image, std::span<double> z,
                            std::span<double> occupancy);

// Coherent delay-and-sum back-projection (BackProjectionModel.image in backprojection.ts):
//   I(v) = sum_l |sum_m sum_k D_lmk exp(+j 2 pi (f0 + k df) tau_vlm)|^2 / norm_l
// tau:      V x L x Mmax excess delays in seconds
// dyn_re/im: L x Mmax x K dynamic CSI; samples whose real part is NaN are skipped
// link_valid: L flags (empty = all links valid); a link with flag 0 contributes nothing
// antennas: per-link antenna count <= Mmax (empty = Mmax for every link)
// norm:     L normalisers; 0 or NaN is treated as 1
struct BackProjectionInput {
    std::span<const double> tau;
    std::span<const double> dyn_re;
    std::span<const double> dyn_im;
    std::span<const std::uint8_t> link_valid;
    std::span<const std::int32_t> antennas;
    std::span<const double> norm;
    std::size_t V = 0, L = 0, Mmax = 0, K = 0;
    double f0 = 0.0;
    double df = 0.0;
};

ES_API void backprojection(const BackProjectionInput& in, std::span<double> out);

}  // namespace echospace::dsp
