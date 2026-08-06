/**
 * Strong Types - Compile-time Type Safety
 *
 * TICKET_175 Phase 5: Compile-time Optimization
 *
 * Provides strongly-typed wrappers for domain values:
 * - Price, Volume, Timestamp types prevent mixing
 * - Compile-time validation via consteval
 * - Zero runtime overhead (same as underlying type)
 *
 * Usage:
 *   Price p{100.50};
 *   Volume v{1000.0};
 *   // Price + Volume = compile error!
 *   auto total = p * v;  // OK: returns Money
 */

#pragma once

#include <cstdint>
#include <compare>
#include <concepts>
#include <limits>
#include <type_traits>
#include <string>
#include <string_view>
#include <charconv>
#include <stdexcept>

#ifdef _MSC_VER
#include <intrin.h>
#endif

namespace StratCraft::executor {

// =============================================================================
// Strong Type Base Template (modernc_quant #32)
// =============================================================================

/**
 * CRTP base for strong types with zero overhead
 */
template<typename T, typename Tag>
class StrongType {
public:
    using value_type = T;

    constexpr StrongType() noexcept : value_{} {}
    constexpr explicit StrongType(T value) noexcept : value_(value) {}

    [[nodiscard]] constexpr T value() const noexcept { return value_; }
    [[nodiscard]] constexpr T& value() noexcept { return value_; }

    // Comparison operators (C++20 spaceship)
    [[nodiscard]] constexpr auto operator<=>(const StrongType&) const noexcept = default;
    [[nodiscard]] constexpr bool operator==(const StrongType&) const noexcept = default;

protected:
    T value_;
};

// =============================================================================
// Domain Types
// =============================================================================

// Tags for type discrimination
struct PriceTag {};
struct VolumeTag {};
struct TimestampTag {};
struct QuantityTag {};
struct MoneyTag {};
struct PercentTag {};

/**
 * Price - monetary value per unit
 */
class Price : public StrongType<double, PriceTag> {
public:
    using StrongType::StrongType;

    // Arithmetic with same type
    [[nodiscard]] constexpr Price operator+(Price other) const noexcept {
        return Price{value_ + other.value_};
    }
    [[nodiscard]] constexpr Price operator-(Price other) const noexcept {
        return Price{value_ - other.value_};
    }
    [[nodiscard]] constexpr Price operator*(double scalar) const noexcept {
        return Price{value_ * scalar};
    }
    [[nodiscard]] constexpr Price operator/(double scalar) const noexcept {
        return Price{value_ / scalar};
    }

    // Price difference as percentage
    [[nodiscard]] constexpr double pctChange(Price base) const noexcept {
        return (value_ - base.value_) / base.value_ * 100.0;
    }
};

/**
 * Volume - trading volume (number of shares/contracts)
 */
class Volume : public StrongType<double, VolumeTag> {
public:
    using StrongType::StrongType;

    [[nodiscard]] constexpr Volume operator+(Volume other) const noexcept {
        return Volume{value_ + other.value_};
    }
    [[nodiscard]] constexpr Volume operator-(Volume other) const noexcept {
        return Volume{value_ - other.value_};
    }
    [[nodiscard]] constexpr Volume operator*(double scalar) const noexcept {
        return Volume{value_ * scalar};
    }
};

/**
 * Timestamp - milliseconds since epoch
 */
class Timestamp : public StrongType<int64_t, TimestampTag> {
public:
    using StrongType::StrongType;

    [[nodiscard]] constexpr Timestamp operator+(int64_t ms) const noexcept {
        return Timestamp{value_ + ms};
    }
    [[nodiscard]] constexpr Timestamp operator-(int64_t ms) const noexcept {
        return Timestamp{value_ - ms};
    }
    [[nodiscard]] constexpr int64_t operator-(Timestamp other) const noexcept {
        return value_ - other.value_;
    }

    // Time constants
    static constexpr int64_t SECOND = 1000;
    static constexpr int64_t MINUTE = 60 * SECOND;
    static constexpr int64_t HOUR = 60 * MINUTE;
    static constexpr int64_t DAY = 24 * HOUR;
};

/**
 * Quantity - position size (signed, can be negative for shorts)
 */
class Quantity : public StrongType<double, QuantityTag> {
public:
    using StrongType::StrongType;

    [[nodiscard]] constexpr Quantity operator+(Quantity other) const noexcept {
        return Quantity{value_ + other.value_};
    }
    [[nodiscard]] constexpr Quantity operator-(Quantity other) const noexcept {
        return Quantity{value_ - other.value_};
    }
    [[nodiscard]] constexpr Quantity operator-() const noexcept {
        return Quantity{-value_};
    }
    [[nodiscard]] constexpr bool isLong() const noexcept { return value_ > 0; }
    [[nodiscard]] constexpr bool isShort() const noexcept { return value_ < 0; }
    [[nodiscard]] constexpr bool isFlat() const noexcept { return value_ == 0; }
};

/**
 * Money - absolute monetary value (Price * Quantity)
 */
class Money : public StrongType<double, MoneyTag> {
public:
    using StrongType::StrongType;

