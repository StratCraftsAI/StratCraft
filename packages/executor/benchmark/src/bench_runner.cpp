/**
 * @file bench_runner.cpp
 * @brief Unified benchmark runner CLI
 *
 * Reference: TICKET_174 - C++ Executor Benchmark Framework
 *
 * Usage:
 *   qnx-executor-bench --all
 *   qnx-executor-bench --bench=execution,serialization
 *   qnx-executor-bench --format=json --output=results.json
 */

#include "benchmark_utils.hpp"
#include "memory_tracker.hpp"
#include "perf_counters.hpp"

#include <iostream>
#include <fstream>
#include <sstream>
#include <iomanip>
#include <string>
#include <vector>
#include <map>
#include <functional>
#include <chrono>
#include <ctime>

using namespace qnx::bench;

// ============================================================================
// Result Types
// ============================================================================

struct MetricValue {
    std::string name;
    double value;
    std::string unit;
    bool passed = true;
    std::string status;  // "PASS", "FAIL", "WARN"
};

struct BenchmarkResult {
    std::string name;
    bool success = true;
    std::string error;
    std::vector<MetricValue> metrics;
    std::chrono::nanoseconds duration{0};
};

struct BenchmarkSuite {
    std::string timestamp;
    std::string hostname;
    std::string cpu_model;
    double cpu_freq_ghz = 0;
    bool is_virtualized = false;
    std::vector<BenchmarkResult> results;
};

// ============================================================================
// Configuration
// ============================================================================

struct RunnerConfig {
    std::vector<std::string> benchmarks;
    std::string outputFormat = "text";  // text, json, csv
    std::string outputFile;
    std::string dataFile;
    int cpuCore = -1;
    bool realtime = false;
    bool vmSafe = false;
    bool strict = false;  // Fail on any hot path allocation
    size_t iterations = 1000;
    size_t warmupIterations = 100;
    bool runAll = false;
    bool quiet = false;
};

// ============================================================================
// System Information
// ============================================================================

std::string get_hostname() {
    char hostname[256];
    if (gethostname(hostname, sizeof(hostname)) == 0) {
        return hostname;
    }
    return "unknown";
}

std::string get_cpu_model() {
    std::ifstream cpuinfo("/proc/cpuinfo");
    std::string line;
    while (std::getline(cpuinfo, line)) {
        if (line.find("model name") != std::string::npos) {
            size_t pos = line.find(':');
            if (pos != std::string::npos) {
                std::string model = line.substr(pos + 1);
                // Trim leading spaces
                size_t start = model.find_first_not_of(" \t");
                if (start != std::string::npos) {
                    return model.substr(start);
                }
            }
        }
    }
    return "unknown";
}

std::string get_timestamp() {
    auto now = std::chrono::system_clock::now();
    auto time = std::chrono::system_clock::to_time_t(now);
    std::ostringstream ss;
    ss << std::put_time(std::localtime(&time), "%Y-%m-%dT%H:%M:%S");
    return ss.str();
}

// ============================================================================
// Benchmark Implementations (Simplified versions for runner)
// ============================================================================

BenchmarkResult run_execution_bench(const RunnerConfig& config) {
    BenchmarkResult result;
    result.name = "execution";

    auto start = std::chrono::steady_clock::now();

    try {
        // Mock indicator engine test
        std::vector<double> data(100000);
        for (size_t i = 0; i < data.size(); ++i) {
            data[i] = 100.0 + static_cast<double>(i % 100) * 0.01;
        }

        double freqGhz = get_cpu_freq_ghz();
        std::vector<double> samples;
        samples.reserve(config.iterations);

        // Warmup
        volatile double sum = 0;
        for (size_t w = 0; w < config.warmupIterations; ++w) {
            for (size_t i = 0; i < data.size(); ++i) {
                sum += data[i];
            }
        }

        // Measure
        for (size_t iter = 0; iter < config.iterations; ++iter) {
            uint64_t t0 = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
            for (size_t i = 0; i < data.size(); ++i) {
                sum += data[i];
            }
            uint64_t t1 = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
            samples.push_back(cycles_to_ns(t1 - t0, freqGhz) / data.size());
        }

        // Compute stats
        std::sort(samples.begin(), samples.end());
        double p50 = samples[samples.size() * 50 / 100];
        double p99 = samples[samples.size() * 99 / 100];

        result.metrics.push_back({"per_bar_p50", p50, "ns", p50 < 1000, p50 < 1000 ? "PASS" : "FAIL"});
        result.metrics.push_back({"per_bar_p99", p99, "ns", p99 < 10000, p99 < 10000 ? "PASS" : "WARN"});

    } catch (const std::exception& e) {
        result.success = false;
        result.error = e.what();
    }

    result.duration = std::chrono::steady_clock::now() - start;
    return result;
}

