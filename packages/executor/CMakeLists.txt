cmake_minimum_required(VERSION 3.20)
project(StratCraft-executor VERSION 0.1.0 LANGUAGES CXX)

# =============================================================================
# C++ Standard (Same as core-engine)
# =============================================================================
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# =============================================================================
# Build Options
# =============================================================================
option(BUILD_SHARED_LIBS "Build shared libraries" OFF)
option(EXECUTOR_BUILD_TESTS "Build tests" ON)
option(EXECUTOR_STATIC_LINK "Static link runtime" ON)
option(EXECUTOR_ENABLE_LTO "Enable Link-Time Optimization" ON)
option(EXECUTOR_NATIVE_ARCH "Enable -march=native for target CPU" ON)
option(EXECUTOR_USE_LIBCXX "Use LLVM libc++ when compiling with Clang" OFF)

if(WIN32)
    add_compile_definitions(NOMINMAX WIN32_LEAN_AND_MEAN)
endif()

# =============================================================================
# Compiler Flags
# =============================================================================
if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU" OR CMAKE_CXX_COMPILER_ID STREQUAL "Clang")
    add_compile_options(-Wall -Wextra -Wpedantic)
    if(EXECUTOR_USE_LIBCXX)
        if(NOT CMAKE_CXX_COMPILER_ID STREQUAL "Clang")
            message(FATAL_ERROR "EXECUTOR_USE_LIBCXX requires Clang")
        endif()
        add_compile_options(-stdlib=libc++)
        add_link_options(-stdlib=libc++)
    endif()
    if(EXECUTOR_NATIVE_ARCH)
        add_compile_options(-march=native)
    endif()
    if(EXECUTOR_STATIC_LINK AND NOT EXECUTOR_USE_LIBCXX)
        add_link_options(-static-libgcc -static-libstdc++)
    endif()
elseif(CMAKE_CXX_COMPILER_ID STREQUAL "MSVC")
    add_compile_options(/W4 /permissive-)
    if(EXECUTOR_STATIC_LINK)
        set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
    endif()
endif()

# =============================================================================
# Link-Time Optimization (TICKET_470)
# =============================================================================
if(EXECUTOR_ENABLE_LTO)
    include(CheckIPOSupported)
    check_ipo_supported(RESULT lto_supported OUTPUT lto_output)
    if(lto_supported)
        set(CMAKE_INTERPROCEDURAL_OPTIMIZATION TRUE)
    else()
        message(STATUS "LTO not supported: ${lto_output}")
    endif()
endif()

# =============================================================================
# vcpkg Integration
# =============================================================================
if(DEFINED ENV{VCPKG_ROOT} AND NOT DEFINED CMAKE_TOOLCHAIN_FILE)
    set(CMAKE_TOOLCHAIN_FILE "$ENV{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake"
        CACHE STRING "Vcpkg toolchain file")
endif()

# =============================================================================
# Dependencies
# =============================================================================
include(FetchContent)

find_package(Arrow CONFIG REQUIRED)
find_package(Parquet CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)

# Arrow exports either static or shared imported targets according to the
# vcpkg triplet. Keep Arrow and Parquet on that same authoritative linkage
# choice instead of assuming the Unix static target also exists on Windows.
if(ARROW_BUILD_STATIC)
    set(EXECUTOR_ARROW_TARGET Arrow::arrow_static)
    set(EXECUTOR_PARQUET_TARGET Parquet::parquet_static)
else()
    set(EXECUTOR_ARROW_TARGET Arrow::arrow_shared)
    set(EXECUTOR_PARQUET_TARGET Parquet::parquet_shared)
endif()

foreach(dependency_target IN ITEMS ${EXECUTOR_ARROW_TARGET} ${EXECUTOR_PARQUET_TARGET})
    if(NOT TARGET ${dependency_target})
        message(FATAL_ERROR
            "Arrow/Parquet linkage contract selected ${dependency_target}, but the package did not export it")
    endif()
endforeach()

# TICKET_1330_2 F4: Abseil is OPTIONAL by design -- EXECUTOR_ENABLE_ABSEIL
# defaults OFF, hash_map.hpp has a real std::unordered_map fallback behind
# QNX_HAS_ABSEIL, the link is conditional on HAS_ABSEIL, and the benchmark suite
# compares both containers. It was nevertheless ALSO declared REQUIRED here and
# linked unconditionally below, so the file carried two contradictory contracts
# for the same library and a build without absl failed at configure time despite
# having a working fallback. The optional contract is the correct one; the probe
# lives with EXECUTOR_ENABLE_ABSEIL further down.

