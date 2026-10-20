# SPDX-License-Identifier: Apache-2.0
"""Subprocess smoke test for the desktop asar dependency gate (audit PR-04).

desktop/scripts/check-asar-deps.js statically verifies that every local
module in the desktop shell's require graph is covered by the
electron-builder manifest. The node:test suite in desktop/scripts/
test-asar-deps-check.js is the primary coverage; this wrapper keeps the gate
green from the Python test suite too, so the updater.js packaging fix
(missing top-level require in the packaged app.asar) cannot silently regress
without any test run noticing. Skipped when node is unavailable so the
backend suite still runs on machines without a Node toolchain.
"""

import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
DESKTOP_DIR = REPO_ROOT / "desktop"
CHECK_SCRIPT = DESKTOP_DIR / "scripts" / "check-asar-deps.js"


@pytest.mark.skipif(not CHECK_SCRIPT.exists(), reason="desktop check script not present")
@pytest.mark.skipif(shutil.which("node") is None, reason="node not available")
def test_desktop_require_graph_covered_by_builder_manifest() -> None:
    """main.js's recursive local require graph must be in the builder manifest."""
    result = subprocess.run(
        ["node", str(CHECK_SCRIPT), "--source", str(DESKTOP_DIR)],
        cwd=DESKTOP_DIR,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
    )
    assert result.returncode == 0, (
        "desktop require graph is not covered by electron-builder.yml "
        f"(exit {result.returncode})\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
    # The module that was missing from the manifest before the PR-04 fix;
    # pin it explicitly so a future manifest revert fails with a clear name.
    assert "updater.js" in result.stdout
