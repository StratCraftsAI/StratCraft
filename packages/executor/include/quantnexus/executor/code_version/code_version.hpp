#pragma once

// TICKET_1292_15 (MC-15, cut 5C-1): pure C++23 code-version owner.
//
// This header is the SINGLE SOURCE OF TRUTH for the Tool Sweep cache-key
// `code_version` (TICKET_815). It removes the last deterministic Python helper
// subprocess on the sweep-dispatch launch path: before this cut,
// code-version-cache.ts spawned
//   `python -m nona_algorithm.signal_sources.code_version --template <id>`
// once per (template, app-session) to derive the 64-hex cache key. That work is
// bounded and deterministic -- an AST import-closure walk over the template's
// first-party source files plus SHA-256 aggregation -- so it belongs in the
// packaged C++ executor, not an interpreter subprocess with its own interpreter-
// discovery / PYTHONPATH / stderr-parsing / cancellation failure surface.
//
// The `code_version` is a deterministic hash combining:
//   1. SHA-256 over every nona_algorithm.* source file the template
//      transitively imports (per-template file closure).
//   2. SHA-256 over the runtime dependency lockfile (poetry.lock or
//      requirements.txt).
//
// The closure is computed by a static Python-import scanner: starting from the
// template's own .py file, follow every `import` / `from ... import ...` edge
// whose resolved module name starts with `nona_algorithm.` and whose .py file
// exists on disk. This is a faithful, value-identical port of
// code_version.py::source_files_closure (AST walk). Non-first-party imports
// (json, numpy, hmmlearn, ...) are filtered by the `nona_algorithm` prefix, so
// the scanner never needs to resolve them -- it only recognises statement
// boundaries. Module -> file resolution mirrors importlib.util.find_spec for
// first-party modules: `nona_algorithm.a.b` -> `<root>/nona_algorithm/a/b.py`
// if it exists, else `<root>/nona_algorithm/a/b/__init__.py`.
//
// Golden parity fixture (code_version_parity_v1.json) captured FROM the Python
// authority before the rewire pins this equality byte-for-byte for every
// registered template.

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <cstring>
#include <deque>
#include <filesystem>
#include <fstream>
#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace StratCraft::executor::code_version {

// =============================================================================
// Frozen contract version
// =============================================================================

// Bumped only on a breaking change to the request/result schema. The result
// carries this so the TS consumer can reject a payload it does not understand
// (fail-fast, never silently misinterpret).
inline constexpr int kCodeVersionVersion = 1;

// First-party package prefix. Only imports under this prefix are followed into
// the closure (mirrors code_version.py::_NONA_PREFIX).
inline constexpr std::string_view kNonaPrefix = "nona_algorithm";

