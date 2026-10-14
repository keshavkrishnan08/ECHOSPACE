// echospace_bench: timing harness for the native DSP kernels.
//
// Method: each benchmark prepares its inputs once, runs `warmup` untimed calls, then times
// `iterations` individual calls with std::chrono::steady_clock. Any per-call input reset (for
// in-place FFTs) happens outside the timed region. Reported statistics are over the per-call
// samples; p95/p99 use the nearest-rank method and are only reported with >= 100 samples.
// Kernels are single-threaded.
//
// Usage: echospace_bench [--json PATH] [--iterations N] [--warmup N] [--filter SUBSTR]
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <fstream>
#include <functional>
#include <optional>
#include <random>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include <sys/utsname.h>

#include "echospace/dsp.hpp"

namespace dsp = echospace::dsp;

#ifndef ECHOSPACE_BUILD_TYPE
#define ECHOSPACE_BUILD_TYPE "unknown"
#endif
#ifndef ECHOSPACE_CXX_FLAGS
#define ECHOSPACE_CXX_FLAGS "unknown"
#endif

namespace {

constexpr std::size_t kMinSamplesForTail = 100;

struct Options {
    std::string json_path;
    std::optional<int> iterations;
    std::optional<int> warmup;
    std::string filter;
};

struct Benchmark {
    std::string name;
    std::string params;
    std::string item_unit;  // what "items" counts, e.g. "frames"
    double items_per_call;
    int iterations;
    int warmup;
    std::function<void()> reset;  // untimed, before each call; may be empty
    std::function<void()> call;
};

struct Stats {
    std::size_t n = 0;
    double min_ns = 0, median_ns = 0, mean_ns = 0;
    std::optional<double> p95_ns, p99_ns;
};

double nearest_rank(const std::vector<double>& sorted, double p) {
    const auto rank = static_cast<std::size_t>(std::ceil(p / 100.0 * double(sorted.size())));
    return sorted[std::clamp<std::size_t>(rank, 1, sorted.size()) - 1];
}

Stats summarize(std::vector<double> ns) {
    std::sort(ns.begin(), ns.end());
    Stats s;
    s.n = ns.size();
    s.min_ns = ns.front();
    const std::size_t m = ns.size() / 2;
    s.median_ns = ns.size() % 2 ? ns[m] : 0.5 * (ns[m - 1] + ns[m]);
    double sum = 0;
    for (double v : ns) sum += v;
    s.mean_ns = sum / double(ns.size());
    if (ns.size() >= kMinSamplesForTail) {
        s.p95_ns = nearest_rank(ns, 95);
        s.p99_ns = nearest_rank(ns, 99);
    }
    return s;
}

std::vector<double> randn(std::size_t n, std::uint64_t seed, double scale = 1.0) {
    std::mt19937_64 rng(seed);
    std::normal_distribution<double> d(0.0, scale);
    std::vector<double> v(n);
    for (auto& x : v) x = d(rng);
    return v;
}

std::vector<double> uniform(std::size_t n, std::uint64_t seed, double lo, double hi) {
    std::mt19937_64 rng(seed);
    std::uniform_real_distribution<double> d(lo, hi);
    std::vector<double> v(n);
    for (auto& x : v) x = d(rng);
    return v;
}

// Results feed a checksum so the optimiser cannot drop the work.
volatile double g_sink = 0.0;
void sink(std::span<const double> v) { g_sink = g_sink + v[0] + v[v.size() / 2] + v.back(); }

// All inputs live here so the benchmark closures can capture by reference.
struct Workloads {
    // FFT
    std::vector<double> fft64_re = randn(1024 * 64, 1), fft64_im = randn(1024 * 64, 2);
    std::vector<double> fft64_wr = fft64_re, fft64_wi = fft64_im;
    std::vector<double> fft1k_re = randn(64 * 1024, 3), fft1k_im = randn(64 * 1024, 4);
    std::vector<double> fft1k_wr = fft1k_re, fft1k_wi = fft1k_im;
    dsp::FftPlan plan64{64}, plan1k{1024};

    // Doppler: 28 links x 3 antennas, 128 slow-time samples, nfft 256
    static constexpr std::size_t kDopRows = 84, kDopN = 128, kDopNfft = 256;
    std::vector<double> dop_re = randn(kDopRows * kDopN, 5), dop_im = randn(kDopRows * kDopN, 6);
    std::vector<double> dop_out = std::vector<double>(kDopRows * kDopNfft);