BenchmarkResult run_serialization_bench(const RunnerConfig& config) {
    BenchmarkResult result;
    result.name = "serialization";

    auto start = std::chrono::steady_clock::now();

    try {
        // Create test JSON string
        std::ostringstream json;
        json << "{\"trades\":[";
        for (int i = 0; i < 1000; ++i) {
            if (i > 0) json << ",";
            json << "{\"id\":" << i << ",\"price\":" << (100.0 + i * 0.01) << "}";
        }
        json << "]}";
        std::string testJson = json.str();

        double freqGhz = get_cpu_freq_ghz();
        std::vector<double> samples;
        samples.reserve(config.iterations);

        // Warmup
        for (size_t w = 0; w < config.warmupIterations; ++w) {
            volatile size_t len = testJson.size();
            (void)len;
        }

        // Measure string operations (simulating JSON serialization)
        for (size_t iter = 0; iter < config.iterations; ++iter) {
            uint64_t t0 = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
            std::string copy = testJson;
            compiler_barrier();
            uint64_t t1 = config.vmSafe ? rdtsc_vm_safe() : rdtsc_precise();
            samples.push_back(cycles_to_ns(t1 - t0, freqGhz));
        }

        std::sort(samples.begin(), samples.end());
        double p50 = samples[samples.size() * 50 / 100];

        result.metrics.push_back({"serialize_p50", p50 / 1000.0, "us", true, "OK"});
        result.metrics.push_back({"json_size", static_cast<double>(testJson.size()), "bytes", true, "OK"});

    } catch (const std::exception& e) {
        result.success = false;
        result.error = e.what();
    }

    result.duration = std::chrono::steady_clock::now() - start;
    return result;
}

BenchmarkResult run_memory_bench([[maybe_unused]] const RunnerConfig& config) {
    BenchmarkResult result;
    result.name = "memory";

    auto start = std::chrono::steady_clock::now();

    try {
        // Test allocation tracking
        global_memory_stats().reset();
        global_hotpath_audit().reset();

        // Simulate some allocations
        std::vector<std::vector<double>> data;
        data.reserve(100);

        for (int i = 0; i < 100; ++i) {
            data.emplace_back(1000);
        }

        auto& stats = global_memory_stats();

        result.metrics.push_back({"allocation_count", static_cast<double>(stats.allocation_count.load()), "count", true, "OK"});
        result.metrics.push_back({"peak_bytes", static_cast<double>(stats.peak_bytes.load()) / 1024.0, "KB", true, "OK"});

        // Hot path audit
        {
            ScopedHotPathAudit audit;
            // Any allocations here would be violations
            std::vector<double> temp(100);
            (void)temp;
        }

        bool hotPathPassed = global_hotpath_audit().passed();
        result.metrics.push_back({
            "hot_path_violations",
            static_cast<double>(global_hotpath_audit().violation_count()),
            "count",
            hotPathPassed,
            hotPathPassed ? "PASS" : "FAIL"
        });

    } catch (const std::exception& e) {
        result.success = false;
        result.error = e.what();
    }

    result.duration = std::chrono::steady_clock::now() - start;
    return result;
}

BenchmarkResult run_cache_bench([[maybe_unused]] const RunnerConfig& config) {
    BenchmarkResult result;
    result.name = "cache";

    auto start = std::chrono::steady_clock::now();

    try {
        PerfCounterGroup counters;
        counters.add(PerfEvent::L1D_READ_MISS);
        counters.add(PerfEvent::CACHE_MISSES);

        std::vector<double> data(1024 * 1024);  // 8MB
        for (size_t i = 0; i < data.size(); ++i) {
            data[i] = static_cast<double>(i);
        }

        volatile double sum = 0;

        {
            ScopedPerfCounters scope(counters);
            for (size_t iter = 0; iter < 10; ++iter) {
                for (size_t i = 0; i < data.size(); ++i) {
                    sum += data[i];
                }
            }
        }

        auto results = counters.read();
        for (const auto& r : results) {
            if (r.event == PerfEvent::L1D_READ_MISS) {
                result.metrics.push_back({"l1d_misses", static_cast<double>(r.value), "count", true, "OK"});
            }
            if (r.event == PerfEvent::CACHE_MISSES) {
                result.metrics.push_back({"cache_misses", static_cast<double>(r.value), "count", true, "OK"});
            }
        }

    } catch (const std::exception& e) {
        result.success = false;
        result.error = e.what();
    }

    result.duration = std::chrono::steady_clock::now() - start;
    return result;
}

