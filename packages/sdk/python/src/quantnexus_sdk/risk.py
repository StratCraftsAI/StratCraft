"""Risk management plugin base class."""

from abc import abstractmethod
from dataclasses import dataclass, field

from StratCraft_sdk.plugin import NexusPlugin


@dataclass
class Position:
    """Trading position."""

    symbol: str
    quantity: float
    entry_price: float
    current_price: float


@dataclass
class RiskMetrics:
    """Risk evaluation metrics."""

    portfolio_risk: float
    position_risks: dict[str, float] = field(default_factory=dict)
    suggestions: list[str] = field(default_factory=list)


class RiskPlugin(NexusPlugin):
    """Base class for risk management plugins."""

    @abstractmethod
    def evaluate(self, positions: list[Position]) -> RiskMetrics:
        """Evaluate risk for the given positions."""
        ...