    // Sanitization: 28 packets of 3 x 30
    static constexpr std::size_t kP = 28, kM = 3, kK = 30;
    std::vector<double> san_re = randn(kP * kM * kK, 7), san_im = randn(kP * kM * kK, 8);
    std::vector<double> san_x, san_ore = std::vector<double>(kP * kM * kK),
                               san_oim = std::vector<double>(kP * kM * kK),
                               san_oph = std::vector<double>(kP * kM * kK);

    // RTI: V = 5280 voxels, L = 28 links
    static constexpr std::size_t kV = 5280, kL = 28, kFrames = 100;
    std::vector<double> pi = randn(kV * kL, 9, 0.05);
    std::vector<double> null_std = uniform(kV, 10, 0.05, 0.5);
    std::vector<double> var_ratio = uniform(kV, 11, 0.0, 1.0);
    std::vector<double> y1 = randn(kL, 12, 2.0), yb = randn(kFrames * kL, 13, 2.0);
    std::vector<double> rti_img = std::vector<double>(kFrames * kV),
                        rti_z = std::vector<double>(kFrames * kV),
                        rti_occ = std::vector<double>(kFrames * kV);

    // Back-projection: V = 5280, L = 28, M = 3, K = 30
    static constexpr std::size_t kBpM = 3, kBpK = 30;
    std::vector<double> tau = uniform(kV * kL * kBpM, 14, 0.0, 40e-9);
    std::vector<double> bp_re = randn(kL * kBpM * kBpK, 15), bp_im = randn(kL * kBpM * kBpK, 16);
    std::vector<double> bp_norm = uniform(kL, 17, 0.5, 2.0);
    std::vector<double> bp_out = std::vector<double>(kV);

    Workloads() {
        san_x.resize(kK);
        for (std::size_t k = 0; k < kK; ++k) san_x[k] = double(k) - 14.5;
    }
};

std::vector<Benchmark> make_benchmarks(Workloads& w) {
    std::vector<Benchmark> b;
    b.push_back({"fft_64_batch", "rows=1024 n=64 forward in-place", "points", 1024.0 * 64, 300, 30,
                 [&] { w.fft64_wr = w.fft64_re; w.fft64_wi = w.fft64_im; },
                 [&] { w.plan64.run_batch(w.fft64_wr, w.fft64_wi, false); sink(w.fft64_wr); }});
    b.push_back({"fft_1024_batch", "rows=64 n=1024 forward in-place", "points", 64.0 * 1024, 300, 30,
                 [&] { w.fft1k_wr = w.fft1k_re; w.fft1k_wi = w.fft1k_im; },
                 [&] { w.plan1k.run_batch(w.fft1k_wr, w.fft1k_wi, false); sink(w.fft1k_wr); }});
    b.push_back({"doppler_spectrum", "rows=84 n=128 nfft=256", "series", double(Workloads::kDopRows),
                 300, 30, {},
                 [&] {
                     dsp::doppler_spectrum_batch(w.dop_re, w.dop_im, Workloads::kDopN,
                                                 Workloads::kDopNfft, w.dop_out);
                     sink(w.dop_out);
                 }});
    b.push_back({"sanitize", "packets=28 M=3 K=30", "packets", double(Workloads::kP), 1000, 100, {},
                 [&] {
                     const std::size_t n = Workloads::kM * Workloads::kK;
                     for (std::size_t p = 0; p < Workloads::kP; ++p) {
                         const auto in_re = std::span<const double>(w.san_re).subspan(p * n, n);
                         const auto in_im = std::span<const double>(w.san_im).subspan(p * n, n);
                         dsp::sanitize_packet(in_re, in_im, Workloads::kM, Workloads::kK, w.san_x,
                                              std::span(w.san_ore).subspan(p * n, n),
                                              std::span(w.san_oim).subspan(p * n, n),
                                              std::span(w.san_oph).subspan(p * n, n));
                     }
                     sink(w.san_oph);
                 }});
    const dsp::RtiOperator op{w.pi, w.null_std, w.var_ratio, Workloads::kV, Workloads::kL};
    b.push_back({"rti_apply", "V=5280 L=28 frames=1", "frames", 1.0, 1000, 100, {},
                 [&, op] {
                     const std::size_t V = Workloads::kV;
                     dsp::rti_apply(op, w.y1, 1.5, std::span(w.rti_img).first(V),
                                    std::span(w.rti_z).first(V), std::span(w.rti_occ).first(V));
                     sink(std::span(w.rti_occ).first(V));
                 }});
    b.push_back({"rti_apply_batch", "V=5280 L=28 frames=100", "frames", double(Workloads::kFrames),
                 200, 20, {},
                 [&, op] {
                     dsp::rti_apply_batch(op, w.yb, Workloads::kFrames, 1.5, w.rti_img, w.rti_z,
                                          w.rti_occ);
                     sink(w.rti_occ);
                 }});
    b.push_back({"backprojection", "V=5280 L=28 M=3 K=30", "voxels", double(Workloads::kV), 100, 5,
                 {},
                 [&] {
                     dsp::BackProjectionInput in;
                     in.tau = w.tau;
                     in.dyn_re = w.bp_re;
                     in.dyn_im = w.bp_im;
                     in.norm = w.bp_norm;
                     in.V = Workloads::kV;
                     in.L = Workloads::kL;
                     in.Mmax = Workloads::kBpM;
                     in.K = Workloads::kBpK;
                     in.f0 = 5.18e9;
                     in.df = 312.5e3;
                     dsp::backprojection(in, w.bp_out);
                     sink(w.bp_out);
                 }});
    return b;
}

std::string json_escape(const std::string& s) {
    std::string o;
    for (char c : s) {
        switch (c) {
            case '"': o += "\\\""; break;
            case '\\': o += "\\\\"; break;
            case '\n': o += "\\n"; break;
            case '\t': o += "\\t"; break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof buf, "\\u%04x", c);
                    o += buf;
                } else {
                    o += c;
                }
        }
    }
    return o;
}

