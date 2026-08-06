// TICKET_1292 Phase 5 5A (MC-09): golden parity for the strategy-admission owner.
//
// Covers every ticket dimension: prohibited constructs, syntax failures, ABI
// exports, warnings, source locations, cancellation, missing compiler, and
// packaging (the CLI test is registered separately in CMakeLists).
//
// Source-only checks (prohibited/structural) run unconditionally and are pinned
// against the retained Python owner's CV*/CR* rule ids. Compile-driven stages
// (syntax/warnings/ABI) run only when a clang++ is discoverable; when absent
// they are exercised via the explicit missing-compiler contract.

#include "quantnexus/executor/strategy_admission/strategy_admission.hpp"
#include "quantnexus/executor/strategy_admission/strategy_admission_json.hpp"

#include <catch2/catch_test_macros.hpp>
#include <nlohmann/json.hpp>

#include <atomic>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <optional>
#include <string>

namespace admission = StratCraft::executor::strategy_admission;
namespace fs = std::filesystem;

namespace {

const admission::Diagnostic* find_rule(
    const admission::AdmissionResult& r, const std::string& rule_id) {
    for (const auto& d : r.diagnostics) {
        if (d.rule_id == rule_id) return &d;
    }
    return nullptr;
}

bool has_rule(const admission::AdmissionResult& r, const std::string& rule_id) {
    return find_rule(r, rule_id) != nullptr;
}

// Discover a clang++ for the compile-driven stages. QNX_ADMISSION_CLANG wins;
// otherwise probe the conventional locations. Returns empty when none found.
std::string discover_clang() {
    if (const char* env = std::getenv("QNX_ADMISSION_CLANG")) {
        if (env[0] != '\0' && fs::exists(env)) return env;
    }
    for (const char* candidate : {"/usr/bin/clang++", "/usr/local/bin/clang++"}) {
        if (fs::exists(candidate)) return candidate;
    }
    return {};
}

// Resolve the SDK include dir (sibling nonabackTrader repo) so the compile
// stages can find <stratforge/...> and <qnx_strategy_sdk/...>.
std::string sdk_include() {
#ifdef QNX_SOURCE_ROOT
    const fs::path root{QNX_SOURCE_ROOT};
    const fs::path inc = root / ".." / "nonabackTrader" / "include";
    if (fs::exists(inc)) return fs::weakly_canonical(inc).string();
#endif
    return {};
}

constexpr const char* kValidSource = R"CPP(
#include <stratforge/strategy/strategy.hpp>
#include <qnx_strategy_sdk/qnx_strategy_sdk.hpp>

class MyStrategy : public stratforge::Strategy {
public:
    void init() override {}
    void next() override {
        double c = data().close()[0];
        (void)c;
    }
};

QNX_STRATEGY_FACTORY_EXPORT(MyStrategy)
)CPP";

}  // namespace

// ===========================================================================
// Source-only parity (compiler-free): prohibited constructs + structural.
// ===========================================================================

TEST_CASE("prohibited constructs are surfaced with locations", "[admission][prohibited]") {
    const std::string code =
        "#include <stratforge/strategy/strategy.hpp>\n"  // 1
        "#include <cstdlib>\n"                            // 2 CR1
        "#include <fstream>\n"                            // 3 CR3 (file io include)
        "using namespace std;\n"                          // 4 CR5
        "\n"
        "class BadStrategy : public stratforge::Strategy {\n"
        "public:\n"
        "    void next() override {\n"
        "        system(\"x\");\n"                         // 9 CR2
        "        std::ofstream f(\"x.txt\");\n"            // 10 CR3 (file io class)
        "        goto done;\n"                             // 11 CR4
        "    done:\n"
        "        return;\n"
        "    }\n"
        "};\n"
        "QNX_STRATEGY_FACTORY_EXPORT(BadStrategy)\n";

    std::vector<admission::Diagnostic> diags;
    admission::analyze_source(code, diags);

    admission::AdmissionResult r;
    r.diagnostics = diags;

    // Each prohibited rule id present at the exact 1-based line (source-location dim).
    REQUIRE(find_rule(r, "CR1") != nullptr);
    REQUIRE(find_rule(r, "CR1")->line == 2);
    REQUIRE(find_rule(r, "CR5") != nullptr);
    REQUIRE(find_rule(r, "CR5")->line == 4);
    REQUIRE(find_rule(r, "CR2") != nullptr);
    REQUIRE(find_rule(r, "CR2")->line == 9);
    REQUIRE(find_rule(r, "CR4") != nullptr);
    REQUIRE(find_rule(r, "CR4")->line == 11);
    // CR3 (file I/O) appears for both the include and the class use.
    REQUIRE(has_rule(r, "CR3"));

    // Prohibited constructs are non-fatal (Python auto-strips them, never blocks).
    for (const auto& d : diags) {
        if (d.source == admission::DiagnosticSource::Prohibited) {
            REQUIRE(d.severity == admission::Severity::Warning);
        }
    }
}

