"""Indicator plugin base class."""

from abc import abstractmethod
from dataclasses import dataclass
from typing import Literal

from StratCraft_sdk.data import OHLCV
from StratCraft_sdk.plugin import NexusPlugin


@dataclass
class IndicatorInput:
    """Input data for indicator calculation."""

    data: list[OHLCV]
    params: dict[str, float]


@dataclass
class IndicatorOutput:
    """Output from indicator calculation."""

    values: list[float]
    signals: list[Literal["buy", "sell"] | None] | None = None


class IndicatorPlugin(NexusPlugin):
    """Base class for indicator plugins."""

    @property
    @abstractmethod
    def default_params(self) -> dict[str, float]:
        """Default parameters for the indicator."""
        ...

    @abstractmethod
    def calculate(self, input_data: IndicatorInput) -> IndicatorOutput:
        """Calculate indicator values."""
        ...
