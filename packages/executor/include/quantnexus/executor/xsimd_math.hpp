/**
 * xsimd Math - Cross-Platform SIMD Indicator Calculations
 *
 * TICKET_470 Phase 2.1: Portable SIMD via xsimd
 *
 * Provides the same operations as simd_math.hpp but using xsimd
 * for cross-platform support (x86 AVX2/AVX-512 + ARM NEON + RISC-V RVV).
 *
 * When QNX_HAS_XSIMD is defined, the unified API in simd_math.hpp
 * can delegate to these implementations for ARM compatibility.
 *
 * modernc_quant.md references:
 * - #56 SIMD intrinsics (portable via xsimd)
 * - #40 std::span zero-copy views
 *
 * Source pattern: NexusFIX simd_scanner.hpp xsimd integration
 */

#pragma once

#include <span>
#include <cstddef>
#include <cmath>
#include <algorithm>

#if defined(QNX_HAS_XSIMD) && QNX_HAS_XSIMD
#include <xsimd/xsimd.hpp>
#define QNX_XSIMD_ENABLED 1
#else
#define QNX_XSIMD_ENABLED 0
#endif

namespace StratCraft::executor::xsimd_math {

#if QNX_XSIMD_ENABLED

// =============================================================================
// Architecture-aware batch type
// =============================================================================

using arch_t = xsimd::default_arch;
using batch_d = xsimd::batch<double, arch_t>;

inline constexpr size_t BATCH_SIZE = batch_d::size;

// =============================================================================
// Vectorized Sum
// =============================================================================

/**
 * Sum reduction using xsimd (auto-selects best SIMD for platform)
 */
[[nodiscard]] inline double sum(std::span<const double> data) noexcept {
    const size_t n = data.size();
    const double* ptr = data.data();

    batch_d vsum = batch_d(0.0);
    size_t i = 0;

    // Vectorized loop
    for (; i + BATCH_SIZE <= n; i += BATCH_SIZE) {
        auto chunk = xsimd::load_unaligned(ptr + i);
        vsum += chunk;
    }

    double result = xsimd::reduce_add(vsum);

    // Scalar remainder
    for (; i < n; ++i) {
        result += ptr[i];
    }

    return result;
}

// =============================================================================
// Vectorized Standard Deviation
// =============================================================================

[[nodiscard]] inline double stddev(std::span<const double> data) noexcept {
    if (data.empty()) return 0.0;

    const size_t n = data.size();
    const double* ptr = data.data();
    const double mean = sum(data) / static_cast<double>(n);

    batch_d vmean = batch_d(mean);
    batch_d vsumsq = batch_d(0.0);
    size_t i = 0;

    for (; i + BATCH_SIZE <= n; i += BATCH_SIZE) {
        auto chunk = xsimd::load_unaligned(ptr + i);
        auto diff = chunk - vmean;
        vsumsq = xsimd::fma(diff, diff, vsumsq);
    }

    double sumsq = xsimd::reduce_add(vsumsq);

    for (; i < n; ++i) {
        double diff = ptr[i] - mean;
        sumsq += diff * diff;
    }

    return std::sqrt(sumsq / static_cast<double>(n));
}

// =============================================================================
// Vectorized Dot Product
// =============================================================================

[[nodiscard]] inline double dot(
    std::span<const double> a,
    std::span<const double> b
) noexcept {
    const size_t n = std::min(a.size(), b.size());
    const double* pa = a.data();
    const double* pb = b.data();

    batch_d vsum = batch_d(0.0);
    size_t i = 0;

    for (; i + BATCH_SIZE <= n; i += BATCH_SIZE) {
        auto va = xsimd::load_unaligned(pa + i);
        auto vb = xsimd::load_unaligned(pb + i);
        vsum = xsimd::fma(va, vb, vsum);
    }

    double result = xsimd::reduce_add(vsum);

    for (; i < n; ++i) {
        result += pa[i] * pb[i];
    }

    return result;
}

// =============================================================================
// Vectorized Element-wise Operations
// =============================================================================

inline void add(
    std::span<const double> a,
    std::span<const double> b,
    std::span<double> out
) noexcept {
    const size_t n = std::min({a.size(), b.size(), out.size()});
    size_t i = 0;

    for (; i + BATCH_SIZE <= n; i += BATCH_SIZE) {
        auto va = xsimd::load_unaligned(a.data() + i);
        auto vb = xsimd::load_unaligned(b.data() + i);
        xsimd::store_unaligned(out.data() + i, va + vb);
    }

    for (; i < n; ++i) {
        out[i] = a[i] + b[i];
    }
}

inline void sub(
    std::span<const double> a,
    std::span<const double> b,
    std::span<double> out
) noexcept {
    const size_t n = std::min({a.size(), b.size(), out.size()});
    size_t i = 0;

    for (; i + BATCH_SIZE <= n; i += BATCH_SIZE) {
        auto va = xsimd::load_unaligned(a.data() + i);
        auto vb = xsimd::load_unaligned(b.data() + i);
        xsimd::store_unaligned(out.data() + i, va - vb);
    }

    for (; i < n; ++i) {
        out[i] = a[i] - b[i];
    }
}

inline void mul(
    std::span<const double> a,
    std::span<const double> b,
    std::span<double> out
) noexcept {
    const size_t n = std::min({a.size(), b.size(), out.size()});
    size_t i = 0;

    for (; i + BATCH_SIZE <= n; i += BATCH_SIZE) {
        auto va = xsimd::load_unaligned(a.data() + i);
        auto vb = xsimd::load_unaligned(b.data() + i);
        xsimd::store_unaligned(out.data() + i, va * vb);
    }

    for (; i < n; ++i) {
        out[i] = a[i] * b[i];
    }
}

// =============================================================================
// Vectorized Min/Max
// =============================================================================

inline void minmax(
    std::span<const double> data,
    double& outMin,
    double& outMax
) noexcept {
    if (data.empty()) {
        outMin = outMax = 0.0;
        return;
    }

    const size_t n = data.size();
    const double* ptr = data.data();

    batch_d vmin = batch_d(ptr[0]);
    batch_d vmax = batch_d(ptr[0]);
    size_t i = 0;

    for (; i + BATCH_SIZE <= n; i += BATCH_SIZE) {
        auto chunk = xsimd::load_unaligned(ptr + i);
        vmin = xsimd::min(vmin, chunk);
        vmax = xsimd::max(vmax, chunk);
    }

    // Reduce vector to scalar
    outMin = xsimd::reduce_min(vmin);
    outMax = xsimd::reduce_max(vmax);

    // Handle remainder
    for (; i < n; ++i) {
        outMin = std::min(outMin, ptr[i]);
        outMax = std::max(outMax, ptr[i]);
    }
}

// =============================================================================
// Vectorized Moving Average
// =============================================================================

inline void moving_average(
    std::span<const double> data,
    size_t period,
    std::span<double> out
) noexcept {
    const size_t n = data.size();
    if (n < period) return;

    const double invPeriod = 1.0 / static_cast<double>(period);

    // Initialize first MA value (scalar - dependency chain)
    double s = 0.0;
    for (size_t i = 0; i < period; ++i) {
        s += data[i];
    }
    out[period - 1] = s * invPeriod;

    // Rolling update (sequential due to data dependency)
    for (size_t i = period; i < n; ++i) {
        s = s + data[i] - data[i - period];
        out[i] = s * invPeriod;
    }
}

// =============================================================================
// Vectorized Scale (multiply by scalar)
// =============================================================================

inline void scale(
    std::span<const double> data,
    double scalar,
    std::span<double> out
) noexcept {
    const size_t n = std::min(data.size(), out.size());
    const double* ptr = data.data();
    batch_d vscalar = batch_d(scalar);
    size_t i = 0;

    for (; i + BATCH_SIZE <= n; i += BATCH_SIZE) {
        auto chunk = xsimd::load_unaligned(ptr + i);
        xsimd::store_unaligned(out.data() + i, chunk * vscalar);
    }

    for (; i < n; ++i) {
        out[i] = ptr[i] * scalar;
    }
}

#endif // QNX_XSIMD_ENABLED

// =============================================================================
// Compile-time SIMD info
// =============================================================================

/**
 * Get description of active SIMD architecture
 */
[[nodiscard]] inline const char* arch_name() noexcept {
#if QNX_XSIMD_ENABLED
    return xsimd::default_arch::name();
#elif defined(__AVX512F__)
    return "AVX-512 (intrinsics)";
#elif defined(__AVX2__)
    return "AVX2 (intrinsics)";
#elif defined(__ARM_NEON)
    return "NEON (no xsimd)";
#else
    return "Scalar";
#endif
}

} // namespace StratCraft::executor::xsimd_math
