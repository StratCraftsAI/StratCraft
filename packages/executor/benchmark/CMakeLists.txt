# =============================================================================
# StratCraft Executor Benchmark Framework
# Reference: TICKET_174 - C++ Executor Benchmark Framework
# =============================================================================

cmake_minimum_required(VERSION 3.20)

# =============================================================================
# Options
# =============================================================================
option(BENCHMARK_ENABLE_PERF "Enable Linux perf_event counters" ON)
option(BENCHMARK_ENABLE_GIL_TEST "Enable Python GIL latency tests (TICKET_681: disabled, pybind11 removed)" OFF)
option(BENCHMARK_TRACK_ALLOCATIONS "Enable allocation tracking" OFF)
option(BENCHMARK_ENABLE_ABSEIL "Enable Abseil flat_hash_map benchmark" ON)

# =============================================================================
# Optional: Abseil for Swiss Tables benchmark (TICKET_216)
# =============================================================================
if(BENCHMARK_ENABLE_ABSEIL)
    find_package(absl CONFIG QUIET)
    if(absl_FOUND)
        message(STATUS "Abseil: FOUND - Swiss Tables benchmark enabled")
        set(HAS_ABSEIL TRUE)
    else()
        message(STATUS "Abseil: NOT FOUND - Using std::unordered_map only")
        set(HAS_ABSEIL FALSE)
    endif()
endif()

# =============================================================================
# Benchmark Library (Header-only utilities)
# =============================================================================
add_library(qnx_bench_utils INTERFACE)
target_include_directories(qnx_bench_utils INTERFACE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)
target_compile_features(qnx_bench_utils INTERFACE cxx_std_23)

if(BENCHMARK_TRACK_ALLOCATIONS)
    target_compile_definitions(qnx_bench_utils INTERFACE QNX_BENCH_TRACK_ALLOCATIONS)
endif()

# =============================================================================
# Phase 2: Core Benchmarks
# =============================================================================

# Data Loading Benchmark
add_executable(bench_data_loading src/bench_data_loading.cpp)
target_link_libraries(bench_data_loading PRIVATE
    StratCraft_executor
    qnx_bench_utils
)
target_compile_options(bench_data_loading PRIVATE
    -O3 -march=native -fno-omit-frame-pointer
)

# Execution Benchmark
add_executable(bench_execution src/bench_execution.cpp)
target_link_libraries(bench_execution PRIVATE
    StratCraft_executor
    qnx_bench_utils
)
target_compile_options(bench_execution PRIVATE
    -O3 -march=native -fno-omit-frame-pointer
)

# Serialization Benchmark
add_executable(bench_serialization src/bench_serialization.cpp)
target_link_libraries(bench_serialization PRIVATE
    StratCraft_executor
    qnx_bench_utils
)
target_compile_options(bench_serialization PRIVATE
    -O3 -march=native -fno-omit-frame-pointer
)

# =============================================================================
# Phase 3: Advanced Benchmarks
# =============================================================================

# Cache Contention Benchmark
add_executable(bench_cache_contention src/bench_cache_contention.cpp)
target_link_libraries(bench_cache_contention PRIVATE
    StratCraft_executor
    qnx_bench_utils
)
target_compile_options(bench_cache_contention PRIVATE
    -O3 -march=native -fno-omit-frame-pointer
)

# Data Sensitivity Benchmark
add_executable(bench_data_sensitivity src/bench_data_sensitivity.cpp)
target_link_libraries(bench_data_sensitivity PRIVATE
    StratCraft_executor
    qnx_bench_utils
)
target_compile_options(bench_data_sensitivity PRIVATE
    -O3 -march=native -fno-omit-frame-pointer
)

# TICKET_681: GIL Latency Benchmark removed (pybind11 no longer available)

# Prefetch Benchmark
add_executable(bench_prefetch src/bench_prefetch.cpp)
target_link_libraries(bench_prefetch PRIVATE
    StratCraft_executor
    qnx_bench_utils
)
target_compile_options(bench_prefetch PRIVATE
    -O3 -march=native -fno-omit-frame-pointer
)

