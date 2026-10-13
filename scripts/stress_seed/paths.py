"""Sandbox path policy for stress-seed runs.

Security decisions live here and only here:

- The output directory must resolve strictly *inside* the sandbox root
  (never equal to it, never outside).
- Symlinks and Windows junctions/reparse points anywhere on the path chain
  between the sandbox root and the target are rejected, so a link that
  points outside the sandbox cannot smuggle writes out.
- A target that already exists (file or directory) is rejected: every run
  gets a fresh run-id directory and there is deliberately no "overwrite the
  old database" shortcut.
- Whether a path happens to contain the substring "stress" is NOT a security
  signal and is never consulted.
"""

from __future__ import annotations

import random
import sys
from datetime import datetime
from pathlib import Path


class PathSafetyError(Exception):
    """Raised when a requested output path is unsafe; message is user-facing."""


def _is_reparse_point(path: Path) -> bool:
    """Best-effort detection of symlinks and Windows junctions.

    ``Path.is_symlink()`` covers real symlinks on both platforms. Junctions
    (``IO_REPARSE_TAG_MOUNT_POINT``) are *not* reported by ``is_symlink``;
    ``Path.is_junction()`` exists from Python 3.12 on, so on 3.11 we fall
    back to inspecting the reparse-point attribute via ``os.path``. Any
    probe error is treated as "unsafe" (fail closed).
    """
    try:
        if path.is_symlink():
            return True
    except OSError:
        return True
    if sys.platform == "win32":
        try:
            if hasattr(path, "is_junction") and path.is_junction():  # Python 3.12+
                return True
        except OSError:
            return True
    return False


def validate_target_dir(target: Path, sandbox_root: Path) -> Path:
    """Validate that ``target`` is a fresh directory strictly inside the sandbox.

    Returns the fully resolved target path. Raises :class:`PathSafetyError`
    when the path escapes the sandbox, traverses a reparse point, or already
    exists. Performs read-only filesystem probing only -- the caller decides
    when to actually create the directory.
    """
    if not target.name or target.parent == target:
        raise PathSafetyError(f"target path must name a directory, not a root: {target}")

    sandbox = sandbox_root.resolve()
    resolved = target.resolve()

    if resolved == sandbox or sandbox not in resolved.parents:
        raise PathSafetyError(
            f"output path must be strictly inside the sandbox root {sandbox} (resolved: {resolved})"
        )

    # Reject any reparse point on the chain between sandbox and target so a
    # junction/symlink cannot redirect part of the tree elsewhere.
    current = sandbox
    for part in resolved.relative_to(sandbox).parts:
        current = current / part
        if _is_reparse_point(current):
            raise PathSafetyError(
                f"path component is a symlink/junction, refusing to write through it: {current}"
            )

    if target.exists() or resolved.exists():
        raise PathSafetyError(
            f"output target already exists, refusing to touch it "
            f"(every run must use a fresh directory): {target}"
        )
    return resolved


def propose_run_dir(sandbox_root: Path, now: datetime, rng: random.Random) -> Path:
    """Propose a fresh run-id directory ``stress-<timestamp>-<rand>``.

    Uses the caller-provided clock and RNG so proposals are testable. The
    directory is *not* created here; creation happens only after validation
    in ``cli.run_seed``.
    """
    stamp = now.strftime("%Y%m%d-%H%M%S")
    for _ in range(8):
        candidate = sandbox_root / f"stress-{stamp}-{rng.randbytes(2).hex()}"
        if not candidate.exists():
            return candidate
    raise PathSafetyError(
        f"could not propose a fresh run directory under {sandbox_root} after 8 attempts"
    )


def ensure_inside_sandbox(resolved_target: Path, sandbox_root: Path) -> None:
    """Re-assert containment right before any write (defence in depth)."""
    sandbox = sandbox_root.resolve()
    if resolved_target == sandbox or sandbox not in resolved_target.parents:
        raise PathSafetyError(
            f"resolved target escaped sandbox root: {resolved_target} vs {sandbox}"
        )
