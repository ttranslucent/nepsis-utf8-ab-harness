"""Decision governor selecting response strategies based on interpretant health."""

from dataclasses import dataclass
from typing import Literal

CollapseMode = Literal["OccamDefault", "HickamBuffer", "ZeroBackFallback"]


@dataclass
class CollapseGovernor:
    """Selects the collapse mode from contradiction density and coherence."""

    red_threshold: float = 0.8
    buffer_threshold: float = 0.5

    def select(self, contradiction_density: float, interpretant_coherence: float) -> CollapseMode:
        """Return the collapse mode based on basic thresholds."""
        if contradiction_density >= self.red_threshold:
            return "ZeroBackFallback"
        if contradiction_density >= self.buffer_threshold or interpretant_coherence < self.buffer_threshold:
            return "HickamBuffer"
        return "OccamDefault"
