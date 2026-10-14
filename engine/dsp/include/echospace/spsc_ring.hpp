// Bounded single-producer / single-consumer ring buffer with drop accounting.
//
// Native counterpart of BoundedQueue (packages/engine/src/dsp/queue.ts). The queue never
// grows; when it is full the producer applies the drop policy:
//
//   DropPolicy::drop_newest  the new item is rejected (push returns false);
//   DropPolicy::drop_oldest  the oldest queued item is evicted and the new item is stored.
//
// Every slot carries a sequence number (as in Vyukov's bounded queue): for queue index p
// (slot p % cap) the slot holds seq == 2p while free for p and 2p + 1 once item p is
// published. The factor 2 keeps "published p" and "free for p + 1" distinct even when
// cap == 1. The consumer
// claims the head index with a CAS before touching the slot and releases it afterwards, so
// under drop_oldest the producer can evict by winning that same CAS. If the consumer has
// already claimed the oldest item and is still reading it, the slot the producer needs is
// busy; that push then drops the new item instead (counted as a drop). Each push records at
// most one drop. All operations are lock-free; exactly one thread may push and one may pop.
#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <new>
#include <optional>
#include <stdexcept>
#include <type_traits>
#include <utility>

namespace echospace {

enum class DropPolicy { drop_oldest, drop_newest };

template <typename T>
class SpscRing {
    static_assert(std::is_nothrow_move_constructible_v<T>, "T must be nothrow move constructible");
    static_assert(std::is_nothrow_move_assignable_v<T>, "T must be nothrow move assignable");
    static_assert(std::is_default_constructible_v<T>, "T must be default constructible");

public:
    explicit SpscRing(std::size_t capacity, DropPolicy policy = DropPolicy::drop_oldest)
        : cap_(capacity), policy_(policy) {
        if (capacity == 0) throw std::invalid_argument("SpscRing capacity must be positive");
        slots_ = std::make_unique<Slot[]>(capacity);
        for (std::size_t i = 0; i < capacity; ++i) slots_[i].seq.store(2 * i, std::memory_order_relaxed);
    }

    SpscRing(const SpscRing&) = delete;
    SpscRing& operator=(const SpscRing&) = delete;

    // Producer side. Returns true if the item was stored.
    bool push(T item) noexcept {
        const std::uint64_t pos = tail_.load(std::memory_order_relaxed);
        Slot& s = slots_[pos % cap_];
        pushed_.store(pushed_.load(std::memory_order_relaxed) + 1, std::memory_order_relaxed);

        if (s.seq.load(std::memory_order_acquire) != 2 * pos) {
            // Full: the slot still holds item pos - cap, or the consumer is reading it.
            if (policy_ == DropPolicy::drop_newest || !evict(pos - cap_)) {
                count_drop();
                return false;
            }
            count_drop();
        }
        s.value = std::move(item);
        s.seq.store(2 * pos + 1, std::memory_order_release);
        tail_.store(pos + 1, std::memory_order_release);
        return true;
    }

    // Consumer side.
    std::optional<T> pop() noexcept {
        std::uint64_t h = head_.load(std::memory_order_acquire);
        for (;;) {
            Slot& s = slots_[h % cap_];
            const std::uint64_t seq = s.seq.load(std::memory_order_acquire);
            const auto diff = static_cast<std::int64_t>(seq - (2 * h + 1));
            if (diff < 0) return std::nullopt;  // not yet published: empty
            if (diff > 0) {                     // slot already reused: head moved on
                h = head_.load(std::memory_order_acquire);
                continue;
            }
            if (head_.compare_exchange_weak(h, h + 1, std::memory_order_acq_rel,
                                            std::memory_order_acquire)) {
                std::optional<T> out{std::move(s.value)};
                s.seq.store(2 * (h + cap_), std::memory_order_release);
                popped_.store(popped_.load(std::memory_order_relaxed) + 1,
                              std::memory_order_relaxed);
                return out;
            }
            // CAS failure reloaded h (producer evicted the item); retry.
        }
    }

    std::size_t capacity() const noexcept { return cap_; }
    DropPolicy policy() const noexcept { return policy_; }

    // Approximate when called concurrently with push/pop.
    std::size_t size() const noexcept {
        const std::uint64_t h = head_.load(std::memory_order_acquire);
        const std::uint64_t t = tail_.load(std::memory_order_acquire);
        return t > h ? static_cast<std::size_t>(t - h) : 0;
    }
    bool empty() const noexcept { return size() == 0; }

    std::uint64_t drops() const noexcept { return drops_.load(std::memory_order_relaxed); }
    std::uint64_t pushed() const noexcept { return pushed_.load(std::memory_order_relaxed); }
    std::uint64_t popped() const noexcept { return popped_.load(std::memory_order_relaxed); }

private:
    static constexpr std::size_t kLine = 64;

    struct Slot {
        std::atomic<std::uint64_t> seq{0};
        T value{};
    };

    // Producer-only: claim index `oldest` (the item occupying the producer's target slot).
    // Fails if the consumer claimed it first.
    bool evict(std::uint64_t oldest) noexcept {
        std::uint64_t expected = oldest;
        if (!head_.compare_exchange_strong(expected, oldest + 1, std::memory_order_acq_rel,
                                           std::memory_order_acquire))
            return false;
        Slot& s = slots_[oldest % cap_];
        s.value = T{};  // release resources held by the evicted item
        return true;
    }

    void count_drop() noexcept {
        drops_.store(drops_.load(std::memory_order_relaxed) + 1, std::memory_order_relaxed);
    }

    std::unique_ptr<Slot[]> slots_;
    const std::size_t cap_;
    const DropPolicy policy_;

    alignas(kLine) std::atomic<std::uint64_t> head_{0};  // next index to consume
    alignas(kLine) std::atomic<std::uint64_t> tail_{0};  // next index to produce
    alignas(kLine) std::atomic<std::uint64_t> pushed_{0};
    std::atomic<std::uint64_t> drops_{0};
    alignas(kLine) std::atomic<std::uint64_t> popped_{0};
};

}  // namespace echospace
