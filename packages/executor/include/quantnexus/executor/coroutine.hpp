/**
 * C++20 Coroutines for Lazy Evaluation
 *
 * TICKET_175 Phase 8: C++20 Coroutines
 *
 * Provides:
 * - Generator<T> for lazy sequences
 * - AsyncTask<T> for async operations
 * - DataStream for streaming market data
 *
 * modernc_quant.md references:
 * - #77 Generator coroutines
 * - #78 Async tasks
 * - #79 Lazy evaluation
 * - #80 Coroutine pools
 */

#pragma once

#include <coroutine>
#include <exception>
#include <optional>
#include <utility>
#include <memory>
#include <vector>
#include <functional>

namespace StratCraft::executor::coro {

// =============================================================================
// Generator<T> - Lazy Sequence Generator (modernc_quant #77)
// =============================================================================

/**
 * Lazy generator that yields values on demand
 *
 * Usage:
 *   Generator<int> range(int start, int end) {
 *       for (int i = start; i < end; ++i) {
 *           co_yield i;
 *       }
 *   }
 *
 *   for (int x : range(0, 10)) {
 *       std::cout << x << "\n";
 *   }
 */
template<typename T>
class Generator {
public:
    struct promise_type {
        T current_value;
        std::exception_ptr exception;

        Generator get_return_object() {
            return Generator{std::coroutine_handle<promise_type>::from_promise(*this)};
        }

        std::suspend_always initial_suspend() noexcept { return {}; }
        std::suspend_always final_suspend() noexcept { return {}; }

        std::suspend_always yield_value(T value) noexcept {
            current_value = std::move(value);
            return {};
        }

        void return_void() noexcept {}

        void unhandled_exception() {
            exception = std::current_exception();
        }

        template<typename U>
        std::suspend_never await_transform(U&&) = delete;  // Disable co_await
    };

    using handle_type = std::coroutine_handle<promise_type>;

    Generator() noexcept = default;

    explicit Generator(handle_type h) noexcept : handle_(h) {}

    Generator(Generator&& other) noexcept : handle_(other.handle_) {
        other.handle_ = nullptr;
    }

    Generator& operator=(Generator&& other) noexcept {
        if (this != &other) {
            if (handle_) handle_.destroy();
            handle_ = other.handle_;
            other.handle_ = nullptr;
        }
        return *this;
    }

    ~Generator() {
        if (handle_) handle_.destroy();
    }

    // Non-copyable
    Generator(const Generator&) = delete;
    Generator& operator=(const Generator&) = delete;

    /**
     * Iterator for range-based for loops
     */
    class iterator {
    public:
        using iterator_category = std::input_iterator_tag;
        using difference_type = std::ptrdiff_t;
        using value_type = T;
        using pointer = T*;
        using reference = T&;

        iterator() noexcept = default;
        explicit iterator(handle_type h) noexcept : handle_(h) {}

        iterator& operator++() {
            handle_.resume();
            if (handle_.done()) {
                if (handle_.promise().exception) {
                    std::rethrow_exception(handle_.promise().exception);
                }
            }
            return *this;
        }

        iterator operator++(int) {
            iterator tmp = *this;
            ++(*this);
            return tmp;
        }

        [[nodiscard]] const T& operator*() const noexcept {
            return handle_.promise().current_value;
        }

        [[nodiscard]] const T* operator->() const noexcept {
            return &handle_.promise().current_value;
        }

        [[nodiscard]] bool operator==(std::default_sentinel_t) const noexcept {
            return !handle_ || handle_.done();
        }

    private:
        handle_type handle_;
    };

    [[nodiscard]] iterator begin() {
        if (handle_) {
            handle_.resume();
            if (handle_.done()) {
                if (handle_.promise().exception) {
                    std::rethrow_exception(handle_.promise().exception);
                }
            }
        }
        return iterator{handle_};
    }

    [[nodiscard]] std::default_sentinel_t end() const noexcept {
        return {};
    }

    /**
     * Get next value
     */
    [[nodiscard]] std::optional<T> next() {
        if (!handle_ || handle_.done()) {
            return std::nullopt;
        }
        handle_.resume();
        if (handle_.done()) {
            return std::nullopt;
        }
        return handle_.promise().current_value;
    }

    /**
     * Check if generator is exhausted
     */
    [[nodiscard]] bool done() const noexcept {
        return !handle_ || handle_.done();
    }

private:
    handle_type handle_;
};

// =============================================================================
// Task<T> - Async Task (modernc_quant #78)
// =============================================================================

/**
 * Async task that can be awaited
 *
 * Usage:
 *   Task<int> async_compute() {
 *       co_return 42;
 *   }
 *
 *   Task<void> caller() {
 *       int result = co_await async_compute();
 *   }
 */
template<typename T = void>
class Task;

template<typename T>
class Task {
public:
    struct promise_type {
        T result;
        std::exception_ptr exception;
        std::coroutine_handle<> continuation;

        Task get_return_object() {
            return Task{std::coroutine_handle<promise_type>::from_promise(*this)};
        }

        std::suspend_never initial_suspend() noexcept { return {}; }

        auto final_suspend() noexcept {
            struct Awaiter {
                std::coroutine_handle<> continuation;

                bool await_ready() noexcept { return false; }

                std::coroutine_handle<> await_suspend(std::coroutine_handle<>) noexcept {
                    return continuation ? continuation : std::noop_coroutine();
                }

                void await_resume() noexcept {}
            };
            return Awaiter{continuation};
        }

        void return_value(T value) noexcept {
            result = std::move(value);
        }

        void unhandled_exception() {
            exception = std::current_exception();
        }
    };