TEST_CASE("structural CV1/CV3 block admission (no strategy class + main)", "[admission][structural]") {
    // Parity fixture: matches Python golden errors[] for the `structural` case.
    const std::string code =
        "#include <stratforge/strategy/strategy.hpp>\n"
        "\n"
        "int main() {\n"
        "    return 0;\n"
        "}\n";

    admission::AdmissionRequest req;
    req.code = code;
    req.checks = {true, true, false, false, false};  // source-only
    const admission::AdmissionResult r = admission::admit(req);

    REQUIRE(has_rule(r, "CV1"));   // No class inheriting from stratforge::Strategy
    REQUIRE(has_rule(r, "CV3"));   // main() found
    REQUIRE(r.admitted == false);  // CV1/CV3 are errors
}

TEST_CASE("structural CV6 blocks admission (unbalanced braces)", "[admission][structural]") {
    // Parity fixture: matches Python golden errors[] "CV6: Unbalanced braces".
    const std::string code =
        "#include <stratforge/strategy/strategy.hpp>\n"
        "\n"
        "class BraceStrategy : public stratforge::Strategy {\n"
        "public:\n"
        "    void next() override {\n"
        "        if (true) {\n"
        "    }\n"
        "};\n"
        "QNX_STRATEGY_FACTORY_EXPORT(BraceStrategy)\n";

    admission::AdmissionRequest req;
    req.code = code;
    req.checks = {true, true, false, false, false};
    const admission::AdmissionResult r = admission::admit(req);

    const auto* cv6 = find_rule(r, "CV6");
    REQUIRE(cv6 != nullptr);
    REQUIRE(cv6->message.find("Unbalanced braces") != std::string::npos);
    REQUIRE(r.admitted == false);
}

TEST_CASE("CV7 blocks multiple inheritance on the strategy class", "[admission][structural]") {
    const std::string code =
        "#include <stratforge/strategy/strategy.hpp>\n"
        "class Helper {};\n"
        "class MultiStrategy : public stratforge::Strategy, public Helper {\n"
        "public:\n"
        "    void next() override {}\n"
        "};\n"
        "QNX_STRATEGY_FACTORY_EXPORT(MultiStrategy)\n";

    admission::AdmissionRequest req;
    req.code = code;
    req.checks = {true, true, false, false, false};
    const admission::AdmissionResult r = admission::admit(req);
    REQUIRE(has_rule(r, "CV7"));
    REQUIRE(r.admitted == false);
}

TEST_CASE("CV2 blocks a generic strategy missing next()", "[admission][structural]") {
    const std::string code =
        "#include <stratforge/strategy/strategy.hpp>\n"
        "class NoNextStrategy : public stratforge::Strategy {\n"
        "public:\n"
        "    void init() override {}\n"
        "};\n"
        "QNX_STRATEGY_FACTORY_EXPORT(NoNextStrategy)\n";

    admission::AdmissionRequest req;
    req.code = code;
    req.checks = {true, true, false, false, false};
    const admission::AdmissionResult r = admission::admit(req);
    REQUIRE(has_rule(r, "CV2"));
    REQUIRE(r.admitted == false);
}

TEST_CASE("valid source with a strategy class admits under source-only checks", "[admission][structural]") {
    admission::AdmissionRequest req;
    req.code = kValidSource;
    req.checks = {true, true, false, false, false};
    const admission::AdmissionResult r = admission::admit(req);
    REQUIRE_FALSE(has_rule(r, "CV1"));
    REQUIRE_FALSE(has_rule(r, "CV3"));
    REQUIRE_FALSE(has_rule(r, "CV6"));
    REQUIRE(r.admitted == true);
    REQUIRE(r.compiler_available == true);  // no compile stage requested
}

