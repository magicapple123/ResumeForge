# SPDX-License-Identifier: Apache-2.0
"""R01 完整备份与隔离恢复演练的守卫测试。

两层证据：

1. **整链证据**：在子进程里跑一次真实的 scripts/backup_restore_drill.py（合成数据、
   两个隔离临时目录），断言它自报的 120 项检查全过。脚本本身在子进程里跑而不是被
   import——它在导入 app 之后要按环境变量解析数据目录，进程内跑会把测试进程的
   DATABASE_URL 一起带偏。
2. **纯函数证据**：直接 import scripts/backup_drill 里的篡改/指纹辅助函数，确认
   "坏包"真的是被构造出来的（而不是演练里恰好没命中那条路径）。

不碰真实数据库：脚本自带安全闸（DATA_DIR / DATABASE_URL 必须在演练目录内），并且
本测试额外验证"工作目录在仓库内时拒绝运行"。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
ENTRY = SCRIPTS_DIR / "backup_restore_drill.py"

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from backup_drill import checks, cli, common  # noqa: E402 - 先补 scripts/ 到 sys.path

# 演练必须证明的 R01 范围（对应任务书 R01 的五组要求）。
REQUIRED_PREFIXES = {
    "单/全数据集导出": [
        "export.default.",
        "export.globals.",
        "export.keys.",
        "export.collection.",
    ],
    "uncovered 清单": ["export.default.uncovered_"],
    "隔离恢复": ["restore.single.", "restore.reimport.", "restore.collection."],
    "fail-closed": [
        "restore.reject.format",
        "restore.reject.asset_sha",
        "restore.reject.asset_missing",
        "restore.reject.row_counts",
        "restore.reject.asset_conflict",
    ],
    "旧数据不变": [
        "restore.single.preexisting_unchanged",
        "restore.globals.preexisting_unchanged",
        "cross.source_unchanged",
    ],
}


@pytest.fixture(scope="module")
def drill_result(tmp_path_factory: pytest.TempPathFactory) -> dict:
    """跑一次完整演练，返回（进程结果, 汇总报告, 工作目录）。"""
    work = tmp_path_factory.mktemp("r01-drill") / "work"
    report_path = work.parent / "r01-report.json"
    env = dict(os.environ, PYTHONUTF8="1")
    completed = subprocess.run(
        [
            sys.executable,
            str(ENTRY),
            "--work-dir",
            str(work),
            "--json-out",
            str(report_path),
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        timeout=300,
        check=False,
    )
    assert report_path.exists(), (
        f"演练没有写出汇总报告（退出码 {completed.returncode}）\n"
        f"stdout:\n{completed.stdout[-4000:]}\nstderr:\n{completed.stderr[-4000:]}"
    )
    return {
        "completed": completed,
        "report": json.loads(report_path.read_text(encoding="utf-8")),
        "work_dir": work,
        "report_path": report_path,
    }


def _flat_checks(report: dict) -> dict[str, dict]:
    return {str(item.get("key")): item for item in report.get("checks") or []}


def test_the_drill_passes_every_check(drill_result):
    completed = drill_result["completed"]
    report = drill_result["report"]
    assert completed.returncode == 0, (
        f"演练失败（退出码 {completed.returncode}）\n"
        f"失败项：{[item for item in report.get('checks') or [] if not item.get('ok')][:5]}\n"
        f"stdout:\n{completed.stdout[-4000:]}\nstderr:\n{completed.stderr[-2000:]}"
    )
    assert report["ok"] is True
    assert report["total"] == len(report["checks"])
    assert report["passed"] == report["total"]
    assert [item for item in report["checks"] if not item.get("ok")] == []


def test_the_drill_covers_every_r01_requirement(drill_result):
    keys = [str(item.get("key")) for item in drill_result["report"]["checks"]]
    for label, prefixes in REQUIRED_PREFIXES.items():
        for prefix in prefixes:
            assert any(key.startswith(prefix) for key in keys), f"{label}缺少 {prefix} 检查"
    # 关键单项（无法用前缀懒匹配的）逐条点名。
    for key in (
        "export.default.tables",
        "export.default.api_key_flag",
        "export.default.no_plaintext_key",
        "export.default.uncovered_excludes_runtime",
        "export.globals.font_count",
        "export.collection.datasets",
        "export.collection.isolation",
        "restore.single.tables",
        "restore.single.row_counts",
        "restore.keys.flag",
        "restore.keys.db_key_decrypts",
        "restore.keys.global_llm_key",
        "restore.keys.fonts_restored",
        "restore.collection.isolates_broken_subset",
        "restore.reject.format.no_partial_writes",
        "restore.reject.asset_sha.no_partial_writes",
        "restore.reject.asset_conflict.keeps_local",
        "cross.workdir_outside_repo",
        "cross.unique_check_ids",
    ):
        assert key in _flat_checks(drill_result["report"]), f"缺少检查项 {key}"


def test_restored_side_has_assets_fonts_and_new_datasets(drill_result):
    """恢复到新目录后：附件/字体/数据集都在，旧数据集文件还在原位。"""
    work = drill_result["work_dir"]
    target = work / "target"
    source = work / "source"
    assert (target / "resume_forge.db").exists()
    target_datasets = sorted((target / "datasets").glob("*.db"))
    # 1 份预置旧数据集 + 单数据集 2 次 + 含密钥 + 不含密钥 + 整包 2 份 + 坏子包 1 份。
    assert len(target_datasets) >= 8, [path.name for path in target_datasets]
    fonts = sorted(path.name for path in (target / "fonts").glob("*.ttf"))
    assert fonts == sorted([common.FONT_A_NAME, common.FONT_B_NAME])
    assert (target / "global_settings.json").exists()
    restored_assets = sorted((target / "datasets" / "user_files").iterdir())
    assert any(path.name.endswith(common.USER_FILE_NAME) for path in restored_assets)
    # 源目录（真实"旧数据"）在整场恢复之后仍在原处，且演练报告断言了字节未变。
    assert (source / "resume_forge.db").exists()
    assert (source / "user_files").is_dir()


def test_default_work_dir_cleanup_only_removes_its_own_temp_dir():
    """自动清理只认 mkdtemp 建的那一层；用户给的目录绝不被删。"""
    own = Path(tempfile.mkdtemp(prefix="rf-backup-drill-"))
    cli.safe_cleanup(own)
    assert not own.exists()

    foreign = Path(tempfile.mkdtemp(prefix="r01-not-ours-"))
    try:
        cli.safe_cleanup(foreign)
        assert foreign.exists(), "不是本脚本建的目录也被删了"
    finally:
        for path in foreign.rglob("*"):
            if path.is_file():
                path.unlink()
        for path in sorted(foreign.rglob("*"), reverse=True):
            if path.is_dir():
                path.rmdir()
        foreign.rmdir()


def test_rejects_a_work_dir_inside_the_repository(tmp_path):
    forbidden = REPO_ROOT / "runtime" / "r01-drill-must-not-exist"
    assert not forbidden.exists()
    completed = subprocess.run(
        [sys.executable, str(ENTRY), "--work-dir", str(forbidden)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=dict(os.environ, PYTHONUTF8="1"),
        timeout=120,
        check=False,
    )
    assert completed.returncode == 2
    assert "仓库外" in (completed.stdout + completed.stderr)
    assert not forbidden.exists(), "拒绝运行时不应该创建工作目录"


# ===== 纯函数：篡改辅助确实能造出坏包 =====


def _sample_zip(path: Path) -> Path:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("manifest.json", b'{"format": 1}')
        archive.writestr("user_files/keep.txt", b"keep")
        archive.writestr("user_files/drop.txt", b"drop")
    return path


def test_rewrite_zip_can_replace_and_remove_members(tmp_path):
    source = _sample_zip(tmp_path / "source.zip")
    destination = common.rewrite_zip(
        source,
        tmp_path / "tampered.zip",
        replacements={"user_files/keep.txt": b"tampered"},
        removals=("user_files/drop.txt",),
    )
    with zipfile.ZipFile(destination) as archive:
        names = set(archive.namelist())
        assert "user_files/drop.txt" not in names
        assert archive.read("user_files/keep.txt") == b"tampered"
        assert archive.read("manifest.json") == b'{"format": 1}'


def test_rewrite_manifest_and_database_helpers(tmp_path):
    source = _sample_zip(tmp_path / "source.zip")
    with zipfile.ZipFile(source, "a") as archive:
        archive.writestr(common.DATABASE_MEMBER, b"")
    bad_format = common.rewrite_manifest(
        source,
        tmp_path / "bad-format.zip",
        lambda manifest: manifest.__setitem__("format", 999),
    )
    assert common.read_json_member(bad_format, "manifest.json")["format"] == 999

    def mutate(database: Path) -> None:
        database.write_bytes(b"mutated database bytes")

    bad_database = common.rewrite_database(
        source, tmp_path / "bad-db.zip", tmp_path / "staging", mutate
    )
    assert common.read_member(bad_database, common.DATABASE_MEMBER) == b"mutated database bytes"


def test_fingerprints_detect_changes_and_additions(tmp_path):
    root = tmp_path / "tree"
    root.mkdir()
    first = root / "a.txt"
    first.write_text("one", encoding="utf-8")
    before = common.tree_fingerprints(root)
    assert before["a.txt"] == common.bytes_sha256(b"one")
    first.write_text("two", encoding="utf-8")
    (root / "b.txt").write_text("new", encoding="utf-8")
    after = common.tree_fingerprints(root)
    assert common.changed_files(before, after) == ["a.txt"]
    assert common.added_files(before, after) == ["b.txt"]


def test_sidecars_are_ignored_only_on_demand(tmp_path):
    root = tmp_path / "tree"
    root.mkdir()
    (root / "app.db").write_bytes(b"main")
    (root / "app.db-shm").write_bytes(b"sidecar")
    assert len(common.tree_fingerprints(root)) == 2
    assert set(common.tree_fingerprints(root, ignore_sqlite_sidecars=True)) == {"app.db"}


def test_digest_and_asset_expectations_are_consistent(tmp_path):
    archive = _sample_zip(tmp_path / "source.zip")
    size, digest = common.member_digest(archive, "user_files/keep.txt")
    assert (size, digest) == (4, common.bytes_sha256(b"keep"))
    assert common.member_contains(archive, "user_files/keep.txt", b"keep")
    assert not common.member_contains(archive, "user_files/keep.txt", b"absent")

    section = {
        "manifest_version": 1,
        "user_files": [{"name": "keep.txt", "size_bytes": 4, "sha256": digest}],
        "referral_images": [{"name": "shot.png", "size_bytes": 1, "sha256": "0" * 64}],
    }
    expected = checks.expected_assets(section, {"user_files": b"keep"})
    assert expected == {"user_files": {"keep.txt": b"keep"}}
    assert common.within(tmp_path / "tree" / "a.txt", tmp_path / "tree")
    assert not common.within(tmp_path / "tree-sibling", tmp_path / "tree")