BenchmarkResult run_perf_counters_bench([[maybe_unused]] const RunnerConfig& config) {
    BenchmarkResult result;
    result.name = "perf_counters";

    auto start = std::chrono::steady_clock::now();

    try {
        PerfCounterGroup counters;
        counters.add_standard_set();

        // Simple compute workload
        volatile double sum = 0;
        {
            ScopedPerfCounters scope(counters);
            for (size_t i = 0; i < 1000000; ++i) {
                sum += static_cast<double>(i) * 0.001;
            }
        }

        auto results = counters.read();
        auto metrics = DerivedMetrics::compute(results);

        result.metrics.push_back({"ipc", metrics.ipc, "ratio", metrics.ipc > 0.5, metrics.ipc > 0.5 ? "OK" : "WARN"});
        result.metrics.push_back({"branch_miss_rate", metrics.branch_miss_rate, "%", metrics.branch_miss_rate < 5, metrics.branch_miss_rate < 5 ? "OK" : "WARN"});

        for (const auto& r : results) {
            result.metrics.push_back({r.name, static_cast<double>(r.value), "count", true, "OK"});
        }

    } catch (const std::exception& e) {
        result.success = false;
        result.error = e.what();
    }

    result.duration = std::chrono::steady_clock::now() - start;
    return result;
}

// ============================================================================
// Benchmark Registry
// ============================================================================

using BenchmarkFunc = std::function<BenchmarkResult(const RunnerConfig&)>;

std::map<std::string, BenchmarkFunc> get_benchmark_registry() {
    return {
        {"execution", run_execution_bench},
        {"serialization", run_serialization_bench},
        {"memory", run_memory_bench},
        {"cache", run_cache_bench},
        {"perf_counters", run_perf_counters_bench},
    };
}

// ============================================================================
// Output Formatters
// ============================================================================

void output_text(const BenchmarkSuite& suite, std::ostream& out) {
    out << "\n";
    out << "================================================================\n";
    out << "           StratCraft BENCHMARK SUITE RESULTS\n";
    out << "================================================================\n";
    out << "\n";

    out << "System Information:\n";
    out << "  Timestamp:    " << suite.timestamp << "\n";
    out << "  Hostname:     " << suite.hostname << "\n";
    out << "  CPU Model:    " << suite.cpu_model << "\n";
    out << "  CPU Freq:     " << std::fixed << std::setprecision(2) << suite.cpu_freq_ghz << " GHz\n";
    out << "  Virtualized:  " << (suite.is_virtualized ? "yes" : "no") << "\n";
    out << "\n";

    for (const auto& result : suite.results) {
        out << "----------------------------------------------------------------\n";
        out << "Benchmark: " << result.name << "\n";
        out << "----------------------------------------------------------------\n";

        if (!result.success) {
            out << "  Status: FAILED - " << result.error << "\n";
            continue;
        }

        auto duration_ms = std::chrono::duration_cast<std::chrono::milliseconds>(result.duration).count();
        out << "  Duration: " << duration_ms << " ms\n";
        out << "\n";

        out << std::fixed << std::setprecision(3);
        for (const auto& metric : result.metrics) {
            out << "  " << std::left << std::setw(25) << metric.name
                << std::right << std::setw(15) << metric.value
                << " " << std::setw(10) << metric.unit
                << " [" << metric.status << "]\n";
        }
        out << "\n";
    }

    // Summary
    out << "================================================================\n";
    out << "SUMMARY\n";
    out << "================================================================\n";

    int passed = 0, failed = 0, warned = 0;
    for (const auto& result : suite.results) {
        if (!result.success) {
            failed++;
            continue;
        }
        for (const auto& metric : result.metrics) {
            if (metric.status == "PASS" || metric.status == "OK") passed++;
            else if (metric.status == "FAIL") failed++;
            else if (metric.status == "WARN") warned++;
        }
    }

    out << "  Passed:  " << passed << "\n";
    out << "  Failed:  " << failed << "\n";
    out << "  Warned:  " << warned << "\n";
    out << "\n";
    out << "Overall: " << (failed == 0 ? "PASSED" : "FAILED") << "\n";
    out << "================================================================\n";
}

