// C++23 and Clang Strategy Admission -- deterministic admission authority
// (TICKET_1292 Phase 5 5A, MC-09).
//
// C++23 owner for strategy-code ADMISSION: the compiler/ABI gate that decides
// whether a generated C++ strategy source is admissible. Supersedes the Python
// AST-era admission verdict that `strategy-code-integrity.ts` launched via
// `cpp_strategy_code_integrity.py` (the `CV*` structural-error branch that
// `algorithm-post-insert-pipeline.ts` treated as the blocking
// `CODE_INTEGRITY_FAILED` gate).
//
// SCOPE (why this is exactly MC-09 and not more): the Python owner intermixed
// two concerns -- (1) admission/validation (prohibited constructs + `CV*`
// structural validation + the ABI v2 factory-export gate) and (2) LLM-output
// auto-repair rewriting bound to the SDK indicator registry (CN/CC/CA/API
// rewriting). Clang cannot rename a hallucinated indicator or synthesize a
// missing pure-virtual body; concern (2) is Builder generation-repair, not
// compiler admission, and is retained as a documented Builder adapter. This
// owner takes concern (1) and REPLACES the heuristics with the real compiler:
// prohibited-construct detection, structural validation, actionable Clang
// syntax/warning diagnostics with source locations, and ABI v2 factory-export
// inspection of a compiled `.so`.
//
// The `ruleId` field preserves the Python identifiers (CR1-CR8 prohibited,
// CV1/CV2/CV3/CV6/CV7 structural) so downstream telemetry and parity tests are
// byte-comparable; Clang-native diagnostics carry `clang:<...>` ids.
//
// Same packaged-command boundary as every Phase-1 owner: JSON request in,
// versioned JSON diagnostics out, exit 0 on success (admission ran; verdict may
// be pass or fail), actionable JSON error + exit 2 on a malformed request. No
// new process or protocol -- the resolved `clang++` (from compiler-resolver.ts,
// TICKET_177) is driven as a short-lived subprocess exactly as
// `algorithm-compilation-service.ts` already drives it.

#pragma once

#include <atomic>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace StratCraft::executor::strategy_admission {

// Frozen contract version emitted in every result and required in every request.
inline constexpr int kDiagnosticVersion = 1;

// ABI v2 exported C symbols (qnx_strategy_sdk.hpp QNX_STRATEGY_FACTORY_EXPORT).
inline constexpr std::string_view kAbiSymbolVersion = "qnx_strategy_abi_version";
inline constexpr std::string_view kAbiSymbolCreate = "stratforge_create_strategy";
inline constexpr std::string_view kAbiSymbolDestroy = "stratforge_destroy_strategy";
inline constexpr int kExpectedAbiVersion = 2;

enum class Severity { Note, Warning, Error, Fatal };

[[nodiscard]] std::string_view to_string(Severity severity) noexcept;

enum class DiagnosticSource { Prohibited, Structural, Clang, Abi };

[[nodiscard]] std::string_view to_string(DiagnosticSource source) noexcept;

struct Diagnostic {
    Severity severity{Severity::Error};
    std::string rule_id;
    std::string message;
    // 1-based; nullopt when the diagnostic is not line/column anchored.
    std::optional<int> line;
    std::optional<int> column;
    DiagnosticSource source{DiagnosticSource::Structural};
};

struct AbiReport {
    bool factory_export_present{false};
    std::optional<int> abi_version;  // qnx_strategy_abi_version() return, when compiled
    std::vector<std::string> symbols;
};

struct AdmissionResult {
    int diagnostic_version{kDiagnosticVersion};
    bool admitted{true};            // false iff any Fatal/Error diagnostic present
    bool compiler_available{true};  // false iff a compile stage was requested but the
                                    //   compiler path was empty / not executable
    AbiReport abi;
    std::vector<Diagnostic> diagnostics;
};

// Which stages to run. All default true; compile stages are silently skipped
// (and `compiler_available` set false) when `compiler_path` is empty.
struct AdmissionChecks {
    bool prohibited_constructs{true};
    bool structural{true};
    bool syntax{true};
    bool warnings{true};
    bool abi_export{true};
};

struct AdmissionRequest {
    std::string code;
    std::string signal_source;   // carried for context only
    std::string compiler_path;   // resolved clang++ (compiler-resolver.ts)
    std::vector<std::string> include_paths;
    AdmissionChecks checks;
};

// Pure, in-process source-only analysis: prohibited-construct scan + structural
// validation. Deterministic and compiler-free -- this is the byte-comparable
// parity surface against the Python `CR*`/`CV*` rules. Appends to `out`.
void analyze_source(std::string_view code, std::vector<Diagnostic>& out);

// Full admission. Runs source analysis, then (when `compiler_path` is set and
// the corresponding checks are enabled) drives the resolved clang++ for syntax
// + warning diagnostics and compiles a temp `.so` to inspect the ABI v2 factory
// export. `cancelled`, when non-null and observed true, aborts before/at each
// compile stage and any in-flight compiler subprocess is terminated.
[[nodiscard]] AdmissionResult admit(
    const AdmissionRequest& request,
    const std::atomic<bool>* cancelled = nullptr);

}  // namespace StratCraft::executor::strategy_admission
