"""StratCraft Python SDK for plugin development."""

from StratCraft_sdk.plugin import NexusPlugin, PluginContext
from StratCraft_sdk.data import DataProviderPlugin, OHLCV
from StratCraft_sdk.indicator import IndicatorPlugin
from StratCraft_sdk.signal import SignalPlugin, Signal
from StratCraft_sdk.risk import RiskPlugin

__version__ = "0.1.0"

__all__ = [
    "NexusPlugin",
    "PluginContext",
    "DataProviderPlugin",
    "OHLCV",
    "IndicatorPlugin",
    "SignalPlugin",
    "Signal",
    "RiskPlugin",
]
