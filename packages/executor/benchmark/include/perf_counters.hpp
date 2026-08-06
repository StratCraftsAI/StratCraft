/**
 * @file perf_counters.hpp
 * @brief Hardware performance counter wrapper using Linux perf_event
 *
 * Reference: TICKET_174 - C++ Executor Benchmark Framework
 * Reference: modernc_quant.md #97 - Hardware Performance Counters
 */

#pragma once

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>
#include <unordered_map>
#include <stdexcept>
#include <fstream>
#include <sstream>

#include <unistd.h>
#include <sys/ioctl.h>
#include <linux/perf_event.h>
#include <sys/syscall.h>

namespace qnx::bench {

// ============================================================================
// Perf Event Types
// ============================================================================

enum class PerfEvent {
    // Hardware events
    CPU_CYCLES,
    INSTRUCTIONS,
    CACHE_REFERENCES,
    CACHE_MISSES,
    BRANCH_INSTRUCTIONS,
    BRANCH_MISSES,

    // Cache events
    L1D_READ_MISS,
    L1D_WRITE_MISS,
    L1I_READ_MISS,
    LLC_READ_MISS,
    LLC_WRITE_MISS,

    // TLB events
    DTLB_READ_MISS,
    DTLB_WRITE_MISS,
    ITLB_READ_MISS,

