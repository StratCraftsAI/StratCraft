// TICKET_794 Phase 1 -- composed source emission.

#pragma once

#include "composer.hpp"

#include <string>

namespace stratforge::live::composer {

// Version of the emitted-source shape. Part of the compile cache key: bump
// whenever emitComposedSource output changes for identical input, so stale
// cached artifacts cannot be served (TICKET_1125 Phase 5).
// v2: constexpr parameter baking replaced the runtime JSON parameter parse.
// v3: integer leaves carry ULL/LL suffixes (strict conformance above
//     INT64_MAX; INT64_MIN emitted as an expression, not a literal).
inline constexpr const char* kComposerCodegenVersion = "3";

struct EmittedSource {
    std::string source;       // Full C++ translation unit.
    std::string analysisClass;
    std::string entryClass;
    std::string exitClass;    // Empty if no exit component.
};

// Reads packages/builder-templates/templates/live_composed.cpp.template
// (embedded at composer build time) and substitutes per-component values.
// Throws ComposerError if a referenced indicator is not in the stratforge
// accept-list or any component class name cannot be extracted.
EmittedSource emitComposedSource(const ComposerInput& input);

// Exposed for tests + cache-key canonicalisation.
std::string canonicalComponents(const std::vector<Component>& components);

// Regex-extracts the first `class Name` declaration from a snippet of C++.
// Returns empty string if no match. Public for unit tests.
std::string extractClassName(std::string_view code);

} // namespace stratforge::live::composer
