/**
 * Executor Core Implementation
 *
 * TICKET_133 Phase 1: Executor Core Development
 * TICKET_681: Removed BacktestPlugin dependency (pybind11 removed)
 *
 * Provides config loading and result serialization utilities.
 */

#include "quantnexus/executor/executor_core.hpp"
#include "quantnexus/executor/cpp_backtest_plugin.hpp"
#include "quantnexus/executor/executor_constants.hpp"

#include <nlohmann/json.hpp>
#include <fstream>
#include <format>
#include <filesystem>

namespace fs = std::filesystem;

namespace StratCraft::executor {

// =============================================================================
// Config Loading
// =============================================================================

ExecutorConfig ExecutorConfig::LoadFromFile(const std::string& path) {
    std::ifstream file(path);
    if (!file.is_open()) {
        throw std::runtime_error(std::format("Failed to open config file: {}", path));
    }

    nlohmann::json j;
    file >> j;
    return j.get<ExecutorConfig>();
}

ExecutorConfig ExecutorConfig::LoadFromString(const std::string& json) {
    auto j = nlohmann::json::parse(json);
    return j.get<ExecutorConfig>();
}

// =============================================================================
// Result Saving
// =============================================================================

void BacktestResult::SaveToFile(const std::string& path) const {
    std::ofstream file(path);
    if (!file.is_open()) {
        throw std::runtime_error(std::format("Failed to open output file: {}", path));
    }

    nlohmann::json j = *this;
    file << j.dump(constants::JSON_INDENT_SPACES);
}

std::string BacktestResult::ToJson() const {
    nlohmann::json j = *this;
    return j.dump(constants::JSON_INDENT_SPACES);
}

// =============================================================================
// ExecutorCore Implementation (TICKET_681: delegates to CppBacktestPlugin)
// =============================================================================

ExecutorCore::ExecutorCore()
    : plugin_(std::make_unique<CppBacktestPlugin>()) {
}

ExecutorCore::~ExecutorCore() = default;

BacktestResult ExecutorCore::execute(
    const std::string& configPath,
    const std::string& outputDir,
    ProgressCallback progressCallback,
    IncrementCallback incrementCallback
) {
    // Load config
    ExecutorConfig config = ExecutorConfig::LoadFromFile(configPath);

    // Override output dir if specified
    if (!outputDir.empty()) {
        config.outputDir = outputDir;
    }

    // Execute via CppBacktestPlugin interface
    nlohmann::json configJson;
    configJson["strategyPath"] = config.strategyPath;
    configJson["outputDir"] = config.outputDir;
    configJson["language"] = "cpp";

    auto result = plugin_->execute(configJson, std::move(progressCallback), std::move(incrementCallback));

    BacktestResult btResult;
    btResult.success = result.success;
    btResult.errorMessage = result.errorMessage;
    return btResult;
}

BacktestResult ExecutorCore::execute(
    const ExecutorConfig& config,
    ProgressCallback progressCallback,
    IncrementCallback incrementCallback
) {
    return execute(config.outputDir + "/config.json", config.outputDir, std::move(progressCallback), std::move(incrementCallback));
}

} // namespace StratCraft::executor