    // Branch events
    BRANCH_LOAD_MISS,
};

/**
 * @brief Convert PerfEvent to perf_event_attr configuration
 */
inline perf_event_attr make_perf_attr(PerfEvent event) {
    perf_event_attr attr{};
    std::memset(&attr, 0, sizeof(attr));
    attr.size = sizeof(attr);
    attr.disabled = 1;
    attr.exclude_kernel = 1;
    attr.exclude_hv = 1;

    switch (event) {
        case PerfEvent::CPU_CYCLES:
            attr.type = PERF_TYPE_HARDWARE;
            attr.config = PERF_COUNT_HW_CPU_CYCLES;
            break;
        case PerfEvent::INSTRUCTIONS:
            attr.type = PERF_TYPE_HARDWARE;
            attr.config = PERF_COUNT_HW_INSTRUCTIONS;
            break;
        case PerfEvent::CACHE_REFERENCES:
            attr.type = PERF_TYPE_HARDWARE;
            attr.config = PERF_COUNT_HW_CACHE_REFERENCES;
            break;
        case PerfEvent::CACHE_MISSES:
            attr.type = PERF_TYPE_HARDWARE;
            attr.config = PERF_COUNT_HW_CACHE_MISSES;
            break;
        case PerfEvent::BRANCH_INSTRUCTIONS:
            attr.type = PERF_TYPE_HARDWARE;
            attr.config = PERF_COUNT_HW_BRANCH_INSTRUCTIONS;
            break;
        case PerfEvent::BRANCH_MISSES:
            attr.type = PERF_TYPE_HARDWARE;
            attr.config = PERF_COUNT_HW_BRANCH_MISSES;
            break;

        // L1 Data Cache
        case PerfEvent::L1D_READ_MISS:
            attr.type = PERF_TYPE_HW_CACHE;
            attr.config = (PERF_COUNT_HW_CACHE_L1D) |
                          (PERF_COUNT_HW_CACHE_OP_READ << 8) |
                          (PERF_COUNT_HW_CACHE_RESULT_MISS << 16);
            break;
        case PerfEvent::L1D_WRITE_MISS:
            attr.type = PERF_TYPE_HW_CACHE;
            attr.config = (PERF_COUNT_HW_CACHE_L1D) |
                          (PERF_COUNT_HW_CACHE_OP_WRITE << 8) |
                          (PERF_COUNT_HW_CACHE_RESULT_MISS << 16);
            break;

        // L1 Instruction Cache
        case PerfEvent::L1I_READ_MISS:
            attr.type = PERF_TYPE_HW_CACHE;
            attr.config = (PERF_COUNT_HW_CACHE_L1I) |
                          (PERF_COUNT_HW_CACHE_OP_READ << 8) |
                          (PERF_COUNT_HW_CACHE_RESULT_MISS << 16);
            break;

        // Last Level Cache
        case PerfEvent::LLC_READ_MISS:
            attr.type = PERF_TYPE_HW_CACHE;
            attr.config = (PERF_COUNT_HW_CACHE_LL) |
                          (PERF_COUNT_HW_CACHE_OP_READ << 8) |
                          (PERF_COUNT_HW_CACHE_RESULT_MISS << 16);
            break;
        case PerfEvent::LLC_WRITE_MISS:
            attr.type = PERF_TYPE_HW_CACHE;
            attr.config = (PERF_COUNT_HW_CACHE_LL) |
                          (PERF_COUNT_HW_CACHE_OP_WRITE << 8) |
                          (PERF_COUNT_HW_CACHE_RESULT_MISS << 16);
            break;

        // Data TLB
        case PerfEvent::DTLB_READ_MISS:
            attr.type = PERF_TYPE_HW_CACHE;
            attr.config = (PERF_COUNT_HW_CACHE_DTLB) |
                          (PERF_COUNT_HW_CACHE_OP_READ << 8) |
                          (PERF_COUNT_HW_CACHE_RESULT_MISS << 16);
            break;
        case PerfEvent::DTLB_WRITE_MISS:
            attr.type = PERF_TYPE_HW_CACHE;
            attr.config = (PERF_COUNT_HW_CACHE_DTLB) |
                          (PERF_COUNT_HW_CACHE_OP_WRITE << 8) |
                          (PERF_COUNT_HW_CACHE_RESULT_MISS << 16);
            break;

        // Instruction TLB
        case PerfEvent::ITLB_READ_MISS:
            attr.type = PERF_TYPE_HW_CACHE;
            attr.config = (PERF_COUNT_HW_CACHE_ITLB) |
                          (PERF_COUNT_HW_CACHE_OP_READ << 8) |
                          (PERF_COUNT_HW_CACHE_RESULT_MISS << 16);
            break;

        // Branch
        case PerfEvent::BRANCH_LOAD_MISS:
            attr.type = PERF_TYPE_HW_CACHE;
            attr.config = (PERF_COUNT_HW_CACHE_BPU) |
                          (PERF_COUNT_HW_CACHE_OP_READ << 8) |
                          (PERF_COUNT_HW_CACHE_RESULT_MISS << 16);
            break;
    }

    return attr;
}

/**
 * @brief Get human-readable name for PerfEvent
 */
inline const char* perf_event_name(PerfEvent event) {
    switch (event) {
        case PerfEvent::CPU_CYCLES: return "cpu_cycles";
        case PerfEvent::INSTRUCTIONS: return "instructions";
        case PerfEvent::CACHE_REFERENCES: return "cache_refs";
        case PerfEvent::CACHE_MISSES: return "cache_misses";
        case PerfEvent::BRANCH_INSTRUCTIONS: return "branch_insns";
        case PerfEvent::BRANCH_MISSES: return "branch_misses";
        case PerfEvent::L1D_READ_MISS: return "l1d_read_miss";
        case PerfEvent::L1D_WRITE_MISS: return "l1d_write_miss";
        case PerfEvent::L1I_READ_MISS: return "l1i_read_miss";
        case PerfEvent::LLC_READ_MISS: return "llc_read_miss";
        case PerfEvent::LLC_WRITE_MISS: return "llc_write_miss";
        case PerfEvent::DTLB_READ_MISS: return "dtlb_read_miss";
        case PerfEvent::DTLB_WRITE_MISS: return "dtlb_write_miss";
        case PerfEvent::ITLB_READ_MISS: return "itlb_read_miss";
        case PerfEvent::BRANCH_LOAD_MISS: return "branch_load_miss";
        default: return "unknown";
    }
}

// ============================================================================
// Single Counter
// ============================================================================

/**
 * @brief Single perf event counter
 */
class PerfCounter {
public:
    explicit PerfCounter(PerfEvent event) : event_(event), fd_(-1) {
        auto attr = make_perf_attr(event);
        fd_ = static_cast<int>(syscall(__NR_perf_event_open, &attr, 0, -1, -1, 0));
    }

