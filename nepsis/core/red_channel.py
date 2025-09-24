"""Red channel monitors for non-negotiable danger conditions."""

from dataclasses import dataclass
from typing import Any, Dict


@dataclass
class RedChannel:
    """Simple red channel that flags critical signals."""

    sentinel: float = 0.8

    def evaluate(self, signal: Dict[str, Any]) -> bool:
        """Return True if the signal should trigger an immediate stop."""
        score = float(signal.get("risk", 0.0))
        return score >= self.sentinel or bool(signal.get("override", False))
