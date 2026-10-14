#include <algorithm>
#include <cmath>
#include <numbers>
#include <stdexcept>

#include "echospace/dsp.hpp"

namespace echospace::dsp {

double norm_cdf(double x) noexcept {
    const double z = std::abs(x) / std::numbers::sqrt2;
    const double t = 1.0 / (1.0 + 0.3275911 * z);
    const double y =
        1.0 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
               0.254829592) *
                  t * std::exp(-z * z);
    return x >= 0.0 ? 0.5 * (1.0 + y) : 0.5 * (1.0 - y);
}

namespace {

// Four partial sums: breaks the serial floating-point add chain (latency bound otherwise)
// without needing -ffast-math to reassociate.
inline double dot(const double* a, const double* b, std::size_t n) {
    double s0 = 0.0, s1 = 0.0, s2 = 0.0, s3 = 0.0;
    std::size_t k = 0;
    for (; k + 4 <= n; k += 4) {
        s0 += a[k] * b[k];
        s1 += a[k + 1] * b[k + 1];
        s2 += a[k + 2] * b[k + 2];
        s3 += a[k + 3] * b[k + 3];
    }
    for (; k < n; ++k) s0 += a[k] * b[k];
    return (s0 + s1) + (s2 + s3);
}

void check_rti(const RtiOperator& op, std::size_t y_size, std::size_t frames,
               std::span<double> image, std::span<double> z, std::span<double> occupancy) {
    if (op.V == 0 || op.L == 0) throw std::invalid_argument("rti: V and L must be positive");
    if (op.pi.size() != op.V * op.L || op.null_std.size() != op.V || op.var_ratio.size() != op.V)
        throw std::invalid_argument("rti: operator sizes do not match V x L");
    if (y_size != frames * op.L) throw std::invalid_argument("rti: y must hold frames x L values");
    const std::size_t out = frames * op.V;
    if (occupancy.size() != out) throw std::invalid_argument("rti: occupancy must hold frames x V");
    if ((!image.empty() && image.size() != out) || (!z.empty() && z.size() != out))
        throw std::invalid_argument("rti: image/z must be empty or hold frames x V");
}

}  // namespace

void rti_apply(const RtiOperator& op, std::span<const double> y, double z0,
               std::span<double> image, std::span<double> z, std::span<double> occupancy) {
    rti_apply_batch(op, y, 1, z0, image, z, occupancy);
}

void rti_apply_batch(const RtiOperator& op, std::span<const double> y, std::size_t frames,
                     double z0, std::span<double> image, std::span<double> z,
                     std::span<double> occupancy) {
    check_rti(op, y.size(), frames, image, z, occupancy);
    const std::size_t V = op.V;
    const std::size_t L = op.L;

    auto finish = [&](std::size_t f, std::size_t i, double s) {
        const std::size_t o = f * V + i;
        const double sd = op.null_std[i];
        const double zi = sd > 1e-12 ? s / sd : 0.0;
        if (!image.empty()) image[o] = s;
        if (!z.empty()) z[o] = zi;
        occupancy[o] = op.var_ratio[i] > 0.95 ? 0.5 : norm_cdf(zi - z0);
    };

    // Tile over voxels so a block of Pi rows stays in L1 while every frame streams past it.
    // Every frame uses the same summation order, so results do not depend on batching.
    constexpr std::size_t kBlock = 64;
    for (std::size_t v0 = 0; v0 < V; v0 += kBlock) {
        const std::size_t v1 = std::min(V, v0 + kBlock);
        for (std::size_t f = 0; f < frames; ++f) {
            const double* yf = y.data() + f * L;
            for (std::size_t i = v0; i < v1; ++i) finish(f, i, dot(op.pi.data() + i * L, yf, L));
        }
    }
}

void backprojection(const BackProjectionInput& in, std::span<double> out) {
    const std::size_t V = in.V, L = in.L, Mmax = in.Mmax, K = in.K;
    if (V == 0 || L == 0 || Mmax == 0 || K == 0)
        throw std::invalid_argument("backprojection: dimensions must be positive");
    if (in.tau.size() != V * L * Mmax) throw std::invalid_argument("backprojection: tau size");
    if (in.dyn_re.size() != L * Mmax * K || in.dyn_im.size() != L * Mmax * K)
        throw std::invalid_argument("backprojection: dyn size must be L x Mmax x K");
    if (in.norm.size() != L) throw std::invalid_argument("backprojection: norm size");
    if (!in.link_valid.empty() && in.link_valid.size() != L)
        throw std::invalid_argument("backprojection: link_valid size");
    if (!in.antennas.empty() && in.antennas.size() != L)
        throw std::invalid_argument("backprojection: antennas size");
    for (auto m : in.antennas)
        if (m < 0 || static_cast<std::size_t>(m) > Mmax)
            throw std::invalid_argument("backprojection: antenna count out of range");
    if (out.size() != V) throw std::invalid_argument("backprojection: output size must be V");

    constexpr double two_pi = 2.0 * std::numbers::pi;
    for (std::size_t v = 0; v < V; ++v) {
        double total = 0.0;
        for (std::size_t l = 0; l < L; ++l) {
            if (!in.link_valid.empty() && !in.link_valid[l]) continue;
            const std::size_t M =
                in.antennas.empty() ? Mmax : static_cast<std::size_t>(in.antennas[l]);
            double sr = 0.0;
            double si = 0.0;
            for (std::size_t m = 0; m < M; ++m) {
                const double t = in.tau[(v * L + l) * Mmax + m];
                const double p0 = two_pi * in.f0 * t;
                const double dp = two_pi * in.df * t;
                double cr = std::cos(p0);
                double ci = std::sin(p0);
                const double wr = std::cos(dp);
                const double wi = std::sin(dp);
                const double* dr = in.dyn_re.data() + (l * Mmax + m) * K;
                const double* di = in.dyn_im.data() + (l * Mmax + m) * K;
                // Phasor advanced by recurrence across subcarriers, as in backprojection.ts.
                for (std::size_t k = 0; k < K; ++k) {
                    const double ar = dr[k];
                    const double ai = di[k];
                    if (!std::isnan(ar)) {
                        sr += ar * cr - ai * ci;
                        si += ar * ci + ai * cr;
                    }
                    const double nr = cr * wr - ci * wi;
                    ci = cr * wi + ci * wr;
                    cr = nr;
                }
            }
            const double nl = in.norm[l];
            total += (sr * sr + si * si) / ((nl != 0.0 && !std::isnan(nl)) ? nl : 1.0);
        }
        out[v] = total;
    }
}

}  // namespace echospace::dsp