// =============================================================================
// Template -> defining-module table
// =============================================================================
//
// Byte-identical to code_version.py::_TEMPLATE_MODULE. Importing ONLY this
// module (not the full registry) is what makes the closure per-template.
// A new template requires an entry in BOTH tables; an unknown template_id is a
// hard error (never a silent fall back to the registry, which would re-
// introduce the "all templates share one closure" bug).
inline const std::map<std::string, std::string>& templateModuleTable() {
    static const std::map<std::string, std::string> table = {
        {"catboost_return_v2", "nona_algorithm.signal_sources.ml.catboost_return"},
        {"double_ensemble_return_v2", "nona_algorithm.signal_sources.ml.double_ensemble_return"},
        {"ft_transformer_return_v1", "nona_algorithm.signal_sources.ml.ft_transformer_return"},
        {"gmm_regime_v1", "nona_algorithm.signal_sources.gmm.gmm_regime"},
        {"hmm_regime_v1", "nona_algorithm.signal_sources.hmm.hmm_regime"},
        {"isolation_forest_anomaly_v1", "nona_algorithm.signal_sources.ml.isolation_forest_anomaly"},
        {"kalman_filter_v1", "nona_algorithm.signal_sources.ml.kalman_filter"},
        {"lightgbm_return_v1", "nona_algorithm.signal_sources.ml.lightgbm_return"},
        {"lightgbm_return_v2", "nona_algorithm.signal_sources.ml.lightgbm_return_v2"},
        {"ngram_next_bar_v1", "nona_algorithm.signal_sources.ngram.ngram_next_bar"},
        {"pytorch_gru_return_v1", "nona_algorithm.signal_sources.ml.pytorch_gru_return"},
        {"pytorch_lstm_return_v1", "nona_algorithm.signal_sources.ml.pytorch_lstm_return"},
        {"pytorch_mlp_return_v1", "nona_algorithm.signal_sources.ml.pytorch_mlp_return"},
        {"pytorch_tcn_return_v1", "nona_algorithm.signal_sources.ml.pytorch_tcn_return"},
        {"pytorch_ts_transformer_return_v1", "nona_algorithm.signal_sources.ml.pytorch_ts_transformer_return"},
        {"rdagent_bridge", "nona_algorithm.signal_sources.rdagent_factors.bridge"},
        {"sklearn_bayesian_ridge_return_v1", "nona_algorithm.signal_sources.ml.sklearn_bayesian_ridge_return"},
        {"sklearn_bayesian_ridge_return_v2", "nona_algorithm.signal_sources.ml.sklearn_bayesian_ridge_return_v2"},
        {"sklearn_elasticnet_return_v1", "nona_algorithm.signal_sources.ml.sklearn_elasticnet_return"},
        {"sklearn_elasticnet_return_v2", "nona_algorithm.signal_sources.ml.sklearn_elasticnet_return_v2"},
        {"sklearn_gp_return_v1", "nona_algorithm.signal_sources.ml.sklearn_gp_return"},
        {"sklearn_gp_return_v2", "nona_algorithm.signal_sources.ml.sklearn_gp_return_v2"},
        {"sklearn_knn_return_v1", "nona_algorithm.signal_sources.ml.sklearn_knn_return"},
        {"sklearn_knn_return_v2", "nona_algorithm.signal_sources.ml.sklearn_knn_return_v2"},
        {"sklearn_lasso_return_v1", "nona_algorithm.signal_sources.ml.sklearn_lasso_return"},
        {"sklearn_lasso_return_v2", "nona_algorithm.signal_sources.ml.sklearn_lasso_return_v2"},
        {"sklearn_logistic_return_v1", "nona_algorithm.signal_sources.ml.sklearn_logistic_return"},
        {"sklearn_logistic_return_v2", "nona_algorithm.signal_sources.ml.sklearn_logistic_return_v2"},
        {"sklearn_random_forest_return_v1", "nona_algorithm.signal_sources.ml.sklearn_random_forest_return"},
        {"sklearn_random_forest_return_v2", "nona_algorithm.signal_sources.ml.sklearn_random_forest_return_v2"},
        {"sklearn_ridge_return_v1", "nona_algorithm.signal_sources.ml.sklearn_ridge_return"},
        {"sklearn_ridge_return_v2", "nona_algorithm.signal_sources.ml.sklearn_ridge_return_v2"},
        {"xgboost_return_v1", "nona_algorithm.signal_sources.ml.xgboost_return"},
        {"xgboost_return_v2", "nona_algorithm.signal_sources.ml.xgboost_return_v2"},
        {"xgboost_return_v3", "nona_algorithm.signal_sources.ml.xgboost_return_v3"},
    };
    return table;
}

// =============================================================================
// SHA-256 (self-contained; parity-verified against the Python hashlib output
// by the golden fixture). Same well-known primitive as the composer cache.
// =============================================================================

