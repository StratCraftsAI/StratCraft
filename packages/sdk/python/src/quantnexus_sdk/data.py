"""Data provider plugin base class."""

from abc import abstractmethod
from dataclasses import dataclass
from datetime import date

from StratCraft_sdk.plugin import NexusPlugin


@dataclass
class OHLCV:
    """OHLCV bar data."""

    timestamp: int
    open: float
    high: float
    low: float
    close: float
    volume: float


class DataProviderPlugin(NexusPlugin):
    """Base class for data provider plugins."""

    @property
    @abstractmethod
    def supported_symbols(self) -> list[str]:
        """List of supported symbols."""
        ...

    @abstractmethod
    async def get_ohlcv(
        self,
        symbol: str,
        start_date: date,
        end_date: date,
        interval: str = "1d",
    ) -> list[OHLCV]:
        """Get OHLCV data for a symbol."""
        ...

    @abstractmethod
    async def get_latest_price(self, symbol: str) -> float | None:
        """Get the latest price for a symbol."""
        ...
