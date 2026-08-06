/**
 * SBE Types - Fundamental types for Simple Binary Encoding
 *
 * TICKET_473_5: Zero-copy SBE binary types for IPC messages
 *
 * Provides:
 * - FixedString<N>: fixed-length, null-padded string
 * - DecimalPrice: fixed-point decimal (mantissa + exponent)
 * - SbeSide: compact enum for Buy/Sell
 * - SbeOrderType: compact enum for order types
 *
 * All types are trivially copyable and have deterministic layout
 * for direct memory-mapped access.
 *
 */

#pragma once

#include <cstdint>
#include <cstring>
#include <string_view>
#include <type_traits>

namespace StratCraft::executor::sbe {

// =============================================================================
// FixedString<N> - Fixed-length null-padded string
// =============================================================================

/**
 * Fixed-length string for SBE fields.
 * Always occupies exactly N bytes. Unused bytes are zero-filled.
 * No heap allocation, trivially copyable.
 */
template<size_t N>
struct FixedString {
    static_assert(N > 0, "FixedString size must be > 0");

    char data[N]{};

    FixedString() noexcept = default;

    explicit FixedString(std::string_view str) noexcept {
        const size_t copy_len = (str.size() < N) ? str.size() : N;
        std::memcpy(data, str.data(), copy_len);
        if (copy_len < N) {
            std::memset(data + copy_len, 0, N - copy_len);
        }
    }

    /// Get as string_view (trims trailing nulls)
    [[nodiscard]] std::string_view view() const noexcept {
        size_t len = 0;
        while (len < N && data[len] != '\0') ++len;
        return std::string_view{data, len};
    }

    /// Fixed capacity
    [[nodiscard]] static constexpr size_t capacity() noexcept { return N; }

    /// Actual string length (excluding trailing nulls)
    [[nodiscard]] size_t length() const noexcept {
        size_t len = 0;
        while (len < N && data[len] != '\0') ++len;
        return len;
    }

    [[nodiscard]] bool operator==(const FixedString& other) const noexcept {
        return std::memcmp(data, other.data, N) == 0;
    }
};

// =============================================================================
// DecimalPrice - Fixed-point decimal for SBE
// =============================================================================

/**
 * Fixed-point decimal representation.
 * mantissa * 10^exponent
 *
 * Example: 150.25 -> mantissa=15025, exponent=-2
 * Compact 12-byte representation for wire format.
 */
struct DecimalPrice {
    int64_t mantissa{0};
    int8_t exponent{-8};   // Default: 8 decimal places (same as FixedPrice)
    char padding_[3]{};     // Align to 12 bytes

    DecimalPrice() noexcept = default;

    constexpr DecimalPrice(int64_t m, int8_t e) noexcept
        : mantissa{m}, exponent{e} {}

    /// Create from double with specified decimal places
    [[nodiscard]] static DecimalPrice from_double(double value, int8_t decimals = -8) noexcept {
        int64_t scale = 1;
        int8_t abs_dec = (decimals < 0) ? static_cast<int8_t>(-decimals) : decimals;
        for (int8_t i = 0; i < abs_dec; ++i) scale *= 10;
        return DecimalPrice{static_cast<int64_t>(value * static_cast<double>(scale)), decimals};
    }

    /// Convert to double
    [[nodiscard]] double to_double() const noexcept {
        double scale = 1.0;
        int8_t abs_exp = (exponent < 0) ? static_cast<int8_t>(-exponent) : exponent;
        for (int8_t i = 0; i < abs_exp; ++i) scale *= 10.0;
        return (exponent < 0)
            ? static_cast<double>(mantissa) / scale
            : static_cast<double>(mantissa) * scale;
    }
};

// =============================================================================
// Enums
// =============================================================================

/// Trade side (1 byte)
enum class SbeSide : uint8_t {
    Buy = 0,
    Sell = 1,
    NullVal = 255
};

/// Order type (1 byte)
enum class SbeOrderType : uint8_t {
    Market = 0,
    Limit = 1,
    Stop = 2,
    StopLimit = 3,
    NullVal = 255
};

/// Backtest status (1 byte)
enum class SbeBacktestStatus : uint8_t {
    Pending = 0,
    Running = 1,
    Completed = 2,
    Failed = 3,
    Cancelled = 4,
    NullVal = 255
};

// =============================================================================
// Static Assertions
// =============================================================================

static_assert(std::is_trivially_copyable_v<FixedString<32>>,
              "FixedString must be trivially copyable");
static_assert(sizeof(FixedString<32>) == 32,
              "FixedString<32> must be exactly 32 bytes");

static_assert(std::is_trivially_copyable_v<DecimalPrice>,
              "DecimalPrice must be trivially copyable");
static_assert(sizeof(DecimalPrice) == 12,
              "DecimalPrice must be 12 bytes");

static_assert(sizeof(SbeSide) == 1, "SbeSide must be 1 byte");
static_assert(sizeof(SbeOrderType) == 1, "SbeOrderType must be 1 byte");
static_assert(sizeof(SbeBacktestStatus) == 1, "SbeBacktestStatus must be 1 byte");

} // namespace StratCraft::executor::sbe
