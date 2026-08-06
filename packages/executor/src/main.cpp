/**
 * Open StratCraft execution foundation entry point.
 *
 * TICKET_1304_5B: commercial research kernels are intentionally absent.
 */

#include "quantnexus/executor/code_version/code_version_json.hpp"
#include "quantnexus/executor/cpp_backtest_plugin.hpp"
#include "quantnexus/executor/data_plane/eval_parquet.hpp"
#include "quantnexus/executor/data_plane/eval_parquet_dispatch.hpp"
#include "quantnexus/executor/data_plane/ohlcv_constants.hpp"
#include "quantnexus/executor/data_plane/ohlcv_data_plane.hpp"
#include "quantnexus/executor/evaluation_contract.hpp"
#include "quantnexus/executor/planning_geometry/planning_geometry_json.hpp"
#include "quantnexus/executor/plugin_loader.hpp"
#include "quantnexus/executor/resource_governance/resource_governance_json.hpp"
#include "quantnexus/executor/scheduler/scheduler_json.hpp"
#include "quantnexus/executor/strategy_admission/strategy_admission_json.hpp"
#include "quantnexus/executor/live/live_engine_plugin.hpp"

#include <nlohmann/json.hpp>

#include <cmath>
#include <cstdint>
#include <filesystem>
#include <format>
#include <fstream>
#include <iostream>
#include <limits>
#include <string>
#include <string_view>
#include <type_traits>

namespace fs = std::filesystem;

namespace {

struct Args {
    std::string configPath;
    std::string outputDir;
    bool verbose = false;
    bool help = false;
    bool listPlugins = false;
    bool contractInfo = false;
    std::string validateEvaluationEnvelope;
    std::string evalParquetInput;
    std::string ohlcvDataPlaneInput;
    std::string strategyAdmissionInput;
    std::string planningGeometryInput;
    std::string resourceGovernanceInput;
    std::string schedulerInput;
    std::string codeVersionInput;
};

void printUsage(const char* programName) {
    std::cout
        << "StratCraft Executor - Open Strategy Execution Foundation\n\n"
        << "Usage:\n  " << programName
        << " --config=<path> [--output=<dir>] [--verbose]\n\n"
        << "Foundation commands:\n"
        << "  --list-plugins\n"
        << "  --contract-info\n"
        << "  --validate-evaluation-envelope=<path>\n"
        << "  --eval-parquet=<path>\n"
        << "  --ohlcv-data-plane=<path>\n"
        << "  --strategy-admission=<path>\n"
        << "  --planning-geometry=<path>\n"
        << "  --resource-governance=<path>\n"
        << "  --scheduler=<path>\n"
        << "  --code-version=<path>\n"
        << "  --help\n";
}

Args parseArgs(int argc, char* argv[]) {
    Args args;
    auto value = [](const std::string& arg, std::string_view prefix) {
        return arg.substr(prefix.size());
    };
    for (int index = 1; index < argc; ++index) {
        const std::string arg = argv[index];
        if (arg.starts_with("--config=")) args.configPath = value(arg, "--config=");
        else if (arg.starts_with("--output=")) args.outputDir = value(arg, "--output=");
        else if (arg == "--verbose" || arg == "-v") args.verbose = true;
        else if (arg == "--help" || arg == "-h") args.help = true;
        else if (arg == "--list-plugins") args.listPlugins = true;
        else if (arg == "--contract-info") args.contractInfo = true;
        else if (arg.starts_with("--validate-evaluation-envelope=")) {
            args.validateEvaluationEnvelope =
                value(arg, "--validate-evaluation-envelope=");
        } else if (arg.starts_with("--eval-parquet=")) {
            args.evalParquetInput = value(arg, "--eval-parquet=");
        } else if (arg.starts_with("--ohlcv-data-plane=")) {
            args.ohlcvDataPlaneInput = value(arg, "--ohlcv-data-plane=");
        } else if (arg.starts_with("--strategy-admission=")) {
            args.strategyAdmissionInput = value(arg, "--strategy-admission=");
        } else if (arg.starts_with("--planning-geometry=")) {
            args.planningGeometryInput = value(arg, "--planning-geometry=");
        } else if (arg.starts_with("--resource-governance=")) {
            args.resourceGovernanceInput = value(arg, "--resource-governance=");
        } else if (arg.starts_with("--scheduler=")) {
            args.schedulerInput = value(arg, "--scheduler=");
        } else if (arg.starts_with("--code-version=")) {
            args.codeVersionInput = value(arg, "--code-version=");
        } else {
            throw std::runtime_error("unknown executor argument: " + arg);
        }
    }
    return args;
}

void progressCallback(double percent, const std::string& message) {
    std::cout << nlohmann::json{
        {"type", "progress"},
        {"percent", std::round(percent * 10.0) / 10.0},
        {"message", message},
    }.dump() << '\n';
    std::cout.flush();
}


void initializePlugins() {
    using namespace StratCraft::executor;
    registerCppBacktestPlugin();
    live::registerLiveEnginePlugin();
    const auto pluginDir = getDefaultPluginDirectory();
    if (fs::exists(pluginDir)) PluginLoader::instance().scanPlugins(pluginDir);
}

std::pair<nlohmann::json, std::string> loadConfigAndGetPluginName(
    const std::string& configPath) {
    std::ifstream file(configPath);
    if (!file.is_open()) {
        throw std::runtime_error(std::format("Failed to open config file: {}", configPath));
    }
    nlohmann::json config;
    file >> config;
    return {config, config.value("pluginName", "cpp_backtest")};
}

}  // namespace

