// Self-contained checks of the DSP kernels against direct (slow) formulas. Cross-checks
// against NumPy/SciPy live in engine/tests/test_native_vs_numpy.py.
#include <cmath>
#include <complex>
#include <limits>
#include <numbers>
#include <random>
#include <vector>

#include "echospace/dsp.hpp"
#include "echospace/dsp_c.h"
#include "harness.hpp"

namespace dsp = echospace::dsp;
using cd = std::complex<double>;

namespace {

constexpr double kPi = std::numbers::pi;

std::vector<cd> naive_dft(const std::vector<double>& re, const std::vector<double>& im, bool inv) {
    const std::size_t n = re.size();
    std::vector<cd> out(n);
    const double sgn = inv ? 1.0 : -1.0;
    for (std::size_t k = 0; k < n; ++k) {
        cd s = 0.0;
        for (std::size_t t = 0; t < n; ++t)
            s += cd(re[t], im[t]) * std::polar(1.0, sgn * 2.0 * kPi * double(k * t % n) / double(n));
        out[k] = inv ? s / double(n) : s;
    }
    return out;
}

std::vector<double> randn(std::size_t n, std::mt19937_64& rng) {
    std::normal_distribution<double> d;
    std::vector<double> v(n);
    for (auto& x : v) x = d(rng);
    return v;
}

}  // namespace

TEST(hann_matches_definition) {
    std::vector<double> w(16);
    dsp::hann(w);
    for (std::size_t i = 0; i < w.size(); ++i)
        CHECK_NEAR(w[i], 0.5 - 0.5 * std::cos(2 * kPi * double(i) / 15.0), 1e-15);
    CHECK_NEAR(w.front(), 0.0, 1e-15);
    std::vector<double> one(1);
    dsp::hann(one);
    CHECK(one[0] == 1.0);
}

TEST(fft_matches_naive_dft) {
    std::mt19937_64 rng(1);
    for (std::size_t n : {1u, 2u, 4u, 8u, 64u, 256u}) {
        auto re = randn(n, rng), im = randn(n, rng);
        for (bool inv : {false, true}) {
            auto ref = naive_dft(re, im, inv);
            auto r = re, i = im;
            dsp::fft(r, i, inv);
            for (std::size_t k = 0; k < n; ++k) {
                CHECK_NEAR(r[k], ref[k].real(), 1e-10 * double(n));
                CHECK_NEAR(i[k], ref[k].imag(), 1e-10 * double(n));
            }
        }
    }
}

TEST(fft_roundtrip_and_batch) {
    std::mt19937_64 rng(2);
    const std::size_t n = 1024, rows = 5;
    auto re = randn(n * rows, rng), im = randn(n * rows, rng);
    auto r = re, i = im;
    dsp::fft_batch(r, i, n, false);
    // Each row equals a single transform of that row.
    std::vector<double> r1(re.begin() + n, re.begin() + 2 * n), i1(im.begin() + n, im.begin() + 2 * n);
    dsp::fft(r1, i1);
    for (std::size_t k = 0; k < n; ++k) CHECK(r1[k] == r[n + k] && i1[k] == i[n + k]);
    dsp::fft_batch(r, i, n, true);
    for (std::size_t k = 0; k < n * rows; ++k) {
        CHECK_NEAR(r[k], re[k], 1e-12);
        CHECK_NEAR(i[k], im[k], 1e-12);
    }
}

TEST(fft_rejects_non_pow2) {
    std::vector<double> r(12), i(12);
    CHECK_THROWS(dsp::fft(r, i));
    CHECK(es_fft(r.data(), i.data(), 12, 0) == ES_ERR_NOT_POW2);
    CHECK(es_fft(nullptr, i.data(), 8, 0) == ES_ERR_NULL);
}

TEST(doppler_peak_at_tone) {
    // A complex tone at bin +8 of a 64-point FFT should peak at shifted index 32 + 8.
    const std::size_t n = 64, nfft = 64;
    std::vector<double> re(n), im(n), out(nfft);
    for (std::size_t t = 0; t < n; ++t) {
        re[t] = 3.0 + std::cos(2 * kPi * 8.0 * double(t) / double(n));
        im[t] = -1.0 + std::sin(2 * kPi * 8.0 * double(t) / double(n));
    }
    dsp::doppler_spectrum(re, im, out);
    std::size_t arg = 0;
    for (std::size_t k = 1; k < nfft; ++k)
        if (out[k] > out[arg]) arg = k;
    CHECK(arg == 40);
    // Mean removal: the DC bin (shifted index 32) is far below the peak.
    CHECK(out[32] < out[40] - 40.0);
}

