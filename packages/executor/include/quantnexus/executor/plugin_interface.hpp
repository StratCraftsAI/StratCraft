/**
 * Executor Plugin Interface
 *
 * TICKET_251_1: Define IExecutorPlugin abstract interface
 *
 * All executor plugins (built-in and third-party) must implement this interface.
 * The interface is designed to be:
 * - Generic: Works with any execution type (backtest, alpha factory, optimization)
 * - Flexible: Uses JSON for configuration and results
 * - Safe: Supports cancellation and progress reporting
 */

#pragma once

#include "plugin_types.hpp"
#include "result_types.hpp"  // TICKET_789: IncrementCallback

#include <string_view>
#include <memory>

namespace StratCraft::executor {

// =============================================================================
// IExecutorPlugin Interface
// =============================================================================

/**
 * Abstract interface for executor plugins
 *
 * Plugins are loaded dynamically or registered as built-in.
 * Each plugin handles a specific type of execution task.
 *
 * Example plugins:
 * - BacktestPlugin: Strategy backtesting (built-in)
 * - AlphaFactoryPlugin: Signal combination and evaluation
 * - OptimizationPlugin: Parameter optimization
 */
class IExecutorPlugin {
public:
    virtual ~IExecutorPlugin() = default;

    // =========================================================================
    // Plugin Metadata
    // =========================================================================

    /**
     * Get plugin name (unique identifier)
     *
     * Used for plugin selection in configuration.
     * Examples: "backtest", "alpha-factory", "optimization"
     */
    [[nodiscard]] virtual std::string_view name() const noexcept = 0;

    /**
     * Get plugin version
     *
     * Semantic versioning recommended (e.g., "1.0.0")
     */
    [[nodiscard]] virtual std::string_view version() const noexcept = 0;

    /**
     * Get plugin description (optional)
     *
     * Human-readable description for UI display
     */
    [[nodiscard]] virtual std::string_view description() const noexcept {
        return "";
    }

    // =========================================================================
    // Execution
    // =========================================================================

    /**
     * Execute the plugin task
     *
     * @param config Plugin-specific configuration (from PluginConfig.pluginData)
     * @param progressCallback Optional callback for progress updates
     * @param incrementCallback Optional callback for streaming incremental
     *        results (TICKET_789). Plugins that support progressive emission
     *        (e.g. cpp_backtest via stratforge IncrementBatcher) invoke this
     *        once per flush. Plugins that do not stream may ignore it.
     *        Default nullptr keeps existing call sites working unchanged.
     * @return ExecutionResult with success status and plugin-specific data
     *
     * Implementation notes:
     * - Check cancelled() periodically for long-running tasks
     * - Call progressCallback to report progress (0-100%)
     * - Return error in ExecutionResult.errorMessage on failure
     */
    virtual ExecutionResult execute(
        const nlohmann::json& config,
        ProgressCallback progressCallback = nullptr,
        IncrementCallback incrementCallback = nullptr
    ) = 0;

    // =========================================================================
    // Cancellation
    // =========================================================================

    /**
     * Request execution cancellation
     *
     * Sets internal flag that execute() should check periodically.
     * Cancellation is cooperative - plugins must check and respond.
     */
    virtual void cancel() noexcept = 0;

    /**
     * Check if cancellation was requested
     *
     * Plugins should call this in their execution loop.
     */
    [[nodiscard]] virtual bool cancelled() const noexcept = 0;

    // =========================================================================
    // Progress
    // =========================================================================

    /**
     * Get current progress percentage
     *
     * @return Progress as percentage (0.0 - 100.0)
     *
     * Can be queried independently of progressCallback.
     */
    [[nodiscard]] virtual float progress() const noexcept = 0;
};

// =============================================================================
// Plugin Smart Pointer
// =============================================================================

/**
 * Unique pointer with custom deleter for dynamically loaded plugins
 *
 * For built-in plugins, use default deleter.
 * For dynamic plugins, use DestroyPluginFunc from the shared library.
 */
using PluginPtr = std::unique_ptr<IExecutorPlugin, void(*)(IExecutorPlugin*)>;

/**
 * Create PluginPtr for built-in plugin
 */
inline PluginPtr makeBuiltinPluginPtr(IExecutorPlugin* plugin) {
    return PluginPtr(plugin, [](IExecutorPlugin* p) { delete p; });
}

/**
 * Create PluginPtr for dynamic plugin with custom deleter
 */
inline PluginPtr makeDynamicPluginPtr(IExecutorPlugin* plugin, DestroyPluginFunc deleter) {
    return PluginPtr(plugin, deleter);
}

} // namespace StratCraft::executor