int main(int argc, char* argv[]) {
    using namespace StratCraft::executor;

    Args args;
    try {
        args = parseArgs(argc, argv);
    } catch (const std::exception& error) {
        std::cerr << nlohmann::json{
            {"code", "QNX_EXECUTOR_ARGUMENT_INVALID"},
            {"message", error.what()},
            {"retryable", false},
        }.dump() << '\n';
        return 2;
    }

    if (args.help) {
        printUsage(argv[0]);
        return 0;
    }

    if (args.contractInfo) {
        std::cout << nlohmann::json{
            {"command_boundary", "StratCraft-executor"},
            {"envelope_schema_version",
             evaluation::kEnvelopeSchemaVersion},
            {"arrow_schema_version", evaluation::kArrowSchemaVersion},
            {"market_data_arrow_schema_version",
             evaluation::kMarketDataArrowSchemaVersion},
            {"ohlcv_data_plane_version",
             data_plane::ohlcv_constants::CONTRACT_VERSION},
            {"ohlcv_schema_version",
             data_plane::ohlcv_constants::SCHEMA_VERSION},
        }.dump() << '\n';
        return 0;
    }

    if (!args.evalParquetInput.empty()) {
        return StratCraft::executor::data_plane::dispatch_eval_parquet(
            args.evalParquetInput, std::cout, std::cerr);
    }

    if (!args.ohlcvDataPlaneInput.empty()) {
        namespace data_plane = StratCraft::executor::data_plane;
        namespace ohlcv_constants =
            StratCraft::executor::data_plane::ohlcv_constants;
        try {
            std::ifstream input(args.ohlcvDataPlaneInput);
            if (!input.is_open()) {
                throw data_plane::OhlcvDataPlaneError(
                    "QNX_OHLCV_INPUT_OPEN_FAILED",
                    "failed to open OHLCV data-plane request: " +
                        args.ohlcvDataPlaneInput,
                    true);
            }
            nlohmann::json document;
            input >> document;
            std::cout << data_plane::run_ohlcv_data_plane_command(document).dump()
                      << '\n';
            return 0;
        } catch (const data_plane::OhlcvDataPlaneError& error) {
            std::cerr << nlohmann::json{
                {"version", ohlcv_constants::CONTRACT_VERSION},
                {"status", error.code() == "QNX_OHLCV_CANCELLED"
                               ? "cancelled"
                               : "error"},
                {"error",
                 {{"code", error.code()},
                  {"message", error.what()},
                  {"retryable", error.is_retryable()}}},
            }.dump() << '\n';
            return error.code() == "QNX_OHLCV_CANCELLED"
                       ? ohlcv_constants::COMMAND_CANCELLED_EXIT_CODE
                       : ohlcv_constants::COMMAND_ERROR_EXIT_CODE;
        } catch (const std::exception& error) {
            std::cerr << nlohmann::json{
                {"version", ohlcv_constants::CONTRACT_VERSION},
                {"status", "error"},
                {"error",
                 {{"code", "QNX_OHLCV_CONTRACT_INVALID"},
                  {"message", error.what()},
                  {"retryable", false}}},
            }.dump() << '\n';
            return ohlcv_constants::COMMAND_ERROR_EXIT_CODE;
        }
    }

    if (!args.validateEvaluationEnvelope.empty()) {
        try {
            std::ifstream input(args.validateEvaluationEnvelope);
            if (!input.is_open()) {
                throw std::runtime_error(
                    "failed to open evaluation envelope: " +
                    args.validateEvaluationEnvelope);
            }
            nlohmann::json document;
            input >> document;
            const auto envelope = evaluation::parse_envelope(document);
            std::cout << evaluation::to_json(envelope).dump() << '\n';
            return 0;
        } catch (const std::exception& error) {
            std::cerr << nlohmann::json{
                {"code", "QNX_EVAL_CONTRACT_INVALID"},
                {"message", error.what()},
                {"retryable", false},
            }.dump() << '\n';
            return 2;
        }
    }

    if (!args.strategyAdmissionInput.empty()) {
        namespace admission = StratCraft::executor::strategy_admission;
        try {
            std::ifstream input(args.strategyAdmissionInput);
            if (!input.is_open()) {
                throw std::runtime_error(
                    "failed to open strategy-admission input: " +
                    args.strategyAdmissionInput);
            }
            nlohmann::json document;
            input >> document;
            const admission::AdmissionRequest request =
                admission::parse_request(document);
            const admission::AdmissionResult result = admission::admit(request);
            std::cout << admission::to_json(result).dump() << '\n';
            return 0;
        } catch (const std::exception& error) {
            std::cerr << nlohmann::json{
                {"code", "QNX_STRATEGY_ADMISSION_INPUT_INVALID"},
                {"message", error.what()},
                {"retryable", false},
            }.dump() << '\n';
            return 2;
        }
    }

    // TICKET_1292 Phase 5 5B (MC-11): pure planning-geometry authority.
    // Reads {"version":1, "kind":"required_pull_bars|embargo|plan|check_refusal|
    // deficit_allocation", ...} and emits the versioned plan. Owns the CV
    // sizing math that cv-sizing-contract.ts now delegates here (TICKET_849
    // single source of truth, now rooted in C++), the embargo derivation that
    // removes the resolve_embargo.py subprocess, bar sufficiency, snapshot-
    // window projection, and the deterministic deficit-allocation core. Same
    // packaged-command boundary: JSON in/out, exit 0 on success, actionable
    // JSON error + exit 2 on a malformed request. No new process or protocol.
    if (!args.planningGeometryInput.empty()) {
        namespace pg = StratCraft::executor::planning_geometry;
        try {
            std::ifstream input(args.planningGeometryInput);
            if (!input.is_open()) {
                throw std::runtime_error(
                    "failed to open planning-geometry input: " +
                    args.planningGeometryInput);
            }
            nlohmann::json document;
            input >> document;
            std::cout << pg::run_planning_geometry(document).dump() << '\n';
            return 0;
        } catch (const std::exception& error) {
            std::cerr << nlohmann::json{
                {"code", "QNX_PLANNING_GEOMETRY_INPUT_INVALID"},
                {"message", error.what()},
                {"retryable", false},
            }.dump() << '\n';
            return 2;
        }
    }

    // TICKET_1292_10 Phase 6 (MC-10): C++23 resource-governance authority. The
    // single owner of the swap-pressure classifier (pipeline-resource-profile.ts),
    // the admission hysteresis state machine (resource_gate.py), the per-cell RSS
    // budget + closed-loop degradation ladder (resource_watchdog.py /
    // training_memory.py RssSentinel), and the cgroup cap->limit derivation
    // (cgroup-fence.sh). Consumers keep sampling (/proc reads) + enforcement (pause
    // at a safe epoch/cell boundary, apply systemd properties) and delegate the
    // DECISION here. JSON in/out on the same packaged-command boundary; exit 0 on
    // success, structured JSON error + exit 2 on a malformed request.
    if (!args.resourceGovernanceInput.empty()) {
        namespace rg = StratCraft::executor::resource_governance;
        try {
            std::ifstream input(args.resourceGovernanceInput);
            if (!input.is_open()) {
                throw std::runtime_error(
                    "failed to open resource-governance input: " +
                    args.resourceGovernanceInput);
            }
            nlohmann::json document;
            input >> document;
            std::cout << rg::run_resource_governance(document).dump() << '\n';
            return 0;
        } catch (const std::exception& error) {
            std::cerr << nlohmann::json{
                {"code", "QNX_RESOURCE_GOVERNANCE_INPUT_INVALID"},
                {"message", error.what()},
                {"retryable", false},
            }.dump() << '\n';
            return 2;
        }
    }

    // TICKET_1292_12 Phase 6 (MC-12): C++23 sweep-scheduler authority. The single
    // owner of the sweep scheduler's control-plane DECISIONS -- arm admission
    // (worker-pool cursor over the MC-10-resolved concurrency), ASHA successive-
    // halving (rung0 -> barrier rank -> rung1), per-arm retry / kill
    // classification, and the TICKET_1289 resume / arm-skip fingerprint gate.
    // This replaces the TS worker pools in discovery-orchestrator.ts + the
    // parallel Python scheduler in packages/sweep-runner/runner.py + fit_one.py's
    // _classify_error, all diverging against executor-side constants. The DRIVER
    // (TS) keeps process IO -- spawn, heartbeat / PER_ARM_EXECUTOR_TIMEOUT_MS
    // liveness, SIGTERM/SIGKILL -- and feeds the ordered outcome stream back; the
    // scheduler returns the next dispatch/barrier/retry directives. JSON in/out.
    if (!args.schedulerInput.empty()) {
        namespace sch = StratCraft::executor::scheduler;
        try {
            std::ifstream input(args.schedulerInput);
            if (!input.is_open()) {
                throw std::runtime_error(
                    "failed to open scheduler input: " + args.schedulerInput);
            }
            nlohmann::json document;
            input >> document;
            std::cout << sch::run_scheduler(document).dump() << '\n';
            return 0;
        } catch (const std::exception& error) {
            std::cerr << nlohmann::json{
                {"code", "QNX_SCHEDULER_INPUT_INVALID"},
                {"message", error.what()},
                {"retryable", false},
            }.dump() << '\n';
            return 2;
        }
    }

    // TICKET_1292_15 Phase 5 5C (MC-15): C++23 code-version authority. The last
    // deterministic Python helper subprocess on the sweep-dispatch launch path.
    // Computes the Tool Sweep cache-key code_version (TICKET_815) -- a per-
    // template first-party source-file closure (static Python-import scan) plus
    // SHA-256 aggregation over the closure and the runtime lockfile. Replaces the
    // `python -m nona_algorithm.signal_sources.code_version` subprocess that
    // code-version-cache.ts spawned; value-identical to the Python authority by
    // code_version_parity_v1.json. JSON in/out on the same packaged-command
    // boundary; exit 0 on success, structured JSON error + exit 2 on failure.
    if (!args.codeVersionInput.empty()) {
        namespace cv = StratCraft::executor::code_version;
        try {
            std::ifstream input(args.codeVersionInput);
            if (!input.is_open()) {
                throw std::runtime_error(
                    "failed to open code-version input: " + args.codeVersionInput);
            }
            nlohmann::json document;
            input >> document;
            std::cout << cv::run_code_version(document).dump() << '\n';
            return 0;
        } catch (const std::exception& error) {
            std::cerr << nlohmann::json{
                {"code", "QNX_CODE_VERSION_INPUT_INVALID"},
                {"message", error.what()},
                {"retryable", false},
            }.dump() << '\n';
            return 2;
        }
    }

    // Initialize plugin system
    initializePlugins();

    if (args.listPlugins) {
        std::cout << "Available plugins:\n";
        for (const auto& name : PluginLoader::instance().listPlugins()) {
            std::cout << "  - " << name << "\n";
        }
        return 0;
    }

    if (args.configPath.empty()) {
        std::cerr << "Error: --config is required\n\n";
        printUsage(argv[0]);
        return 1;
    }

    if (args.verbose) {
        std::cout << "StratCraft Executor Starting...\n";
        std::cout << "  Config: " << args.configPath << "\n";
        if (!args.outputDir.empty()) {
            std::cout << "  Output: " << args.outputDir << "\n";
        }
        std::cout << "\n";
    }

    try {
        // Load config and determine plugin
        auto [config, pluginName] = loadConfigAndGetPluginName(args.configPath);

        if (args.verbose) {
            std::cout << "  Plugin: " << pluginName << "\n\n";
        }

        // Override output dir if specified
        if (!args.outputDir.empty()) {
            config["outputDir"] = args.outputDir;
            config["output_dir"] = args.outputDir;
        }

        // Get plugin
        auto& loader = PluginLoader::instance();
        IExecutorPlugin* plugin = loader.loadPlugin(pluginName);

        if (!plugin) {
            std::cerr << "Error: Plugin not found: " << pluginName << "\n";
            std::cerr << "Available plugins:\n";
            for (const auto& name : loader.listPlugins()) {
                std::cerr << "  - " << name << "\n";
            }
            return 1;
        }

        // Execute via plugin interface
        auto result = plugin->execute(config, progressCallback);

        if (result.success) {
            if (args.verbose) {
                std::cout << "\n=== Execution Complete ===\n";

                // Extract metrics from result data
                if (result.data.contains("metrics")) {
                    auto& metrics = result.data["metrics"];
                    std::cout << std::format("  Total PnL:     ${:.2f}\n",
                        metrics.value("totalPnl", 0.0));
                    std::cout << std::format("  Total Return:  {:.2f}%\n",
                        metrics.value("totalReturn", 0.0));
                    std::cout << std::format("  Sharpe Ratio:  {:.2f}\n",
                        metrics.value("sharpeRatio", 0.0));
                    std::cout << std::format("  Max Drawdown:  {:.2f}%\n",
                        metrics.value("maxDrawdown", 0.0));
                    std::cout << std::format("  Total Trades:  {}\n",
                        metrics.value("totalTrades", 0));
                    std::cout << std::format("  Win Rate:      {:.2f}%\n",
                        metrics.value("winRate", 0.0));
                }

                if (result.data.contains("executionTimeMs")) {
                    std::cout << std::format("  Execution Time: {} ms\n",
                        result.data.value("executionTimeMs", 0));
                }
            }
            return 0;
        } else {
            std::cerr << "Execution failed: " << result.errorMessage << "\n";
            return 1;
        }

    } catch (const std::exception& e) {
        std::cerr << "Fatal error: " << e.what() << "\n";
        return 1;
    }
}
