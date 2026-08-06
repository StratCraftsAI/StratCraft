"""Signal plugin base class."""

from abc import abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

from StratCraft_sdk.data import OHLCV
from StratCraft_sdk.plugin import NexusPlugin


@dataclass
class Signal:
    """Trading signal."""

    symbol: str
    signal_type: Literal["buy", "sell", "hold"]
    strength: float  # 0-1
    timestamp: datetime
    metadata: dict[str, Any] = field(default_factory=dict)


class SignalPlugin(NexusPlugin):
    """Base class for signal generator plugins."""

    @abstractmethod
    async def generate(self, data: list[OHLCV]) -> list[Signal]:
        """Generate trading signals from market data."""
        ...