void output_json(const BenchmarkSuite& suite, std::ostream& out) {
    out << "{\n";
    out << "  \"timestamp\": \"" << suite.timestamp << "\",\n";
    out << "  \"hostname\": \"" << suite.hostname << "\",\n";
    out << "  \"cpu_model\": \"" << suite.cpu_model << "\",\n";
    out << "  \"cpu_freq_ghz\": " << std::fixed << std::setprecision(3) << suite.cpu_freq_ghz << ",\n";
    out << "  \"is_virtualized\": " << (suite.is_virtualized ? "true" : "false") << ",\n";
    out << "  \"benchmarks\": [\n";

    for (size_t i = 0; i < suite.results.size(); ++i) {
        const auto& result = suite.results[i];

        out << "    {\n";
        out << "      \"name\": \"" << result.name << "\",\n";
        out << "      \"success\": " << (result.success ? "true" : "false") << ",\n";

        if (!result.success) {
            out << "      \"error\": \"" << result.error << "\"\n";
        } else {
            auto duration_us = std::chrono::duration_cast<std::chrono::microseconds>(result.duration).count();
            out << "      \"duration_us\": " << duration_us << ",\n";
            out << "      \"metrics\": {\n";

            for (size_t j = 0; j < result.metrics.size(); ++j) {
                const auto& metric = result.metrics[j];
                out << "        \"" << metric.name << "\": {\n";
                out << "          \"value\": " << std::fixed << std::setprecision(6) << metric.value << ",\n";
                out << "          \"unit\": \"" << metric.unit << "\",\n";
                out << "          \"status\": \"" << metric.status << "\"\n";
                out << "        }";
                if (j < result.metrics.size() - 1) out << ",";
                out << "\n";
            }

            out << "      }\n";
        }

        out << "    }";
        if (i < suite.results.size() - 1) out << ",";
        out << "\n";
    }

    out << "  ]\n";
    out << "}\n";
}

void output_csv(const BenchmarkSuite& suite, std::ostream& out) {
    // Header
    out << "benchmark,metric,value,unit,status\n";

    for (const auto& result : suite.results) {
        if (!result.success) {
            out << result.name << ",error,0,," << result.error << "\n";
            continue;
        }

        for (const auto& metric : result.metrics) {
            out << result.name << ","
                << metric.name << ","
                << std::fixed << std::setprecision(6) << metric.value << ","
                << metric.unit << ","
                << metric.status << "\n";
        }
    }
}

// ============================================================================
// Main
// ============================================================================

void print_usage(const char* prog) {
    std::cerr << "Usage: " << prog << " [options]\n";
    std::cerr << "\n";
    std::cerr << "Options:\n";
    std::cerr << "  --all                 Run all benchmarks\n";
    std::cerr << "  --bench=NAME[,NAME]   Run specific benchmarks\n";
    std::cerr << "  --list                List available benchmarks\n";
    std::cerr << "  --format=FORMAT       Output format: text, json, csv (default: text)\n";
    std::cerr << "  --output=FILE         Write results to file\n";
    std::cerr << "  --data-file=PATH      Parquet file for data loading benchmark\n";
    std::cerr << "  --iterations=N        Measurement iterations (default: 1000)\n";
    std::cerr << "  --warmup=N            Warmup iterations (default: 100)\n";
    std::cerr << "  --cpu=N               Bind to CPU core N\n";
    std::cerr << "  --realtime            Enable real-time scheduling (requires root)\n";
    std::cerr << "  --vm-safe             Use VM-safe RDTSC (for cloud environments)\n";
    std::cerr << "  --strict              Fail on any hot path allocation\n";
    std::cerr << "  --quiet               Minimal output\n";
    std::cerr << "  --help                Show this help\n";
    std::cerr << "\n";
    std::cerr << "Available benchmarks:\n";

    auto registry = get_benchmark_registry();
    for (const auto& [name, _] : registry) {
        std::cerr << "  " << name << "\n";
    }
}

