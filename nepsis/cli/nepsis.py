"""Nepsis CLI entrypoint."""

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List

from nepsis.core import (
    BlueChannel,
    CollapseGovernor,
    ConditionSpec,
    ExperimentRunner,
    RedChannel,
    StillLogger,
    ZeroBackController,
)


def load_signal(path: Path) -> Dict[str, Any]:
    import json

    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def run_scenario(args: argparse.Namespace) -> None:
    signal = load_signal(Path(args.signal))
    red = RedChannel()
    blue = BlueChannel()
    governor = CollapseGovernor()
    still = StillLogger(Path(args.still_log))
    zero_back = ZeroBackController()

    still.log("start scenario")

    hijack_score, promote = blue.analyze(signal)
    still.log(f"blue-channel hijack={hijack_score:.2f} promote={promote}")

    if promote:
        still.log("promotion to red channel")
    red_trigger = red.evaluate(signal) or promote

    mode = governor.select(
        contradiction_density=float(signal.get("contradiction", 0.0)),
        interpretant_coherence=float(signal.get("coherence", 1.0)),
    )
    still.log(f"collapse-mode {mode}")

    if red_trigger:
        zero_back.reset("red-triggered")
        still.log("zero-back engaged")

    print(
        f"mode={mode} red_trigger={red_trigger} hijack_score={hijack_score:.2f} "
        f"zero_back_depth={len(zero_back.history)}"
    )


def audit_log(_: argparse.Namespace) -> None:
    print("audit log not yet implemented")


def zero_back(_: argparse.Namespace) -> None:
    controller = ZeroBackController()
    controller.reset("manual")
    print(f"ZeroBack depth {len(controller.history)}")


def run_experiment(args: argparse.Namespace) -> None:
    workspace = Path(args.workspace).resolve()
    tests_path = (workspace / args.tests).resolve()
    artifacts_path = (workspace / args.artifacts).resolve()

    runner = ExperimentRunner(
        workspace=workspace,
        tests_path=tests_path,
        artifacts_path=artifacts_path,
    )

    conditions: List[ConditionSpec] = [
        ConditionSpec(
            name="naked",
            solution_path=workspace / args.naked_solution,
            prompt_path=workspace / args.naked_prompt,
        ),
        ConditionSpec(
            name="scaffold",
            solution_path=workspace / args.scaffold_solution,
            prompt_path=workspace / args.scaffold_prompt,
        ),
    ]

    summary = runner.run(conditions, model_name=args.model_name, notes=args.notes)
    print(json.dumps(summary, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Nepsis co-driver CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run-scenario", help="Run a scenario JSON file")
    run_parser.add_argument("signal", help="Path to scenario JSON payload")
    run_parser.add_argument(
        "--still-log", default="logs/still.log", help="Path for STILL log output"
    )
    run_parser.set_defaults(func=run_scenario)

    audit_parser = subparsers.add_parser("audit-log", help="Display collected audit log")
    audit_parser.set_defaults(func=audit_log)

    zero_back_parser = subparsers.add_parser("zero-back", help="Trigger a zero-back reset")
    zero_back_parser.set_defaults(func=zero_back)

    experiment_parser = subparsers.add_parser(
        "run-experiment", help="Run naked vs scaffold solutions through pytest evaluator"
    )
    experiment_parser.add_argument(
        "--workspace", default=".", help="Project workspace root containing solutions and tests"
    )
    experiment_parser.add_argument(
        "--tests", default="tests/test_stream_utf8_normalizer.py", help="Pytest target file"
    )
    experiment_parser.add_argument(
        "--artifacts", default="artifacts", help="Directory where result artifacts are written"
    )
    experiment_parser.add_argument(
        "--naked-solution", default="solution_naked.py", help="Path to the naked condition solution"
    )
    experiment_parser.add_argument(
        "--scaffold-solution", default="solution_scaffold.py", help="Path to the scaffold condition solution"
    )
    experiment_parser.add_argument(
        "--naked-prompt", default="prompts/naked.txt", help="Prompt file for naked condition"
    )
    experiment_parser.add_argument(
        "--scaffold-prompt", default="prompts/scaffold.txt", help="Prompt file for scaffold condition"
    )
    experiment_parser.add_argument(
        "--model-name", default="", help="Model identifier to record in results"
    )
    experiment_parser.add_argument(
        "--notes", default="", help="Optional notes captured in artifacts"
    )
    experiment_parser.set_defaults(func=run_experiment)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