TEST(doppler_constant_input_is_floor) {
    std::vector<double> re(10, 2.0), im(10, -1.0), out(16);
    dsp::doppler_spectrum(re, im, out);
    for (double v : out) CHECK_NEAR(v, -120.0, 1e-6);
}

TEST(unwrap_removes_jumps) {
    const std::size_t n = 50;
    std::vector<double> truth(n), wrapped(n), out(n);
    for (std::size_t i = 0; i < n; ++i) {
        truth[i] = 0.7 * double(i) - 3.0;
        wrapped[i] = std::atan2(std::sin(truth[i]), std::cos(truth[i]));
    }
    dsp::unwrap(wrapped, out);
    const double shift = out[0] - truth[0];
    for (std::size_t i = 0; i < n; ++i) CHECK_NEAR(out[i] - truth[i], shift, 1e-12);
}

TEST(sanitize_removes_common_line) {
    const std::size_t M = 3, K = 30;
    std::vector<double> x(K), re(M * K), im(M * K), ore(M * K), oim(M * K), oph(M * K);
    for (std::size_t k = 0; k < K; ++k) x[k] = double(k) - 14.5;
    const double slope = 0.4, icpt = 1.1;
    const double ant_offset[] = {0.0, 0.5, -0.8};
    for (std::size_t m = 0; m < M; ++m)
        for (std::size_t k = 0; k < K; ++k) {
            const double ph = slope * x[k] + icpt + ant_offset[m];
            re[m * K + k] = 2.0 * std::cos(ph);
            im[m * K + k] = 2.0 * std::sin(ph);
        }
    auto fit = dsp::sanitize_packet(re, im, M, K, x, ore, oim, oph);
    CHECK(fit.ref_antenna == 0);
    CHECK_NEAR(fit.slope, slope, 1e-12);
    // Intercept is only defined modulo 2 pi.
    CHECK_NEAR(std::remainder(fit.intercept - icpt, 2 * kPi), 0.0, 1e-12);
    for (std::size_t m = 0; m < M; ++m)
        for (std::size_t k = 0; k < K; ++k) {
            const std::size_t i = m * K + k;
            // Inter-antenna phase offsets survive; the line is gone.
            CHECK_NEAR(std::atan2(oim[i], ore[i]), ant_offset[m], 1e-12);
            CHECK_NEAR(std::hypot(ore[i], oim[i]), 2.0, 1e-12);
        }
}

TEST(sanitize_skips_nonfinite_reference) {
    const std::size_t M = 2, K = 4;
    std::vector<double> x{0, 1, 2, 3}, re(M * K, 1.0), im(M * K, 0.5), ore(M * K);
    re[0] = std::numeric_limits<double>::quiet_NaN();
    auto fit = dsp::sanitize_packet(re, im, M, K, x, ore, {}, {});
    CHECK(fit.ref_antenna == 1);
    std::fill(re.begin(), re.begin() + K, std::numeric_limits<double>::quiet_NaN());
    re[K] = std::numeric_limits<double>::infinity();
    fit = dsp::sanitize_packet(re, im, M, K, x, ore, {}, {});
    CHECK(fit.ref_antenna == -1 && fit.slope == 0.0 && fit.intercept == 0.0);
}

TEST(hampel_replaces_outlier) {
    std::vector<double> x{1, 2, 1, 2, 1, 50, 2, 1, 2, 1}, y(x.size());
    const std::size_t r = dsp::hampel(x, 3, 3.0, y);
    CHECK(r == 1);
    // Window {1,2,1,50,2,1,2}: median 2, MAD 1.4826.
    CHECK(y[5] == 2.0);
    for (std::size_t i = 0; i < x.size(); ++i)
        if (i != 5) CHECK(y[i] == x[i]);
}

TEST(hampel_even_window_median_and_nan) {
    const double nan = std::numeric_limits<double>::quiet_NaN();
    std::vector<double> x{0, 0, 1, 1, nan, 9, 0, 1}, y(x.size());
    const std::size_t r = dsp::hampel(x, 2, 2.0, y);
    // Window of x[5] = {1, nan, 9, 0, 1} -> finite {1, 9, 0, 1}, median 1, MAD 1.4826 * 0.5...
    CHECK(std::isnan(y[4]));
    CHECK(r >= 1);
    CHECK(y[5] == 1.0);
}

TEST(norm_cdf_accuracy) {
    for (double x = -6.0; x <= 6.0; x += 0.01)
        CHECK_NEAR(dsp::norm_cdf(x), 0.5 * std::erfc(-x / std::numbers::sqrt2), 1.5e-7);
    // The A&S coefficients sum to 0.999999999, so Phi(0) = 0.5 + 5e-10 rather than exactly 0.5.
    CHECK_NEAR(dsp::norm_cdf(0.0), 0.5, 1e-9);
    CHECK(dsp::norm_cdf(-3.0) + dsp::norm_cdf(3.0) == 1.0);
}