// ===========================================================================
// Missing-compiler contract (fail fast, no silent skip).
// ===========================================================================

TEST_CASE("missing compiler yields a FATAL missing-compiler diagnostic", "[admission][missing-compiler]") {
    admission::AdmissionRequest req;
    req.code = kValidSource;
    req.compiler_path = "";  // none provided
    req.checks = {false, false, true, false, false};  // wants syntax => needs compiler
    const admission::AdmissionResult r = admission::admit(req);
    REQUIRE(r.compiler_available == false);
    REQUIRE(has_rule(r, "clang:missing-compiler"));
    REQUIRE(r.admitted == false);
}

TEST_CASE("non-executable compiler path fails fast", "[admission][missing-compiler]") {
    admission::AdmissionRequest req;
    req.code = kValidSource;
    req.compiler_path = "/nonexistent/clang++";
    req.checks = {false, false, true, false, false};
    const admission::AdmissionResult r = admission::admit(req);
    REQUIRE(r.compiler_available == false);
    REQUIRE(has_rule(r, "clang:missing-compiler"));
}

// ===========================================================================
// Cancellation.
// ===========================================================================

TEST_CASE("pre-cancelled admission aborts before compilation", "[admission][cancellation]") {
    admission::AdmissionRequest req;
    req.code = kValidSource;
    req.compiler_path = discover_clang();  // may be empty
    req.checks = {false, false, true, false, false};
    std::atomic<bool> cancelled{true};
    const admission::AdmissionResult r = admission::admit(req, &cancelled);
    // Either the missing-compiler path (no clang) or the cancelled path fires;
    // both are fatal, non-admitting, and never silently succeed.
    REQUIRE(r.admitted == false);
    REQUIRE((has_rule(r, "clang:cancelled") || has_rule(r, "clang:missing-compiler")));
}

// ===========================================================================
// Compile-driven stages (require a real clang + SDK includes).
// ===========================================================================

TEST_CASE("syntax failure surfaces a clang diagnostic with location", "[admission][syntax]") {
    const std::string clang = discover_clang();
    if (clang.empty()) {
        SUCCEED("no clang available; syntax stage covered by missing-compiler contract");
        return;
    }
    // A deliberate syntax error, no SDK includes needed.
    const std::string code =
        "class Broken : public Base {\n"
        "    void next() { int x = ; }\n"  // syntax error
        "};\n";
    admission::AdmissionRequest req;
    req.code = code;
    req.compiler_path = clang;
    req.checks = {false, false, true, false, false};
    const admission::AdmissionResult r = admission::admit(req);
    REQUIRE(r.compiler_available == true);
    bool has_clang_error = false;
    for (const auto& d : r.diagnostics) {
        if (d.source == admission::DiagnosticSource::Clang
            && (d.severity == admission::Severity::Error
                || d.severity == admission::Severity::Fatal)) {
            has_clang_error = true;
            REQUIRE(d.line.has_value());  // location dimension
        }
    }
    REQUIRE(has_clang_error);
    REQUIRE(r.admitted == false);
}

TEST_CASE("warnings are captured and never block admission", "[admission][warnings]") {
    const std::string clang = discover_clang();
    if (clang.empty()) {
        SUCCEED("no clang available; warning stage skipped");
        return;
    }
    // -Wall flags an unused variable; no error => still admitted.
    const std::string code =
        "extern \"C\" int qnx_strategy_abi_version();\n"
        "int f() { int unused = 3; return 0; }\n";
    admission::AdmissionRequest req;
    req.code = code;
    req.compiler_path = clang;
    req.checks = {false, false, true, true, false};  // syntax + warnings only
    const admission::AdmissionResult r = admission::admit(req);
    bool has_warning = false;
    for (const auto& d : r.diagnostics) {
        if (d.source == admission::DiagnosticSource::Clang
            && d.severity == admission::Severity::Warning) {
            has_warning = true;
        }
    }
    REQUIRE(has_warning);
    REQUIRE(r.admitted == true);  // warnings do not block
}

