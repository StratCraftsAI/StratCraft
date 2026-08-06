/**
 * Executor Constants
 *
 * TICKET_097_3: Magic Number Elimination
 *
 * Centralized domain-specific constants for the executor module.
 * All magic numbers should be defined here with meaningful names.
 *
 * Categories:
 * - Warmup: I-Cache and D-Cache warming parameters
 * - DataSource: Data loading and batch processing
 * - MockData: Synthetic data generation
 * - Time: Time unit conversions
 * - Trading: Default trading parameters
 * - Checkpoint: Checkpoint/resume functionality
 * - Parallel: Parallel execution thresholds
 * - CPUID: CPU feature detection bits
 */

#pragma once

#include <cstddef>
#include <cstdint>

namespace StratCraft::executor::constants {

// =============================================================================
// Warmup Constants (executor_core.cpp)
// =============================================================================

/// Number of iterations for I-Cache warmup loop
inline constexpr int WARMUP_ICACHE_ITERATIONS = 100;

/// Pre-allocated capacity for warmup vector
inline constexpr size_t WARMUP_VECTOR_CAPACITY = 1000;

/// Number of iterations for D-Cache warmup loop
inline constexpr int WARMUP_DCACHE_ITERATIONS = 1000;

/// Cache line size in doubles for D-Cache warmup stride
inline constexpr size_t WARMUP_DCACHE_STRIDE = 64;

// =============================================================================
// Data Source Constants (parquet_data_source.cpp)
// =============================================================================

/// Parquet reader batch size (rows per batch)
inline constexpr int64_t PARQUET_BATCH_SIZE = 65536;  // 64K rows

/// TICKET_641_1: Maximum rows allowed from a single Parquet file
/// 50M bars ~2.4GB for 6 double columns -- prevents OOM from corrupted/malicious files
inline constexpr size_t MAX_DATAFRAME_ROWS = 50'000'000;

// =============================================================================
// Mock Data Constants (mock_data_source.cpp)
// =============================================================================

/// Default number of bars for testing when not specified
inline constexpr size_t MOCK_DATA_DEFAULT_BARS = 1000;

/// Starting price for synthetic data generation
inline constexpr double MOCK_DATA_INITIAL_PRICE = 100.0;

/// Fixed RNG seed for reproducibility
inline constexpr unsigned int MOCK_DATA_RNG_SEED = 42;

/// Base volume multiplier for mock data
inline constexpr double MOCK_DATA_VOLUME_MULTIPLIER = 1000000.0;

/// Default interval in seconds when parsing fails
inline constexpr int64_t MOCK_DATA_DEFAULT_INTERVAL_SECONDS = 60;

// =============================================================================
// Time Constants (mock_data_source.cpp)
// =============================================================================

/// Seconds per minute
inline constexpr int64_t SECONDS_PER_MINUTE = 60;

/// Seconds per hour
inline constexpr int64_t SECONDS_PER_HOUR = 3600;

/// Seconds per day
inline constexpr int64_t SECONDS_PER_DAY = 86400;

/// Milliseconds per second (for timestamp conversion)
inline constexpr int64_t MS_PER_SECOND = 1000;

// =============================================================================
// Trading Default Constants (config_types.hpp)
// =============================================================================

/// Default initial capital for backtesting
inline constexpr double DEFAULT_INITIAL_CAPITAL = 100000.0;

/// Default commission rate (0.1%)
inline constexpr double DEFAULT_COMMISSION_RATE = 0.001;

/// Default slippage rate (0.05%)
inline constexpr double DEFAULT_SLIPPAGE_RATE = 0.0005;

/// Default maximum position size as fraction of capital
inline constexpr double DEFAULT_MAX_POSITION_SIZE = 1.0;

// =============================================================================
// Checkpoint Default Constants (config_types.hpp)
// =============================================================================

/// Save checkpoint every N bars
inline constexpr int DEFAULT_CHECKPOINT_INTERVAL = 500;

/// Keep N most recent checkpoints
inline constexpr int DEFAULT_CHECKPOINT_MAX_COUNT = 5;

/// Replay N bars for indicator warmup on resume
inline constexpr int DEFAULT_CHECKPOINT_WARMUP_PERIOD = 50;

// =============================================================================
// Parallel Execution Constants (parallel.hpp)
// =============================================================================

/// Minimum chunk size for parallel operations
inline constexpr size_t PARALLEL_MIN_CHUNK_SIZE = 1024;

/// Number of chunks per thread for load balancing
inline constexpr size_t PARALLEL_CHUNKS_PER_THREAD = 4;

/// Minimum batch size to trigger parallel execution
inline constexpr size_t BATCH_PARALLEL_THRESHOLD = 4;

/// Minimum elements to trigger parallel execution (data-level threshold)
inline constexpr size_t PARALLEL_DATA_THRESHOLD = 10000;

// =============================================================================
// CPUID Feature Bit Constants (simd_avx512.hpp)
// =============================================================================

/// CPUID EBX bit position for AVX-512F feature
inline constexpr int CPUID_AVX512F_BIT = 16;

/// CPUID EBX bit position for AVX2 feature
inline constexpr int CPUID_AVX2_BIT = 5;

// =============================================================================
// CLI Argument Constants (main.cpp)
// =============================================================================

/// Command line argument prefix for config path
inline constexpr const char* CLI_ARG_CONFIG_PREFIX = "--config=";

/// Command line argument prefix for output directory
inline constexpr const char* CLI_ARG_OUTPUT_PREFIX = "--output=";

/// Command line flag for verbose mode (long form)
inline constexpr const char* CLI_FLAG_VERBOSE = "--verbose";

/// Command line flag for verbose mode (short form)
inline constexpr const char* CLI_FLAG_VERBOSE_SHORT = "-v";

/// Command line flag for help (long form)
inline constexpr const char* CLI_FLAG_HELP = "--help";

/// Command line flag for help (short form)
inline constexpr const char* CLI_FLAG_HELP_SHORT = "-h";

/// Length of --config= prefix for substr extraction
inline constexpr size_t CLI_ARG_CONFIG_PREFIX_LEN = 9;

/// Length of --output= prefix for substr extraction
inline constexpr size_t CLI_ARG_OUTPUT_PREFIX_LEN = 9;

// =============================================================================
// Output Format Constants (main.cpp, executor_service.ts)
// =============================================================================

/// Prefix for incremental result output (parsed by executor-service.ts)
inline constexpr const char* OUTPUT_INCREMENT_PREFIX = "[INCREMENT] ";

/// TICKET_321: Prefix for pipeline phase output (parsed by executor-service.ts)
inline constexpr const char* OUTPUT_PHASE_PREFIX = "[PHASE] ";

/// TICKET_321: Phase identifier - Python interpreter initialization
inline constexpr const char* PHASE_INITIALIZING = "initializing";

/// TICKET_321: Phase identifier - Parquet data loading
inline constexpr const char* PHASE_LOADING_DATA = "loading_data";

/// TICKET_321: Phase identifier - Strategy bar processing
inline constexpr const char* PHASE_BACKTESTING = "backtesting";

/// TICKET_387_P2: Prefix for loading sub-step status (parsed by executor-service.ts)
inline constexpr const char* OUTPUT_LOADING_STATUS_PREFIX = "[LOADING_STATUS] ";

/// Result output filename
inline constexpr const char* OUTPUT_RESULT_FILENAME = "result.json";



// =============================================================================
// JSON Format Constants
// =============================================================================

/// Number of spaces for JSON indentation
inline constexpr int JSON_INDENT_SPACES = 2;

// =============================================================================
// Warmup Calculation Constants
// =============================================================================

/// Exponential factor for I-Cache warmup computation
inline constexpr double WARMUP_EXP_FACTOR = 0.01;

// =============================================================================
// Mock Data Distribution Constants
// =============================================================================

/// Mean of daily returns for mock data generation
inline constexpr double MOCK_DATA_RETURN_MEAN = 0.0001;

/// Standard deviation of daily returns for mock data generation
inline constexpr double MOCK_DATA_RETURN_STDDEV = 0.02;

/// Volatility factor for high/low price calculation
inline constexpr double MOCK_DATA_VOLATILITY_FACTOR = 0.5;

// =============================================================================
// Data Source Type Constants
// =============================================================================

/// Data source type identifier: mock
inline constexpr const char* DATA_SOURCE_TYPE_MOCK = "mock";

/// Data source type identifier: parquet
inline constexpr const char* DATA_SOURCE_TYPE_PARQUET = "parquet";

/// Data source type identifier: csv
inline constexpr const char* DATA_SOURCE_TYPE_CSV = "csv";

/// Data source name: MockDataSource
inline constexpr const char* DATA_SOURCE_NAME_MOCK = "MockDataSource";

/// Data source name: ParquetDataSource
inline constexpr const char* DATA_SOURCE_NAME_PARQUET = "ParquetDataSource";

// =============================================================================
// Display Format Constants
// =============================================================================

/// Multiplier for converting decimal to percentage
inline constexpr double PERCENT_MULTIPLIER = 100.0;

/// Progress bar complete value (100%)
inline constexpr double PROGRESS_COMPLETE = 100.0;

// =============================================================================
// Deferred Processor Constants (deferred_processor.hpp)
// =============================================================================

/// Default SPSC queue capacity for deferred processor (must be power of 2)
inline constexpr std::size_t DEFERRED_QUEUE_CAPACITY = 4096;

/// Default maximum messages per batch drain cycle
inline constexpr std::size_t DEFERRED_MAX_BATCH_SIZE = 64;

} // namespace StratCraft::executor::constants
