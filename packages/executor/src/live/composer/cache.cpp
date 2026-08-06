// TICKET_794 Phase 1 -- compiled artifact cache + SHA-256.
//
// SHA-256 implementation is the standard FIPS-180-4 reference algorithm,
// written by hand here to avoid pulling in OpenSSL/libcrypto for a single
// hash function.

#include "cache.hpp"

#include <array>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <random>
#include <stdexcept>
#include <string>
#include <system_error>

namespace fs = std::filesystem;

namespace stratforge::live::composer {

namespace {

constexpr std::array<std::uint32_t, 64> kSha256K = {
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
    0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u, 0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
    0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
    0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
    0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u, 0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
    0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
    0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
    0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u, 0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u,
};

inline std::uint32_t rotr(std::uint32_t x, std::uint32_t n) {
    return (x >> n) | (x << (32 - n));
}

void sha256Compress(std::array<std::uint32_t, 8>& h, const std::uint8_t block[64]) {
    std::uint32_t w[64];
    for (int i = 0; i < 16; ++i) {
        w[i] = (static_cast<std::uint32_t>(block[i * 4]) << 24) |
               (static_cast<std::uint32_t>(block[i * 4 + 1]) << 16) |
               (static_cast<std::uint32_t>(block[i * 4 + 2]) << 8) |
                static_cast<std::uint32_t>(block[i * 4 + 3]);
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
        const std::uint32_t t1 = hh + S1 + ch + kSha256K[i] + w[i];
        const std::uint32_t S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const std::uint32_t mj = (a & b) ^ (a & c) ^ (b & c);
        const std::uint32_t t2 = S0 + mj;
        hh = g;
        g = f;
        f = e;
        e = d + t1;
        d = c;
        c = b;
        b = a;
        a = t1 + t2;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d;
    h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
}

} // namespace

std::string sha256Hex(std::string_view bytes) {
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
    for (int k = 0; k < 8; ++k) {
        tail[tail_size - 1 - k] = static_cast<std::uint8_t>((total_bits >> (8 * k)) & 0xffu);
    }
    sha256Compress(h, tail);
    if (tail_size == 128) sha256Compress(h, tail + 64);

    char buf[65];
    static const char hex[] = "0123456789abcdef";
    for (int k = 0; k < 8; ++k) {
        const std::uint32_t w = h[k];
        for (int j = 0; j < 4; ++j) {
            const std::uint8_t by = static_cast<std::uint8_t>((w >> (8 * (3 - j))) & 0xffu);
            buf[k * 8 + j * 2] = hex[by >> 4];
            buf[k * 8 + j * 2 + 1] = hex[by & 0x0fu];
        }
    }
    buf[64] = '\0';
    return std::string(buf, 64);
}

fs::path resolveCacheDir(const fs::path& cacheDirOverride) {
    fs::path dir;
    if (!cacheDirOverride.empty()) {
        dir = cacheDirOverride;
    } else if (const char* env = std::getenv("QNX_LIVE_COMPOSER_CACHE_DIR"); env && *env) {
        dir = env;
    } else if (const char* ud = std::getenv("QNX_USER_DATA_DIR"); ud && *ud) {
        dir = fs::path(ud) / "cache" / "live-composer";
    } else {
        const char* tmp = std::getenv("TMPDIR");
        dir = fs::path(tmp && *tmp ? tmp : "/tmp") / "qnx-live-composer-cache";
    }
    std::error_code ec;
    fs::create_directories(dir, ec);
    if (ec) {
        throw std::runtime_error("failed to create cache directory " + dir.string() + ": " + ec.message());
    }
    return dir;
}

void atomicWriteFile(const fs::path& target, std::string_view bytes) {
    std::random_device rd;
    const auto suffix = std::to_string(static_cast<std::uint64_t>(rd()) ^
                                       static_cast<std::uint64_t>(std::random_device{}()));
    fs::path tmp = target;
    tmp += ".tmp." + suffix;

    {
        std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
        if (!out) {
            throw std::runtime_error("failed to open temp file " + tmp.string());
        }
        out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
        if (!out) {
            throw std::runtime_error("failed to write temp file " + tmp.string());
        }
    }

    std::error_code ec;
    fs::rename(tmp, target, ec);
    if (ec) {
        fs::remove(tmp);
        throw std::runtime_error("failed to atomically rename " + tmp.string() + " -> " + target.string() + ": " + ec.message());
    }
}

} // namespace stratforge::live::composer
