#!/bin/bash
# TICKET_681 Phase 3: Build stratforge-runner (single binary executor)
# TICKET_177: Executor vcpkg Auto-Detection
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
NONABT_DIR="$ROOT_DIR/../nonabackTrader"
BUILD_DIR="${NONABT_DIR}/build-parquet"
BUILD_TYPE="${BUILD_TYPE:-Release}"
BUILD_MODE="${1:-all}"
EXECUTOR_BENCHMARKS="${EXECUTOR_BUILD_BENCHMARKS:-OFF}"

if [ "$BUILD_MODE" != "all" ] && [ "$BUILD_MODE" != "--package" ]; then
    echo "ERROR: Unknown build mode: $BUILD_MODE"
    echo "Usage: ./build.sh [--package]"
    exit 1
fi

if [ "$EXECUTOR_BENCHMARKS" != "ON" ] && [ "$EXECUTOR_BENCHMARKS" != "OFF" ]; then
    echo "ERROR: EXECUTOR_BUILD_BENCHMARKS must be ON or OFF"
    exit 1
fi

echo "==================================="
echo "stratforge-runner Build Script"
echo "  (TICKET_681: single binary executor)"
echo "==================================="
echo "Build Type: ${BUILD_TYPE}"
echo "Build Dir:  ${BUILD_DIR}"
echo ""

# TICKET_1371 R5: prefer Ninja for faster incremental builds.
CMAKE_GENERATOR_ARGS=()
if command -v ninja &>/dev/null; then
    CMAKE_GENERATOR_ARGS+=(-G Ninja)
    echo "CMake generator: Ninja"
else
    echo "CMake generator: default (Makefiles)"
fi

# Auto-migrate a build directory from Make to Ninja (or vice-versa).
# CMake cannot change generator in-place; the build dir must be cleared.
migrate_cmake_generator() {
    local build_dir="$1"
    local cache_file="$build_dir/CMakeCache.txt"
    [ -f "$cache_file" ] || return 0
    if [ ${#CMAKE_GENERATOR_ARGS[@]} -gt 0 ]; then
        if grep -q 'CMAKE_MAKE_PROGRAM:FILEPATH=.*/g\?make' "$cache_file" 2>/dev/null; then
            echo "Migrating $build_dir from Make to Ninja (clearing CMake cache)..."
            rm -rf "$build_dir"
            mkdir -p "$build_dir"
        fi
    else
        if grep -q 'CMAKE_MAKE_PROGRAM:FILEPATH=.*/ninja' "$cache_file" 2>/dev/null; then
            echo "Migrating $build_dir from Ninja to Make (clearing CMake cache)..."
            rm -rf "$build_dir"
            mkdir -p "$build_dir"
        fi
    fi
}

# The packaged build consumes the pinned public StratForge source declared by
# packages/executor/CMakeLists.txt. The default developer build retains the
# adjacent checkout so local V3 runner work uses the current source tree.
if [ "$BUILD_MODE" = "all" ] && [ ! -f "$NONABT_DIR/CMakeLists.txt" ]; then
    echo "ERROR: nonabackTrader not found at: $NONABT_DIR"
    echo "Clone it: git clone git@github-silverstreams:StratCraftsAI/nonabackTrader.git $NONABT_DIR"
    exit 1
fi

# TICKET_177: Auto-detect vcpkg (consistent with core-engine/build.sh)
case "$(uname -s)" in
    Linux*) PLATFORM_TRIPLET="${VCPKG_DEFAULT_TRIPLET:-x64-linux}" ;;
    Darwin*)
        if [ "$(uname -m)" = "arm64" ]; then
            PLATFORM_TRIPLET="${VCPKG_DEFAULT_TRIPLET:-arm64-osx}"
        else
            PLATFORM_TRIPLET="${VCPKG_DEFAULT_TRIPLET:-x64-osx}"
        fi
        ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM_TRIPLET="${VCPKG_DEFAULT_TRIPLET:-x64-windows}" ;;
    *)
        echo "ERROR: Unsupported build platform: $(uname -s)"
        exit 1
        ;;
esac

if command -v cygpath >/dev/null 2>&1 && [ -n "${VCPKG_ROOT:-}" ]; then
    VCPKG_ROOT="$(cygpath -u "$VCPKG_ROOT")"
    export VCPKG_ROOT
fi

