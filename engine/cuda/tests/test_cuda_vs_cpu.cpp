// Compares every CUDA entry point with the CPU implementation on random inputs.
// Exits with 77 (CTest "skipped") when no CUDA device is visible.
//
// Tolerances: rtol 1e-9 plus an absolute floor of 1e-12 x max|reference| (device FMA
// contraction and a different summation/FFT order change rounding, not results); occupancy
// atol 1e-12 (same A&S formula on both sides); Doppler dB atol 1e-9.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <random>
#include <tuple>
#include <vector>

#include "echospace/dsp.hpp"
#include "echospace/dsp_c.h"
#include "echospace/dsp_cuda.h"
#include "harness.hpp"

namespace {

std::vector<double> randn(std::size_t n, std::mt19937_64& rng, double scale = 1.0) {
    std::normal_distribution<double> d(0.0, scale);
    std::vector<double> v(n);
    for (auto& x : v) x = d(rng);
    return v;
}

std::vector<double> uniform(std::size_t n, std::mt19937_64& rng, double lo, double hi) {
    std::uniform_real_distribution<double> d(lo, hi);
    std::vector<double> v(n);
    for (auto& x : v) x = d(rng);
    return v;
}

double max_abs(const std::vector<double>& v) {
    double m = 0.0;
    for (double x : v) m = std::max(m, std::abs(x));
    return m;
}

void check_close(const std::vector<double>& got, const std::vector<double>& ref, double rtol,
                 double atol, const char* what) {
    std::size_t bad = 0;
    for (std::size_t i = 0; i < ref.size(); ++i)
        if (!(std::abs(got[i] - ref[i]) <= atol + rtol * std::abs(ref[i]))) ++bad;
    if (bad) {
        std::fprintf(stderr, "  %s: %zu / %zu elements out of tolerance\n", what, bad, ref.size());
        es_test::fail(__FILE__, __LINE__, what);
    }
}

}  // namespace

TEST(cuda_rti_apply_batch_matches_cpu) {
    std::mt19937_64 rng(1);
    const std::size_t V = 5280, L = 28, F = 100;
    auto pi = randn(V * L, rng, 0.05), y = randn(F * L, rng, 2.0);
    auto sd = uniform(V, rng, 0.05, 0.5), vr = uniform(V, rng, 0.0, 1.0);
    for (std::size_t i = 0; i < V; i += 97) sd[i] = 0.0;

    std::vector<double> img(F * V), z(F * V), occ(F * V);
    CHECK(es_rti_apply_batch(pi.data(), sd.data(), vr.data(), V, L, y.data(), F, 1.5, img.data(),
                             z.data(), occ.data()) == ES_OK);

    es_cuda_rti* ctx = nullptr;
    CHECK(es_cuda_rti_create(pi.data(), sd.data(), vr.data(), V, L, &ctx) == ES_OK);
    std::vector<double> gimg(F * V), gz(F * V), gocc(F * V);
    CHECK(es_cuda_rti_apply_batch(ctx, y.data(), F, 1.5, gimg.data(), gz.data(), gocc.data()) == ES_OK);
    es_cuda_rti_destroy(ctx);

    check_close(gimg, img, 1e-9, 1e-12 * max_abs(img), "image");
    check_close(gz, z, 1e-9, 1e-12 * max_abs(z), "z");
    check_close(gocc, occ, 0.0, 1e-12, "occupancy");
}

TEST(cuda_backprojection_matches_cpu) {
    std::mt19937_64 rng(2);
    const std::size_t V = 5280, L = 28, M = 3, K = 30;
    auto tau = uniform(V * L * M, rng, 0.0, 40e-9);
    auto dr = randn(L * M * K, rng), di = randn(L * M * K, rng);
    dr[17] = std::nan("");
    auto norm = uniform(L, rng, 0.5, 2.0);
    norm[3] = 0.0;
    std::vector<std::uint8_t> valid(L, 1);
    valid[5] = 0;
    std::vector<std::int32_t> ants(L, 3);
    ants[7] = 2;
    const double f0 = 5.18e9, df = 312.5e3;

    std::vector<double> ref(V), got(V);
    CHECK(es_backprojection(tau.data(), V, L, M, K, dr.data(), di.data(), valid.data(), ants.data(),
                            norm.data(), f0, df, ref.data()) == ES_OK);
    es_cuda_bp* ctx = nullptr;
    CHECK(es_cuda_bp_create(tau.data(), V, L, M, K, ants.data(), f0, df, &ctx) == ES_OK);
    CHECK(es_cuda_bp_image(ctx, dr.data(), di.data(), valid.data(), norm.data(), got.data()) == ES_OK);
    es_cuda_bp_destroy(ctx);
    check_close(got, ref, 1e-9, 1e-12 * max_abs(ref), "backprojection");
}

TEST(cuda_doppler_matches_cpu) {
    std::mt19937_64 rng(3);
    for (auto [rows, n, nfft] : {std::tuple<std::size_t, std::size_t, std::size_t>{84, 128, 256},
                                 {16, 300, 256},
                                 {4, 64, 64}}) {
        auto re = randn(rows * n, rng), im = randn(rows * n, rng);
        std::vector<double> ref(rows * nfft), got(rows * nfft);
        CHECK(es_doppler_spectrum_batch(re.data(), im.data(), rows, n, nfft, ref.data()) == ES_OK);
        CHECK(es_cuda_doppler_spectrum_batch(re.data(), im.data(), rows, n, nfft, got.data()) == ES_OK);
        check_close(got, ref, 1e-9, 1e-9, "doppler dB");
    }
}

TEST(cuda_rejects_bad_arguments) {
    double buf[8] = {};
    CHECK(es_cuda_doppler_spectrum_batch(buf, buf, 1, 8, 12, buf) == ES_ERR_NOT_POW2);
    CHECK(es_cuda_rti_apply_batch(nullptr, buf, 1, 0.0, nullptr, nullptr, buf) == ES_ERR_NULL);
}

int main() {
    int devices = 0;
    es_cuda_device_count(&devices);
    if (devices == 0) {
        std::printf("no CUDA device visible; skipping\n");
        return 77;
    }
    return es_test::run_all();
}
