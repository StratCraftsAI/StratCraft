"""Base plugin classes for StratCraft."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal


@dataclass
class PluginManifest:
    """Plugin manifest definition."""

    id: str
    name: str
    version: str
    description: str
    plugin_type: Literal["data-provider", "indicator", "signal", "risk", "ui"]
    author: str | None = None
    main: str = "main.py"
    dependencies: dict[str, str] | None = None


class PluginContext:
    """Context provided to plugins for accessing system resources."""

    def __init__(self, data_dir: Path, config_dir: Path) -> None:
        """Initialize plugin context."""
        self._data_dir = data_dir
        self._config_dir = config_dir
        self._config: dict[str, Any] = {}

    @property
    def data_dir(self) -> Path:
        """Directory for plugin data storage."""
        return self._data_dir

    @property
    def config_dir(self) -> Path:
        """Directory for plugin configuration."""
        return self._config_dir

    def log(
        self, level: Literal["debug", "info", "warn", "error"], message: str
    ) -> None:
        """Log a message."""
        # TODO: Integrate with server logging
        print(f"[{level.upper()}] {message}")

    def get_config(self, key: str, default: Any = None) -> Any:
        """Get a configuration value."""
        return self._config.get(key, default)

    def set_config(self, key: str, value: Any) -> None:
        """Set a configuration value."""
        self._config[key] = value


class NexusPlugin(ABC):
    """Base class for all StratCraft plugins."""

    def __init__(self, context: PluginContext) -> None:
        """Initialize plugin with context."""
        self.context = context

    @property
    @abstractmethod
    def manifest(self) -> PluginManifest:
        """Plugin manifest."""
        ...

    @abstractmethod
    async def initialize(self) -> None:
        """Initialize the plugin."""
        ...

    @abstractmethod
    async def destroy(self) -> None:
        """Clean up plugin resources."""
        ...