TEST(rti_batch_equals_single_frames) {
    std::mt19937_64 rng(3);
    const std::size_t V = 150, L = 7, F = 4;
    auto pi = randn(V * L, rng), y = randn(F * L, rng);
    std::vector<double> sd(V), vr(V);
    std::uniform_real_distribution<double> u(0.0, 1.0);
    for (std::size_t i = 0; i < V; ++i) {
        sd[i] = i % 17 == 0 ? 0.0 : 0.1 + u(rng);
        vr[i] = u(rng);
    }
    const dsp::RtiOperator op{pi, sd, vr, V, L};
    std::vector<double> img(F * V), z(F * V), occ(F * V);
    dsp::rti_apply_batch(op, y, F, 1.5, img, z, occ);
    for (std::size_t f = 0; f < F; ++f) {
        std::vector<double> i1(V), z1(V), o1(V);
        dsp::rti_apply(op, std::span(y).subspan(f * L, L), 1.5, i1, z1, o1);
        for (std::size_t v = 0; v < V; ++v) {
            CHECK(img[f * V + v] == i1[v] && z[f * V + v] == z1[v] && occ[f * V + v] == o1[v]);
            double s = 0.0;
            for (std::size_t a = 0; a < L; ++a) s += pi[v * L + a] * y[f * L + a];
            CHECK_NEAR(i1[v], s, 1e-12);
            if (sd[v] == 0.0) CHECK(z1[v] == 0.0);
            if (vr[v] > 0.95) CHECK(o1[v] == 0.5);
            else CHECK_NEAR(o1[v], dsp::norm_cdf(z1[v] - 1.5), 0.0);
        }
    }
    // Occupancy alone (image/z skipped) matches.
    std::vector<double> occ2(F * V);
    dsp::rti_apply_batch(op, y, F, 1.5, {}, {}, occ2);
    CHECK(occ2 == occ);
}

TEST(backprojection_matches_direct_sum) {
    std::mt19937_64 rng(4);
    const std::size_t V = 40, L = 4, Mmax = 3, K = 8;
    std::uniform_real_distribution<double> u(0.0, 30e-9);
    std::vector<double> tau(V * L * Mmax);
    for (auto& t : tau) t = u(rng);
    auto dr = randn(L * Mmax * K, rng), di = randn(L * Mmax * K, rng);
    dr[5] = std::numeric_limits<double>::quiet_NaN();
    std::vector<double> norm{2.0, 0.0, 0.5, 1.0};
    std::vector<std::uint8_t> valid{1, 1, 0, 1};
    std::vector<std::int32_t> ants{3, 2, 3, 1};
    const double f0 = 5.18e9, df = 312.5e3 * 2;

    dsp::BackProjectionInput in;
    in.tau = tau;
    in.dyn_re = dr;
    in.dyn_im = di;
    in.link_valid = valid;
    in.antennas = ants;
    in.norm = norm;
    in.V = V, in.L = L, in.Mmax = Mmax, in.K = K, in.f0 = f0, in.df = df;
    std::vector<double> out(V);
    dsp::backprojection(in, out);

    for (std::size_t v = 0; v < V; ++v) {
        double total = 0.0;
        for (std::size_t l = 0; l < L; ++l) {
            if (!valid[l]) continue;
            cd s = 0.0;
            for (std::size_t m = 0; m < std::size_t(ants[l]); ++m)
                for (std::size_t k = 0; k < K; ++k) {
                    const std::size_t idx = (l * Mmax + m) * K + k;
                    if (std::isnan(dr[idx])) continue;
                    const double t = tau[(v * L + l) * Mmax + m];
                    s += cd(dr[idx], di[idx]) * std::polar(1.0, 2 * kPi * (f0 + double(k) * df) * t);
                }
            total += std::norm(s) / (norm[l] != 0.0 ? norm[l] : 1.0);
        }
        CHECK_NEAR(out[v], total, 1e-9 * std::max(1.0, total));
    }
}

TEST(c_abi_reports_size_errors) {
    std::vector<double> buf(8);
    CHECK(es_abi_version() == ES_ABI_VERSION);
    CHECK(es_doppler_spectrum(buf.data(), buf.data(), 0, 8, buf.data()) == ES_ERR_SIZE);
    CHECK(es_rti_apply(buf.data(), buf.data(), buf.data(), 0, 2, buf.data(), 0.0, nullptr, nullptr,
                       buf.data()) == ES_ERR_SIZE);
    CHECK(std::string(es_status_string(ES_ERR_NOT_POW2)).find("power of two") != std::string::npos);
}

TEST_MAIN()
