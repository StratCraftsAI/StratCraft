// TICKET_196_7_3 Step 11 / TICKET_196_7_0_1 Q3 -- artifact loader interface.
//
// Source-of-truth contract for C++ live-side loading of v2 signal source
// artifacts (HMM / n-gram / sklearn / xgboost / pytorch). Concrete loaders
// implement IArtifactLoader; templates register their factory with
// ArtifactLoaderRegistry so LiveEngine can construct the right loader from a
// template_id read out of _meta.json.
//
// Spec home: docs/design/TICKET_196_7_0_1_CPP_LIVE_RUNTIME_ARTIFACT_LOADING.md
// First consumer: OnnxArtifactLoader (TICKET_196_7_3 ML signal pack).
//
// Per the locked 196_7_0_1 spec the interface lives in the stratforge::signal
// namespace conceptually; per user direction (and CLAUDE.md scope rules that
// keep us out of the upstream StratForge repo) the actual home is the
// executor repo under quantnexus::executor::signal::.

#pragma once

#include <exception>
#include <filesystem>
#include <span>
#include <string>
#include <string_view>

#include <stratforge/bar.hpp>

namespace StratCraft::executor::signal {

using Bar = stratforge::Bar;

// Exceptions ----------------------------------------------------------------
// All four are reported back to the UI via the structured error event path
// specified in TICKET_196_7_0_1 Q5 (stdout JSON line -> useMessage). They
// share a common base so LiveEngine can catch one type at the boundary.

class ArtifactLoadError : public std::exception {
 public:
  ArtifactLoadError(std::string template_id, std::string detail)
      : template_id_(std::move(template_id)), detail_(std::move(detail)) {
    message_ = template_id_ + ": " + detail_;
  }

  [[nodiscard]] const char* what() const noexcept override { return message_.c_str(); }
  [[nodiscard]] const std::string& template_id() const noexcept { return template_id_; }
  [[nodiscard]] const std::string& detail() const noexcept { return detail_; }

 private:
  std::string template_id_;
  std::string detail_;
  std::string message_;
};

class ArtifactVersionMismatch : public ArtifactLoadError {
 public:
  ArtifactVersionMismatch(std::string template_id, std::string expected, std::string got)
      : ArtifactLoadError(std::move(template_id),
                          "artifact_version mismatch (expected " + expected +
                              ", got " + got + ")"),
        expected_(std::move(expected)),
        got_(std::move(got)) {}

  [[nodiscard]] const std::string& expected() const noexcept { return expected_; }
  [[nodiscard]] const std::string& got() const noexcept { return got_; }

 private:
  std::string expected_;
  std::string got_;
};

class ArtifactRuntimeTooOld : public ArtifactLoadError {
 public:
  using ArtifactLoadError::ArtifactLoadError;
};

class ArtifactOpsetUnsupported : public ArtifactLoadError {
 public:
  using ArtifactLoadError::ArtifactLoadError;
};

class ArtifactShapeMismatch : public ArtifactLoadError {
 public:
  using ArtifactLoadError::ArtifactLoadError;
};

class ArtifactSchemaError : public ArtifactLoadError {
 public:
  using ArtifactLoadError::ArtifactLoadError;
};

// IArtifactLoader -----------------------------------------------------------
// Interface signature locked in TICKET_196_7_0_1 Q3. predict_one is the only
// hot-path entry point; it MUST be noexcept and allocation-free per the
// 196_7_0_1 Q6 hot-path discipline.
//
// `trailing` is the last N bars (excluding `current`) needed for templates
// that fold history into their prediction (HMM Viterbi window, ML lag
// features). Stateless / lookup-only templates may ignore it.
class IArtifactLoader {
 public:
  virtual ~IArtifactLoader() = default;

  // Loads the artifact from disk. Throws ArtifactLoadError or a subclass on
  // any failure. Pre-sizes all scratch buffers so predict_one is alloc-free.
  // Called once at strategy startup; dynamic re-loading on the hot path is
  // forbidden (196_7_0_1 Q4).
  virtual void load(const std::filesystem::path& artifact_dir) = 0;

  // Hot path. Returns a value in [-1, 1] consistent with the v2 contract
  // (TICKET_196_7_0 Clause 1). Pre-warmup bars must return 0.0.
  [[nodiscard]] virtual double predict_one(const Bar& current,
                                           std::span<const Bar> trailing) noexcept = 0;

  [[nodiscard]] virtual int warmup_bars() const noexcept = 0;
  [[nodiscard]] virtual std::string_view template_id() const noexcept = 0;
};

}  // namespace StratCraft::executor::signal
