"""Basic scaffolding tests for Nepsis core modules."""

from pathlib import Path

from subprocess import CompletedProcess

from nepsis.core import (
    BlueChannel,
    CollapseGovernor,
    ConditionSpec,
    ExperimentRunner,
    RedChannel,
    StillLogger,
    ZeroBackController,
)


def test_collapse_governor_default_mode():
    governor = CollapseGovernor()
    mode = governor.select(0.1, 1.0)
    assert mode == "OccamDefault"


def test_red_channel_no_trigger():
    red = RedChannel()
    assert red.evaluate({"risk": 0.1}) is False


def test_blue_channel_promotion_threshold():
    blue = BlueChannel(promotion_threshold=0.5)
    score, promote = blue.analyze({"instability": 0.6})
    assert score >= 0.6
    assert promote is True


def test_still_logger_writes(tmp_path):
    log_path = tmp_path / "still.log"
    still = StillLogger(log_path)
    still.log("test message")
    assert log_path.exists()
    assert "test message" in log_path.read_text(encoding="utf-8")


def test_zero_back_controller_tracks_depth():
    controller = ZeroBackController(max_depth=2)
    controller.reset("a")
    controller.reset("b")
    controller.reset("c")
    assert controller.history == ["b", "c"]


def test_jailing_case_demo(tmp_path):
    """JailingCase placeholder ensures interpretant handling will be implemented."""
    log_path = tmp_path / "still.log"
    still = StillLogger(log_path)
    still.log("JailingCase::start")
    still.log("JailingCase::review")
    assert len(still.events) == 2


def test_experiment_runner_restores_solution(tmp_path):
    workspace = tmp_path
    artifacts = workspace / "artifacts"
    tests_path = workspace / "tests"
    tests_path.mkdir(parents=True)
    (tests_path / "test_stream_utf8_normalizer.py").write_text("# placeholder", encoding="utf-8")

    original_solution = workspace / "solution.py"
    original_solution.write_text("original", encoding="utf-8")

    naked_path = workspace / "solution_naked.py"
    scaffold_path = workspace / "solution_scaffold.py"
    naked_path.write_text("naked", encoding="utf-8")
    scaffold_path.write_text("scaffold", encoding="utf-8")

    calls = []

    def fake_runner(cmd, cwd):
        calls.append((cmd, cwd))
        stdout = "11 passed in 0.01s" if len(calls) == 1 else "10 passed, 1 failed in 0.02s"
        return CompletedProcess(cmd, 0, stdout=stdout, stderr="")

    runner = ExperimentRunner(
        workspace=workspace,
        tests_path=tests_path / "test_stream_utf8_normalizer.py",
        artifacts_path=artifacts,
        runner=fake_runner,
    )

    conditions = [
        ConditionSpec("naked", naked_path, workspace / "prompts" / "naked.txt"),
        ConditionSpec("scaffold", scaffold_path, workspace / "prompts" / "scaffold.txt"),
    ]

    summary = runner.run(conditions, model_name="UnitTestModel")

    assert original_solution.read_text(encoding="utf-8") == "original"
    assert len(summary["conditions"]) == 2
    assert summary["conditions"][0]["tests"]["passed"] == 11
    assert (artifacts / "automated_results.json").exists()
    assert any("pytest" in " ".join(cmd) for cmd, _ in calls)
