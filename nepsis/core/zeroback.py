"""ZeroBack controller for resets and archival rollbacks."""

from dataclasses import dataclass, field
from typing import List


@dataclass
class ZeroBackController:
    """Keep track of resets and enforce depth limits."""

    max_depth: int = 3
    history: List[str] = field(default_factory=list)

    def reset(self, label: str) -> None:
        self.history.append(label)
        if len(self.history) > self.max_depth:
            self.history.pop(0)

    def last(self) -> str:
        return self.history[-1] if self.history else ""