namespace detail {

inline std::uint32_t rotr(std::uint32_t x, std::uint32_t n) {
    return (x >> n) | (x << (32 - n));
}

inline void sha256Compress(std::array<std::uint32_t, 8>& h, const std::uint8_t block[64]) {
    static const std::uint32_t k[64] = {
        0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u,
        0x923f82a4u, 0xab1c5ed5u, 0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
        0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u, 0xe49b69c1u, 0xefbe4786u,
        0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
        0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u,
        0x06ca6351u, 0x14292967u, 0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
        0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u, 0xa2bfe8a1u, 0xa81a664bu,
        0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
        0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au,
        0x5b9cca4fu, 0x682e6ff3u, 0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
        0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u,
    };
    std::uint32_t w[64];
    for (int i = 0; i < 16; ++i) {
        w[i] = (static_cast<std::uint32_t>(block[i * 4]) << 24) |
               (static_cast<std::uint32_t>(block[i * 4 + 1]) << 16) |
               (static_cast<std::uint32_t>(block[i * 4 + 2]) << 8) |
               (static_cast<std::uint32_t>(block[i * 4 + 3]));
    }
    for (int i = 16; i < 64; ++i) {
        const std::uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
        const std::uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
        w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    std::uint32_t a = h[0], b = h[1], c = h[2], d = h[3];
    std::uint32_t e = h[4], f = h[5], g = h[6], hh = h[7];
    for (int i = 0; i < 64; ++i) {
        const std::uint32_t S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const std::uint32_t ch = (e & f) ^ (~e & g);
        const std::uint32_t t1 = hh + S1 + ch + k[i] + w[i];
        const std::uint32_t S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const std::uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
        const std::uint32_t t2 = S0 + maj;
        hh = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d;
    h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
}

inline std::string sha256Hex(std::string_view bytes) {
    std::array<std::uint32_t, 8> h = {
        0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
        0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u,
    };
    const auto* data = reinterpret_cast<const std::uint8_t*>(bytes.data());
    const std::uint64_t total_bits = static_cast<std::uint64_t>(bytes.size()) * 8u;
    std::size_t i = 0;
    while (i + 64 <= bytes.size()) {
        sha256Compress(h, data + i);
        i += 64;
    }
    std::uint8_t tail[128] = {};
    const std::size_t remaining = bytes.size() - i;
    std::memcpy(tail, data + i, remaining);
    tail[remaining] = 0x80u;
    const std::size_t tail_size = (remaining < 56) ? 64 : 128;
    for (int kk = 0; kk < 8; ++kk) {
        tail[tail_size - 1 - kk] = static_cast<std::uint8_t>((total_bits >> (8 * kk)) & 0xffu);
    }
    sha256Compress(h, tail);
    if (tail_size == 128) sha256Compress(h, tail + 64);

    char buf[65];
    static const char hex[] = "0123456789abcdef";
    for (int kk = 0; kk < 8; ++kk) {
        const std::uint32_t w = h[kk];
        for (int j = 0; j < 4; ++j) {
            const std::uint8_t by = static_cast<std::uint8_t>((w >> (8 * (3 - j))) & 0xffu);
            buf[kk * 8 + j * 2] = hex[by >> 4];
            buf[kk * 8 + j * 2 + 1] = hex[by & 0x0fu];
        }
    }
    buf[64] = '\0';
    return std::string(buf, 64);
}

// SHA-256 hex of a file's raw bytes. Mirrors code_version.py::sha256_of_file.
inline std::string sha256OfFile(const std::filesystem::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in.is_open()) {
        throw std::runtime_error("code-version: cannot open file for hashing: " + path.string());
    }
    std::string contents((std::istreambuf_iterator<char>(in)),
                          std::istreambuf_iterator<char>());
    return sha256Hex(contents);
}

// ---------------------------------------------------------------------------
// Python-import statement scanner (static; no code execution)
// ---------------------------------------------------------------------------

// Convert a first-party source-file path back to the dotted package name of its
// CONTAINING directory (used to anchor relative-import resolution). Mirrors
// code_version.py::_file_to_package: keep from the `nona_algorithm` path
// segment onwards, drop the file name.
inline std::string fileToPackage(const std::filesystem::path& filePath) {
    std::vector<std::string> parts;
    for (const auto& seg : filePath) parts.push_back(seg.string());
    std::size_t rootIdx = parts.size();
    for (std::size_t i = 0; i < parts.size(); ++i) {
        if (parts[i] == std::string(kNonaPrefix)) { rootIdx = i; break; }
    }
    if (rootIdx == parts.size()) return "";
    std::string out;
    // From root .. second-to-last segment (drop the file name at parts.back()).
    for (std::size_t i = rootIdx; i + 1 < parts.size(); ++i) {
        if (!out.empty()) out += ".";
        out += parts[i];
    }
    return out;
}

// Resolve a `from X import Y` / `import X` target to a fully-qualified module
// name. `level` follows the AST convention (0 = absolute, 1 = `from .`,
// 2 = `from ..`, ...). Mirrors code_version.py::_resolve_import_target.
inline std::optional<std::string> resolveImportTarget(
    const std::string& moduleOrAlias, const std::string& currentPackage, int level) {
    if (level == 0) return moduleOrAlias;
    std::vector<std::string> parts;
    {
        std::size_t start = 0;
        while (start <= currentPackage.size()) {
            const std::size_t dot = currentPackage.find('.', start);
            if (dot == std::string::npos) { parts.push_back(currentPackage.substr(start)); break; }
            parts.push_back(currentPackage.substr(start, dot - start));
            start = dot + 1;
        }
    }
    if (currentPackage.empty()) parts.clear();
    // parent = ".".join(parts[: len(parts) - (level - 1)])
    const int keep = static_cast<int>(parts.size()) - (level - 1);
    if (keep <= 0) return std::nullopt;
    std::string parent;
    for (int i = 0; i < keep; ++i) {
        if (!parent.empty()) parent += ".";
        parent += parts[static_cast<std::size_t>(i)];
    }
    if (parent.empty()) return std::nullopt;
    if (!moduleOrAlias.empty()) return parent + "." + moduleOrAlias;
    return parent;
}

inline std::string strip(const std::string& s) {
    std::size_t a = 0, b = s.size();
    while (a < b && std::isspace(static_cast<unsigned char>(s[a]))) ++a;
    while (b > a && std::isspace(static_cast<unsigned char>(s[b - 1]))) --b;
    return s.substr(a, b - a);
}

// Parse one source file's raw text and return every fully-qualified module name
// it imports (resolving relative imports against `currentPackage`).
//
// This is the C++ equivalent of code_version.py::_ast_imports. We do not build a
// full Python AST; we tokenise import statements. This is sound for the closure
// because the closure only follows nona_algorithm.* edges, and those appear as
// ordinary `import`/`from` statements. Handles: `import a`, `import a as b`,
// `import a.b, c` (comma list), `from a.b import x, y`, `from . import x`,
// `from ..pkg import (\n x,\n y,\n)` (parenthesised continuation), and indented
// (deferred, in-function) imports. `from a import x, y` yields `a` once (the
// symbols after `import` are typically names within a, not submodules), exactly
// as the Python AST walker does. Comment / string handling: a `#` outside a
// paren-continuation ends the logical line; we do not attempt to detect imports
// embedded in string literals (neither does the Python walker meaningfully, for
// first-party edges).
inline std::vector<std::string> astImports(
    const std::string& source, const std::string& currentPackage) {
    std::vector<std::string> targets;

    // Split into physical lines, then reassemble logical lines that continue
    // across a backslash or an open parenthesis in a `from ... import (` form.
    std::vector<std::string> lines;
    {
        std::size_t start = 0;
        while (start <= source.size()) {
            const std::size_t nl = source.find('\n', start);
            if (nl == std::string::npos) { lines.push_back(source.substr(start)); break; }
            lines.push_back(source.substr(start, nl - start));
            start = nl + 1;
        }
    }

    auto stripComment = [](const std::string& line) -> std::string {
        // Drop a trailing comment. Good enough for import lines (no # in a
        // module path); we ignore the corner case of # inside a string literal
        // on an import line, which does not occur for first-party imports.
        const std::size_t h = line.find('#');
        return h == std::string::npos ? line : line.substr(0, h);
    };

    for (std::size_t li = 0; li < lines.size(); ++li) {
        std::string logical = stripComment(lines[li]);
        std::string trimmed = strip(logical);
        if (!trimmed.starts_with("import ") && !trimmed.starts_with("from ")) {
            continue;
        }

        // Coalesce parenthesised / backslash continuations for `from` imports.
        if (trimmed.starts_with("from ")) {
            int open = 0;
            for (char c : logical) { if (c == '(') ++open; else if (c == ')') --open; }
            bool cont = (open > 0) ||
                        (!logical.empty() && strip(logical).back() == '\\');
            std::string acc = logical;
            while (cont && li + 1 < lines.size()) {
                ++li;
                std::string nxt = stripComment(lines[li]);
                // strip a trailing backslash continuation marker
                std::string accTrim = strip(acc);
                if (!accTrim.empty() && accTrim.back() == '\\') {
                    acc = acc.substr(0, acc.rfind('\\'));
                }
                acc += " " + nxt;
                open = 0;
                for (char c : acc) { if (c == '(') ++open; else if (c == ')') --open; }
                std::string accStrip = strip(acc);
                cont = (open > 0) || (!accStrip.empty() && accStrip.back() == '\\');
            }
            logical = acc;
            trimmed = strip(logical);
        }

        if (trimmed.starts_with("from ")) {
            // from <dots><module> import ...
            std::string rest = strip(trimmed.substr(5));  // after "from "
            int level = 0;
            std::size_t p = 0;
            while (p < rest.size() && rest[p] == '.') { ++level; ++p; }
            // module name = up to whitespace / "import"
            std::size_t q = p;
            while (q < rest.size() && (std::isalnum(static_cast<unsigned char>(rest[q])) ||
                                       rest[q] == '_' || rest[q] == '.')) {
                ++q;
            }
            const std::string moduleName = rest.substr(p, q - p);
            const auto resolved = resolveImportTarget(moduleName, currentPackage, level);
            if (resolved.has_value()) targets.push_back(*resolved);
        } else {
            // import a[.b][ as x][, c[.d][ as y]]
            std::string rest = strip(trimmed.substr(6));  // after "import"
            // split on commas
            std::vector<std::string> items;
            std::size_t start = 0;
            for (std::size_t i = 0; i <= rest.size(); ++i) {
                if (i == rest.size() || rest[i] == ',') {
                    items.push_back(rest.substr(start, i - start));
                    start = i + 1;
                }
            }
            for (auto& raw : items) {
                std::string item = strip(raw);
                // drop " as alias"
                const std::size_t asPos = item.find(" as ");
                if (asPos != std::string::npos) item = item.substr(0, asPos);
                item = strip(item);
                // take the leading dotted-name token
                std::size_t q = 0;
                while (q < item.size() && (std::isalnum(static_cast<unsigned char>(item[q])) ||
                                           item[q] == '_' || item[q] == '.')) {
                    ++q;
                }
                const std::string name = item.substr(0, q);
                if (!name.empty()) targets.push_back(name);
            }
        }
    }
    return targets;
}

}  // namespace detail

// =============================================================================
// Module -> file resolution (mirrors importlib.util.find_spec for first-party)
// =============================================================================

// Resolve a fully-qualified first-party module name to its .py source file
// under `packageParent` (the directory that CONTAINS the `nona_algorithm`
// package, e.g. packages/nona-algorithm). Returns nullopt for a name that does
// not map to an existing .py file (namespace package, symbol, or third-party).
//
//   nona_algorithm.a.b -> <parent>/nona_algorithm/a/b.py  (if exists)
//                      -> <parent>/nona_algorithm/a/b/__init__.py  (else)
inline std::optional<std::filesystem::path> resolveModuleToFile(
    const std::string& moduleName, const std::filesystem::path& packageParent) {
    namespace fs = std::filesystem;
    fs::path rel = packageParent;
    std::size_t start = 0;
    while (start <= moduleName.size()) {
        const std::size_t dot = moduleName.find('.', start);
        const std::string seg = (dot == std::string::npos)
                                     ? moduleName.substr(start)
                                     : moduleName.substr(start, dot - start);
        rel /= seg;
        if (dot == std::string::npos) break;
        start = dot + 1;
    }
    std::error_code ec;
    const fs::path asModule = fs::path(rel).replace_extension(".py");
    if (fs::exists(asModule, ec) && fs::is_regular_file(asModule, ec)) {
        return fs::weakly_canonical(asModule, ec);
    }
    const fs::path asPackage = rel / "__init__.py";
    if (fs::exists(asPackage, ec) && fs::is_regular_file(asPackage, ec)) {
        return fs::weakly_canonical(asPackage, ec);
    }
    return std::nullopt;
}

// =============================================================================
// Closure + aggregate hashes
// =============================================================================

// Return the sorted absolute paths of every nona_algorithm.* source file the
// template transitively imports. Mirrors code_version.py::source_files_closure
// (AST static walk). `packageParent` contains the `nona_algorithm` directory.
inline std::vector<std::filesystem::path> sourceFilesClosure(
    const std::string& templateId, const std::filesystem::path& packageParent) {
    namespace fs = std::filesystem;
    const auto& table = templateModuleTable();
    const auto it = table.find(templateId);
    if (it == table.end()) {
        throw std::runtime_error("code-version: unknown template_id=" + templateId);
    }
    const std::string startModule = it->second;
    const auto startPath = resolveModuleToFile(startModule, packageParent);
    if (!startPath.has_value()) {
        throw std::runtime_error(
            "code-version: could not resolve module " + startModule + " to a .py file");
    }

    std::set<std::string> seenModules;
    std::set<fs::path> files;
    std::deque<std::pair<std::string, fs::path>> queue;
    queue.emplace_back(startModule, *startPath);

    while (!queue.empty()) {
        // Match Python's list.pop() (LIFO); traversal order does not affect the
        // final sorted-file hash, but we keep LIFO for behavioural fidelity.
        auto [moduleName, filePath] = queue.back();
        queue.pop_back();
        if (seenModules.count(moduleName)) continue;
        seenModules.insert(moduleName);
        files.insert(filePath);

        const std::string currentPkg = detail::fileToPackage(filePath);
        std::ifstream in(filePath, std::ios::binary);
        if (!in.is_open()) continue;
        std::string source((std::istreambuf_iterator<char>(in)),
                            std::istreambuf_iterator<char>());

        for (const std::string& rawTarget : detail::astImports(source, currentPkg)) {
            const bool firstParty =
                rawTarget == std::string(kNonaPrefix) ||
                rawTarget.starts_with(std::string(kNonaPrefix) + ".");
            if (!firstParty) continue;
            if (seenModules.count(rawTarget)) continue;
            const auto targetFile = resolveModuleToFile(rawTarget, packageParent);
            if (targetFile.has_value()) {
                queue.emplace_back(rawTarget, *targetFile);
                continue;
            }
            // Maybe rawTarget is `pkg.module.Symbol`; strip the last segment
            // and retry as a module path (mirrors the Python fallback).
            const std::size_t dot = rawTarget.rfind('.');
            if (dot != std::string::npos) {
                const std::string parent = rawTarget.substr(0, dot);
                if (parent.starts_with(std::string(kNonaPrefix)) &&
                    !seenModules.count(parent)) {
                    const auto parentFile = resolveModuleToFile(parent, packageParent);
                    if (parentFile.has_value()) {
                        queue.emplace_back(parent, *parentFile);
                    }
                }
            }
        }
    }

    std::vector<fs::path> out(files.begin(), files.end());
    std::sort(out.begin(), out.end());
    return out;
}

// Aggregate SHA-256 over the sorted (abs-path, file-sha256) pairs. Byte-for-byte
// mirror of code_version.py::source_files_sha256: each entry contributes
// `<abs path>\n<file sha256>\n`.
inline std::string sourceFilesSha256(const std::vector<std::filesystem::path>& files) {
    std::vector<std::filesystem::path> sorted = files;
    std::sort(sorted.begin(), sorted.end());
    std::string acc;
    for (const auto& path : sorted) {
        acc += path.string();
        acc += "\n";
        acc += detail::sha256OfFile(path);
        acc += "\n";
    }
    return detail::sha256Hex(acc);
}

// Locate the runtime dependency lockfile under the package root
// (<packageParent>/nona_algorithm/.. == packageParent, since the Python module
// uses parents[2] == pkg root == packages/nona-algorithm). Search order matches
// code_version.py::find_lockfile: poetry.lock, then requirements.txt.
inline std::filesystem::path findLockfile(const std::filesystem::path& packageParent) {
    namespace fs = std::filesystem;
    std::error_code ec;
    const fs::path poetry = packageParent / "poetry.lock";
    if (fs::exists(poetry, ec)) return poetry;
    const fs::path req = packageParent / "requirements.txt";
    if (fs::exists(req, ec)) return req;
    throw std::runtime_error(
        "code-version: no lockfile found (poetry.lock / requirements.txt) under " +
        packageParent.string());
}

// =============================================================================
// Result + top-level compute
// =============================================================================

struct CodeVersionResult {
    std::string codeVersion;        // the 64-hex cache key persisted to signal_run
    std::string sourceFilesSha256;  // component (for the [CACHE-KEY] log line)
    std::string lockfileSha256;     // component
    int sourceFileCount = 0;        // observability
    std::string lockfilePath;       // abs path (basename pinned by the fixture)
};

// Compute the cache-key code_version for a template. Byte-identical to
// code_version.py::compute_code_version.
//
//   combined = sha256( source_files_sha256 + "|" + lockfile_sha256 )
inline CodeVersionResult computeCodeVersion(
    const std::string& templateId, const std::filesystem::path& packageParent) {
    const auto files = sourceFilesClosure(templateId, packageParent);
    if (files.empty()) {
        throw std::runtime_error(
            "code-version: source closure for " + templateId +
            " returned 0 files; refusing to emit an empty hash");
    }
    const std::string srcHash = sourceFilesSha256(files);
    const auto lockfile = findLockfile(packageParent);
    const std::string lockHash = detail::sha256OfFile(lockfile);

    const std::string combined = detail::sha256Hex(srcHash + "|" + lockHash);

    CodeVersionResult result;
    result.codeVersion = combined;
    result.sourceFilesSha256 = srcHash;
    result.lockfileSha256 = lockHash;
    result.sourceFileCount = static_cast<int>(files.size());
    result.lockfilePath = lockfile.string();
    return result;
}

}  // namespace StratCraft::executor::code_version