int main(int argc, char* argv[]) {
    RunnerConfig config;

    // Parse arguments
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];

        if (arg == "--help" || arg == "-h") {
            print_usage(argv[0]);
            return 0;
        } else if (arg == "--all") {
            config.runAll = true;
        } else if (arg == "--list") {
            auto registry = get_benchmark_registry();
            for (const auto& [name, _] : registry) {
                std::cout << name << "\n";
            }
            return 0;
        } else if (arg.starts_with("--bench=")) {
            std::string benches = arg.substr(8);
            std::stringstream ss(benches);
            std::string bench;
            while (std::getline(ss, bench, ',')) {
                config.benchmarks.push_back(bench);
            }
        } else if (arg.starts_with("--format=")) {
            config.outputFormat = arg.substr(9);
        } else if (arg.starts_with("--output=")) {
            config.outputFile = arg.substr(9);
        } else if (arg.starts_with("--data-file=")) {
            config.dataFile = arg.substr(12);
        } else if (arg.starts_with("--iterations=")) {
            config.iterations = std::stoull(arg.substr(13));
        } else if (arg.starts_with("--warmup=")) {
            config.warmupIterations = std::stoull(arg.substr(9));
        } else if (arg.starts_with("--cpu=")) {
            config.cpuCore = std::stoi(arg.substr(6));
        } else if (arg == "--realtime") {
            config.realtime = true;
        } else if (arg == "--vm-safe") {
            config.vmSafe = true;
        } else if (arg == "--strict") {
            config.strict = true;
        } else if (arg == "--quiet") {
            config.quiet = true;
        } else if (arg == "--json") {
            // TICKET_471_5: Shorthand for --format=json --all
            config.outputFormat = "json";
            config.runAll = true;
        } else if (arg[0] != '-' && std::isdigit(static_cast<unsigned char>(arg[0]))) {
            // TICKET_471_5: Positional iteration count (e.g., "10000")
            config.iterations = std::stoull(arg);
            if (config.benchmarks.empty()) {
                config.runAll = true;
            }
        } else {
            std::cerr << "Unknown option: " << arg << "\n";
            return 1;
        }
    }

    // Auto-detect virtualization
    if (!config.vmSafe && is_virtualized()) {
        if (!config.quiet) {
            std::cout << "Note: Virtualized environment detected, using VM-safe RDTSC\n";
        }
        config.vmSafe = true;
    }

    // CPU affinity
    if (config.cpuCore >= 0) {
        if (config.realtime) {
            if (setup_benchmark_thread(config.cpuCore)) {
                if (!config.quiet) {
                    std::cout << "Bound to CPU core " << config.cpuCore << " with real-time priority\n";
                }
            } else {
                std::cerr << "Warning: Failed to set real-time scheduling (requires root)\n";
                bind_to_core(config.cpuCore);
            }
        } else {
            if (bind_to_core(config.cpuCore)) {
                if (!config.quiet) {
                    std::cout << "Bound to CPU core " << config.cpuCore << "\n";
                }
            }
        }
    }

    // Determine benchmarks to run
    auto registry = get_benchmark_registry();

    if (config.runAll) {
        for (const auto& [name, _] : registry) {
            config.benchmarks.push_back(name);
        }
    }

    if (config.benchmarks.empty()) {
        std::cerr << "No benchmarks specified. Use --all or --bench=NAME\n";
        return 1;
    }

    // Build suite
    BenchmarkSuite suite;
    suite.timestamp = get_timestamp();
    suite.hostname = get_hostname();
    suite.cpu_model = get_cpu_model();
    suite.cpu_freq_ghz = get_cpu_freq_ghz();
    suite.is_virtualized = is_virtualized();

    // Run benchmarks
    if (!config.quiet) {
        std::cout << "Running " << config.benchmarks.size() << " benchmark(s)...\n\n";
    }

    for (const auto& name : config.benchmarks) {
        auto it = registry.find(name);
        if (it == registry.end()) {
            std::cerr << "Unknown benchmark: " << name << "\n";
            continue;
        }

        if (!config.quiet) {
            std::cout << "Running: " << name << "..." << std::flush;
        }

        auto result = it->second(config);
        suite.results.push_back(result);

        if (!config.quiet) {
            std::cout << " " << (result.success ? "OK" : "FAILED") << "\n";
        }
    }

    // Output results
    std::ostream* out = &std::cout;
    std::ofstream outFile;

    if (!config.outputFile.empty()) {
        outFile.open(config.outputFile);
        if (!outFile) {
            std::cerr << "Error: Cannot open output file: " << config.outputFile << "\n";
            return 1;
        }
        out = &outFile;
    }

    if (config.outputFormat == "json") {
        output_json(suite, *out);
    } else if (config.outputFormat == "csv") {
        output_csv(suite, *out);
    } else {
        output_text(suite, *out);
    }

    // Check strict mode
    if (config.strict) {
        for (const auto& result : suite.results) {
            for (const auto& metric : result.metrics) {
                if (metric.status == "FAIL") {
                    return 1;
                }
            }
        }
    }

    return 0;
}
