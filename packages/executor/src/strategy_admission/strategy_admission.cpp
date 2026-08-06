// TICKET_1292 Phase 5 5A (MC-09): C++23/Clang strategy-admission owner impl.
//
// See strategy_admission.hpp for the frozen contract and scope rationale.

#include "quantnexus/executor/strategy_admission/strategy_admission.hpp"

#include <array>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <random>
#include <regex>
#include <sstream>
#include <string>
#include <string_view>
#include <system_error>
#include <vector>

#if defined(_WIN32)
#include <windows.h>
#else
#include <dlfcn.h>
#include <sys/wait.h>
#include <unistd.h>
#include <spawn.h>
#include <csignal>
extern char** environ;
#endif

namespace StratCraft::executor::strategy_admission {

namespace fs = std::filesystem;

std::string_view to_string(Severity severity) noexcept {
    switch (severity) {
        case Severity::Note: return "note";
        case Severity::Warning: return "warning";
        case Severity::Error: return "error";
        case Severity::Fatal: return "fatal";
    }
    return "error";
}

std::string_view to_string(DiagnosticSource source) noexcept {
    switch (source) {
        case DiagnosticSource::Prohibited: return "prohibited";
        case DiagnosticSource::Structural: return "structural";
        case DiagnosticSource::Clang: return "clang";
        case DiagnosticSource::Abi: return "abi";
    }
    return "structural";
}

// ===========================================================================
// Source-only analysis (compiler-free, deterministic parity surface)
// ===========================================================================

namespace {

// A prohibited-include set + call/class patterns ported from the Python owner
// (DANGEROUS_INCLUDES / DANGEROUS_CALLS / FILE_IO_*). These become `warning`
// diagnostics (source=prohibited): in the retained Python path the same
// constructs are auto-stripped as `fixes[]`, never blocking `errors[]`, so
// blocking parity is preserved by keeping them non-fatal here while still
// surfacing them to the UI (TICKET_858).
constexpr std::array<std::string_view, 9> kDangerousIncludes = {
    "cstdlib", "unistd.h", "sys/socket.h", "netinet/in.h", "dlfcn.h",
    "sys/types.h", "sys/wait.h", "signal.h", "spawn.h",
};
constexpr std::array<std::string_view, 3> kFileIoIncludes = {
    "fstream", "ofstream", "ifstream",
};

std::string strip(std::string_view line) {
    std::size_t begin = 0;
    std::size_t end = line.size();
    while (begin < end && std::isspace(static_cast<unsigned char>(line[begin]))) ++begin;
    while (end > begin && std::isspace(static_cast<unsigned char>(line[end - 1]))) --end;
    return std::string{line.substr(begin, end - begin)};
}

std::vector<std::string> split_lines(std::string_view code) {
    std::vector<std::string> lines;
    std::string current;
    for (char c : code) {
        if (c == '\n') {
            lines.push_back(current);
            current.clear();
        } else if (c != '\r') {
            current.push_back(c);
        }
    }
    lines.push_back(current);
    return lines;
}

// Regex helpers (thread-safe: constructed once).
const std::regex kIncludeRe(R"(^#include\s*[<"]([^>"]+)[>"])");
const std::regex kDangerousCallRe(
    R"(\b(system|execl|execlp|execle|execv|execvp|execvpe|fork|popen|pclose|dlopen|dlsym|dlclose)\s*\()");
const std::regex kFileIoCallRe(
    R"(\b(fopen|fwrite|fread|fclose|fprintf|fputs|fgets|freopen)\s*\()");
const std::regex kFileIoClassRe(
    R"(\bstd::(fstream|ofstream|ifstream|basic_fstream|basic_ofstream|basic_ifstream)\b)");
const std::regex kGotoRe(R"(\bgoto\s+\w+\s*;)");
const std::regex kUsingNamespaceStdRe(R"(^using\s+namespace\s+std\s*;)");
// CV1: class Name (final)? : (public|private|protected) Base[, ...] {
const std::regex kClassInheritRe(
    R"(class\s+(\w+)\s*(?:final\s*)?:\s*(?:public|private|protected)\s+([\w:]+(?:\s*,\s*(?:public|private|protected)\s+[\w:]+)*)\s*\{)");
const std::regex kBaseSplitRe(R"(\s*,\s*(?:public|private|protected)\s+)");
const std::regex kNextMethodRe(R"(void\s+next\s*\([^)]*\)\s*(?:override\s*)?\{)");
const std::regex kMainRe(R"(\bint\s+main\s*\()");

bool in_set(const std::array<std::string_view, 9>& set, std::string_view v) {
    for (auto s : set) if (s == v) return true;
    return false;
}
bool in_set(const std::array<std::string_view, 3>& set, std::string_view v) {
    for (auto s : set) if (s == v) return true;
    return false;
}

}  // namespace

void analyze_source(std::string_view code, std::vector<Diagnostic>& out) {
    const std::vector<std::string> lines = split_lines(code);

    // --- Prohibited-construct scan (CR1-CR5), per line, non-fatal warnings. ---
    for (std::size_t idx = 0; idx < lines.size(); ++idx) {
        const int line_no = static_cast<int>(idx + 1);
        const std::string stripped = strip(lines[idx]);

        std::smatch m;
        if (std::regex_search(stripped, m, kIncludeRe)) {
            const std::string inc = m[1].str();
            if (in_set(kDangerousIncludes, inc)) {
                out.push_back({Severity::Warning, "CR1",
                    "Dangerous include: " + inc, line_no, std::nullopt,
                    DiagnosticSource::Prohibited});
            } else if (in_set(kFileIoIncludes, inc)) {
                out.push_back({Severity::Warning, "CR3",
                    "File I/O include: " + inc, line_no, std::nullopt,
                    DiagnosticSource::Prohibited});
            }
        }
        // CR2: standalone dangerous call (not inside an if/while condition).
        if (std::regex_search(stripped, kDangerousCallRe)
            && !stripped.starts_with("if") && !stripped.starts_with("while")) {
            out.push_back({Severity::Warning, "CR2",
                "Dangerous call: " + stripped.substr(0, 60), line_no,
                std::nullopt, DiagnosticSource::Prohibited});
        }
        if (std::regex_search(stripped, kFileIoCallRe)) {
            out.push_back({Severity::Warning, "CR3",
                "File I/O call: " + stripped.substr(0, 60), line_no,
                std::nullopt, DiagnosticSource::Prohibited});
        }
        if (std::regex_search(stripped, kFileIoClassRe)) {
            out.push_back({Severity::Warning, "CR3",
                "File I/O usage: " + stripped.substr(0, 60), line_no,
                std::nullopt, DiagnosticSource::Prohibited});
        }
        if (std::regex_search(stripped, kGotoRe)) {
            out.push_back({Severity::Warning, "CR4",
                "goto statement", line_no, std::nullopt,
                DiagnosticSource::Prohibited});
        }
        if (std::regex_search(stripped, kUsingNamespaceStdRe)) {
            out.push_back({Severity::Warning, "CR5",
                "using namespace std;", line_no, std::nullopt,
                DiagnosticSource::Prohibited});
        }
    }

    // --- Structural validation (CV1/CV3/CV6/CV7), the BLOCKING gate. ---
    const std::string code_text{code};

    // CV1: exactly one class inheriting a Strategy base. The Python owner
    // accepts stratforge::Strategy + specialized bases; the admission-blocking
    // property is "a strategy class exists and is unique", so we match any
    // inheritance whose base name ends in `Strategy` (generic + specialized),
    // which is exactly the SDK contract.
    std::vector<std::string> strategy_classes;
    for (auto it = std::sregex_iterator(code_text.begin(), code_text.end(), kClassInheritRe);
         it != std::sregex_iterator(); ++it) {
        const std::string cls = (*it)[1].str();
        const std::string bases = (*it)[2].str();
        const std::vector<std::string> base_list(
            std::sregex_token_iterator(bases.begin(), bases.end(), kBaseSplitRe, -1),
            std::sregex_token_iterator());
        bool is_strategy = false;
        std::size_t base_count = 0;
        for (const std::string& raw : base_list) {
            const std::string b = strip(raw);
            if (b.empty()) continue;
            ++base_count;
            std::string bare = b;
            const std::string prefix = "stratforge::";
            if (bare.starts_with(prefix)) bare = bare.substr(prefix.size());
            if (bare == "Strategy" || (bare.size() > 8 && bare.ends_with("Strategy"))) {
                is_strategy = true;
            }
        }
        if (is_strategy) {
            strategy_classes.push_back(cls);
            // CV7: no multiple inheritance for the strategy class.
            if (base_count > 1) {
                out.push_back({Severity::Error, "CV7",
                    "Multiple inheritance detected in class " + cls + ": " + bases,
                    std::nullopt, std::nullopt, DiagnosticSource::Structural});
            }
        }
    }
    if (strategy_classes.empty()) {
        out.push_back({Severity::Error, "CV1",
            "No class inheriting from stratforge::Strategy found",
            std::nullopt, std::nullopt, DiagnosticSource::Structural});
    } else if (strategy_classes.size() > 1) {
        std::string joined;
        for (std::size_t i = 0; i < strategy_classes.size(); ++i) {
            if (i) joined += ", ";
            joined += strategy_classes[i];
        }
        out.push_back({Severity::Error, "CV1",
            "Multiple strategy classes found: " + joined,
            std::nullopt, std::nullopt, DiagnosticSource::Structural});
    }

    // CV2: next() present (a strategy must implement the bar hook). The Python
    // owner skips this for specialized bases (next() is final there); admission
    // still requires SOME next()/check_* hook. We emit CV2 only when no next()
    // AND the sole/first strategy class is the generic stratforge::Strategy, to
    // avoid false-positives on specialized bases whose hook is check_*().
    if (!strategy_classes.empty() && !std::regex_search(code_text, kNextMethodRe)) {
        // Specialized base => hook name differs; only block the generic base.
        const bool generic_base =
            code_text.find(": public stratforge::Strategy") != std::string::npos
            || code_text.find(":public stratforge::Strategy") != std::string::npos
            || code_text.find(": public Strategy") != std::string::npos;
        if (generic_base) {
            out.push_back({Severity::Error, "CV2",
                "next() method not found", std::nullopt, std::nullopt,
                DiagnosticSource::Structural});
        }
    }

    // CV3: no main().
    if (std::regex_search(code_text, kMainRe)) {
        out.push_back({Severity::Error, "CV3",
            "main() function found (strategy code should not contain main())",
            std::nullopt, std::nullopt, DiagnosticSource::Structural});
    }

    // CV6: balanced braces / parentheses.
    long brace = 0, paren = 0;
    for (char c : code) {
        if (c == '{') ++brace;
        else if (c == '}') --brace;
        else if (c == '(') ++paren;
        else if (c == ')') --paren;
    }
    if (brace != 0) {
        out.push_back({Severity::Error, "CV6",
            "Unbalanced braces (difference: " + std::to_string(brace) + ")",
            std::nullopt, std::nullopt, DiagnosticSource::Structural});
    }
    if (paren != 0) {
        out.push_back({Severity::Error, "CV6",
            "Unbalanced parentheses (difference: " + std::to_string(paren) + ")",
            std::nullopt, std::nullopt, DiagnosticSource::Structural});
    }
}

// ===========================================================================
// Compiler-driven stages (Clang driver subprocess + dlopen ABI inspect)
// ===========================================================================

namespace {

bool is_executable(const std::string& path) {
    std::error_code ec;
    if (path.empty()) return false;
    return fs::exists(path, ec) && !ec;
}

struct SubprocessResult {
    bool ran{false};       // false => spawn/exec failed
    bool cancelled{false};
    int exit_code{-1};
    std::string merged_output;  // stdout+stderr merged
};

std::string unique_temp_stem() {
    static std::atomic<unsigned long long> counter{0};
    std::random_device rd;
    std::ostringstream oss;
    oss << "qnx-admit-" << ::getpid() << '-'
        << rd() << '-' << counter.fetch_add(1);
    return (fs::temp_directory_path() / oss.str()).string();
}

#if !defined(_WIN32)
// Spawn `argv`, capturing merged stdout/stderr, honoring a cancellation flag by
// SIGTERM->SIGKILL on the child. Returns the process result.
SubprocessResult run_compiler(
    const std::vector<std::string>& argv,
    const std::atomic<bool>* cancelled) {
    SubprocessResult result;

    int pipefd[2];
    if (::pipe(pipefd) != 0) return result;

    std::vector<char*> cargv;
    cargv.reserve(argv.size() + 1);
    for (const std::string& a : argv) cargv.push_back(const_cast<char*>(a.c_str()));
    cargv.push_back(nullptr);

    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_adddup2(&actions, pipefd[1], STDOUT_FILENO);
    posix_spawn_file_actions_adddup2(&actions, pipefd[1], STDERR_FILENO);
    posix_spawn_file_actions_addclose(&actions, pipefd[0]);
    posix_spawn_file_actions_addclose(&actions, pipefd[1]);

    pid_t pid = 0;
    const int spawn_rc = posix_spawnp(
        &pid, cargv[0], &actions, nullptr, cargv.data(), environ);
    posix_spawn_file_actions_destroy(&actions);
    ::close(pipefd[1]);
    if (spawn_rc != 0) {
        ::close(pipefd[0]);
        return result;
    }
    result.ran = true;

    // Non-blocking-ish drain with periodic cancellation checks.
    std::string output;
    std::array<char, 4096> buf{};
    bool killed = false;
    for (;;) {
        if (cancelled != nullptr && cancelled->load()
            && !killed) {
            ::kill(pid, SIGTERM);
            killed = true;
            result.cancelled = true;
        }
        const ssize_t n = ::read(pipefd[0], buf.data(), buf.size());
        if (n > 0) {
            output.append(buf.data(), static_cast<std::size_t>(n));
        } else if (n == 0) {
            break;  // EOF: child closed its end
        } else {
            break;  // read error
        }
    }
    ::close(pipefd[0]);

    int status = 0;
    ::waitpid(pid, &status, 0);
    result.merged_output = std::move(output);
    if (WIFEXITED(status)) result.exit_code = WEXITSTATUS(status);
    else result.exit_code = -1;
    return result;
}
#else
SubprocessResult run_compiler(
    const std::vector<std::string>& argv,
    const std::atomic<bool>* /*cancelled*/) {
    // Windows admission uses the classic command line; cancellation degrades to
    // process completion (short-lived syntax-only invocation).
    SubprocessResult result;
    std::string cmd;
    for (const std::string& a : argv) { cmd += '"'; cmd += a; cmd += "\" "; }
    cmd += " 2>&1";
    FILE* pipe = _popen(cmd.c_str(), "r");
    if (!pipe) return result;
    result.ran = true;
    std::array<char, 4096> buf{};
    std::string output;
    while (std::fgets(buf.data(), static_cast<int>(buf.size()), pipe)) {
        output += buf.data();
    }
    result.exit_code = _pclose(pipe);
    result.merged_output = std::move(output);
    return result;
}
#endif

// Parse `file:line:col: severity: message` classic clang diagnostics (the same
// format apps/desktop/src/main/utils/compiler-error-parser.ts consumes).
void parse_clang_diagnostics(
    const std::string& raw,
    bool warnings_enabled,
    std::vector<Diagnostic>& out) {
    static const std::regex diag_re(
        R"(^.+?:(\d+):(\d+):\s+(fatal error|error|warning|note):\s+(.+)$)");
    std::istringstream stream(raw);
    std::string line;
    while (std::getline(stream, line)) {
        std::smatch m;
        if (!std::regex_search(line, m, diag_re)) continue;
        const std::string sev_text = m[3].str();
        Severity sev = Severity::Error;
        if (sev_text == "fatal error") sev = Severity::Fatal;
        else if (sev_text == "error") sev = Severity::Error;
        else if (sev_text == "warning") sev = Severity::Warning;
        else sev = Severity::Note;

        if (!warnings_enabled && (sev == Severity::Warning || sev == Severity::Note)) {
            continue;
        }
        Diagnostic d;
        d.severity = sev;
        d.rule_id = std::string("clang:") + sev_text;
        d.message = m[4].str();
        d.line = std::stoi(m[1].str());
        d.column = std::stoi(m[2].str());
        d.source = DiagnosticSource::Clang;
        out.push_back(std::move(d));
    }
}

}  // namespace

AdmissionResult admit(
    const AdmissionRequest& request,
    const std::atomic<bool>* cancelled) {
    AdmissionResult result;

    // Stage 1: compiler-free source analysis (always runs when enabled).
    if (request.checks.prohibited_constructs || request.checks.structural) {
        std::vector<Diagnostic> src;
        analyze_source(request.code, src);
        for (Diagnostic& d : src) {
            if (!request.checks.prohibited_constructs
                && d.source == DiagnosticSource::Prohibited) continue;
            if (!request.checks.structural
                && d.source == DiagnosticSource::Structural) continue;
            result.diagnostics.push_back(std::move(d));
        }
    }

    const bool wants_compile =
        request.checks.syntax || request.checks.warnings || request.checks.abi_export;

    if (wants_compile) {
        if (!is_executable(request.compiler_path)) {
            // FAIL FAST: a compile stage was requested but no compiler is
            // available. This is an actionable, UI-surfaced FATAL, not a silent
            // skip (TICKET_857 / TICKET_858).
            result.compiler_available = false;
            result.diagnostics.push_back({Severity::Fatal, "clang:missing-compiler",
                request.compiler_path.empty()
                    ? "No C++ compiler path provided for strategy admission"
                    : ("Resolved compiler is not executable: " + request.compiler_path),
                std::nullopt, std::nullopt, DiagnosticSource::Clang});
            result.admitted = false;
            return result;
        }
    }

    std::string source_path;
    std::string so_path;
    if (wants_compile) {
        if (cancelled != nullptr && cancelled->load()) {
            result.diagnostics.push_back({Severity::Fatal, "clang:cancelled",
                "strategy admission cancelled before compilation",
                std::nullopt, std::nullopt, DiagnosticSource::Clang});
            result.admitted = false;
            return result;
        }
        const std::string stem = unique_temp_stem();
        source_path = stem + ".cpp";
        so_path = stem + ".so";
        std::ofstream out_file(source_path, std::ios::binary);
        out_file << request.code;
        out_file.close();
    }

    // Stage 2: Clang syntax + warning diagnostics (-fsyntax-only, fast).
    if (request.checks.syntax || request.checks.warnings) {
        std::vector<std::string> argv = {
            request.compiler_path, "-std=c++23", "-fsyntax-only",
            "-fno-caret-diagnostics", "-fno-color-diagnostics", "-ferror-limit=0",
        };
        if (request.checks.warnings) argv.push_back("-Wall");
        for (const std::string& inc : request.include_paths) {
            argv.push_back("-I");
            argv.push_back(inc);
        }
        argv.push_back(source_path);
        const SubprocessResult proc = run_compiler(argv, cancelled);
        if (proc.cancelled) {
            result.diagnostics.push_back({Severity::Fatal, "clang:cancelled",
                "strategy admission cancelled during syntax check",
                std::nullopt, std::nullopt, DiagnosticSource::Clang});
            std::error_code ec;
            fs::remove(source_path, ec);
            result.admitted = false;
            return result;
        }
        if (!proc.ran) {
            result.compiler_available = false;
            result.diagnostics.push_back({Severity::Fatal, "clang:missing-compiler",
                "Failed to launch compiler: " + request.compiler_path,
                std::nullopt, std::nullopt, DiagnosticSource::Clang});
            std::error_code ec;
            fs::remove(source_path, ec);
            result.admitted = false;
            return result;
        }
        parse_clang_diagnostics(proc.merged_output, request.checks.warnings,
                                result.diagnostics);
    }

    // Stage 3: compile to a temp .so and inspect the ABI v2 factory export.
    if (request.checks.abi_export) {
        // ABI export presence in source (macro or the three raw symbols).
        const bool macro_present =
            request.code.find("QNX_STRATEGY_FACTORY_EXPORT") != std::string::npos;
        const bool raw_present =
            request.code.find(kAbiSymbolCreate) != std::string::npos
            && request.code.find(kAbiSymbolDestroy) != std::string::npos;

        bool compiled = false;
        if ((macro_present || raw_present)
            && (cancelled == nullptr || !cancelled->load())) {
            std::vector<std::string> argv = {
                request.compiler_path, "-std=c++23", "-shared",
#if !defined(_WIN32)
                "-fPIC",
#endif
                "-fno-caret-diagnostics", "-fno-color-diagnostics",
            };
            for (const std::string& inc : request.include_paths) {
                argv.push_back("-I");
                argv.push_back(inc);
            }
            argv.push_back(source_path);
            argv.push_back("-o");
            argv.push_back(so_path);
            const SubprocessResult proc = run_compiler(argv, cancelled);
            if (proc.cancelled) {
                result.diagnostics.push_back({Severity::Fatal, "clang:cancelled",
                    "strategy admission cancelled during ABI compilation",
                    std::nullopt, std::nullopt, DiagnosticSource::Clang});
                std::error_code ec;
                fs::remove(source_path, ec);
                fs::remove(so_path, ec);
                result.admitted = false;
                return result;
            }
            compiled = proc.ran && proc.exit_code == 0
                       && fs::exists(so_path);
        }

#if !defined(_WIN32)
        if (compiled) {
            void* handle = ::dlopen(so_path.c_str(), RTLD_NOW | RTLD_LOCAL);
            if (handle != nullptr) {
                const std::array<std::string_view, 3> wanted = {
                    kAbiSymbolVersion, kAbiSymbolCreate, kAbiSymbolDestroy,
                };
                bool all_present = true;
                for (std::string_view sym : wanted) {
                    void* addr = ::dlsym(handle, std::string{sym}.c_str());
                    if (addr != nullptr) {
                        result.abi.symbols.emplace_back(sym);
                    } else {
                        all_present = false;
                    }
                }
                result.abi.factory_export_present = all_present;
                if (all_present) {
                    using version_fn = int (*)();
                    auto* vfn = reinterpret_cast<version_fn>(
                        ::dlsym(handle, std::string{kAbiSymbolVersion}.c_str()));
                    if (vfn != nullptr) result.abi.abi_version = vfn();
                }
                ::dlclose(handle);
            }
        }
#endif

        // The macro/source claimed an export but the compiled artifact does not
        // resolve all three symbols => a FATAL admission failure (the runner
        // will fail to load this .so). Presence-in-source without a compile is a
        // non-fatal note (syntax stage owns the blocking compile verdict).
        if ((macro_present || raw_present)) {
            if (compiled && !result.abi.factory_export_present) {
                result.diagnostics.push_back({Severity::Fatal, "abi:factory-export-missing",
                    "Compiled .so does not export the ABI v2 factory symbols "
                    "(qnx_strategy_abi_version / stratforge_create_strategy / "
                    "stratforge_destroy_strategy)",
                    std::nullopt, std::nullopt, DiagnosticSource::Abi});
            } else if (compiled && result.abi.abi_version.has_value()
                       && *result.abi.abi_version != kExpectedAbiVersion) {
                result.diagnostics.push_back({Severity::Fatal, "abi:version-mismatch",
                    "Strategy ABI version " + std::to_string(*result.abi.abi_version)
                        + " does not match expected v" + std::to_string(kExpectedAbiVersion),
                    std::nullopt, std::nullopt, DiagnosticSource::Abi});
            }
        } else {
            // No factory export at all in the source.
            result.diagnostics.push_back({Severity::Error, "abi:no-factory-export",
                "Strategy source does not declare QNX_STRATEGY_FACTORY_EXPORT",
                std::nullopt, std::nullopt, DiagnosticSource::Abi});
        }
    }

    // Cleanup temp artifacts.
    if (!source_path.empty()) {
        std::error_code ec;
        fs::remove(source_path, ec);
    }
    if (!so_path.empty()) {
        std::error_code ec;
        fs::remove(so_path, ec);
    }

    // Verdict: admitted iff no fatal/error diagnostics.
    for (const Diagnostic& d : result.diagnostics) {
        if (d.severity == Severity::Fatal || d.severity == Severity::Error) {
            result.admitted = false;
            break;
        }
    }
    return result;
}

}  // namespace StratCraft::executor::strategy_admission
