/**
 * AVX-512 SIMD Operations
 *
 * TICKET_175 Phase 11: AVX-512 (Server Only)
 *
 * Provides AVX-512 vectorized operations for server deployment:
 * - 512-bit vectors (8 doubles per operation)
 * - Masked operations for conditional SIMD
 * - Runtime detection and fallback
 *
 * modernc_quant.md references:
 * - #56 SIMD intrinsics (AVX-512 extension)
 *
 * NOTE: AVX-512 is only available on:
 * - Intel Skylake-X and later (i9-7900X+)
 * - Intel Xeon Scalable (server)
 * - AMD Zen 4 and later
 */

#pragma once

#include <cstddef>
#include <cstdint>
#include <cmath>
#include <algorithm>

#include "executor_constants.hpp"
#include "hardware_constants.hpp"

// CPUID for runtime feature detection
#if defined(__GNUC__) || defined(__clang__)
#include <cpuid.h>
#endif

// AVX-512 detection
#if defined(__AVX512F__) && defined(__AVX512DQ__)
#include <immintrin.h>
#define QNX_HAS_AVX512 1
#else
#define QNX_HAS_AVX512 0
#endif

// AVX2 fallback
#if defined(__AVX2__)
#include <immintrin.h>
#define QNX_HAS_AVX2 1
#else
#define QNX_HAS_AVX2 0
#endif

