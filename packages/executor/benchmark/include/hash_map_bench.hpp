/**
 * @file hash_map_bench.hpp
 * @brief Hash Map Benchmark: std::unordered_map vs absl::flat_hash_map
 *
 * Reference: TICKET_216 - Modern C++ Optimization Research
 * Source: Abseil flat_hash_map analysis
 *
 * Swiss Tables (absl::flat_hash_map) advantages:
 * - SIMD-accelerated probing (SSE compares 16 slots per instruction)
 * - Higher load factor (87.5% vs 50-75%)
 * - Flat storage (no pointer chasing)
 * - Better cache locality
 *
 * Expected: ~3x faster lookups
 */

#pragma once

#include "benchmark_utils.hpp"

#include <unordered_map>
#include <vector>
#include <random>
#include <string>

// Abseil flat_hash_map (available via vcpkg)
#if __has_include(<absl/container/flat_hash_map.h>)
#include <absl/container/flat_hash_map.h>
#define HAS_ABSEIL 1
#else
#define HAS_ABSEIL 0
#endif

namespace qnx::bench {

// ============================================================================
// Benchmark Results
// ============================================================================

struct HashMapBenchResult {
    double insert_ns;        // Average insert time
    double lookup_ns;        // Average lookup time
    double miss_lookup_ns;   // Average miss lookup time
    double erase_ns;         // Average erase time
    size_t count;            // Number of elements
};

struct HashMapComparison {
    HashMapBenchResult std_map;
#if HAS_ABSEIL
    HashMapBenchResult absl_map;
    double lookup_speedup;   // absl vs std speedup
    double insert_speedup;
#endif
};

// ============================================================================
// Benchmark Implementation
// ============================================================================

/**
 * @brief Generate random keys for testing
 */
inline std::vector<uint64_t> generate_random_keys(size_t n, uint64_t seed = 42) {
    std::vector<uint64_t> keys(n);
    std::mt19937_64 rng(seed);
    std::uniform_int_distribution<uint64_t> dist;

    for (size_t i = 0; i < n; ++i) {
        keys[i] = dist(rng);
    }
    return keys;
}

/**
 * @brief Benchmark std::unordered_map
 */
inline HashMapBenchResult benchmark_std_unordered_map(
    const std::vector<uint64_t>& keys,
    size_t warmup_iters = 3,
    size_t measure_iters = 10
) {
    HashMapBenchResult result{};
    result.count = keys.size();

    double freq_ghz = estimate_cpu_freq_ghz(50);

    // Generate miss keys (different from insert keys)
    auto miss_keys = generate_random_keys(keys.size(), 12345);

    std::vector<double> insert_times, lookup_times, miss_times, erase_times;
    insert_times.reserve(measure_iters);
    lookup_times.reserve(measure_iters);
    miss_times.reserve(measure_iters);
    erase_times.reserve(measure_iters);

    for (size_t iter = 0; iter < warmup_iters + measure_iters; ++iter) {
        std::unordered_map<uint64_t, uint64_t> map;
        map.reserve(keys.size());

        // Insert benchmark
        uint64_t start = rdtsc_vm_safe();
        for (const auto& key : keys) {
            map[key] = key * 2;
        }
        uint64_t end = rdtsc_vm_safe();

        if (iter >= warmup_iters) {
            insert_times.push_back(
                static_cast<double>(end - start) / freq_ghz / keys.size());
        }

        // Lookup benchmark (hits)
        volatile uint64_t sink = 0;
        start = rdtsc_vm_safe();
        for (const auto& key : keys) {
            auto it = map.find(key);
            if (it != map.end()) sink += it->second;
        }
        end = rdtsc_vm_safe();
        (void)sink;

        if (iter >= warmup_iters) {
            lookup_times.push_back(
                static_cast<double>(end - start) / freq_ghz / keys.size());
        }

        // Lookup benchmark (misses)
        start = rdtsc_vm_safe();
        for (const auto& key : miss_keys) {
            auto it = map.find(key);
            if (it != map.end()) sink += it->second;
        }
        end = rdtsc_vm_safe();

        if (iter >= warmup_iters) {
            miss_times.push_back(
                static_cast<double>(end - start) / freq_ghz / keys.size());
        }

        // Erase benchmark
        start = rdtsc_vm_safe();
        for (const auto& key : keys) {
            map.erase(key);
        }
        end = rdtsc_vm_safe();

        if (iter >= warmup_iters) {
            erase_times.push_back(
                static_cast<double>(end - start) / freq_ghz / keys.size());
        }
    }

    // Calculate medians
    auto median = [](std::vector<double>& v) {
        std::sort(v.begin(), v.end());
        return v[v.size() / 2];
    };

    result.insert_ns = median(insert_times);
    result.lookup_ns = median(lookup_times);
    result.miss_lookup_ns = median(miss_times);
    result.erase_ns = median(erase_times);

    return result;
}

#if HAS_ABSEIL
/**
 * @brief Benchmark absl::flat_hash_map
 */
inline HashMapBenchResult benchmark_absl_flat_hash_map(
    const std::vector<uint64_t>& keys,
    size_t warmup_iters = 3,
    size_t measure_iters = 10
) {
    HashMapBenchResult result{};
    result.count = keys.size();

    double freq_ghz = estimate_cpu_freq_ghz(50);

    auto miss_keys = generate_random_keys(keys.size(), 12345);

    std::vector<double> insert_times, lookup_times, miss_times, erase_times;
    insert_times.reserve(measure_iters);
    lookup_times.reserve(measure_iters);
    miss_times.reserve(measure_iters);
    erase_times.reserve(measure_iters);

    for (size_t iter = 0; iter < warmup_iters + measure_iters; ++iter) {
        absl::flat_hash_map<uint64_t, uint64_t> map;
        map.reserve(keys.size());

        // Insert benchmark
        uint64_t start = rdtsc_vm_safe();
        for (const auto& key : keys) {
            map[key] = key * 2;
        }
        uint64_t end = rdtsc_vm_safe();

        if (iter >= warmup_iters) {
            insert_times.push_back(
                static_cast<double>(end - start) / freq_ghz / keys.size());
        }

        // Lookup benchmark (hits)
        volatile uint64_t sink = 0;
        start = rdtsc_vm_safe();
        for (const auto& key : keys) {
            auto it = map.find(key);
            if (it != map.end()) sink += it->second;
        }
        end = rdtsc_vm_safe();
        (void)sink;

        if (iter >= warmup_iters) {
            lookup_times.push_back(
                static_cast<double>(end - start) / freq_ghz / keys.size());
        }

        // Lookup benchmark (misses)
        start = rdtsc_vm_safe();
        for (const auto& key : miss_keys) {
            auto it = map.find(key);
            if (it != map.end()) sink += it->second;
        }
        end = rdtsc_vm_safe();

        if (iter >= warmup_iters) {
            miss_times.push_back(
                static_cast<double>(end - start) / freq_ghz / keys.size());
        }

        // Erase benchmark
        start = rdtsc_vm_safe();
        for (const auto& key : keys) {
            map.erase(key);
        }
        end = rdtsc_vm_safe();

        if (iter >= warmup_iters) {
            erase_times.push_back(
                static_cast<double>(end - start) / freq_ghz / keys.size());
        }
    }

    auto median = [](std::vector<double>& v) {
        std::sort(v.begin(), v.end());
        return v[v.size() / 2];
    };

    result.insert_ns = median(insert_times);
    result.lookup_ns = median(lookup_times);
    result.miss_lookup_ns = median(miss_times);
    result.erase_ns = median(erase_times);

    return result;
}
#endif

/**
 * @brief Run full hash map comparison benchmark
 */
inline HashMapComparison benchmark_hash_maps(
    size_t num_elements = 100000,
    size_t warmup = 3,
    size_t measure = 10
) {
    HashMapComparison result;

    auto keys = generate_random_keys(num_elements);

    result.std_map = benchmark_std_unordered_map(keys, warmup, measure);

#if HAS_ABSEIL
    result.absl_map = benchmark_absl_flat_hash_map(keys, warmup, measure);
    result.lookup_speedup = result.std_map.lookup_ns / result.absl_map.lookup_ns;
    result.insert_speedup = result.std_map.insert_ns / result.absl_map.insert_ns;
#endif

    return result;
}

/**
 * @brief Print benchmark results
 */
inline void print_hash_map_results(const HashMapComparison& result) {
    std::cout << "\n========================================================\n";
    std::cout << "           HASH MAP BENCHMARK REPORT\n";
    std::cout << "========================================================\n\n";

    std::cout << "Elements: " << result.std_map.count << "\n\n";

    std::cout << std::fixed << std::setprecision(1);

    std::cout << "std::unordered_map:\n";
    std::cout << "  Insert:      " << std::setw(8) << result.std_map.insert_ns << " ns/op\n";
    std::cout << "  Lookup:      " << std::setw(8) << result.std_map.lookup_ns << " ns/op\n";
    std::cout << "  Miss:        " << std::setw(8) << result.std_map.miss_lookup_ns << " ns/op\n";
    std::cout << "  Erase:       " << std::setw(8) << result.std_map.erase_ns << " ns/op\n\n";

#if HAS_ABSEIL
    std::cout << "absl::flat_hash_map (Swiss Tables):\n";
    std::cout << "  Insert:      " << std::setw(8) << result.absl_map.insert_ns << " ns/op\n";
    std::cout << "  Lookup:      " << std::setw(8) << result.absl_map.lookup_ns << " ns/op\n";
    std::cout << "  Miss:        " << std::setw(8) << result.absl_map.miss_lookup_ns << " ns/op\n";
    std::cout << "  Erase:       " << std::setw(8) << result.absl_map.erase_ns << " ns/op\n\n";

    std::cout << "Speedup (absl vs std):\n";
    std::cout << std::setprecision(2);
    std::cout << "  Lookup:      " << std::setw(8) << result.lookup_speedup << "x\n";
    std::cout << "  Insert:      " << std::setw(8) << result.insert_speedup << "x\n";

    if (result.lookup_speedup >= 1.5) {
        std::cout << "\n  [PASS: >= 1.5x lookup speedup]\n";
    } else {
        std::cout << "\n  [Results may vary by workload]\n";
    }
#else
    std::cout << "absl::flat_hash_map: NOT AVAILABLE\n";
    std::cout << "  (Install Abseil via vcpkg or FetchContent)\n";
#endif

    std::cout << "\n========================================================\n";
}

}  // namespace qnx::bench
