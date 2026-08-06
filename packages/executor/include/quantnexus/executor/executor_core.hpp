/**
 * Executor Core
 *
 * TICKET_133 Phase 1: Executor Core Development
 * TICKET_681: Removed BacktestPlugin/pybind11 dependency
 *
 * Provides config loading, result serialization, and backward-compatible
 * ExecutorCore wrapper (now delegates to CppBacktestPlugin).
 */

#pragma once

#include "config_types.hpp"
#include "result_types.hpp"
#include "data_source.hpp"
#include "plugin_types.hpp"

#include <functional>
#include <memory>
#include <string>

namespace StratCraft::executor {

// Forward declaration
class CppBacktestPlugin;

// =============================================================================
// ExecutorCore (Backward Compatibility Wrapper)
// =============================================================================

/**
 * Backward-compatible wrapper for strategy execution
 *
 * TICKET_681: Now delegates to CppBacktestPlugin (Python path removed).
 */
class ExecutorCore {
public:
    ExecutorCore();
    ~ExecutorCore();

    // Non-copyable, non-movable
    ExecutorCore(const ExecutorCore&) = delete;
    ExecutorCore& operator=(const ExecutorCore&) = delete;
    ExecutorCore(ExecutorCore&&) = delete;
    ExecutorCore& operator=(ExecutorCore&&) = delete;

    /**
     * Execute strategy from config file
     */
    BacktestResult execute(
        const std::string& configPath,
        const std::string& outputDir,
        ProgressCallback progressCallback = nullptr,
        IncrementCallback incrementCallback = nullptr
    );

    /**
     * Execute with pre-loaded config
     */
    BacktestResult execute(
        const ExecutorConfig& config,
        ProgressCallback progressCallback = nullptr,
        IncrementCallback incrementCallback = nullptr
    );

private:
    std::unique_ptr<CppBacktestPlugin> plugin_;
};

} // namespace StratCraft::executor
