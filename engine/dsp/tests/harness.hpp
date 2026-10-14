// Minimal test harness: TEST(name) registers a function, CHECK* record failures without
// aborting, main() runs everything and returns non-zero on failure. Independent of NDEBUG.
#pragma once

#include <cmath>
#include <cstdio>
#include <functional>
#include <string>
#include <vector>

namespace es_test {

struct Case {
    const char* name;
    std::function<void()> fn;
};

inline std::vector<Case>& registry() {
    static std::vector<Case> r;
    return r;
}

inline int& failures() {
    static int f = 0;
    return f;
}

struct Registrar {
    Registrar(const char* name, std::function<void()> fn) { registry().push_back({name, std::move(fn)}); }
};

inline void fail(const char* file, int line, const std::string& msg) {
    std::fprintf(stderr, "  %s:%d: %s\n", file, line, msg.c_str());
    ++failures();
}

inline int run_all() {
    int failed_cases = 0;
    for (const auto& c : registry()) {
        const int before = failures();
        try {
            c.fn();
        } catch (const std::exception& e) {
            fail(__FILE__, __LINE__, std::string("uncaught exception: ") + e.what());
        }
        const bool ok = failures() == before;
        std::printf("[%s] %s\n", ok ? " ok " : "FAIL", c.name);
        std::fflush(stdout);
        if (!ok) ++failed_cases;
    }
    std::printf("%zu tests, %d failed\n", registry().size(), failed_cases);
    return failed_cases == 0 ? 0 : 1;
}

}  // namespace es_test

#define ES_CAT2(a, b) a##b
#define ES_CAT(a, b) ES_CAT2(a, b)
#define TEST(name)                                                                \
    static void name();                                                           \
    static const es_test::Registrar ES_CAT(reg_, name){#name, name};              \
    static void name()

#define CHECK(cond)                                                               \
    do {                                                                          \
        if (!(cond)) es_test::fail(__FILE__, __LINE__, "CHECK(" #cond ") failed"); \
    } while (0)

#define CHECK_NEAR(a, b, tol)                                                             \
    do {                                                                                  \
        const double va_ = (a), vb_ = (b);                                                \
        if (!(std::abs(va_ - vb_) <= (tol)))                                              \
            es_test::fail(__FILE__, __LINE__,                                             \
                          std::string(#a " = ") + std::to_string(va_) + ", " #b " = " +   \
                              std::to_string(vb_) + ", tol " + std::to_string(tol));      \
    } while (0)

#define CHECK_THROWS(expr)                                                        \
    do {                                                                          \
        bool thrown_ = false;                                                     \
        try {                                                                     \
            (void)(expr);                                                         \
        } catch (...) {                                                           \
            thrown_ = true;                                                       \
        }                                                                         \
        if (!thrown_) es_test::fail(__FILE__, __LINE__, "expected exception: " #expr); \
    } while (0)

#define TEST_MAIN() \
    int main() { return es_test::run_all(); }
