/**
 * Live Engine Plugin
 *
 * TICKET_613: Actor Model live execution engine.
 * TICKET_613_1: Route B - C++ LiveEngine calls compiled strategy directly.
 * TICKET_681: Removed pybind11/Python path (C++ only).
 *
 * Implements IExecutorPlugin for live trading with stdin/stdout JSON protocol.
 * Reads bar events from stdin, processes through compiled C++ strategy .so,
 * emits signals via stdout.
 */

#pragma once

#include "../plugin_interface.hpp"
#include "event_types.hpp"

#include <nlohmann/json.hpp>
#include <atomic>
#include <iostream>
#include <istream>
#include <string>
#include <vector>

namespace StratCraft::executor::live {

struct LiveEngineTestSeam;

class LiveEnginePlugin : public IExecutorPlugin {
public:
    LiveEnginePlugin() = default;
    ~LiveEnginePlugin() override { unloadCppStrategy(); }

    // Non-copyable, non-movable
    LiveEnginePlugin(const LiveEnginePlugin&) = delete;
    LiveEnginePlugin& operator=(const LiveEnginePlugin&) = delete;
    LiveEnginePlugin(LiveEnginePlugin&&) = delete;
    LiveEnginePlugin& operator=(LiveEnginePlugin&&) = delete;

    // =========================================================================
    // IExecutorPlugin Implementation
    // =========================================================================

    [[nodiscard]] std::string_view name() const noexcept override {
        return "live";
    }

    [[nodiscard]] std::string_view version() const noexcept override {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view description() const noexcept override {
        return "C++ live execution engine (Route B direct)";
    }

    ExecutionResult execute(
        const nlohmann::json& config,
        ProgressCallback progressCallback = nullptr,
        IncrementCallback incrementCallback = nullptr
    ) override;

    void cancel() noexcept override {
        cancelled_.store(true, std::memory_order_release);
    }

    [[nodiscard]] bool cancelled() const noexcept override {
        return cancelled_.load(std::memory_order_acquire);
    }

    [[nodiscard]] float progress() const noexcept override {
        return progress_.load(std::memory_order_acquire);
    }

private:
    // Initialize C++ live strategy shared library from strategy source.
    void initializeCppStrategy(const nlohmann::json& config);

    // Release currently loaded C++ live strategy library.
    void unloadCppStrategy() noexcept;

    // Event loop: read input stream -> parse -> onCppBar / onCppAltData -> emit stdout.
    // The `in` parameter is injectable to allow unit tests to drive the dispatch
    // logic without spawning a subprocess; production callers pass std::cin.
    void eventLoop(std::istream& in = std::cin);

    // Process a single bar through the C++ live ABI.
    void onCppBar(const BarEvent& bar);

    // TICKET_196_7_7 P2.1: forward an alt-data JSON row to the strategy via the
    // optional v2-ABI symbol `qnx_live_strategy_on_alt_data`. The row JSON is
    // exactly the body of an `alt_data` stdin message (see eventLoop()).
    void onCppAltData(const nlohmann::json& row);

    // Emit signal JSON to stdout
    void emitSignal(int direction, const BarEvent& bar);

    // Emit position update to stdout after order fill
    void emitPositionUpdate(const OrderFilledEvent& order);

    std::vector<BarEvent> bars_;               // Accumulated bar history
    std::vector<OrderFilledEvent> fills_;       // Accumulated fill history
    int prev_signal_ = 0;             // Signal change detection
    void* cpp_library_ = nullptr;
    using CppAbiVersionFn = int (*)();
    using CppOnBarFn = const char* (*)(const char*);
    using CppOnAltDataFn = const char* (*)(const char*);
    using CppResetFn = void (*)();
    CppAbiVersionFn cpp_abi_version_ = nullptr;
    CppOnBarFn cpp_on_bar_ = nullptr;
    CppOnAltDataFn cpp_on_alt_data_ = nullptr;  // TICKET_196_7_7 P2.1: optional v2 entry
    CppResetFn cpp_reset_ = nullptr;
    std::string cpp_strategy_path_;
    std::string symbol_;               // Trading symbol for context
    std::string interval_;             // Bar interval for context
    std::atomic<bool> cancelled_{false};
    std::atomic<float> progress_{0.0f};
    uint32_t bar_count_ = 0;

    friend struct LiveEngineTestSeam;
};

// =============================================================================
// Plugin Registration
// =============================================================================

/**
 * Register LiveEnginePlugin as built-in plugin
 */
void registerLiveEnginePlugin();

} // namespace StratCraft::executor::live