if(EXECUTOR_BUILD_TESTS)
    # APT Catch2 is compiled with libstdc++, which causes ABI mismatch when
    # EXECUTOR_USE_LIBCXX=ON (libc++). Always build from source to guarantee
    # ABI compatibility with the project's stdlib choice (TICKET_734).
    FetchContent_Declare(
        Catch2
        GIT_REPOSITORY https://github.com/catchorg/Catch2.git
        GIT_TAG        v3.7.1
        GIT_SHALLOW    TRUE
    )
    FetchContent_MakeAvailable(Catch2)

    # TICKET_1330_2: JSON-Schema validation is used by exactly one target --
    # tests/test_evaluation_contract.cpp, the only file in the tracked tree that
    # includes <nlohmann/json-schema.hpp>. It was previously declared REQUIRED at
    # top level and linked unconditionally into the core library, which made a
    # test-only need a hard requirement for EVERY consumer configuration. That
    # permanently broke the benchmark workflow: it builds from apt system
    # packages (TICKET_733) and no Ubuntu repository ships this library, so
    # configure died at find_package on all 40 recorded runs.
    #
    # Prefer a config package when one is available (the vcpkg path provides it
    # via vcpkg.json), and fall back to FetchContent so a tests-on build also
    # succeeds on a system-package runner. Same idiom as Catch2 above.
    find_package(nlohmann_json_schema_validator CONFIG QUIET)
    if(NOT nlohmann_json_schema_validator_FOUND)
        message(STATUS "json-schema-validator: not found as a package, building from source")
        set(JSON_VALIDATOR_INSTALL OFF CACHE BOOL "" FORCE)
        set(JSON_VALIDATOR_BUILD_TESTS OFF CACHE BOOL "" FORCE)
        set(JSON_VALIDATOR_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
        FetchContent_Declare(
            nlohmann_json_schema_validator
            GIT_REPOSITORY https://github.com/pboettch/json-schema-validator.git
            GIT_TAG        2.3.0
            GIT_SHALLOW    TRUE
        )
        FetchContent_MakeAvailable(nlohmann_json_schema_validator)
    else()
        message(STATUS "json-schema-validator: FOUND as a config package")
    endif()
endif()

# =============================================================================
# nonabt Engine (TICKET_630 Phase 1.1)
# =============================================================================
set(SF_BUILD_TESTS OFF CACHE BOOL "Disable stratforge tests for executor integration" FORCE)
set(SF_BUILD_EXAMPLES OFF CACHE BOOL "Disable stratforge examples for executor integration" FORCE)
set(SF_BUILD_BENCHMARKS OFF CACHE BOOL "Disable stratforge benchmarks for executor integration" FORCE)
set(SF_BUILD_RUNNER OFF CACHE BOOL "Disable stratforge runner for executor integration" FORCE)

FetchContent_Declare(nonabt
    GIT_REPOSITORY https://github.com/StratCraftsAI/StratForge.git
    # TICKET_895 Step 1: bumped to Ichimoku forward-write fix
    # (upstream nonabackTrader 979e000, public sync 755f490).
    # Eliminates infinite loop in Ichimoku::sync_cursors under per-bar
    # factor_eval kernel model. Also includes TICKET_SF009 Alpha191+JKP.
    # Prior pin: 08679e1 (TICKET_789_1 [INCREMENT_V2] wire-shape fix).
    GIT_TAG 755f4903920f632abdd62fdc1167ec42f020a5df
)


FetchContent_MakeAvailable(nonabt)

# =============================================================================
# Optional Dependencies (TICKET_470)
# =============================================================================
option(EXECUTOR_ENABLE_XSIMD "Enable xsimd cross-platform SIMD" OFF)
option(EXECUTOR_ENABLE_MIMALLOC "Enable mimalloc per-session allocator" OFF)
option(EXECUTOR_ENABLE_QUILL "Enable Quill async logging" OFF)
option(EXECUTOR_ENABLE_ABSEIL "Enable Abseil Swiss Tables" OFF)

if(EXECUTOR_ENABLE_XSIMD)
    find_package(xsimd CONFIG QUIET)
    if(xsimd_FOUND)
        message(STATUS "xsimd: FOUND - Cross-platform SIMD enabled")
        set(HAS_XSIMD TRUE)
    else()
        message(STATUS "xsimd: NOT FOUND - Using platform intrinsics only")
        set(HAS_XSIMD FALSE)
    endif()
endif()

if(EXECUTOR_ENABLE_MIMALLOC)
    find_package(mimalloc CONFIG QUIET)
    if(mimalloc_FOUND)
        message(STATUS "mimalloc: FOUND - Per-session allocator enabled")
        set(HAS_MIMALLOC TRUE)
    else()
        message(STATUS "mimalloc: NOT FOUND - Using default allocator")
        set(HAS_MIMALLOC FALSE)
    endif()
endif()

if(EXECUTOR_ENABLE_QUILL)
    find_package(quill CONFIG QUIET)
    if(quill_FOUND)
        message(STATUS "Quill: FOUND - Async logging enabled")
        set(HAS_QUILL TRUE)
    else()
        message(STATUS "Quill: NOT FOUND - Using default logging")
        set(HAS_QUILL FALSE)
    endif()
endif()

if(EXECUTOR_ENABLE_ABSEIL)
    find_package(absl CONFIG QUIET)
    if(absl_FOUND)
        message(STATUS "Abseil: FOUND - Swiss Tables enabled")
        set(HAS_ABSEIL TRUE)
    else()
        message(STATUS "Abseil: NOT FOUND - Using std::unordered_map")
        set(HAS_ABSEIL FALSE)
    endif()
endif()

# =============================================================================
# Executor Core Library
# =============================================================================
set(EXECUTOR_CORE_SOURCES
    src/evaluation_contract.cpp
    src/data_plane/eval_parquet.cpp
    src/data_plane/ohlcv_data_plane.cpp
    src/executor_core.cpp
    src/cpp_backtest_plugin.cpp
    src/plugin_loader.cpp
    src/data_source/mock_data_source.cpp
    src/data_source/parquet_data_source.cpp
    src/live/live_engine_plugin.cpp
    src/strategy_admission/strategy_admission.cpp
)

add_library(StratCraft_executor_core STATIC ${EXECUTOR_CORE_SOURCES})
add_library(StratCraft_executor ALIAS StratCraft_executor_core)

target_include_directories(StratCraft_executor_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)
target_link_libraries(StratCraft_executor_core PUBLIC
    ${EXECUTOR_ARROW_TARGET}
    ${EXECUTOR_PARQUET_TARGET}
    nlohmann_json::nlohmann_json
    stratforge
    ${CMAKE_DL_LIBS}
)
# TICKET_1330_2 F4: absl::flat_hash_map / absl::hash are linked conditionally
# under `if(HAS_ABSEIL)` below, matching the optional contract. Linking them here
# unconditionally made EXECUTOR_ENABLE_ABSEIL=OFF builds fail to link a library
# they were never configured to need.
# TICKET_1330_2: nlohmann_json_schema_validator::validator deliberately NOT
# linked here. No core source includes <nlohmann/json-schema.hpp> --
# src/evaluation_contract.cpp validates by hand with plain nlohmann/json (see
# its required-key set and explicit schema_version comparison). It is linked on
# test_evaluation_contract, the single target that actually uses it.
# TICKET_470: Optional dependency linking
if(HAS_XSIMD)
    target_link_libraries(StratCraft_executor_core PUBLIC xsimd)
    target_compile_definitions(StratCraft_executor_core PUBLIC QNX_HAS_XSIMD=1)
endif()

if(HAS_MIMALLOC)
    target_link_libraries(StratCraft_executor_core PUBLIC mimalloc-static)
    target_compile_definitions(StratCraft_executor_core PUBLIC QNX_HAS_MIMALLOC=1)
endif()

if(HAS_QUILL)
    target_link_libraries(StratCraft_executor_core PUBLIC quill::quill)
    target_compile_definitions(StratCraft_executor_core PUBLIC QNX_HAS_QUILL=1)
endif()

if(HAS_ABSEIL)
    target_link_libraries(StratCraft_executor_core PUBLIC absl::flat_hash_map absl::hash)
    target_compile_definitions(StratCraft_executor_core PUBLIC QNX_HAS_ABSEIL=1)
endif()

# =============================================================================
# Main Executable
# =============================================================================
add_executable(StratCraft-executor src/main.cpp)
target_link_libraries(StratCraft-executor PRIVATE StratCraft_executor)

# =============================================================================
# stratforge-live-composer (TICKET_794 Phase 1)
# =============================================================================
# Reads a JSON describing a saved 3-component strategy (analysis + entry +
# optional exit), emits a single C++ translation unit, compiles to .so
# exporting the qnx_live V2 ABI. Standalone binary -- only links
# nlohmann_json so the build is fast and the artifact small.
set(LIVE_COMPOSER_EMBED_HDR "${CMAKE_CURRENT_BINARY_DIR}/composer_templates_embed.hpp")
set(LIVE_COMPOSER_LIVE_TPL "${CMAKE_CURRENT_SOURCE_DIR}/../builder-templates/templates/live.cpp.template")
set(LIVE_COMPOSER_COMPOSED_TPL "${CMAKE_CURRENT_SOURCE_DIR}/../builder-templates/templates/live_composed.cpp.template")
set(LIVE_COMPOSER_INDICATORS_DIR "${nonabt_SOURCE_DIR}/include/stratforge/indicators")
get_target_property(_LIVE_COMPOSER_NLOHMANN_INC nlohmann_json::nlohmann_json INTERFACE_INCLUDE_DIRECTORIES)
list(GET _LIVE_COMPOSER_NLOHMANN_INC 0 LIVE_COMPOSER_NLOHMANN_JSON_INC)
set(LIVE_COMPOSER_STRATFORGE_INC_DIRS "${nonabt_SOURCE_DIR}/include")

add_custom_command(
    OUTPUT "${LIVE_COMPOSER_EMBED_HDR}"
    COMMAND ${CMAKE_COMMAND}
        -D "OUT=${LIVE_COMPOSER_EMBED_HDR}"
        -D "LIVE_TPL=${LIVE_COMPOSER_LIVE_TPL}"
        -D "LIVE_COMPOSED_TPL=${LIVE_COMPOSER_COMPOSED_TPL}"
        -D "INDICATORS_DIR=${LIVE_COMPOSER_INDICATORS_DIR}"
        -D "NLOHMANN_JSON_INC=${LIVE_COMPOSER_NLOHMANN_JSON_INC}"
        -D "STRATFORGE_INC_DIRS=${LIVE_COMPOSER_STRATFORGE_INC_DIRS}"
        -P "${CMAKE_CURRENT_SOURCE_DIR}/cmake/generate_composer_embed.cmake"
    DEPENDS
        "${LIVE_COMPOSER_LIVE_TPL}"
        "${LIVE_COMPOSER_COMPOSED_TPL}"
        "${CMAKE_CURRENT_SOURCE_DIR}/cmake/generate_composer_embed.cmake"
    COMMENT "Generating composer_templates_embed.hpp"
    VERBATIM)

add_custom_target(generate_composer_embed
    DEPENDS "${LIVE_COMPOSER_EMBED_HDR}")

add_executable(stratforge-live-composer
    src/live/composer/main.cpp
    src/live/composer/composer.cpp
    src/live/composer/source_emitter.cpp
    src/live/composer/cache.cpp
    "${LIVE_COMPOSER_EMBED_HDR}")
add_dependencies(stratforge-live-composer generate_composer_embed)
target_include_directories(stratforge-live-composer PRIVATE
    "${CMAKE_CURRENT_BINARY_DIR}"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/live/composer")
target_link_libraries(stratforge-live-composer PRIVATE
    nlohmann_json::nlohmann_json)
# TICKET_1125 Phase 5: strategy .so -march=native gate follows the same
# switch as the executor library build.
target_compile_definitions(stratforge-live-composer PRIVATE
    QNX_COMPOSER_NATIVE_ARCH=$<IF:$<BOOL:${EXECUTOR_NATIVE_ARCH}>,1,0>)


# =============================================================================
# Benchmarks/
# =============================================================================
option(EXECUTOR_BUILD_BENCHMARKS "Build benchmark framework" OFF)

if(EXECUTOR_BUILD_BENCHMARKS)
    add_subdirectory(benchmark)
endif()

# =============================================================================
# Tests
# =============================================================================
if(EXECUTOR_BUILD_TESTS)
    enable_testing()

    add_test(NAME test_executor_rejects_commercial_command
        COMMAND ${CMAKE_COMMAND}
            -DEXECUTABLE=$<TARGET_FILE:StratCraft-executor>
            -DARGUMENT=--stationarity=commercial-worker-only
            -DEXPECTED=QNX_EXECUTOR_ARGUMENT_INVALID
            -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/assert_cli_rejected.cmake)

    add_executable(test_evaluation_contract tests/test_evaluation_contract.cpp)
    # TICKET_1330_2: the only consumer of <nlohmann/json-schema.hpp>, so the
    # validator is linked here rather than into the core library.
    target_link_libraries(test_evaluation_contract
        PRIVATE StratCraft_executor Catch2::Catch2WithMain
        nlohmann_json_schema_validator::validator)
    target_compile_definitions(test_evaluation_contract PRIVATE
        QNX_SOURCE_ROOT="${CMAKE_CURRENT_SOURCE_DIR}/../..")
    add_test(NAME test_evaluation_contract COMMAND test_evaluation_contract)
    add_test(NAME test_evaluation_contract_cli_info
        COMMAND $<TARGET_FILE:StratCraft-executor> --contract-info)
    set_tests_properties(test_evaluation_contract_cli_info PROPERTIES
        PASS_REGULAR_EXPRESSION "qnx.evaluation-envelope/1.0.0")
    add_test(NAME test_evaluation_contract_cli_valid
        COMMAND $<TARGET_FILE:StratCraft-executor>
            --validate-evaluation-envelope=${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/evaluation_envelope_v1.json)
    set_tests_properties(test_evaluation_contract_cli_valid PROPERTIES
        PASS_REGULAR_EXPRESSION "phase1-golden-completed")
    add_test(NAME test_evaluation_contract_cli_invalid
        COMMAND $<TARGET_FILE:StratCraft-executor>
            --validate-evaluation-envelope=${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/evaluation_parity_cases_v1.json)
    set_tests_properties(test_evaluation_contract_cli_invalid PROPERTIES
        WILL_FAIL TRUE)

    # TICKET_1292 Phase 5 5A (MC-09): C++/Clang strategy-admission owner.
    # Golden parity covers prohibited constructs, syntax failures, ABI exports,
    # warnings, source locations, cancellation, and missing-compiler. The suite
    # discovers a clang++ from PATH (QNX_ADMISSION_CLANG env override) so the
    # compile/warning/ABI stages exercise a real compiler; source-only checks run
    # unconditionally. Fixtures were captured from the retained Python owner
    # (cpp_strategy_code_integrity.py) to pin the CV*/CR* rule parity.
    add_executable(test_strategy_admission tests/strategy_admission/test_strategy_admission.cpp)
    target_link_libraries(test_strategy_admission
        PRIVATE StratCraft_executor Catch2::Catch2WithMain ${CMAKE_DL_LIBS})
    target_compile_definitions(test_strategy_admission PRIVATE
        QNX_SOURCE_ROOT="${CMAKE_CURRENT_SOURCE_DIR}/../..")
    add_test(NAME test_strategy_admission COMMAND test_strategy_admission)
    # Packaged-command boundary: the --strategy-admission subcommand emits the
    # versioned admission envelope on stdout (exit 0). The CLI fixture is a valid
    # source with the ABI factory macro; source-only checks admit it (no
    # compilerPath => compile stages skipped, compilerAvailable stays true).
    add_test(NAME test_strategy_admission_cli
        COMMAND $<TARGET_FILE:StratCraft-executor>
            --strategy-admission=${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/strategy_admission_cli_input.json)
    set_tests_properties(test_strategy_admission_cli PROPERTIES
        PASS_REGULAR_EXPRESSION "\"admitted\":true.*\"diagnosticVersion\":1")

    # TICKET_1292 Phase 5 5B (MC-11): pure planning-geometry owner parity.
    # Golden parity covers CV sizing (requiredPullBars/planPaths/checkRefusal)
    # captured from the TS cv-sizing-contract.ts and embargo derivation captured
    # from the Python embargo module, plus exhaustive boundary asserts (integer
    # limits, thin data, window endpoints, snapshot projection, error paths,
    # cross-layer agreement). Header-only owner; links only for Catch2.
    add_executable(test_planning_geometry tests/planning_geometry/test_planning_geometry.cpp)
    target_link_libraries(test_planning_geometry
        PRIVATE StratCraft_executor Catch2::Catch2WithMain)
    target_compile_definitions(test_planning_geometry PRIVATE
        QNX_SOURCE_ROOT="${CMAKE_CURRENT_SOURCE_DIR}/../..")
    add_test(NAME test_planning_geometry COMMAND test_planning_geometry)
    # Packaged-command boundary: the --planning-geometry subcommand emits the
    # versioned plan on stdout (exit 0). The CLI fixture is a required_pull_bars
    # request; the response carries the version and the sized threshold.
    add_test(NAME test_planning_geometry_cli
        COMMAND $<TARGET_FILE:StratCraft-executor>
            --planning-geometry=${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/planning_geometry_cli_input.json)
    set_tests_properties(test_planning_geometry_cli PROPERTIES
        PASS_REGULAR_EXPRESSION "\"requiredPullBars\":.*\"version\":1")

    # TICKET_1292_10 Phase 6 (MC-10): C++ resource-governance owner parity.
    # Golden parity covers the swap-pressure classifier (pipeline-resource-
    # profile.ts), the admission hysteresis state machine (resource_gate.py), the
    # per-cell RSS budget + degrade->abort ladder (resource_watchdog.py /
    # RssSentinel), and the cgroup cap->limit derivation (cgroup-fence.sh),
    # captured into resource_governance_parity_v1.json from the live Python
    # engines. Header-only owner; links only for Catch2.
    add_executable(test_resource_governance tests/signal/test_resource_governance.cpp)
    target_link_libraries(test_resource_governance
        PRIVATE StratCraft_executor Catch2::Catch2WithMain)
    target_compile_definitions(test_resource_governance PRIVATE
        QNX_SOURCE_ROOT="${CMAKE_CURRENT_SOURCE_DIR}/../..")
    add_test(NAME test_resource_governance COMMAND test_resource_governance)
    # Packaged-command boundary: the --resource-governance subcommand emits the
    # versioned decision on stdout (exit 0). The CLI fixture is a capacity
    # request; the response carries the cgroup limits + the version.
    add_test(NAME test_resource_governance_cli
        COMMAND $<TARGET_FILE:StratCraft-executor>
            --resource-governance=${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/resource_governance_cli_input.json)
    set_tests_properties(test_resource_governance_cli PROPERTIES
        PASS_REGULAR_EXPRESSION "\"cgroupMemoryMaxGib\":.*\"version\":1")

    # TICKET_1292_12 Phase 6 (MC-12): C++ sweep-scheduler owner. Golden fixture
    # covers the plan_batch state machine (non-ASHA pool + retry re-dispatch;
    # ASHA rung0 -> barrier rank -> rung1), the retry classifier
    # (fit_one.py/_classify_error), and the resume/arm-skip fingerprint gate
    # (TICKET_1289). The ASHA ranking is a byte-for-byte port of
    # asha-screening.ts; direct TEST_CASEs assert the comparator / floor /
    # guard-bar traps. Header-only owner; links only for Catch2.
    add_executable(test_scheduler tests/signal/test_scheduler.cpp)
    target_link_libraries(test_scheduler
        PRIVATE StratCraft_executor Catch2::Catch2WithMain)
    target_compile_definitions(test_scheduler PRIVATE
        QNX_SOURCE_ROOT="${CMAKE_CURRENT_SOURCE_DIR}/../..")
    add_test(NAME test_scheduler COMMAND test_scheduler)
    # Packaged-command boundary: the --scheduler subcommand emits the versioned
    # plan on stdout (exit 0). The CLI fixture is a fresh ASHA batch; the
    # response carries phase=rung0 + the version.
    add_test(NAME test_scheduler_cli
        COMMAND $<TARGET_FILE:StratCraft-executor>
            --scheduler=${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/scheduler_cli_input.json)
    set_tests_properties(test_scheduler_cli PROPERTIES
        PASS_REGULAR_EXPRESSION "\"phase\":\"rung0\".*\"version\":1")

    # TICKET_1292_15 Phase 5 5C (MC-15): C++ code-version owner parity. Golden
    # parity covers the Tool Sweep cache-key code_version (TICKET_815) for every
    # registered template -- the per-template first-party source-file closure
    # (static Python-import scan) + SHA-256 aggregation over the closure and the
    # runtime lockfile -- captured into code_version_parity_v1.json from the live
    # Python authority (code_version.py). Replaces the last deterministic Python
    # helper subprocess on the sweep-dispatch launch path. Header-only owner;
    # links only for Catch2. QNX_SOURCE_ROOT lets the test resolve
    # packages/nona-algorithm as the packageParent.
    add_executable(test_code_version tests/code_version/test_code_version.cpp)
    target_link_libraries(test_code_version
        PRIVATE StratCraft_executor Catch2::Catch2WithMain)
    target_compile_definitions(test_code_version PRIVATE
        QNX_SOURCE_ROOT="${CMAKE_CURRENT_SOURCE_DIR}/../..")
    add_test(NAME test_code_version COMMAND test_code_version)
    # The CLI fixture carries a machine-specific absolute packageParent, so
    # generate it at configure time from the resolved source root.
    file(WRITE ${CMAKE_CURRENT_BINARY_DIR}/code_version_cli_input.json
        "{\"version\":1,\"templateId\":\"hmm_regime_v1\",\"packageParent\":\"${CMAKE_CURRENT_SOURCE_DIR}/../nona-algorithm\"}")
    # Packaged-command boundary: the --code-version subcommand emits the versioned
    # envelope on stdout (exit 0). The CLI fixture is an hmm_regime_v1 request
    # against the real package tree; the response carries the 64-hex code_version
    # and the version.
    add_test(NAME test_code_version_cli
        COMMAND $<TARGET_FILE:StratCraft-executor>
            --code-version=${CMAKE_CURRENT_BINARY_DIR}/code_version_cli_input.json)
    set_tests_properties(test_code_version_cli PROPERTIES
        PASS_REGULAR_EXPRESSION "\"codeVersion\":.*\"version\":1")

    add_executable(test_data_source tests/test_data_source.cpp)
    target_link_libraries(test_data_source PRIVATE StratCraft_executor Catch2::Catch2WithMain)
    add_test(NAME test_data_source COMMAND test_data_source)

    add_executable(test_eval_parquet_data_plane
        tests/data_plane/test_eval_parquet.cpp)
    target_link_libraries(test_eval_parquet_data_plane
        PRIVATE StratCraft_executor Catch2::Catch2WithMain)
    add_test(NAME test_eval_parquet_data_plane
        COMMAND test_eval_parquet_data_plane)

    add_executable(test_ohlcv_data_plane
        tests/data_plane/test_ohlcv_data_plane.cpp)
    target_link_libraries(test_ohlcv_data_plane
        PRIVATE StratCraft_executor Catch2::Catch2WithMain)
    add_test(NAME test_ohlcv_data_plane
        COMMAND test_ohlcv_data_plane)
    file(WRITE ${CMAKE_CURRENT_BINARY_DIR}/ohlcv_data_plane_cli_input.json
        "{\"version\":\"qnx.ohlcv-data-plane/1.0.0\",\"decisionId\":\"cmake-cli-smoke\",\"operation\":\"canonicalize\",\"inputs\":[],\"window\":{\"startMs\":0,\"endMs\":1},\"outputPath\":\"${CMAKE_CURRENT_BINARY_DIR}/ohlcv_data_plane_cli_output.parquet\"}")
    add_test(NAME test_ohlcv_data_plane_cli
        COMMAND $<TARGET_FILE:StratCraft-executor>
            --ohlcv-data-plane=${CMAKE_CURRENT_BINARY_DIR}/ohlcv_data_plane_cli_input.json)
    set_tests_properties(test_ohlcv_data_plane_cli PROPERTIES
        PASS_REGULAR_EXPRESSION
            "\"decisionId\":\"cmake-cli-smoke\".*\"rowCount\":0.*\"status\":\"ok\"")

    add_executable(test_executor_core tests/test_executor_core.cpp)
    target_link_libraries(test_executor_core PRIVATE StratCraft_executor Catch2::Catch2WithMain)
    add_test(NAME test_executor_core COMMAND test_executor_core)

    add_executable(test_indicators tests/test_indicators.cpp)
    target_link_libraries(test_indicators PRIVATE StratCraft_executor Catch2::Catch2WithMain)
    add_test(NAME test_indicators COMMAND test_indicators)

    # TICKET_794 Phase 1 -- stratforge-live-composer end-to-end gate.
    # Invokes the composer binary as a subprocess (its public contract),
    # dlopens the produced .so, asserts the V2 ABI export set + signal
    # generation on a 100-bar uptrend, and re-composes to verify .cpp
    # determinism for the cache layer (sec 7).
    add_executable(test_composer
        tests/live/composer/test_composer.cpp)
    target_link_libraries(test_composer
        PRIVATE Catch2::Catch2WithMain ${CMAKE_DL_LIBS})
    add_dependencies(test_composer stratforge-live-composer)
    target_compile_definitions(test_composer PRIVATE
        QNX_LIVE_COMPOSER_BIN="$<TARGET_FILE:stratforge-live-composer>"
        QNX_LIVE_COMPOSER_FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests/live/composer/fixtures")
    add_test(NAME test_composer COMMAND test_composer)

    # TICKET_794 Phase 2 -- correctness gate harness.
    # test_parity is the C++ half: it composes the .so and replays a bar CSV
    # to a JSONL signal stream. It's invoked indirectly via
    # tools/scripts/live_parity_diff.py (test_composer_parity), which also
    # runs the develop-branch Python live_runner against the same CSV and
    # diffs the two streams per sec 8 step 3.
    add_executable(test_parity
        tests/live/composer/test_parity.cpp)
    target_link_libraries(test_parity
        PRIVATE Catch2::Catch2WithMain ${CMAKE_DL_LIBS})
    add_dependencies(test_parity stratforge-live-composer)
    target_compile_definitions(test_parity PRIVATE
        QNX_LIVE_COMPOSER_BIN="$<TARGET_FILE:stratforge-live-composer>")

    # Phase 2 gate driver. Self-skips when the OKX bar CSV is missing so
    # CI on machines without the fixture is "gate pending", not failure.
    # Run `python3 tools/scripts/capture_okx_btc_usdt_1m_10d.py` once to
    # populate the CSV, then this gate becomes blocking.
    add_test(NAME test_composer_parity
        COMMAND ${Python3_EXECUTABLE}
            "${CMAKE_SOURCE_DIR}/../../tools/scripts/live_parity_diff.py"
            --cpp-test-bin    "$<TARGET_FILE:test_parity>"
            --cpp-fixture     "${CMAKE_CURRENT_SOURCE_DIR}/tests/live/composer/fixtures/sma_3comp.json"
            --py-fixture      "${CMAKE_CURRENT_SOURCE_DIR}/tests/live/composer/fixtures/sma_3comp_python.json"
            --bar-csv         "${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/live_replay/btc_usdt_1m_10d.csv"
            --tick            1.0
            --skip-if-csv-missing)
    set_tests_properties(test_composer_parity PROPERTIES
        WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}/../..")

endif()

# =============================================================================
# Install
# =============================================================================
install(TARGETS StratCraft-executor
    RUNTIME DESTINATION bin
)

install(DIRECTORY include/quantnexus
    DESTINATION include
)

# =============================================================================
# Summary
# =============================================================================
message(STATUS "")
message(STATUS "StratCraft Executor Configuration:")
message(STATUS "  C++ Standard:     ${CMAKE_CXX_STANDARD}")
message(STATUS "  Build Type:       ${CMAKE_BUILD_TYPE}")
message(STATUS "  Static Link:      ${EXECUTOR_STATIC_LINK}")
message(STATUS "  Use libc++:       ${EXECUTOR_USE_LIBCXX}")
message(STATUS "  Build Tests:      ${EXECUTOR_BUILD_TESTS}")
message(STATUS "  LTO:              ${CMAKE_INTERPROCEDURAL_OPTIMIZATION}")
message(STATUS "  Native Arch:      ${EXECUTOR_NATIVE_ARCH}")
message(STATUS "  xsimd:            ${HAS_XSIMD}")
message(STATUS "  mimalloc:         ${HAS_MIMALLOC}")
message(STATUS "  Quill:            ${HAS_QUILL}")
message(STATUS "  Abseil:           ${HAS_ABSEIL}")
message(STATUS "")