    ~PerfCounter() {
        if (fd_ >= 0) {
            close(fd_);
        }
    }

    PerfCounter(const PerfCounter&) = delete;
    PerfCounter& operator=(const PerfCounter&) = delete;

    PerfCounter(PerfCounter&& other) noexcept : event_(other.event_), fd_(other.fd_) {
        other.fd_ = -1;
    }

    [[nodiscard]] bool is_valid() const noexcept { return fd_ >= 0; }
    [[nodiscard]] PerfEvent event() const noexcept { return event_; }

    void start() {
        if (fd_ >= 0) {
            ioctl(fd_, PERF_EVENT_IOC_RESET, 0);
            ioctl(fd_, PERF_EVENT_IOC_ENABLE, 0);
        }
    }

    void stop() {
        if (fd_ >= 0) {
            ioctl(fd_, PERF_EVENT_IOC_DISABLE, 0);
        }
    }

    [[nodiscard]] uint64_t read() const {
        uint64_t value = 0;
        if (fd_ >= 0) {
            [[maybe_unused]] auto ret = ::read(fd_, &value, sizeof(value));
        }
        return value;
    }

private:
    PerfEvent event_;
    int fd_;
};

// ============================================================================
// Multi-Counter Group
// ============================================================================

/**
 * @brief Hardware counter result
 */
struct CounterResult {
    PerfEvent event;
    uint64_t value;
    const char* name;
};

/**
 * @brief Group of perf counters for comprehensive measurement
 */
class PerfCounterGroup {
public:
    PerfCounterGroup() = default;

    void add(PerfEvent event) {
        counters_.emplace_back(event);
    }

    void add_standard_set() {
        add(PerfEvent::CPU_CYCLES);
        add(PerfEvent::INSTRUCTIONS);
        add(PerfEvent::CACHE_MISSES);
        add(PerfEvent::BRANCH_MISSES);
        add(PerfEvent::L1D_READ_MISS);
        add(PerfEvent::DTLB_READ_MISS);
        add(PerfEvent::ITLB_READ_MISS);
    }

    void start() {
        for (auto& counter : counters_) {
            counter.start();
        }
    }

    void stop() {
        for (auto& counter : counters_) {
            counter.stop();
        }
    }

    [[nodiscard]] std::vector<CounterResult> read() const {
        std::vector<CounterResult> results;
        results.reserve(counters_.size());

        for (const auto& counter : counters_) {
            if (counter.is_valid()) {
                results.push_back({
                    counter.event(),
                    counter.read(),
                    perf_event_name(counter.event())
                });
            }
        }

        return results;
    }

    [[nodiscard]] size_t valid_count() const {
        size_t count = 0;
        for (const auto& counter : counters_) {
            if (counter.is_valid()) ++count;
        }
        return count;
    }

private:
    std::vector<PerfCounter> counters_;
};

// ============================================================================
// RAII Counter Scope
// ============================================================================

/**
 * @brief RAII scope for measuring perf counters
 */
class ScopedPerfCounters {
public:
    explicit ScopedPerfCounters(PerfCounterGroup& group) : group_(group) {
        group_.start();
    }

    ~ScopedPerfCounters() {
        group_.stop();
    }