# TICKET_1330_1: Release-only dependency builds. vcpkg's built-in triplets build
# every port twice (Debug + Release); nothing here links the Debug half, but it
# cost 4.1 GB of a 4.6 GB vcpkg_installed tree and exhausted the CI runner disk
# (`No space left on device` in .debug_info after 88 min). The overlay triplets
# in vcpkg-triplets/ shadow the built-in ones by name -- so PLATFORM_TRIPLET is
# unchanged -- and add VCPKG_BUILD_TYPE release. Exported (not just passed to
# cmake) so nested vcpkg manifest installs triggered by the nonabackTrader
# build see the same overlay. Set here, in the shared build script, so CI and
# local builds resolve dependencies identically.
VCPKG_OVERLAY_TRIPLETS="$SCRIPT_DIR/vcpkg-triplets"
export VCPKG_OVERLAY_TRIPLETS

VCPKG_INSTALLED_ROOT="$SCRIPT_DIR/vcpkg_installed"
LOCAL_VCPKG_INSTALLED="$VCPKG_INSTALLED_ROOT/$PLATFORM_TRIPLET"
USE_LOCAL_VCPKG=0
VCPKG_TOOLCHAIN=""

# Prefer the vcpkg toolchain whenever it is available, including after a
# partially populated install tree was restored from CI cache. Manifest mode
# can resume and validate that tree; treating it as a plain CMAKE_PREFIX_PATH
# would incorrectly assume every required package is already complete.
if [ -z "${VCPKG_ROOT:-}" ]; then
    # Try common locations.
    if [ -d "/opt/vcpkg" ]; then
        export VCPKG_ROOT="/opt/vcpkg"
    elif [ -d "$HOME/vcpkg" ]; then
        export VCPKG_ROOT="$HOME/vcpkg"
    fi
fi

if [ -n "${VCPKG_ROOT:-}" ]; then
    VCPKG_TOOLCHAIN="${VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake"
fi

if [ -n "$VCPKG_TOOLCHAIN" ] && [ -f "$VCPKG_TOOLCHAIN" ]; then
    echo "Using vcpkg: ${VCPKG_ROOT}"
elif [ -d "$LOCAL_VCPKG_INSTALLED" ]; then
    echo "Using preinstalled vcpkg packages without a toolchain: $LOCAL_VCPKG_INSTALLED"
    USE_LOCAL_VCPKG=1
    VCPKG_TOOLCHAIN=""
else
    if [ -n "$VCPKG_TOOLCHAIN" ]; then
        echo "ERROR: vcpkg toolchain not found at: $VCPKG_TOOLCHAIN"
    else
        echo "ERROR: VCPKG_ROOT not set and vcpkg not found"
        echo "Searched: /opt/vcpkg, \$HOME/vcpkg"
    fi
    echo "No complete preinstalled package tree exists at: $LOCAL_VCPKG_INSTALLED"
    exit 1
fi
echo ""

if [ "$BUILD_MODE" = "all" ]; then
    mkdir -p "${BUILD_DIR}"
    migrate_cmake_generator "${BUILD_DIR}"
    cd "${BUILD_DIR}"

    echo "Configuring stratforge-runner with Parquet support..."
    CMAKE_ARGS=(
        "${CMAKE_GENERATOR_ARGS[@]}"
        -DCMAKE_BUILD_TYPE="${BUILD_TYPE}"
        -DSF_BUILD_RUNNER=ON
        -DSF_ENABLE_PARQUET=ON
        -DSF_BUILD_TESTS=OFF
        -DSF_BUILD_EXAMPLES=OFF
        -DSF_BUILD_BENCHMARKS=OFF
    )

    if [ "$USE_LOCAL_VCPKG" -eq 1 ]; then
        CMAKE_ARGS+=(-DCMAKE_PREFIX_PATH="${LOCAL_VCPKG_INSTALLED}")
    elif [ -n "$VCPKG_TOOLCHAIN" ]; then
        # TICKET_1330_1: overlay triplets + explicit triplet, so the
        # Release-only definition applies to manifest-mode installs.
        #
        # VCPKG_MANIFEST_FEATURES=parquet is load-bearing: nonabackTrader's
        # vcpkg.json declares no unconditional dependencies and puts `arrow`
        # behind the `parquet` feature. Without the feature the manifest
        # install resolves to the empty set ("All requested packages are
        # currently installed"), find_package(Arrow) misses, and
        # runner/CMakeLists.txt aborts on SF_ENABLE_PARQUET=ON. The feature
        # must therefore track the -DSF_ENABLE_PARQUET=ON above.
        #
        # VCPKG_INSTALLED_DIR pins the runner to the same install root the
        # executor library below already uses. Two roots meant the runner's
        # copy lived inside BUILD_DIR, so migrate_cmake_generator's `rm -rf`
        # deleted the dependency tree along with the CMake cache.
        CMAKE_ARGS+=(
            -DCMAKE_TOOLCHAIN_FILE="${VCPKG_TOOLCHAIN}"
            -DVCPKG_OVERLAY_TRIPLETS="${VCPKG_OVERLAY_TRIPLETS}"
            -DVCPKG_TARGET_TRIPLET="${PLATFORM_TRIPLET}"
            -DVCPKG_INSTALLED_DIR="${VCPKG_INSTALLED_ROOT}"
            -DVCPKG_MANIFEST_FEATURES="parquet"
        )
    fi

    cmake "$NONABT_DIR" "${CMAKE_ARGS[@]}"

    echo ""
    echo "Building stratforge-runner..."
    cmake --build . --parallel