std::string q(const std::string& s) { return "\"" + json_escape(s) + "\""; }

std::string num(double v) {
    std::ostringstream os;
    os.precision(10);
    os << v;
    return os.str();
}

std::string cpu_model() {
    std::ifstream f("/proc/cpuinfo");
    std::string line;
    while (std::getline(f, line)) {
        if (line.rfind("model name", 0) == 0) {
            const auto colon = line.find(':');
            if (colon != std::string::npos) {
                auto v = line.substr(colon + 1);
                v.erase(0, v.find_first_not_of(" \t"));
                return v;
            }
        }
    }
    return "unknown";
}

std::string compiler() {
#if defined(__clang__)
    return std::string("clang ") + __clang_version__;
#elif defined(__GNUC__)
    return std::string("gcc ") + __VERSION__;
#elif defined(_MSC_VER)
    return "msvc " + std::to_string(_MSC_VER);
#else
    return "unknown";
#endif
}

std::string utc_timestamp() {
    const std::time_t t = std::time(nullptr);
    std::tm tm{};
    gmtime_r(&t, &tm);
    char buf[32];
    std::strftime(buf, sizeof buf, "%Y-%m-%dT%H:%M:%SZ", &tm);
    return buf;
}

std::string env_or_null(const char* name) {
    const char* v = std::getenv(name);
    return v && *v ? q(v) : "null";
}

std::string machine_json() {
    utsname u{};
    std::string os = "unknown";
    if (uname(&u) == 0) os = std::string(u.sysname) + " " + u.release + " " + u.machine;
    std::ostringstream o;
    o << "{\n"
      << "    \"cpu_model\": " << q(cpu_model()) << ",\n"
      << "    \"logical_cores\": " << std::thread::hardware_concurrency() << ",\n"
      << "    \"os\": " << q(os) << ",\n"
      << "    \"compiler\": " << q(compiler()) << ",\n"
      << "    \"build_type\": " << q(ECHOSPACE_BUILD_TYPE) << ",\n"
      << "    \"cxx_flags\": " << q(ECHOSPACE_CXX_FLAGS) << ",\n"
      << "    \"git_commit\": " << env_or_null("ECHOSPACE_GIT_COMMIT") << ",\n"
      << "    \"label\": " << env_or_null("ECHOSPACE_BENCH_LABEL") << ",\n"
      << "    \"timestamp_utc\": " << q(utc_timestamp()) << ",\n"
      << "    \"kernel_threads\": 1\n"
      << "  }";
    return o.str();
}

