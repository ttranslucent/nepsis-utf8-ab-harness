"""Blue channel tracks interpretant drift and can promote to Red."""

from dataclasses import dataclass
from typing import Any, Dict, Tuple


@dataclass
class BlueChannel:
    """Evaluate interpretant signals and escalation triggers."""

    promotion_threshold: float = 0.6

    def analyze(self, signal: Dict[str, Any]) -> Tuple[float, bool]:
        """Return hijack score and whether to promote to Red."""
        hijack_score = float(signal.get("instability", 0.0))
        anomalies = float(signal.get("anomalies", 0.0))
        hijack_score = min(1.0, max(0.0, hijack_score + anomalies * 0.1))
        promote = hijack_score >= self.promotion_threshold
        return hijack_score, promote