namespace StratCraft::executor::simd {

// =============================================================================
// Runtime CPU Feature Detection
// =============================================================================

/**
 * Check if CPU supports AVX-512F at runtime
 */
[[nodiscard]] inline bool cpu_has_avx512() noexcept {
#if defined(__GNUC__) || defined(__clang__)
    #if QNX_HAS_AVX512
        // Compile-time check passed, but verify at runtime
        unsigned int eax, ebx, ecx, edx;
        if (__get_cpuid_count(7, 0, &eax, &ebx, &ecx, &edx)) {
            return (ebx & (1 << constants::CPUID_AVX512F_BIT)) != 0;
        }
    #endif
#endif
    return false;
}

/**
 * Check if CPU supports AVX2 at runtime
 */
[[nodiscard]] inline bool cpu_has_avx2() noexcept {
#if defined(__GNUC__) || defined(__clang__)
    #if QNX_HAS_AVX2
        unsigned int eax, ebx, ecx, edx;
        if (__get_cpuid_count(7, 0, &eax, &ebx, &ecx, &edx)) {
            return (ebx & (1 << constants::CPUID_AVX2_BIT)) != 0;
        }
    #endif
#endif
    return false;
}

// TICKET_476: SIMD constants centralized in hardware_constants.hpp
using StratCraft::executor::constants::AVX512_DOUBLE_WIDTH;
using StratCraft::executor::constants::PREFETCH_DISTANCE_512;

// =============================================================================
// AVX-512 Operations
// =============================================================================

#if QNX_HAS_AVX512

namespace avx512 {

/**
 * Horizontal sum of 512-bit vector
 */
[[nodiscard]] inline double hsum_pd(__m512d v) noexcept {
    // Reduce 512 -> 256 -> 128 -> scalar
    __m256d low = _mm512_castpd512_pd256(v);
    __m256d high = _mm512_extractf64x4_pd(v, 1);
    __m256d sum256 = _mm256_add_pd(low, high);

    __m128d low128 = _mm256_castpd256_pd128(sum256);
    __m128d high128 = _mm256_extractf128_pd(sum256, 1);
    __m128d sum128 = _mm_add_pd(low128, high128);

    __m128d high64 = _mm_unpackhi_pd(sum128, sum128);
    return _mm_cvtsd_f64(_mm_add_sd(sum128, high64));
}

/**
 * Vectorized sum (8 doubles per iteration)
 */
[[nodiscard]] inline double sum(const double* data, size_t n) noexcept {
    __m512d vsum = _mm512_setzero_pd();
    size_t i = 0;

    // Main loop: 8 doubles at a time
    for (; i + 7 < n; i += 8) {
        __m512d v = _mm512_loadu_pd(data + i);
        vsum = _mm512_add_pd(vsum, v);
    }

    double result = hsum_pd(vsum);

    // Scalar remainder
    for (; i < n; ++i) {
        result += data[i];
    }

    return result;
}

/**
 * Vectorized element-wise addition
 */
inline void add(
    const double* __restrict a,
    const double* __restrict b,
    size_t n,
    double* __restrict out
) noexcept {
    size_t i = 0;

    for (; i + 7 < n; i += 8) {
        __m512d va = _mm512_loadu_pd(a + i);
        __m512d vb = _mm512_loadu_pd(b + i);
        __m512d vr = _mm512_add_pd(va, vb);
        _mm512_storeu_pd(out + i, vr);
    }

    // Scalar remainder
    for (; i < n; ++i) {
        out[i] = a[i] + b[i];
    }
}

/**
 * Vectorized element-wise multiplication
 */
inline void mul(
    const double* __restrict a,
    const double* __restrict b,
    size_t n,
    double* __restrict out
) noexcept {
    size_t i = 0;

    for (; i + 7 < n; i += 8) {
        __m512d va = _mm512_loadu_pd(a + i);
        __m512d vb = _mm512_loadu_pd(b + i);
        __m512d vr = _mm512_mul_pd(va, vb);
        _mm512_storeu_pd(out + i, vr);
    }

    for (; i < n; ++i) {
        out[i] = a[i] * b[i];
    }
}

/**
 * Vectorized FMA: out = a * b + c
 */
inline void fma(
    const double* __restrict a,
    const double* __restrict b,
    const double* __restrict c,
    size_t n,
    double* __restrict out
) noexcept {
    size_t i = 0;

    for (; i + 7 < n; i += 8) {
        __m512d va = _mm512_loadu_pd(a + i);
        __m512d vb = _mm512_loadu_pd(b + i);
        __m512d vc = _mm512_loadu_pd(c + i);
        __m512d vr = _mm512_fmadd_pd(va, vb, vc);
        _mm512_storeu_pd(out + i, vr);
    }

    for (; i < n; ++i) {
        out[i] = a[i] * b[i] + c[i];
    }
}

/**
 * Vectorized dot product
 */
[[nodiscard]] inline double dot(
    const double* __restrict a,
    const double* __restrict b,
    size_t n
) noexcept {
    __m512d vsum = _mm512_setzero_pd();
    size_t i = 0;

    for (; i + 7 < n; i += 8) {
        __m512d va = _mm512_loadu_pd(a + i);
        __m512d vb = _mm512_loadu_pd(b + i);
        vsum = _mm512_fmadd_pd(va, vb, vsum);
    }

    double result = hsum_pd(vsum);

    for (; i < n; ++i) {
        result += a[i] * b[i];
    }

    return result;
}

/**
 * Vectorized min/max with mask
 */
inline void minmax(
    const double* data,
    size_t n,
    double& outMin,
    double& outMax
) noexcept {
    if (n == 0) {
        outMin = outMax = 0.0;
        return;
    }

    __m512d vmin = _mm512_set1_pd(data[0]);
    __m512d vmax = vmin;
    size_t i = 0;

    for (; i + 7 < n; i += 8) {
        __m512d v = _mm512_loadu_pd(data + i);
        vmin = _mm512_min_pd(vmin, v);
        vmax = _mm512_max_pd(vmax, v);
    }

    // Reduce to scalar
    outMin = _mm512_reduce_min_pd(vmin);
    outMax = _mm512_reduce_max_pd(vmax);

    // Handle remainder
    for (; i < n; ++i) {
        outMin = std::min(outMin, data[i]);
        outMax = std::max(outMax, data[i]);
    }
}

/**
 * Vectorized standard deviation
 */
[[nodiscard]] inline double stddev(const double* data, size_t n) noexcept {
    if (n == 0) return 0.0;

    double mean = sum(data, n) / static_cast<double>(n);
    __m512d vmean = _mm512_set1_pd(mean);
    __m512d vsumsq = _mm512_setzero_pd();
    size_t i = 0;

    for (; i + 7 < n; i += 8) {
        __m512d v = _mm512_loadu_pd(data + i);
        __m512d diff = _mm512_sub_pd(v, vmean);
        vsumsq = _mm512_fmadd_pd(diff, diff, vsumsq);
    }

    double sumsq = hsum_pd(vsumsq);

    for (; i < n; ++i) {
        double diff = data[i] - mean;
        sumsq += diff * diff;
    }

    return std::sqrt(sumsq / static_cast<double>(n));
}

/**
 * Masked conditional copy
 * Copies elements where mask is true
 */
inline void masked_copy(
    const double* src,
    double* dst,
    const bool* mask,
    size_t n
) noexcept {
    size_t i = 0;

    for (; i + 7 < n; i += 8) {
        // Build mask from bool array
        __mmask8 k = 0;
        for (int j = 0; j < 8; ++j) {
            if (mask[i + j]) k |= (1 << j);
        }

        __m512d vsrc = _mm512_loadu_pd(src + i);
        __m512d vdst = _mm512_loadu_pd(dst + i);
        __m512d vr = _mm512_mask_blend_pd(k, vdst, vsrc);
        _mm512_storeu_pd(dst + i, vr);
    }

    // Scalar remainder
    for (; i < n; ++i) {
        if (mask[i]) dst[i] = src[i];
    }
}

} // namespace avx512

#endif // QNX_HAS_AVX512

// =============================================================================
// Runtime Dispatch
// =============================================================================

/**
 * SIMD capability level
 */
enum class SimdLevel {
    Scalar,
    AVX2,
    AVX512
};

/**
 * Get best available SIMD level
 */
[[nodiscard]] inline SimdLevel get_simd_level() noexcept {
#if QNX_HAS_AVX512
    if (cpu_has_avx512()) return SimdLevel::AVX512;
#endif
#if QNX_HAS_AVX2
    if (cpu_has_avx2()) return SimdLevel::AVX2;
#endif
    return SimdLevel::Scalar;
}

/**
 * Get SIMD level name
 */
[[nodiscard]] inline const char* simd_level_name(SimdLevel level) noexcept {
    switch (level) {
        case SimdLevel::AVX512: return "AVX-512";
        case SimdLevel::AVX2: return "AVX2";
        case SimdLevel::Scalar: return "Scalar";
        default: return "Unknown";
    }
}

/**
 * Auto-dispatch sum based on CPU capability
 */
[[nodiscard]] inline double auto_sum(const double* data, size_t n) noexcept {
    static const SimdLevel level = get_simd_level();

    switch (level) {
#if QNX_HAS_AVX512
        case SimdLevel::AVX512:
            return avx512::sum(data, n);
#endif
#if QNX_HAS_AVX2
        case SimdLevel::AVX2:
            return avx2::sum(data, n);
#endif
        default: {
            double sum = 0.0;
            for (size_t i = 0; i < n; ++i) sum += data[i];
            return sum;
        }
    }
}

/**
 * Auto-dispatch stddev based on CPU capability
 */
[[nodiscard]] inline double auto_stddev(const double* data, size_t n) noexcept {
    static const SimdLevel level = get_simd_level();

    switch (level) {
#if QNX_HAS_AVX512
        case SimdLevel::AVX512:
            return avx512::stddev(data, n);
#endif
#if QNX_HAS_AVX2
        case SimdLevel::AVX2:
            return avx2::stddev(data, n);
#endif
        default: {
            if (n == 0) return 0.0;
            double mean = 0.0;
            for (size_t i = 0; i < n; ++i) mean += data[i];
            mean /= n;
            double sumsq = 0.0;
            for (size_t i = 0; i < n; ++i) {
                double diff = data[i] - mean;
                sumsq += diff * diff;
            }
            return std::sqrt(sumsq / n);
        }
    }
}

} // namespace StratCraft::executor::simd