bool parse(int argc, char** argv, Options& opt) {
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        auto next = [&]() -> const char* { return i + 1 < argc ? argv[++i] : nullptr; };
        const char* v = nullptr;
        if (a == "--json" && (v = next())) opt.json_path = v;
        else if (a == "--iterations" && (v = next())) opt.iterations = std::atoi(v);
        else if (a == "--warmup" && (v = next())) opt.warmup = std::atoi(v);
        else if (a == "--filter" && (v = next())) opt.filter = v;
        else {
            std::fprintf(stderr,
                         "usage: %s [--json PATH] [--iterations N] [--warmup N] [--filter SUBSTR]\n",
                         argv[0]);
            return false;
        }
    }
    if ((opt.iterations && *opt.iterations < 1) || (opt.warmup && *opt.warmup < 0)) {
        std::fprintf(stderr, "iterations must be >= 1 and warmup >= 0\n");
        return false;
    }
    return true;
}

std::string fmt_us(std::optional<double> ns) {
    if (!ns) return "insufficient samples";
    char buf[32];
    std::snprintf(buf, sizeof buf, "%.2f", *ns / 1e3);
    return buf;
}

}  // namespace

int main(int argc, char** argv) {
    Options opt;
    if (!parse(argc, argv, opt)) return 2;

    Workloads w;
    auto benches = make_benchmarks(w);

    std::printf("%-18s %8s %12s %12s %22s %22s %16s\n", "benchmark", "n", "min_us", "median_us",
                "p95_us", "p99_us", "items/s");
    std::ostringstream results;
    bool first = true;
    for (auto& b : benches) {
        if (!opt.filter.empty() && b.name.find(opt.filter) == std::string::npos) continue;
        const int iters = opt.iterations.value_or(b.iterations);
        const int warm = opt.warmup.value_or(b.warmup);

        for (int i = 0; i < warm; ++i) {
            if (b.reset) b.reset();
            b.call();
        }
        std::vector<double> ns;
        ns.reserve(std::size_t(iters));
        for (int i = 0; i < iters; ++i) {
            if (b.reset) b.reset();
            const auto t0 = std::chrono::steady_clock::now();
            b.call();
            const auto t1 = std::chrono::steady_clock::now();
            ns.push_back(std::chrono::duration<double, std::nano>(t1 - t0).count());
        }
        const Stats s = summarize(ns);
        const double items_per_s = b.items_per_call / (s.median_ns * 1e-9);

        std::printf("%-18s %8zu %12.2f %12.2f %22s %22s %16.4g\n", b.name.c_str(), s.n,
                    s.min_ns / 1e3, s.median_ns / 1e3, fmt_us(s.p95_ns).c_str(),
                    fmt_us(s.p99_ns).c_str(), items_per_s);

        if (!first) results << ",\n";
        first = false;
        results << "    {\n"
                << "      \"name\": " << q(b.name) << ",\n"
                << "      \"params\": " << q(b.params) << ",\n"
                << "      \"warmup\": " << warm << ",\n"
                << "      \"iterations\": " << s.n << ",\n"
                << "      \"min_ns\": " << num(s.min_ns) << ",\n"
                << "      \"median_ns\": " << num(s.median_ns) << ",\n"
                << "      \"mean_ns\": " << num(s.mean_ns) << ",\n"
                << "      \"p95_ns\": " << (s.p95_ns ? num(*s.p95_ns) : "null") << ",\n"
                << "      \"p99_ns\": " << (s.p99_ns ? num(*s.p99_ns) : "null") << ",\n"
                << "      \"tail_note\": "
                << (s.p95_ns ? "null" : q("insufficient samples (n < 100) for p95/p99")) << ",\n"
                << "      \"item_unit\": " << q(b.item_unit) << ",\n"
                << "      \"items_per_call\": " << num(b.items_per_call) << ",\n"
                << "      \"items_per_second_at_median\": " << num(items_per_s) << "\n"
                << "    }";
    }

    if (!opt.json_path.empty()) {
        std::ofstream f(opt.json_path);
        if (!f) {
            std::fprintf(stderr, "cannot write %s\n", opt.json_path.c_str());
            return 1;
        }
        f << "{\n  \"tool\": \"echospace_bench\",\n  \"clock\": \"std::chrono::steady_clock\",\n"
          << "  \"percentile_method\": \"nearest-rank; p95/p99 null when n < 100\",\n"
          << "  \"machine\": " << machine_json() << ",\n  \"results\": [\n"
          << results.str() << "\n  ]\n}\n";
        std::printf("wrote %s\n", opt.json_path.c_str());
    }
    return 0;
}
