"""Checks on .github/workflows that actionlint cannot make, because they are about this repo.

GitHub disables scheduled workflows after 60 days of repository inactivity.
These tests keep the guard against that from quietly drifting.
"""

import re
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parents[2]
WORKFLOWS_DIR = REPO / ".github" / "workflows"


def _load(path: Path) -> dict:
    workflow = yaml.safe_load(path.read_text())
    # YAML 1.1 reads the bare key `on` as the boolean True.
    if True in workflow:
        workflow["on"] = workflow.pop(True)
    return workflow


WORKFLOWS = {path.name: _load(path) for path in sorted(WORKFLOWS_DIR.glob("*.yml"))}


def _triggers(workflow: dict) -> dict:
    on = workflow["on"]
    if isinstance(on, str):
        return {on: None}
    if isinstance(on, list):
        return {name: None for name in on}
    return on


def _keepalive_job() -> dict:
    return WORKFLOWS["collect.yml"]["jobs"]["keep-schedules-enabled"]


def test_the_workflow_directory_was_found():
    assert {"collect.yml", "train.yml", "archive.yml", "ci.yml"} <= set(WORKFLOWS)


def test_every_scheduled_workflow_is_kept_enabled():
    scheduled = {name for name, wf in WORKFLOWS.items() if "schedule" in _triggers(wf)}
    kept_enabled = set(_keepalive_job()["env"]["SCHEDULED_WORKFLOWS"].split())

    assert scheduled, "expected at least one scheduled workflow"
    assert kept_enabled == scheduled, (
        "collect.yml's SCHEDULED_WORKFLOWS must list exactly the workflows with a schedule: trigger. "
        f"Missing: {sorted(scheduled - kept_enabled)}; not scheduled: {sorted(kept_enabled - scheduled)}"
    )


def test_every_kept_enabled_workflow_file_exists():
    for name in _keepalive_job()["env"]["SCHEDULED_WORKFLOWS"].split():
        assert (WORKFLOWS_DIR / name).is_file(), name


def test_only_the_keepalive_job_can_write_to_actions():
    collect = WORKFLOWS["collect.yml"]
    assert collect["permissions"] == {"contents": "read"}
    assert _keepalive_job()["permissions"] == {"actions": "write"}
    for job_name, job in collect["jobs"].items():
        if job_name != "keep-schedules-enabled":
            assert "actions" not in job.get("permissions", {}), job_name


def test_the_keepalive_step_enables_each_listed_workflow():
    [step] = _keepalive_job()["steps"]
    assert "gh workflow enable" in step["run"]
    assert "SCHEDULED_WORKFLOWS" in step["run"]
    assert step["env"]["GH_TOKEN"] == "${{ github.token }}"


def test_collect_stays_dispatch_only():
    """A schedule: trigger would make collect itself subject to the 60-day inactivity disable."""
    assert set(_triggers(WORKFLOWS["collect.yml"])) == {"workflow_dispatch"}


def test_collect_checks_forecast_freshness():
    steps = WORKFLOWS["collect.yml"]["jobs"]["check-freshness"]["steps"]
    [check] = [s for s in steps if "check_freshness.py" in s.get("run", "")]
    assert check["env"]["DATABASE_URL"] == "${{ secrets.DATABASE_URL }}"


@pytest.mark.parametrize("workflow_name", sorted(WORKFLOWS))
def test_every_job_has_a_timeout(workflow_name):
    for job_name, job in WORKFLOWS[workflow_name]["jobs"].items():
        assert "timeout-minutes" in job, f"{workflow_name}:{job_name} has no timeout-minutes"


@pytest.mark.parametrize("workflow_name", sorted(WORKFLOWS))
def test_python_scripts_run_by_workflows_exist(workflow_name):
    for job_name, job in WORKFLOWS[workflow_name]["jobs"].items():
        for step in job.get("steps", []):
            run = step.get("run", "")
            workdir = REPO / step.get("working-directory", ".")
            for script in re.findall(r"\bpython\s+([\w./-]+\.py)\b", run):
                assert (workdir / script).is_file(), f"{workflow_name}:{job_name} runs missing {script}"


@pytest.mark.parametrize("workflow_name", ["collect.yml", "train.yml", "archive.yml", "import-dca-history.yml"])
def test_production_jobs_install_runtime_requirements_only(workflow_name):
    """requirements-dev.txt adds test tooling the jobs never need."""
    runs = [s.get("run", "") for job in WORKFLOWS[workflow_name]["jobs"].values() for s in job.get("steps", [])]
    installs = [r for r in runs if "pip install" in r]
    assert installs and all("requirements.txt" in r and "requirements-dev" not in r for r in installs)