    ScopedPerfCounters(const ScopedPerfCounters&) = delete;
    ScopedPerfCounters& operator=(const ScopedPerfCounters&) = delete;

private:
    PerfCounterGroup& group_;
};

// ============================================================================
// Derived Metrics
// ============================================================================

/**
 * @brief Derived performance metrics
 */
struct DerivedMetrics {
    double ipc = 0;                    // Instructions per cycle
    double cache_miss_rate = 0;        // Cache miss rate (%)
    double branch_miss_rate = 0;       // Branch misprediction rate (%)
    double l1d_miss_rate = 0;          // L1D miss rate (%)
    double dtlb_miss_rate = 0;         // Data TLB miss rate (%)
    double itlb_miss_rate = 0;         // Instruction TLB miss rate (%)
    double cpb = 0;                    // Cycles per bar (computed externally)

    static DerivedMetrics compute(const std::vector<CounterResult>& results) {
        DerivedMetrics metrics;

        uint64_t cycles = 0, instructions = 0;
        uint64_t cache_refs = 0, cache_misses = 0;
        uint64_t branch_insns = 0, branch_misses = 0;
        uint64_t l1d_misses = 0;
        uint64_t dtlb_misses = 0, itlb_misses = 0;

        for (const auto& r : results) {
            switch (r.event) {
                case PerfEvent::CPU_CYCLES: cycles = r.value; break;
                case PerfEvent::INSTRUCTIONS: instructions = r.value; break;
                case PerfEvent::CACHE_REFERENCES: cache_refs = r.value; break;
                case PerfEvent::CACHE_MISSES: cache_misses = r.value; break;
                case PerfEvent::BRANCH_INSTRUCTIONS: branch_insns = r.value; break;
                case PerfEvent::BRANCH_MISSES: branch_misses = r.value; break;
                case PerfEvent::L1D_READ_MISS: l1d_misses += r.value; break;
                case PerfEvent::L1D_WRITE_MISS: l1d_misses += r.value; break;
                case PerfEvent::DTLB_READ_MISS: dtlb_misses += r.value; break;
                case PerfEvent::DTLB_WRITE_MISS: dtlb_misses += r.value; break;
                case PerfEvent::ITLB_READ_MISS: itlb_misses = r.value; break;
                default: break;
            }
        }

        if (cycles > 0) {
            metrics.ipc = static_cast<double>(instructions) / cycles;
        }
        if (cache_refs > 0) {
            metrics.cache_miss_rate = 100.0 * cache_misses / cache_refs;
        }
        if (branch_insns > 0) {
            metrics.branch_miss_rate = 100.0 * branch_misses / branch_insns;
        }
        if (instructions > 0) {
            metrics.l1d_miss_rate = 100.0 * l1d_misses / instructions;
            metrics.dtlb_miss_rate = 100.0 * dtlb_misses / instructions;
            metrics.itlb_miss_rate = 100.0 * itlb_misses / instructions;
        }

        return metrics;
    }
};

// ============================================================================
// JSON Output
// ============================================================================

inline std::string results_to_json(const std::vector<CounterResult>& results,
                                   const DerivedMetrics& metrics) {
    std::ostringstream ss;
    ss << "{\n";
    ss << "  \"counters\": {\n";

    for (size_t i = 0; i < results.size(); ++i) {
        ss << "    \"" << results[i].name << "\": " << results[i].value;
        if (i < results.size() - 1) ss << ",";
        ss << "\n";
    }

    ss << "  },\n";
    ss << "  \"metrics\": {\n";
    ss << "    \"ipc\": " << metrics.ipc << ",\n";
    ss << "    \"cache_miss_rate_pct\": " << metrics.cache_miss_rate << ",\n";
    ss << "    \"branch_miss_rate_pct\": " << metrics.branch_miss_rate << ",\n";
    ss << "    \"l1d_miss_rate_pct\": " << metrics.l1d_miss_rate << ",\n";
    ss << "    \"dtlb_miss_rate_pct\": " << metrics.dtlb_miss_rate << ",\n";
    ss << "    \"itlb_miss_rate_pct\": " << metrics.itlb_miss_rate << "\n";
    ss << "  }\n";
    ss << "}";

    return ss.str();
}

}  // namespace qnx::bench
