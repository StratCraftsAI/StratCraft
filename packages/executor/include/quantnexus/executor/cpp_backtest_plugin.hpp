/**
 * C++ Backtest Plugin
 *
 * NONABT_TICKET_010_3 Phase 4B: executor vertical slice for C++ strategies.
 */

#pragma once

#include "plugin_interface.hpp"

#include <atomic>
#include <string>
#include <string_view>
#include <vector>

namespace StratCraft::executor {

class CppBacktestPlugin : public IExecutorPlugin {
public:
    CppBacktestPlugin() = default;
    ~CppBacktestPlugin() override = default;

    CppBacktestPlugin(const CppBacktestPlugin&) = delete;
    CppBacktestPlugin& operator=(const CppBacktestPlugin&) = delete;
    CppBacktestPlugin(CppBacktestPlugin&&) = delete;
    CppBacktestPlugin& operator=(CppBacktestPlugin&&) = delete;

    [[nodiscard]] std::string_view name() const noexcept override {
        return "cpp_backtest";
    }

    [[nodiscard]] std::string_view version() const noexcept override {
        return "0.1.0";
    }

    [[nodiscard]] std::string_view description() const noexcept override {
        return "C++23 strategy backtesting via stratforge-runner";
    }

    ExecutionResult execute(
        const nlohmann::json& config,
        ProgressCallback progressCallback = nullptr,
        IncrementCallback incrementCallback = nullptr
    ) override;

    void cancel() noexcept override;

    [[nodiscard]] bool cancelled() const noexcept override {
        return cancelled_.load(std::memory_order_acquire);
    }

    [[nodiscard]] float progress() const noexcept override {
        return progress_.load(std::memory_order_acquire);
    }

    void setProgress(float value) noexcept {
        progress_.store(value, std::memory_order_release);
    }

private:
    std::atomic<bool> cancelled_{false};
    std::atomic<float> progress_{0.0f};
};

void registerCppBacktestPlugin();

struct CppStrategyValidationResult {
    bool valid = true;
    std::vector<std::string> errors;
};

[[nodiscard]] CppStrategyValidationResult validateCppStrategySource(std::string_view source);

[[nodiscard]] std::string cppStrategyArtifactCacheKey(
    std::string_view source,
    const std::vector<std::string>& includePaths,
    std::string_view pchPath
);

struct CppRunnerHardeningOptions {
    bool enableSandbox = true;
    int cpuTimeSeconds = 120;
    int memoryLimitMb = 1024;
};

[[nodiscard]] std::string hardenCppRunnerCommand(
    std::string_view runnerCommand,
    const CppRunnerHardeningOptions& options
);

} // namespace StratCraft::executor
