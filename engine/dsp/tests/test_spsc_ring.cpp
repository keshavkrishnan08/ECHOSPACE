#include <atomic>
#include <cstdint>
#include <memory>
#include <thread>
#include <vector>

#include "echospace/spsc_ring.hpp"
#include "harness.hpp"

using echospace::DropPolicy;
using echospace::SpscRing;

TEST(ring_fifo_order) {
    SpscRing<int> q(4);
    CHECK(q.empty());
    CHECK(!q.pop().has_value());
    for (int i = 0; i < 3; ++i) CHECK(q.push(i));
    CHECK(q.size() == 3);
    for (int i = 0; i < 3; ++i) {
        auto v = q.pop();
        CHECK(v.has_value() && *v == i);
    }
    CHECK(q.empty());
    CHECK(q.drops() == 0 && q.pushed() == 3 && q.popped() == 3);
}

TEST(ring_wraps_many_laps) {
    SpscRing<std::uint64_t> q(3);
    for (std::uint64_t i = 0; i < 1000; ++i) {
        CHECK(q.push(i));
        auto v = q.pop();
        CHECK(v && *v == i);
    }
}

TEST(ring_drop_newest) {
    SpscRing<int> q(3, DropPolicy::drop_newest);
    for (int i = 0; i < 5; ++i) q.push(i);
    CHECK(q.drops() == 2);
    CHECK(q.size() == 3);
    for (int i = 0; i < 3; ++i) CHECK(*q.pop() == i);
}

TEST(ring_drop_oldest) {
    SpscRing<int> q(3, DropPolicy::drop_oldest);
    for (int i = 0; i < 5; ++i) CHECK(q.push(i));
    CHECK(q.drops() == 2);
    CHECK(q.size() == 3);
    for (int i = 2; i < 5; ++i) CHECK(*q.pop() == i);
    CHECK(!q.pop());
}

TEST(ring_capacity_one) {
    SpscRing<int> q(1, DropPolicy::drop_oldest);
    CHECK(q.push(1));
    CHECK(q.push(2));
    CHECK(*q.pop() == 2);
    CHECK(!q.pop());
    CHECK(q.drops() == 1);
}

TEST(ring_evicted_items_are_released) {
    auto tracked = std::make_shared<int>(7);
    {
        SpscRing<std::shared_ptr<int>> q(2, DropPolicy::drop_oldest);
        q.push(tracked);
        q.push(std::make_shared<int>(1));
        q.push(std::make_shared<int>(2));  // evicts `tracked`
        CHECK(tracked.use_count() == 1);
        CHECK(**q.pop() == 1);
    }
    CHECK(tracked.use_count() == 1);
}

TEST(ring_rejects_zero_capacity) { CHECK_THROWS(SpscRing<int>(0)); }

namespace {

// One producer pushes 0..n-1 while one consumer pops. Received values must be strictly
// increasing (FIFO, no duplicates) and pushed == popped + drops + left over.
void stress(DropPolicy policy, std::size_t capacity, std::uint64_t n, bool slow_consumer) {
    SpscRing<std::uint64_t> q(capacity, policy);
    std::atomic<bool> done{false};
    std::vector<std::uint64_t> got;
    got.reserve(n);

    std::thread consumer([&] {
        std::uint64_t spins = 0;
        for (;;) {
            if (auto v = q.pop()) {
                got.push_back(*v);
                if (slow_consumer && (got.size() % 64) == 0) std::this_thread::yield();
            } else if (done.load(std::memory_order_acquire)) {
                while (auto r = q.pop()) got.push_back(*r);
                break;
            } else if (++spins % 128 == 0) {
                std::this_thread::yield();
            }
        }
    });
    std::uint64_t accepted = 0;
    for (std::uint64_t i = 0; i < n; ++i) accepted += q.push(i) ? 1 : 0;
    done.store(true, std::memory_order_release);
    consumer.join();

    CHECK(q.pushed() == n);
    CHECK(q.popped() == got.size());
    CHECK(q.popped() + q.drops() == n);
    CHECK(q.empty());
    if (policy == DropPolicy::drop_newest) CHECK(accepted == got.size());
    bool increasing = true;
    for (std::size_t i = 1; i < got.size(); ++i) increasing &= got[i] > got[i - 1];
    CHECK(increasing);
    if (!got.empty()) CHECK(got.back() < n);
}

}  // namespace

TEST(ring_stress_drop_oldest) { stress(DropPolicy::drop_oldest, 64, 2'000'000, true); }
TEST(ring_stress_drop_newest) { stress(DropPolicy::drop_newest, 64, 2'000'000, true); }
TEST(ring_stress_small_capacity) { stress(DropPolicy::drop_oldest, 2, 500'000, false); }

TEST(ring_stress_lossless_when_large) {
    // Capacity exceeds the item count, so nothing may be dropped and every value arrives.
    const std::uint64_t n = 200'000;
    SpscRing<std::uint64_t> q(n, DropPolicy::drop_newest);
    std::vector<std::uint64_t> got;
    std::thread consumer([&] {
        while (got.size() < n)
            if (auto v = q.pop()) got.push_back(*v);
    });
    for (std::uint64_t i = 0; i < n; ++i) q.push(i);
    consumer.join();
    CHECK(q.drops() == 0);
    bool exact = got.size() == n;
    for (std::uint64_t i = 0; exact && i < n; ++i) exact = got[i] == i;
    CHECK(exact);
}

TEST_MAIN()
