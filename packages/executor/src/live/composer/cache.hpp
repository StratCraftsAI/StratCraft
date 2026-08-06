// TICKET_794 Phase 1 -- compiled artifact cache.

#pragma once

#include <filesystem>
#include <optional>
#include <string>

namespace stratforge::live::composer {

// SHA-256 hex digest of arbitrary bytes. Implemented locally (no OpenSSL) so
// the composer keeps a minimal dependency surface.
std::string sha256Hex(std::string_view bytes);

// Returns the directory cached artifacts live in. Picked from (in order):
//   1. argument cacheDirOverride if non-empty,
//   2. $QNX_LIVE_COMPOSER_CACHE_DIR if set,
//   3. {userData}/cache/live-composer when QNX_USER_DATA_DIR is set,
//   4. ${TMPDIR or /tmp}/qnx-live-composer-cache as a fallback.
// Creates the directory if it does not exist.
std::filesystem::path resolveCacheDir(const std::filesystem::path& cacheDirOverride);

// Atomically writes `bytes` to a temp file in the same directory as `target`
// and renames it onto `target`. Throws on I/O failure.
void atomicWriteFile(const std::filesystem::path& target, std::string_view bytes);

} // namespace stratforge::live::composer
