#include <algorithm>
#include <cmath>
#include <numbers>
#include <stdexcept>
#include <vector>

#include "echospace/dsp.hpp"

namespace echospace::dsp {

void unwrap(std::span<const double> phase, std::span<double> out) {
    if (out.size() != phase.size()) throw std::invalid_argument("unwrap: size mismatch");
    if (phase.empty()) return;
    constexpr double pi = std::numbers::pi;
    constexpr double two_pi = 2.0 * std::numbers::pi;
    out[0] = phase[0];
    double offset = 0.0;
    for (std::size_t i = 1; i < phase.size(); ++i) {
        const double d = phase[i] - phase[i - 1];
        // JS Math.round rounds halves up; floor(x + 0.5) reproduces that for the values here.
        if (d > pi)
            offset -= two_pi * std::floor(d / two_pi + 0.5);
        else if (d < -pi)
            offset += two_pi * std::floor(-d / two_pi + 0.5);
        out[i] = phase[i] + offset;
    }
}

namespace {

LineFit linear_fit(std::span<const double> x, std::span<const double> y) {
    const std::size_t n = x.size();
    double sx = 0.0;
    double sy = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        sx += x[i];
        sy += y[i];
    }
    const double mx = sx / static_cast<double>(n);
    const double my = sy / static_cast<double>(n);
    double sxx = 0.0;
    double sxy = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        sxx += (x[i] - mx) * (x[i] - mx);
        sxy += (x[i] - mx) * (y[i] - my);
    }
    LineFit f;
    f.slope = sxx > 0.0 ? sxy / sxx : 0.0;
    f.intercept = my - f.slope * mx;
    return f;
}

}  // namespace

LineFit sanitize_packet(std::span<const double> re, std::span<const double> im, std::size_t M,
                        std::size_t K, std::span<const double> x, std::span<double> out_re,
                        std::span<double> out_im, std::span<double> out_phase) {
    const std::size_t n = M * K;
    if (K == 0 || re.size() != n || im.size() != n || x.size() != K)
        throw std::invalid_argument("sanitize_packet: inconsistent sizes");
    for (auto s : {out_re, out_im, out_phase})
        if (!s.empty() && s.size() != n)
            throw std::invalid_argument("sanitize_packet: output size must be M * K");

    std::vector<double> raw(K), unw(K);
    auto raw_phase = [&](std::size_t m) {
        for (std::size_t k = 0; k < K; ++k) raw[k] = std::atan2(im[m * K + k], re[m * K + k]);
    };

    LineFit fit;
    for (std::size_t m = 0; m < M; ++m) {
        if (std::isfinite(re[m * K]) && std::isfinite(im[m * K])) {
            fit.ref_antenna = static_cast<int>(m);
            break;
        }
    }
    if (fit.ref_antenna >= 0) {
        raw_phase(static_cast<std::size_t>(fit.ref_antenna));
        unwrap(raw, unw);
        const LineFit line = linear_fit(x, unw);
        fit.slope = line.slope;
        fit.intercept = line.intercept;
    }

    std::vector<double> c(K), s(K);
    for (std::size_t k = 0; k < K; ++k) {
        const double corr = fit.slope * x[k] + fit.intercept;
        c[k] = std::cos(-corr);
        s[k] = std::sin(-corr);
    }

    for (std::size_t m = 0; m < M; ++m) {
        if (!out_phase.empty()) {
            raw_phase(m);
            unwrap(raw, unw);
        }
        for (std::size_t k = 0; k < K; ++k) {
            const std::size_t i = m * K + k;
            if (!out_re.empty()) out_re[i] = re[i] * c[k] - im[i] * s[k];
            if (!out_im.empty()) out_im[i] = re[i] * s[k] + im[i] * c[k];
            if (!out_phase.empty()) out_phase[i] = unw[k] - (fit.slope * x[k] + fit.intercept);
        }
    }
    return fit;
}

namespace {

// Median of v (reordered in place). v must be non-empty.
double median_inplace(std::vector<double>& v) {
    const std::size_t m = v.size() / 2;
    auto mid = v.begin() + static_cast<std::ptrdiff_t>(m);
    std::nth_element(v.begin(), mid, v.end());
    const double hi = *mid;
    if (v.size() % 2) return hi;
    const double lo = *std::max_element(v.begin(), mid);
    return (lo + hi) / 2.0;
}

}  // namespace

std::size_t hampel(std::span<const double> x, std::size_t half_window, double n_sigma,
                   std::span<double> y) {
    const std::size_t n = x.size();
    if (y.size() != n) throw std::invalid_argument("hampel: output size mismatch");
    std::copy(x.begin(), x.end(), y.begin());

    std::size_t replaced = 0;
    std::vector<double> win;
    win.reserve(2 * half_window + 1);
    for (std::size_t i = 0; i < n; ++i) {
        win.clear();
        const std::size_t lo = i > half_window ? i - half_window : 0;
        const std::size_t hi = std::min(n - 1, i + half_window);
        for (std::size_t j = lo; j <= hi; ++j)
            if (std::isfinite(x[j])) win.push_back(x[j]);
        if (win.size() < 3) continue;
        const double med = median_inplace(win);
        for (double& v : win) v = std::abs(v - med);
        const double mad = 1.4826 * median_inplace(win);
        if (std::isfinite(x[i]) && std::abs(x[i] - med) > n_sigma * mad && mad > 0.0) {
            y[i] = med;
            ++replaced;
        }
    }
    return replaced;
}

}  // namespace echospace::dsp
