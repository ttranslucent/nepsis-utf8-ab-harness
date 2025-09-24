"""Experiment runner for dual-condition UTF-8 evaluation."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from subprocess import CompletedProcess
from typing import Callable, Dict, Iterable, List, Optional


Runner = Callable[[List[str], Path], CompletedProcess]


@dataclass
class ConditionSpec:
    """Description of a single experiment condition."""

    name: str
    solution_path: Path
    prompt_path: Optional[Path] = None


class ExperimentRunner:
    """Coordinate solution swapping, pytest execution, and artifact capture."""

    def __init__(
        self,
        workspace: Path,
        tests_path: Path,
        artifacts_path: Path,
        solution_filename: str = "solution.py",
        runner: Optional[Runner] = None,
    ) -> None:
        self.workspace = workspace
        self.tests_path = tests_path
        self.artifacts_path = artifacts_path
        self.solution_path = workspace / solution_filename
        self.runner = runner or self._default_runner
        self.artifacts_path.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _default_runner(cmd: List[str], cwd: Path) -> CompletedProcess:
        return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)

    def run(
        self,
        conditions: Iterable[ConditionSpec],
        model_name: str = "",
        notes: Optional[str] = None,
    ) -> Dict[str, object]:
        """Run pytest for each condition and write artifacts.

        Returns the aggregated result payload.
        """
        original_content: Optional[str]
        if self.solution_path.exists():
            original_content = self.solution_path.read_text(encoding="utf-8")
        else:
            original_content = None

        aggregated: Dict[str, object] = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model_name": model_name,
            "notes": notes or "",
            "conditions": [],
        }

        scorecard_rows: List[str] = []

        try:
            for condition in conditions:
                stdout_text: str
                stderr_text: str
                return_code: int

                self._install_solution(condition.solution_path)
                result = self.runner(
                    [sys.executable, "-m", "pytest", str(self.tests_path), "-q"],
                    cwd=self.workspace,
                )
                stdout_text = result.stdout or ""
                stderr_text = result.stderr or ""
                return_code = result.returncode

                summary_line = self._extract_summary(stdout_text, stderr_text)
                tests_summary = self._parse_summary(summary_line)

                condition_payload = {
                    "condition": condition.name,
                    "solution": str(condition.solution_path),
                    "prompt": str(condition.prompt_path) if condition.prompt_path else "",
                    "returncode": return_code,
                    "summary": summary_line,
                    "stdout": stdout_text.strip(),
                    "stderr": stderr_text.strip(),
                    "tests": tests_summary,
                }
                aggregated["conditions"].append(condition_payload)

                self._write_condition_artifacts(condition.name, condition_payload)

                scorecard_rows.append(
                    self._format_scorecard_row(
                        condition=condition_payload,
                        model_name=model_name,
                        notes=notes,
                    )
                )
        finally:
            self._restore_original(original_content)

        self._write_aggregated_artifacts(aggregated, scorecard_rows)
        return aggregated

    def _install_solution(self, source: Path) -> None:
        absolute_source = source if source.is_absolute() else self.workspace / source
        if not absolute_source.exists():
            raise FileNotFoundError(f"Solution file not found: {absolute_source}")
        shutil.copyfile(absolute_source, self.solution_path)

    def _restore_original(self, original_content: Optional[str]) -> None:
        if original_content is None:
            if self.solution_path.exists():
                self.solution_path.unlink()
            return
        self.solution_path.write_text(original_content, encoding="utf-8")

    @staticmethod
    def _extract_summary(stdout_text: str, stderr_text: str) -> str:
        for stream in (stdout_text, stderr_text):
            for line in reversed(stream.splitlines()):
                if "passed" in line or "failed" in line:
                    return line.strip()
        return ""

    @staticmethod
    def _parse_summary(summary: str) -> Dict[str, int]:
        import re

        metrics = {"passed": 0, "failed": 0, "errors": 0}
        if not summary:
            return metrics
        for key in metrics.keys():
            match = re.search(rf"(\d+)\s+{key}", summary)
            if match:
                metrics[key] = int(match.group(1))
        return metrics

    def _write_condition_artifacts(self, condition_name: str, payload: Dict[str, object]) -> None:
        base = self.artifacts_path / f"automated_{condition_name}"
        (base.parent).mkdir(parents=True, exist_ok=True)
        with (base.with_suffix(".json")).open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
        with (base.with_suffix(".txt")).open("w", encoding="utf-8") as handle:
            handle.write(payload.get("stdout", ""))
            stderr = payload.get("stderr")
            if stderr:
                handle.write("\n\n[stderr]\n")
                handle.write(str(stderr))

    def _write_aggregated_artifacts(
        self,
        aggregated: Dict[str, object],
        scorecard_rows: List[str],
    ) -> None:
        summary_path = self.artifacts_path / "automated_results.json"
        with summary_path.open("w", encoding="utf-8") as handle:
            json.dump(aggregated, handle, indent=2)

        markdown_path = self.artifacts_path / "automated_results.md"
        with markdown_path.open("w", encoding="utf-8") as handle:
            handle.write("# Automated Experiment Results\n\n")
            handle.write(f"Generated: {aggregated['generated_at']}\n\n")
            for condition in aggregated.get("conditions", []):
                handle.write(f"## {condition['condition']}\n\n")
                handle.write(f"Summary: {condition.get('summary', '')}\n\n")
                handle.write("Tests:\n\n")
                for metric, value in condition.get("tests", {}).items():
                    handle.write(f"- {metric}: {value}\n")
                handle.write("\n")

        scorecard_path = self.artifacts_path / "automated_scorecard.csv"
        header = (
            "trial_id,condition,model_name_version,prompt_file,"
            "tests_passed,tests_failed,tests_errored,notes\n"
        )
        content = header + "".join(scorecard_rows)
        scorecard_path.write_text(content, encoding="utf-8")

    @staticmethod
    def _format_scorecard_row(
        condition: Dict[str, object],
        model_name: str,
        notes: Optional[str],
    ) -> str:
        tests = condition.get("tests", {})
        passed = tests.get("passed", 0)
        failed = tests.get("failed", 0)
        errors = tests.get("errors", 0)
        prompt = condition.get("prompt", "")
        fields = [
            "",
            condition.get("condition", ""),
            model_name,
            prompt,
            str(passed),
            str(failed),
            str(errors),
            notes or "",
        ]
        return ",".join(fields) + "\n"