    [[nodiscard]] constexpr Money operator+(Money other) const noexcept {
        return Money{value_ + other.value_};
    }
    [[nodiscard]] constexpr Money operator-(Money other) const noexcept {
        return Money{value_ - other.value_};
    }
    [[nodiscard]] constexpr Money operator*(double scalar) const noexcept {
        return Money{value_ * scalar};
    }
};

/**
 * Percent - percentage value (0-100 or ratio)
 */
class Percent : public StrongType<double, PercentTag> {
public:
    using StrongType::StrongType;

    [[nodiscard]] constexpr double asRatio() const noexcept { return value_ / 100.0; }
    [[nodiscard]] static constexpr Percent fromRatio(double r) noexcept {
        return Percent{r * 100.0};
    }
};

// =============================================================================
// FixedPrice - Fixed-Point Price Type (TICKET_473_3)
// =============================================================================

/**
 * Fixed-point price representation using int64_t with 8 decimal places.
 * Eliminates floating-point rounding errors in financial calculations.
 *
 * Internal representation: price * 10^8
 * Range: +/- 92,233,720,368.54775807 (sufficient for all asset classes)
 *
 */
class FixedPrice {
public:
    static constexpr int64_t SCALE = 100'000'000;  // 10^8
    static constexpr int DECIMALS = 8;

    constexpr FixedPrice() noexcept : raw_{0} {}
    constexpr explicit FixedPrice(int64_t raw) noexcept : raw_{raw} {}

    [[nodiscard]] constexpr int64_t raw() const noexcept { return raw_; }

    // --- Factory methods ---

    [[nodiscard]] static constexpr FixedPrice from_double(double value) noexcept {
        return FixedPrice{static_cast<int64_t>(value * static_cast<double>(SCALE))};
    }

    [[nodiscard]] constexpr double to_double() const noexcept {
        return static_cast<double>(raw_) / static_cast<double>(SCALE);
    }

    [[nodiscard]] static FixedPrice from_string(std::string_view str) {
        // Parse integer part
        int64_t integer_part = 0;
        int64_t frac_part = 0;
        bool negative = false;
        size_t pos = 0;

        if (!str.empty() && str[0] == '-') {
            negative = true;
            pos = 1;
        }

        // Integer part
        while (pos < str.size() && str[pos] != '.') {
            if (str[pos] < '0' || str[pos] > '9') {
                throw std::invalid_argument("Invalid FixedPrice string");
            }
            integer_part = integer_part * 10 + (str[pos] - '0');
            ++pos;
        }

        // Fractional part
        int frac_digits = 0;
        if (pos < str.size() && str[pos] == '.') {
            ++pos;
            while (pos < str.size() && frac_digits < DECIMALS) {
                if (str[pos] < '0' || str[pos] > '9') {
                    throw std::invalid_argument("Invalid FixedPrice string");
                }
                frac_part = frac_part * 10 + (str[pos] - '0');
                ++frac_digits;
                ++pos;
            }
        }

        // Pad remaining fractional digits
        for (int i = frac_digits; i < DECIMALS; ++i) {
            frac_part *= 10;
        }

        int64_t result = integer_part * SCALE + frac_part;
        return FixedPrice{negative ? -result : result};
    }

    // --- Comparison operators ---

    [[nodiscard]] constexpr auto operator<=>(const FixedPrice&) const noexcept = default;
    [[nodiscard]] constexpr bool operator==(const FixedPrice&) const noexcept = default;

    // --- Arithmetic with overflow protection ---

    [[nodiscard]] constexpr FixedPrice operator+(FixedPrice other) const noexcept {
        return FixedPrice{raw_ + other.raw_};
    }

    [[nodiscard]] constexpr FixedPrice operator-(FixedPrice other) const noexcept {
        return FixedPrice{raw_ - other.raw_};
    }

    [[nodiscard]] constexpr FixedPrice operator-() const noexcept {
        return FixedPrice{-raw_};
    }

    /**
     * Multiply two FixedPrice values (result scaled back to SCALE).
     * Uses the compiler's signed 128-bit arithmetic to prevent overflow during
     * intermediate multiplication.
     */
    [[nodiscard]] constexpr FixedPrice operator*(FixedPrice other) const noexcept {
#ifdef _MSC_VER
        std::int64_t high = 0;
        const auto low = static_cast<std::uint64_t>(_mul128(raw_, other.raw_, &high));
        std::int64_t remainder = 0;
        return FixedPrice{_div128(high, low, SCALE, &remainder)};
#else
        __int128 wide = static_cast<__int128>(raw_) * other.raw_;
        return FixedPrice{static_cast<int64_t>(wide / SCALE)};
#endif
    }

