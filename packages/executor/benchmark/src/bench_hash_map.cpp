/**
 * @file bench_hash_map.cpp
 * @brief Hash Map Benchmark: std::unordered_map vs absl::flat_hash_map
 *
 * Reference: TICKET_216 - Modern C++ Optimization Research (Phase 3)
 * Source: Abseil flat_hash_map analysis
 */

#include <iostream>
#include <iomanip>
#include "../include/hash_map_bench.hpp"

int main() {
    using namespace qnx::bench;

    std::cout << "=============================================================\n";
    std::cout << "       Hash Map Benchmark (TICKET_216 Phase 3)\n";
    std::cout << "=============================================================\n\n";

    // CPU frequency calibration
    double freq_ghz = estimate_cpu_freq_ghz(100);
    std::cout << "CPU Frequency: " << std::fixed << std::setprecision(2)
              << freq_ghz << " GHz\n\n";

#if HAS_ABSEIL
    std::cout << "Abseil: AVAILABLE (Swiss Tables enabled)\n\n";
#else
    std::cout << "Abseil: NOT AVAILABLE (std::unordered_map only)\n\n";
#endif

    // Run benchmarks with different sizes
    std::cout << "Running benchmarks...\n\n";

    for (size_t n : {10000, 100000, 1000000}) {
        std::cout << "--- " << n << " elements ---\n";
        auto result = benchmark_hash_maps(n, 3, 10);
        print_hash_map_results(result);
        std::cout << "\n";
    }

    return 0;
}
