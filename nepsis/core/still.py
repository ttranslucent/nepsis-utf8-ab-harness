"""STILL logger capturing metacognitive checkpoints."""

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import List


@dataclass
class StillLogger:
    """Append strategic time-in-loop events to a log file."""

    path: Path
    events: List[str] = field(default_factory=list)

    def log(self, message: str) -> None:
        timestamp = datetime.utcnow().isoformat() + "Z"
        entry = f"{timestamp} | {message}"
        self.events.append(entry)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(entry + "\n")