    /**
     * Divide two FixedPrice values.
     * Uses the compiler's signed 128-bit arithmetic to maintain precision
     * during intermediate scaling.
     */
    [[nodiscard]] constexpr FixedPrice operator/(FixedPrice other) const noexcept {
        if (other.raw_ == 0) return FixedPrice{0};  // Division by zero guard
#ifdef _MSC_VER
        std::int64_t high = 0;
        const auto low = static_cast<std::uint64_t>(_mul128(raw_, SCALE, &high));
        std::int64_t remainder = 0;
        return FixedPrice{_div128(high, low, other.raw_, &remainder)};
#else
        __int128 wide = static_cast<__int128>(raw_) * SCALE;
        return FixedPrice{static_cast<int64_t>(wide / other.raw_)};
#endif
    }

    // Scalar multiply/divide
    [[nodiscard]] constexpr FixedPrice operator*(int64_t scalar) const noexcept {
        return FixedPrice{raw_ * scalar};
    }

    [[nodiscard]] constexpr FixedPrice operator/(int64_t scalar) const noexcept {
        if (scalar == 0) return FixedPrice{0};
        return FixedPrice{raw_ / scalar};
    }

    // Compound assignment
    constexpr FixedPrice& operator+=(FixedPrice other) noexcept { raw_ += other.raw_; return *this; }
    constexpr FixedPrice& operator-=(FixedPrice other) noexcept { raw_ -= other.raw_; return *this; }

    // --- Utility ---

    [[nodiscard]] constexpr bool is_zero() const noexcept { return raw_ == 0; }
    [[nodiscard]] constexpr bool is_positive() const noexcept { return raw_ > 0; }
    [[nodiscard]] constexpr bool is_negative() const noexcept { return raw_ < 0; }

    [[nodiscard]] constexpr FixedPrice abs() const noexcept {
        return FixedPrice{raw_ < 0 ? -raw_ : raw_};
    }

private:
    int64_t raw_;  // value * 10^8
};

// FixedPrice size verification
static_assert(sizeof(FixedPrice) == sizeof(int64_t), "FixedPrice should be same size as int64_t");
static_assert(std::is_trivially_copyable_v<FixedPrice>, "FixedPrice should be trivially copyable");

// =============================================================================
// Cross-type Operations
// =============================================================================

/**
 * Price * Quantity = Money
 */
[[nodiscard]] constexpr Money operator*(Price p, Quantity q) noexcept {
    return Money{p.value() * q.value()};
}

[[nodiscard]] constexpr Money operator*(Quantity q, Price p) noexcept {
    return Money{p.value() * q.value()};
}

// =============================================================================
// Compile-time Validation (modernc_quant #1, #34)
// =============================================================================

/**
 * Validate price is positive (consteval for compile-time)
 */
consteval Price makePrice(double value) {
    if (value < 0) {
        throw "Price must be non-negative";
    }
    return Price{value};
}

/**
 * Validate volume is non-negative
 */
consteval Volume makeVolume(double value) {
    if (value < 0) {
        throw "Volume must be non-negative";
    }
    return Volume{value};
}

/**
 * Validate timestamp is positive
 */
consteval Timestamp makeTimestamp(int64_t value) {
    if (value < 0) {
        throw "Timestamp must be non-negative";
    }
    return Timestamp{value};
}

// =============================================================================
// Type Traits
// =============================================================================

template<typename T>
struct is_strong_type : std::false_type {};

template<typename T, typename Tag>
struct is_strong_type<StrongType<T, Tag>> : std::true_type {};

template<typename T>
inline constexpr bool is_strong_type_v = is_strong_type<T>::value;

// Concept for strong types
template<typename T>
concept StrongTypeConcept = requires(T t) {
    typename T::value_type;
    { t.value() } -> std::same_as<typename T::value_type>;
};

// =============================================================================
// Literals (User-defined literals for convenience)
// =============================================================================

namespace literals {

constexpr Price operator""_price(long double value) noexcept {
    return Price{static_cast<double>(value)};
}

constexpr Volume operator""_vol(long double value) noexcept {
    return Volume{static_cast<double>(value)};
}

constexpr Timestamp operator""_ms(unsigned long long value) noexcept {
    return Timestamp{static_cast<int64_t>(value)};
}

constexpr Percent operator""_pct(long double value) noexcept {
    return Percent{static_cast<double>(value)};
}

} // namespace literals

// =============================================================================
// Static Assertions (modernc_quant #95)
// =============================================================================

// Verify zero overhead - strong types should be same size as underlying
static_assert(sizeof(Price) == sizeof(double), "Price should have zero overhead");
static_assert(sizeof(Volume) == sizeof(double), "Volume should have zero overhead");
static_assert(sizeof(Timestamp) == sizeof(int64_t), "Timestamp should have zero overhead");
static_assert(sizeof(Quantity) == sizeof(double), "Quantity should have zero overhead");
static_assert(sizeof(Money) == sizeof(double), "Money should have zero overhead");

// Verify trivially copyable for performance
static_assert(std::is_trivially_copyable_v<Price>, "Price should be trivially copyable");
static_assert(std::is_trivially_copyable_v<Volume>, "Volume should be trivially copyable");
static_assert(std::is_trivially_copyable_v<Timestamp>, "Timestamp should be trivially copyable");

} // namespace StratCraft::executor