# Memory Pool Benchmark (TICKET_175 Phase 2)
add_executable(bench_memory_pool src/bench_memory_pool.cpp)
target_link_libraries(bench_memory_pool PRIVATE
    StratCraft_executor
    qnx_bench_utils
)
target_compile_options(bench_memory_pool PRIVATE
    -O3 -march=native -fno-omit-frame-pointer
)

# SIMD Benchmark (TICKET_175 Phase 6)
add_executable(bench_simd src/bench_simd.cpp)
target_link_libraries(bench_simd PRIVATE
    StratCraft_executor
    qnx_bench_utils
)
target_compile_options(bench_simd PRIVATE
    -O3 -march=native -mavx2 -fno-omit-frame-pointer
)

# Lock-free Benchmark (TICKET_175 Phase 7)
add_executable(bench_lockfree src/bench_lockfree.cpp)
target_link_libraries(bench_lockfree PRIVATE
    StratCraft_executor
    qnx_bench_utils
)
target_compile_options(bench_lockfree PRIVATE
    -O3 -march=native -fno-omit-frame-pointer
)
target_link_libraries(bench_lockfree PRIVATE pthread)

# Hash Map Benchmark (TICKET_216 Phase 3 - Abseil Swiss Tables)
add_executable(bench_hash_map src/bench_hash_map.cpp)
target_link_libraries(bench_hash_map PRIVATE
    StratCraft_executor
    qnx_bench_utils
)
target_compile_options(bench_hash_map PRIVATE
    -O3 -march=native -fno-omit-frame-pointer
)
if(HAS_ABSEIL)
    target_link_libraries(bench_hash_map PRIVATE
        absl::flat_hash_map
        absl::hash
    )
    target_compile_definitions(bench_hash_map PRIVATE HAS_ABSEIL=1)
endif()

# =============================================================================
# Phase 4: Unified CLI Runner
# =============================================================================
add_executable(qnx-executor-bench src/bench_runner.cpp)
target_link_libraries(qnx-executor-bench PRIVATE
    qnx_bench_utils
)
target_compile_options(qnx-executor-bench PRIVATE
    -O3 -march=native -fno-omit-frame-pointer
)

# =============================================================================
# Install Benchmarks
# =============================================================================
install(TARGETS
    qnx-executor-bench
    bench_data_loading
    bench_execution
    bench_serialization
    bench_cache_contention
    bench_data_sensitivity
    bench_prefetch
    bench_memory_pool
    bench_simd
    bench_hash_map
    RUNTIME DESTINATION bin/benchmark
)


# =============================================================================
# Custom Target: Run All Benchmarks
# =============================================================================
add_custom_target(run_benchmarks
    COMMAND ${CMAKE_COMMAND} -E echo "=== Running StratCraft Benchmarks ==="
    COMMAND bench_data_loading
    COMMAND bench_execution
    COMMAND bench_serialization
    COMMAND bench_cache_contention
    COMMAND bench_data_sensitivity
    COMMAND bench_prefetch
    COMMAND bench_simd
    COMMAND bench_hash_map
    DEPENDS
        bench_data_loading
        bench_execution
        bench_serialization
        bench_cache_contention
        bench_data_sensitivity
        bench_prefetch
        bench_simd
        bench_hash_map
    WORKING_DIRECTORY ${CMAKE_BINARY_DIR}
    COMMENT "Running all benchmark tests"
)

# =============================================================================
# Summary
# =============================================================================
message(STATUS "")
message(STATUS "StratCraft Benchmark Configuration:")
message(STATUS "  Perf Counters:    ${BENCHMARK_ENABLE_PERF}")
message(STATUS "  GIL Latency Test: REMOVED (pybind11 removed)")
message(STATUS "  Track Allocs:     ${BENCHMARK_TRACK_ALLOCATIONS}")
message(STATUS "")
