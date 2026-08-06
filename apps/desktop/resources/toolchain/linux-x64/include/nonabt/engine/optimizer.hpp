#pragma once

#include <stratforge/core/params.hpp>
#include <stratforge/engine/cerebro.hpp>

#include <cstddef>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace nonabt {

/// Result of a single optimization run
struct OptResult {
    ParamMap params;
    double final_value = 0.0;
    double sharpe_ratio = 0.0;
    double max_drawdown = 0.0;
    std::size_t total_trades = 0;
};

/// Parameter range specification for optimization
struct ParamRange {
    std::string name;
    std::vector<ParamValue> values;
};

/// Generate Cartesian product of parameter ranges
inline std::vector<ParamMap> generate_param_grid(const std::vector<ParamRange>& ranges) {
    std::vector<ParamMap> grid;
    if (ranges.empty()) return grid;

    // Start with first range
    for (const auto& val : ranges[0].values) {
        ParamMap m;
        m[ranges[0].name] = val;
        grid.push_back(std::move(m));
    }

    // Cross-product with remaining ranges
    for (std::size_t r = 1; r < ranges.size(); ++r) {
        std::vector<ParamMap> new_grid;
        new_grid.reserve(grid.size() * ranges[r].values.size());
        for (const auto& existing : grid) {
            for (const auto& val : ranges[r].values) {
                ParamMap m = existing;
                m[ranges[r].name] = val;
                new_grid.push_back(std::move(m));
            }
        }
        grid = std::move(new_grid);
    }

    return grid;
}

/// Optimizer - runs strategy with different parameter combinations in parallel.
/// Uses std::jthread for parallel execution with independent data feed clones.
class Optimizer {
public:
    /// Strategy factory type: creates a strategy given parameters
    using StrategyFactory = std::function<std::unique_ptr<Strategy>(const ParamMap&)>;

    /// Result extraction callback (runs after each Cerebro.run())
    using ResultExtractor = std::function<OptResult(const Cerebro&, const ParamMap&)>;

    struct Config {
        double cash = 10000.0;
        CommissionInfo commission;
        std::size_t max_threads = 0; // 0 = hardware_concurrency
    };

    Optimizer() = default;
    explicit Optimizer(Config config) : config_(std::move(config)) {}

    /// Run optimization over a parameter grid.
    /// @param data_feeds Source data feeds (will be cloned per worker)
    /// @param factory Creates strategy instances for each parameter combo
    /// @param ranges Parameter ranges to search
    /// @param extractor Extracts results from a completed run
    /// @return Vector of results, one per parameter combination
    [[nodiscard]] std::vector<OptResult> run(
        const std::vector<DataFeed*>& data_feeds,
        const StrategyFactory& factory,
        const std::vector<ParamRange>& ranges,
        const ResultExtractor& extractor)
    {
        auto grid = generate_param_grid(ranges);
        if (grid.empty()) return {};

        std::size_t num_threads = config_.max_threads;
        if (num_threads == 0) {
            num_threads = std::thread::hardware_concurrency();
            if (num_threads == 0) num_threads = 1;
        }

        std::vector<OptResult> results(grid.size());
        std::mutex index_mutex;
        std::size_t next_index = 0;

        auto worker = [&]() {
            while (true) {
                std::size_t idx;
                {
                    std::lock_guard lock(index_mutex);
                    if (next_index >= grid.size()) return;
                    idx = next_index++;
                }

                // Clone data feeds for this worker
                Cerebro cerebro;
                cerebro.set_cash(config_.cash);
                cerebro.set_commission(config_.commission);

                for (auto* feed : data_feeds) {
                    auto cloned = feed->clone();
                    if (!cloned) {
                        // If clone not supported, results will be empty for this combo
                        return;
                    }
                    cerebro.add_data(std::move(cloned));
                }

                // Create and configure strategy
                auto strategy = factory(grid[idx]);
                strategy->set_params(grid[idx]);
                cerebro.add_strategy(std::move(strategy));

                // Run
                cerebro.run();

                // Extract results
                results[idx] = extractor(cerebro, grid[idx]);
                results[idx].params = grid[idx];
            }
        };

        // Launch worker threads
        std::vector<std::jthread> threads;
        threads.reserve(std::min(num_threads, grid.size()));
        for (std::size_t t = 0; t < std::min(num_threads, grid.size()); ++t) {
            threads.emplace_back(worker);
        }

        // jthreads auto-join on destruction
        threads.clear();

        return results;
    }

private:
    Config config_;
};

} // namespace nonabt
