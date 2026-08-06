/**
 * Parallel STL Algorithms
 *
 * TICKET_175 Phase 9: Parallel STL
 *
 * Provides parallel versions of common operations:
 * - Parallel reduce/accumulate
 * - Parallel transform
 * - Parallel for_each
 * - Batch indicator calculations
 *
 * modernc_quant.md references:
 * - #55 Parallel algorithms
 */

#pragma once

#include <algorithm>
#include <execution>
#include <numeric>
#include <vector>
#include <span>
#include <cstddef>
#include <functional>
#include <thread>

#include "executor_constants.hpp"

namespace StratCraft::executor::parallel {

// =============================================================================
// Configuration
// =============================================================================

// PARALLEL_DATA_THRESHOLD defined in executor_constants.hpp

/**
 * Get optimal chunk size based on hardware
 */
[[nodiscard]] inline size_t optimal_chunk_size(size_t total_elements) noexcept {
    const size_t num_threads = std::thread::hardware_concurrency();
    return std::max(constants::PARALLEL_MIN_CHUNK_SIZE,
                    total_elements / (num_threads * constants::PARALLEL_CHUNKS_PER_THREAD));
}

// =============================================================================
// Parallel Reduce (modernc_quant #55)
// =============================================================================

/**
 * Parallel sum of elements
 */
template<typename T>
[[nodiscard]] T parallel_sum(std::span<const T> data) {
    if (data.size() < constants::PARALLEL_DATA_THRESHOLD) {
        return std::reduce(data.begin(), data.end(), T{});
    }
    return std::reduce(std::execution::par_unseq, data.begin(), data.end(), T{});
}

/**
 * Parallel reduce with custom operation
 */
template<typename T, typename BinaryOp>
[[nodiscard]] T parallel_reduce(std::span<const T> data, T init, BinaryOp op) {
    if (data.size() < constants::PARALLEL_DATA_THRESHOLD) {
        return std::reduce(data.begin(), data.end(), init, op);
    }
    return std::reduce(std::execution::par_unseq, data.begin(), data.end(), init, op);
}

/**
 * Parallel mean calculation
 */
template<typename T>
[[nodiscard]] double parallel_mean(std::span<const T> data) {
    if (data.empty()) return 0.0;
    T sum = parallel_sum(data);
    return static_cast<double>(sum) / static_cast<double>(data.size());
}

/**
 * Parallel variance calculation
 */
template<typename T>
[[nodiscard]] double parallel_variance(std::span<const T> data) {
    if (data.size() < 2) return 0.0;

    double mean = parallel_mean(data);
    double n = static_cast<double>(data.size());

    auto squared_diff = [mean](double acc, T x) {
        double diff = static_cast<double>(x) - mean;
        return acc + diff * diff;
    };

    double sum_sq;
    if (data.size() < constants::PARALLEL_DATA_THRESHOLD) {
        sum_sq = std::accumulate(data.begin(), data.end(), 0.0, squared_diff);
    } else {
        // For parallel, we need transform_reduce
        sum_sq = std::transform_reduce(
            std::execution::par_unseq,
            data.begin(), data.end(),
            0.0,
            std::plus<>{},
            [mean](T x) {
                double diff = static_cast<double>(x) - mean;
                return diff * diff;
            }
        );
    }

    return sum_sq / n;
}

/**
 * Parallel standard deviation
 */
template<typename T>
[[nodiscard]] double parallel_stddev(std::span<const T> data) {
    return std::sqrt(parallel_variance(data));
}

// =============================================================================
// Parallel Transform (modernc_quant #55)
// =============================================================================

/**
 * Parallel transform in-place
 */
template<typename T, typename UnaryOp>
void parallel_transform_inplace(std::span<T> data, UnaryOp op) {
    if (data.size() < constants::PARALLEL_DATA_THRESHOLD) {
        std::transform(data.begin(), data.end(), data.begin(), op);
    } else {
        std::transform(std::execution::par_unseq,
                       data.begin(), data.end(), data.begin(), op);
    }
}

/**
 * Parallel transform to output
 */
template<typename T, typename U, typename UnaryOp>
void parallel_transform(std::span<const T> input, std::span<U> output, UnaryOp op) {
    if (input.size() < constants::PARALLEL_DATA_THRESHOLD) {
        std::transform(input.begin(), input.end(), output.begin(), op);
    } else {
        std::transform(std::execution::par_unseq,
                       input.begin(), input.end(), output.begin(), op);
    }
}

/**
 * Parallel binary transform
 */
template<typename T, typename U, typename V, typename BinaryOp>
void parallel_transform(std::span<const T> a, std::span<const U> b,
                        std::span<V> output, BinaryOp op) {
    if (a.size() < constants::PARALLEL_DATA_THRESHOLD) {
        std::transform(a.begin(), a.end(), b.begin(), output.begin(), op);
    } else {
        std::transform(std::execution::par_unseq,
                       a.begin(), a.end(), b.begin(), output.begin(), op);
    }
}

// =============================================================================
// Parallel For Each
// =============================================================================

/**
 * Parallel for_each
 */
template<typename T, typename Func>
void parallel_for_each(std::span<T> data, Func func) {
    if (data.size() < constants::PARALLEL_DATA_THRESHOLD) {
        std::for_each(data.begin(), data.end(), func);
    } else {
        std::for_each(std::execution::par_unseq, data.begin(), data.end(), func);
    }
}

// =============================================================================
// Parallel Min/Max
// =============================================================================

/**
 * Parallel min element
 */
template<typename T>
[[nodiscard]] T parallel_min(std::span<const T> data) {
    if (data.empty()) return T{};
    if (data.size() < constants::PARALLEL_DATA_THRESHOLD) {
        return *std::min_element(data.begin(), data.end());
    }
    return *std::min_element(std::execution::par_unseq, data.begin(), data.end());
}

/**
 * Parallel max element
 */
template<typename T>
[[nodiscard]] T parallel_max(std::span<const T> data) {
    if (data.empty()) return T{};
    if (data.size() < constants::PARALLEL_DATA_THRESHOLD) {
        return *std::max_element(data.begin(), data.end());
    }
    return *std::max_element(std::execution::par_unseq, data.begin(), data.end());
}

/**
 * Parallel minmax
 */
template<typename T>
[[nodiscard]] std::pair<T, T> parallel_minmax(std::span<const T> data) {
    if (data.empty()) return {T{}, T{}};
    if (data.size() < constants::PARALLEL_DATA_THRESHOLD) {
        auto [minIt, maxIt] = std::minmax_element(data.begin(), data.end());
        return {*minIt, *maxIt};
    }
    auto [minIt, maxIt] = std::minmax_element(std::execution::par_unseq,
                                              data.begin(), data.end());
    return {*minIt, *maxIt};
}

// =============================================================================
// Parallel Sort
// =============================================================================

/**
 * Parallel sort
 */
template<typename T>
void parallel_sort(std::span<T> data) {
    if (data.size() < constants::PARALLEL_DATA_THRESHOLD) {
        std::sort(data.begin(), data.end());
    } else {
        std::sort(std::execution::par_unseq, data.begin(), data.end());
    }
}

/**
 * Parallel sort with comparator
 */
template<typename T, typename Compare>
void parallel_sort(std::span<T> data, Compare comp) {
    if (data.size() < constants::PARALLEL_DATA_THRESHOLD) {
        std::sort(data.begin(), data.end(), comp);
    } else {
        std::sort(std::execution::par_unseq, data.begin(), data.end(), comp);
    }
}

// =============================================================================
// Batch Indicator Calculations
// =============================================================================

/**
 * Batch SMA calculation (parallel over multiple symbols)
 */
inline void batch_sma(
    const std::vector<std::span<const double>>& inputs,
    std::vector<std::span<double>>& outputs,
    size_t period
) {
    if (inputs.size() < constants::BATCH_constants::PARALLEL_DATA_THRESHOLD) {
        // Sequential for small batches
        for (size_t i = 0; i < inputs.size(); ++i) {
            const auto& input = inputs[i];
            auto& output = outputs[i];

            if (input.size() < period) continue;

            double sum = 0;
            for (size_t j = 0; j < period; ++j) {
                sum += input[j];
            }
            output[period - 1] = sum / period;

            for (size_t j = period; j < input.size(); ++j) {
                sum = sum + input[j] - input[j - period];
                output[j] = sum / period;
            }
        }
    } else {
        // Parallel over symbols
        std::vector<size_t> indices(inputs.size());
        std::iota(indices.begin(), indices.end(), 0);

        std::for_each(std::execution::par_unseq,
                      indices.begin(), indices.end(),
                      [&](size_t i) {
            const auto& input = inputs[i];
            auto& output = outputs[i];

            if (input.size() < period) return;

            double sum = 0;
            for (size_t j = 0; j < period; ++j) {
                sum += input[j];
            }
            output[period - 1] = sum / period;

            for (size_t j = period; j < input.size(); ++j) {
                sum = sum + input[j] - input[j - period];
                output[j] = sum / period;
            }
        });
    }
}

/**
 * Batch returns calculation
 */
inline void batch_returns(
    const std::vector<std::span<const double>>& prices,
    std::vector<std::span<double>>& returns
) {
    std::vector<size_t> indices(prices.size());
    std::iota(indices.begin(), indices.end(), 0);

    auto calc_returns = [&](size_t i) {
        const auto& price = prices[i];
        auto& ret = returns[i];

        if (price.size() < 2) return;

        ret[0] = 0.0;
        for (size_t j = 1; j < price.size(); ++j) {
            ret[j] = (price[j] - price[j-1]) / price[j-1];
        }
    };

    if (prices.size() < constants::BATCH_constants::PARALLEL_DATA_THRESHOLD) {
        std::for_each(indices.begin(), indices.end(), calc_returns);
    } else {
        std::for_each(std::execution::par_unseq,
                      indices.begin(), indices.end(), calc_returns);
    }
}

// =============================================================================
// Parallel Count
// =============================================================================

/**
 * Parallel count if
 */
template<typename T, typename Pred>
[[nodiscard]] size_t parallel_count_if(std::span<const T> data, Pred pred) {
    if (data.size() < constants::PARALLEL_DATA_THRESHOLD) {
        return std::count_if(data.begin(), data.end(), pred);
    }
    return std::count_if(std::execution::par_unseq, data.begin(), data.end(), pred);
}

// =============================================================================
// Parallel Copy If
// =============================================================================

/**
 * Parallel copy if (note: output must be pre-sized)
 */
template<typename T, typename Pred>
[[nodiscard]] size_t parallel_copy_if(std::span<const T> input,
                                       std::span<T> output,
                                       Pred pred) {
    if (input.size() < constants::PARALLEL_DATA_THRESHOLD) {
        auto it = std::copy_if(input.begin(), input.end(), output.begin(), pred);
        return std::distance(output.begin(), it);
    }
    auto it = std::copy_if(std::execution::par_unseq,
                           input.begin(), input.end(), output.begin(), pred);
    return std::distance(output.begin(), it);
}

} // namespace StratCraft::executor::parallel
