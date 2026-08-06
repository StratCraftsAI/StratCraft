#pragma once

#include "version.hpp"

#if defined(_WIN32)
    #define QNX_STRATEGY_EXPORT __declspec(dllexport)
#else
    #define QNX_STRATEGY_EXPORT __attribute__((visibility("default")))
#endif

/// Strategy SDK ABI contract — v2.
///
/// ABI v2: Strategy .so exports a factory pair. The runner (or backtest_runner.hpp)
/// owns backtest orchestration (Cerebro, broker, data, analyzers, serialization).
///
/// Exported C symbols:
///   - qnx_strategy_abi_version()      → ABI version integer
///   - nonabt_create_strategy()        → allocates and returns a Strategy*
///   - nonabt_destroy_strategy(ptr)    → destroys a Strategy* created above

namespace nonabt { class Strategy; }

extern "C" {

/// Returns the ABI version this strategy was compiled against.
using qnx_strategy_abi_version_fn = int (*)();

/// Factory: create a strategy instance (caller does NOT own deletion directly —
/// must call nonabt_destroy_strategy).
using nonabt_create_strategy_fn = stratforge::Strategy* (*)();

/// Factory: destroy a strategy instance created by nonabt_create_strategy.
using nonabt_destroy_strategy_fn = void (*)(stratforge::Strategy*);

}

/// Convenience macro: emits all three ABI v2 exports for a given strategy type.
///
/// Usage (in a strategy .cpp or wrapper):
///   QNX_STRATEGY_FACTORY_EXPORT(MyStrategy)
#define QNX_STRATEGY_FACTORY_EXPORT(StrategyType)                              \
    extern "C" QNX_STRATEGY_EXPORT int qnx_strategy_abi_version() {            \
        return QNX_STRATEGY_ABI_VERSION;                                       \
    }                                                                          \
    extern "C" QNX_STRATEGY_EXPORT stratforge::Strategy* nonabt_create_strategy() {\
        return new StrategyType();                                             \
    }                                                                          \
    extern "C" QNX_STRATEGY_EXPORT void nonabt_destroy_strategy(               \
            stratforge::Strategy* s) {                                             \
        delete s;                                                              \
    }
