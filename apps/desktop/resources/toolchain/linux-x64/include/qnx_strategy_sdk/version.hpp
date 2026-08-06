#pragma once

/// ABI version for the nonabt Strategy SDK.
///
/// Runner checks: if (qnx_strategy_abi_version() != QNX_STRATEGY_ABI_VERSION)
/// abort with an ABI mismatch diagnostic. Increment this value only when a
/// breaking change is made to the C ABI contract.
#define QNX_STRATEGY_ABI_VERSION 2

/// Human-readable SDK header version packaged with the toolchain artifact.
#define QNX_STRATEGY_SDK_VERSION "0.2.0"