fi

echo ""
echo "Build complete!"

# Also build the StratCraft executor library (for benchmarks/tests)
EXECUTOR_BUILD_DIR="${SCRIPT_DIR}/build"
if [ -f "${SCRIPT_DIR}/CMakeLists.txt" ]; then
    echo ""
    echo "Building StratCraft executor library (benchmarks/tests)..."
    mkdir -p "${EXECUTOR_BUILD_DIR}"
    migrate_cmake_generator "${EXECUTOR_BUILD_DIR}"
    cd "${EXECUTOR_BUILD_DIR}"

    EXECUTOR_TESTS=ON
    if [ "$BUILD_MODE" = "--package" ]; then
        EXECUTOR_TESTS=OFF
    fi

    EXEC_CMAKE_ARGS=(
        "${CMAKE_GENERATOR_ARGS[@]}"
        -DCMAKE_BUILD_TYPE="${BUILD_TYPE}"
        -DEXECUTOR_BUILD_TESTS="${EXECUTOR_TESTS}"
        -DEXECUTOR_BUILD_BENCHMARKS="${EXECUTOR_BENCHMARKS}"
    )

    if [ "$BUILD_MODE" = "all" ]; then
        EXEC_CMAKE_ARGS+=(-DFETCHCONTENT_SOURCE_DIR_NONABT="${NONABT_DIR}")
    fi

    if [ "$USE_LOCAL_VCPKG" -eq 1 ]; then
        EXEC_CMAKE_ARGS+=(-DCMAKE_PREFIX_PATH="${LOCAL_VCPKG_INSTALLED}")
    elif [ -n "$VCPKG_TOOLCHAIN" ]; then
        # TICKET_1330_1: see the stratforge-runner configure above.
        # TICKET_1330 follow-up: this is also the single install/cache root. Passing it
        # explicitly keeps cold installs, partial-cache resumes, warm builds,
        # workflow restore/save, and disk evidence on the same directory.
        EXEC_CMAKE_ARGS+=(
            -DCMAKE_TOOLCHAIN_FILE="${VCPKG_TOOLCHAIN}"
            -DVCPKG_OVERLAY_TRIPLETS="${VCPKG_OVERLAY_TRIPLETS}"
            -DVCPKG_TARGET_TRIPLET="${PLATFORM_TRIPLET}"
            -DVCPKG_INSTALLED_DIR="${VCPKG_INSTALLED_ROOT}"
        )
    fi

    cmake "${SCRIPT_DIR}" "${EXEC_CMAKE_ARGS[@]}"
    cmake --build . --parallel

fi

echo ""
echo "Binaries:"
if [ "$BUILD_MODE" = "all" ]; then
    echo "  ${BUILD_DIR}/runner/stratforge-runner"
fi
if [ -f "${EXECUTOR_BUILD_DIR}/StratCraft-executor" ]; then
    echo "  ${EXECUTOR_BUILD_DIR}/StratCraft-executor (open foundation)"
fi
if [ -f "${EXECUTOR_BUILD_DIR}/test_data_source" ]; then
    echo "  ${EXECUTOR_BUILD_DIR}/test_data_source"
fi
if [ -f "${EXECUTOR_BUILD_DIR}/test_executor_core" ]; then
    echo "  ${EXECUTOR_BUILD_DIR}/test_executor_core"
fi
