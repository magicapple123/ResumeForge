#!/usr/bin/env python
# SPDX-License-Identifier: Apache-2.0
"""R01 演练的命令行编排：阶段子进程、报告合并、临时目录清理。"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from .common import (
    _APP_ENV_KEYS,
    BACKEND_DIR,
    REPO_ROOT,
    Drill,
    changed_files,
    tree_fingerprints,
    within,
)
from .restore_phase import restore_and_verify
from .source_phase import export_and_verify, seed_source

ENTRY_PATH = REPO_ROOT / "scripts" / "backup_restore_drill.py"

# ===== 阶段环境（两个阶段必须各自独立进程）=====


def prepare_environment(phase: str, work_root: Path) -> dict[str, Path]:
    """设置独立数据目录的环境变量；必须在 import app 之前调用。"""
    if within(work_root, REPO_ROOT):
        raise SystemExit(f"R01 演练拒绝运行：工作目录必须在仓库外（{work_root}）")
    roots = {
        "source": work_root / "source",
        "target": work_root / "target",
        "archives": work_root / "archives",
    }
    for path in roots.values():
        path.mkdir(parents=True, exist_ok=True)
    # 阶段名为 source / restore，数据根分别为 source / target（恢复发生在另一个目录）。
    root = roots["source"] if phase == "source" else roots["target"]
    roots["data_root"] = root
    os.environ["DATABASE_URL"] = "sqlite:///" + (root / "resume_forge.db").as_posix()
    os.environ["RF_DATA_DIR"] = str(root)
    os.environ["LOG_FILE_ENABLED"] = "false"
    os.environ["AUTO_BACKUP_ENABLED"] = "false"
    os.environ.pop("RF_DESKTOP_SHELL", None)
    if str(BACKEND_DIR) not in sys.path:
        sys.path.insert(0, str(BACKEND_DIR))
    return roots


def assert_isolated(root: Path) -> None:
    """安全闸：配置解析出来的数据目录/数据库必须都在演练目录内。"""
    from app.config import DATA_DIR, get_settings

    database = Path(get_settings().database_url.removeprefix("sqlite:///"))
    for label, path in (("DATA_DIR", Path(DATA_DIR)), ("DATABASE_URL", database)):
        if not within(path, root):
            raise SystemExit(f"R01 演练拒绝运行：{label} 不在演练目录内（{path}）")


def write_report(path: Path | None, report: dict[str, Any]) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def load_report(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


# ===== 阶段入口与主流程 =====


def run_phase(phase: str, work_root: Path, report_path: Path | None) -> int:
    roots = prepare_environment(phase, work_root)
    assert_isolated(roots["data_root"])
    drill = Drill(phase)
    started = time.monotonic()
    if phase == "source":
        expected = seed_source(roots["source"])
        export_and_verify(drill, roots["source"], roots["archives"], expected)
    else:
        restore_and_verify(drill, roots["target"], roots["archives"])
    report = drill.report()
    report["duration_seconds"] = round(time.monotonic() - started, 1)
    write_report(report_path, report)
    print(
        f"阶段 {phase}：{report['passed']}/{report['total']} 项通过，"
        f"耗时 {report['duration_seconds']}s"
    )
    return 0 if drill.ok else 1


def spawn_phase(phase: str, work_root: Path, report_path: Path) -> int:
    env = {key: value for key, value in os.environ.items() if key not in _APP_ENV_KEYS}
    env["PYTHONUTF8"] = "1"
    command = [
        sys.executable,
        str(ENTRY_PATH),
        "--phase",
        phase,
        "--work-dir",
        str(work_root),
        "--json-out",
        str(report_path),
    ]
    print(f"-> 阶段 {phase}（独立进程）", flush=True)
    completed = subprocess.run(command, env=env, cwd=str(REPO_ROOT), check=False)
    return completed.returncode


def run_drill(work_root: Path, json_out: Path | None) -> int:
    started = time.monotonic()
    source_rc = spawn_phase("source", work_root, work_root / "source-report.json")
    source_report = load_report(work_root / "source-report.json")
    before = tree_fingerprints(work_root / "source", ignore_sqlite_sidecars=True)
    restore_rc = 1
    restore_report: dict[str, Any] | None = None
    if source_rc == 0 and source_report is not None:
        restore_rc = spawn_phase("restore", work_root, work_root / "restore-report.json")
        restore_report = load_report(work_root / "restore-report.json")
    else:
        print("源阶段未通过，跳过恢复阶段（无法证明恢复语义）", flush=True)
    after = tree_fingerprints(work_root / "source", ignore_sqlite_sidecars=True)

    cross = Drill("cross")
    cross.check("cross.workdir_outside_repo", not within(work_root, REPO_ROOT))
    changed = changed_files(before, after)
    cross.check("cross.source_unchanged", not changed, f"源目录被改动：{changed[:3]}")

    phases = {"source": source_report, "restore": restore_report}
    checks: list[dict[str, Any]] = []
    for report in phases.values():
        if report:
            checks.extend(report.get("checks") or [])
    keys = [str(item.get("key")) for item in checks]
    duplicates = sorted({key for key in keys if keys.count(key) > 1})
    cross.check("cross.unique_check_ids", not duplicates, f"{duplicates[:3]}")
    checks.extend(cross.checks)
    ok = (
        all(report is not None and report.get("ok") for report in phases.values())
        and cross.ok
        and source_rc == 0
        and restore_rc == 0
    )
    merged = {
        "drill": "R01 完整备份与隔离恢复演练",
        "ok": ok,
        "work_dir": str(work_root),
        "duration_seconds": round(time.monotonic() - started, 1),
        "phases": phases,
        "checks": checks,
        "passed": sum(1 for item in checks if item.get("ok")),
        "total": len(checks),
    }
    write_report(json_out, merged)
    print_summary(merged)
    return 0 if ok else 1


def print_summary(report: dict[str, Any]) -> None:
    failed = [item for item in report["checks"] if not item.get("ok")]
    print("", flush=True)
    print("=" * 72, flush=True)
    print(f"R01 演练结果：{'通过' if report['ok'] else '失败'}", flush=True)
    print(f"检查项：{report['passed']}/{report['total']} 通过，{len(failed)} 失败", flush=True)
    print(f"耗时：{report['duration_seconds']}s；工作目录：{report['work_dir']}", flush=True)
    for item in failed:
        print(f"  [FAIL] {item.get('key')} — {item.get('detail')}", flush=True)
    print("=" * 72, flush=True)


def safe_cleanup(work_root: Path) -> None:
    """只清理**自己**用 mkdtemp 建的那一层；认不出来就保留并提示。"""
    try:
        resolved = work_root.resolve()
        temp_root = Path(tempfile.gettempdir()).resolve()
        if resolved.parent != temp_root or not resolved.name.startswith("rf-backup-drill-"):
            print(f"未自动清理（不是本脚本建的工作目录）：{resolved}", flush=True)
            return
        shutil.rmtree(resolved)
        print(f"已清理演练临时目录：{resolved}", flush=True)
    except OSError as exc:
        print(f"清理临时目录失败（请手动检查 {work_root}）：{exc}", flush=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="R01 完整备份与隔离恢复演练（合成数据，绝不碰真实数据）"
    )
    parser.add_argument("--work-dir", type=Path, default=None, help="演练工作目录（默认临时目录）")
    parser.add_argument("--json-out", type=Path, default=None, help="汇总报告输出路径")
    parser.add_argument(
        "--phase", choices=("source", "restore"), default=None, help="内部：只跑某一阶段"
    )
    parser.add_argument("--keep", action="store_true", help="保留自动创建的临时工作目录")
    args = parser.parse_args(argv)

    if args.phase is not None:
        if args.work_dir is None:
            parser.error("--phase 需要配合 --work-dir")
        return run_phase(args.phase, args.work_dir.resolve(), args.json_out)

    auto_created = args.work_dir is None
    work_root = (
        Path(tempfile.mkdtemp(prefix="rf-backup-drill-"))
        if auto_created
        else args.work_dir.resolve()
    )
    if within(work_root, REPO_ROOT):
        print(f"R01 演练拒绝运行：工作目录必须在仓库外（{work_root}）", file=sys.stderr)
        return 2
    print(f"R01 演练工作目录：{work_root}", flush=True)
    status = run_drill(work_root, args.json_out)
    if auto_created and not args.keep:
        safe_cleanup(work_root)
    elif auto_created:
        print(f"已保留工作目录（--keep）：{work_root}", flush=True)
    return status


if __name__ == "__main__":
    raise SystemExit(main())