TEST_CASE("ABI v2 factory export is inspected from the compiled .so", "[admission][abi]") {
    const std::string clang = discover_clang();
    const std::string inc = sdk_include();
    if (clang.empty() || inc.empty()) {
        SUCCEED("no clang/SDK includes available; ABI stage skipped");
        return;
    }
    admission::AdmissionRequest req;
    req.code = kValidSource;
    req.compiler_path = clang;
    req.include_paths = {inc};
    req.checks = {false, false, false, false, true};  // ABI only
    const admission::AdmissionResult r = admission::admit(req);

    // A well-formed strategy must export all three ABI v2 symbols with version 2.
    REQUIRE(r.abi.factory_export_present == true);
    REQUIRE(r.abi.abi_version == 2);
    REQUIRE(r.abi.symbols.size() == 3);
    REQUIRE(r.admitted == true);
}

TEST_CASE("source without a factory export is flagged", "[admission][abi]") {
    const std::string code =
        "#include <stratforge/strategy/strategy.hpp>\n"
        "class NoExport : public stratforge::Strategy {\n"
        "public:\n"
        "    void next() override {}\n"
        "};\n";
    admission::AdmissionRequest req;
    req.code = code;
    req.checks = {false, false, false, false, true};
    // No compilerPath, but ABI check wants a compiler => missing-compiler fires
    // first (fail fast). Provide clang if present to exercise the no-export path.
    req.compiler_path = discover_clang();
    if (req.compiler_path.empty()) {
        SUCCEED("no clang; no-export path exercised via missing-compiler contract");
        return;
    }
    req.include_paths = {sdk_include()};
    const admission::AdmissionResult r = admission::admit(req);
    REQUIRE(has_rule(r, "abi:no-factory-export"));
    REQUIRE(r.admitted == false);
}

// ===========================================================================
// Golden parity vs the retained Python owner (blocking-verdict baseline).
// ===========================================================================

TEST_CASE("blocking-verdict parity with the Python owner", "[admission][golden]") {
#ifndef QNX_SOURCE_ROOT
    SKIP("QNX_SOURCE_ROOT not defined");
#else
    const fs::path fixture = fs::path{QNX_SOURCE_ROOT}
        / "packages" / "executor" / "tests" / "fixtures"
        / "strategy_admission_parity_v1.json";
    std::ifstream in(fixture);
    REQUIRE(in.is_open());
    nlohmann::json doc;
    in >> doc;

    for (const auto& c : doc.at("cases")) {
        const std::string name = c.at("name").get<std::string>();
        admission::AdmissionRequest req;
        req.code = c.at("code").get<std::string>();
        req.checks = {true, true, false, false, false};  // source-only parity
        const admission::AdmissionResult r = admission::admit(req);

        INFO("case: " << name);
        // (a) verdict parity: admitted matches the captured Python verdict.
        REQUIRE(r.admitted == c.at("admitted").get<bool>());
        // (b) each required CV* rule id is present as a blocking diagnostic.
        for (const auto& rid : c.at("requiredBlockingRuleIds")) {
            const std::string rule = rid.get<std::string>();
            const admission::Diagnostic* d = find_rule(r, rule);
            INFO("required rule: " << rule);
            REQUIRE(d != nullptr);
            REQUIRE((d->severity == admission::Severity::Error
                     || d->severity == admission::Severity::Fatal));
        }
    }
#endif
}

// ===========================================================================
// JSON contract round-trip (packaging boundary).
// ===========================================================================

TEST_CASE("request parse rejects a wrong diagnosticVersion", "[admission][json]") {
    nlohmann::json doc;
    doc["diagnosticVersion"] = 999;
    doc["code"] = kValidSource;
    REQUIRE_THROWS(admission::parse_request(doc));
}

TEST_CASE("result serializes the versioned envelope", "[admission][json]") {
    admission::AdmissionRequest req;
    req.code = kValidSource;
    req.checks = {true, true, false, false, false};
    const admission::AdmissionResult r = admission::admit(req);
    const nlohmann::json j = admission::to_json(r);
    REQUIRE(j.at("diagnosticVersion") == admission::kDiagnosticVersion);
    REQUIRE(j.at("admitted") == true);
    REQUIRE(j.contains("compilerAvailable"));
    REQUIRE(j.contains("abi"));
    REQUIRE(j.at("diagnostics").is_array());
}