    using handle_type = std::coroutine_handle<promise_type>;

    Task() noexcept = default;
    explicit Task(handle_type h) noexcept : handle_(h) {}

    Task(Task&& other) noexcept : handle_(other.handle_) {
        other.handle_ = nullptr;
    }

    Task& operator=(Task&& other) noexcept {
        if (this != &other) {
            if (handle_) handle_.destroy();
            handle_ = other.handle_;
            other.handle_ = nullptr;
        }
        return *this;
    }

    ~Task() {
        if (handle_) handle_.destroy();
    }

    // Awaitable interface
    bool await_ready() const noexcept {
        return handle_.done();
    }

    std::coroutine_handle<> await_suspend(std::coroutine_handle<> continuation) noexcept {
        handle_.promise().continuation = continuation;
        return handle_;
    }

    T await_resume() {
        if (handle_.promise().exception) {
            std::rethrow_exception(handle_.promise().exception);
        }
        return std::move(handle_.promise().result);
    }

    /**
     * Get result (blocking)
     */
    [[nodiscard]] T get() {
        if (!handle_.done()) {
            handle_.resume();
        }
        if (handle_.promise().exception) {
            std::rethrow_exception(handle_.promise().exception);
        }
        return std::move(handle_.promise().result);
    }

    [[nodiscard]] bool done() const noexcept {
        return handle_.done();
    }

private:
    handle_type handle_;
};

// Specialization for void
template<>
class Task<void> {
public:
    struct promise_type {
        std::exception_ptr exception;
        std::coroutine_handle<> continuation;

        Task get_return_object() {
            return Task{std::coroutine_handle<promise_type>::from_promise(*this)};
        }

        std::suspend_never initial_suspend() noexcept { return {}; }

        auto final_suspend() noexcept {
            struct Awaiter {
                std::coroutine_handle<> continuation;
                bool await_ready() noexcept { return false; }
                std::coroutine_handle<> await_suspend(std::coroutine_handle<>) noexcept {
                    return continuation ? continuation : std::noop_coroutine();
                }
                void await_resume() noexcept {}
            };
            return Awaiter{continuation};
        }

        void return_void() noexcept {}

        void unhandled_exception() {
            exception = std::current_exception();
        }
    };

    using handle_type = std::coroutine_handle<promise_type>;

    Task() noexcept = default;
    explicit Task(handle_type h) noexcept : handle_(h) {}

    Task(Task&& other) noexcept : handle_(other.handle_) {
        other.handle_ = nullptr;
    }

    ~Task() {
        if (handle_) handle_.destroy();
    }

    bool await_ready() const noexcept { return handle_.done(); }

    std::coroutine_handle<> await_suspend(std::coroutine_handle<> continuation) noexcept {
        handle_.promise().continuation = continuation;
        return handle_;
    }

    void await_resume() {
        if (handle_.promise().exception) {
            std::rethrow_exception(handle_.promise().exception);
        }
    }

    void get() {
        if (!handle_.done()) {
            handle_.resume();
        }
        if (handle_.promise().exception) {
            std::rethrow_exception(handle_.promise().exception);
        }
    }

private:
    handle_type handle_;
};

// =============================================================================
// Lazy Range Generators (modernc_quant #79)
// =============================================================================

/**
 * Generate range [start, end)
 */
inline Generator<int64_t> range(int64_t start, int64_t end) {
    for (int64_t i = start; i < end; ++i) {
        co_yield i;
    }
}

/**
 * Generate infinite sequence starting from value
 */
inline Generator<int64_t> iota(int64_t start = 0) {
    for (int64_t i = start; ; ++i) {
        co_yield i;
    }
}

/**
 * Take first N elements from generator
 */
template<typename T>
Generator<T> take(Generator<T> gen, size_t n) {
    size_t count = 0;
    for (auto&& value : gen) {
        if (count++ >= n) break;
        co_yield std::forward<decltype(value)>(value);
    }
}

/**
 * Filter generator with predicate
 */
template<typename T, typename Pred>
Generator<T> filter(Generator<T> gen, Pred pred) {
    for (auto&& value : gen) {
        if (pred(value)) {
            co_yield std::forward<decltype(value)>(value);
        }
    }
}

/**
 * Map generator with function
 */
template<typename T, typename Func>
auto map(Generator<T> gen, Func func) -> Generator<decltype(func(std::declval<T>()))> {
    for (auto&& value : gen) {
        co_yield func(std::forward<decltype(value)>(value));
    }
}

// =============================================================================
// Market Data Stream Generator
// =============================================================================

/**
 * Candle data for streaming
 */
struct Candle {
    int64_t timestamp;
    double open;
    double high;
    double low;
    double close;
    double volume;
};

/**
 * Generate candle stream from arrays (zero-copy)
 */
inline Generator<Candle> candle_stream(
    const int64_t* timestamps,
    const double* opens,
    const double* highs,
    const double* lows,
    const double* closes,
    const double* volumes,
    size_t count
) {
    for (size_t i = 0; i < count; ++i) {
        co_yield Candle{
            timestamps[i],
            opens[i],
            highs[i],
            lows[i],
            closes[i],
            volumes[i]
        };
    }
}

/**
 * Window generator for rolling calculations
 */
template<typename T>
Generator<std::vector<T>> sliding_window(Generator<T> gen, size_t windowSize) {
    std::vector<T> window;
    window.reserve(windowSize);

    for (auto&& value : gen) {
        window.push_back(std::forward<decltype(value)>(value));

        if (window.size() == windowSize) {
            co_yield window;
            window.erase(window.begin());
        }
    }
}

} // namespace StratCraft::executor::coro
