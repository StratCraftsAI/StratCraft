/**
 * Executor Plugin Types
 *
 * TICKET_251_1: Define generic types for plugin architecture
 *
 * Provides flexible, JSON-based types that allow plugins to define
 * their own configuration and result formats.
 */

#pragma once

#include <string>
#include <functional>
#include <nlohmann/json.hpp>

namespace StratCraft::executor {

// =============================================================================
// Progress Callback (shared with existing code)
// =============================================================================

/**
 * Progress callback for execution updates
 *
 * @param percent Progress percentage (0.0 - 100.0)
 * @param message Human-readable status message
 */
using ProgressCallback = std::function<void(double percent, const std::string& message)>;

// =============================================================================
// Generic Execution Result
// =============================================================================

/**
 * Generic execution result
 *
 * Uses JSON for plugin-specific data to allow flexibility.
 * Each plugin defines its own result schema within the data field.
 */
struct ExecutionResult {
    bool success = false;
    std::string errorMessage;
    nlohmann::json data;  // Plugin-specific result data

    NLOHMANN_DEFINE_TYPE_INTRUSIVE_WITH_DEFAULT(ExecutionResult,
        success, errorMessage, data)
};

// =============================================================================
// Plugin Configuration
// =============================================================================

/**
 * Generic plugin configuration
 *
 * The pluginData field contains plugin-specific configuration.
 * For backtest plugin, this maps to existing ExecutorConfig fields.
 */
struct PluginConfig {
    std::string pluginName;           // "backtest", "alpha-factory", etc.
    std::string outputDir;            // Output directory for results
    nlohmann::json pluginData;        // Plugin-specific configuration

    NLOHMANN_DEFINE_TYPE_INTRUSIVE(PluginConfig,
        pluginName, outputDir, pluginData)
};

// =============================================================================
// Plugin Factory Function Types
// =============================================================================

// Forward declaration
class IExecutorPlugin;

/**
 * Plugin creation function
 *
 * Exported by dynamic plugins as: extern "C" IExecutorPlugin* create_plugin()
 */
using CreatePluginFunc = IExecutorPlugin* (*)();

/**
 * Plugin destruction function
 *
 * Exported by dynamic plugins as: extern "C" void destroy_plugin(IExecutorPlugin*)
 */
using DestroyPluginFunc = void (*)(IExecutorPlugin*);

/**
 * Plugin version function
 *
 * Exported by dynamic plugins as: extern "C" const char* plugin_version()
 */
using PluginVersionFunc = const char* (*)();

} // namespace StratCraft::executor
