"""stress_seed 安全守卫：PR-01 诊断工具安全与可重复造数。

钉住的行为（全部在临时目录运行，绝不触碰真实 runtime/data）：

1. import ``seed_stress_data`` / ``stress_seed`` 模块零副作用（不写任何文件）；
2. ``--help`` / 非法参数不建目录、不建库；
3. 目标已存在 → 拒绝且原文件不变；
4. symlink / junction 逃逸 → 拒绝（绝不写穿链接）；
5. ``--check-only`` 严格只读（前后快照一致），绝不造数；
6. manifest 内容与实际产物一致（seed / 规模 / schema head / 引擎路径 / 哈希）。

全量造数很重，这里用 ``counts.smoke_counts()`` 的最小规模在进程内跑通
完整装配链路（路径校验 → 环境准备 → Alembic head → 造数 → manifest）。
"""

from __future__ import annotations

import hashlib
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "seed_stress_data.py"
SCRIPTS_DIR = REPO_ROOT / "scripts"

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from stress_seed import cli  # noqa: E402
from stress_seed.counts import smoke_counts  # noqa: E402

_SUBPROCESS_ENV = dict(
    os.environ,
    PYTHONUTF8="1",
    # 导入副作用测试的字节码缓存会写 .pyc，关掉它才好做"前后无新文件"断言。
    PYTHONDONTWRITEBYTECODE="1",
)


def _snapshot(roots: list[Path]) -> dict[str, str | None]:
    """Collect path -> content-hash for every file under ``roots``.

    ``__pycache__`` 目录排除：与本守卫无关，且其他并行测试可能合法地写它。
    """
    entries: dict[str, str | None] = {}
    for root in roots:
        if not root.exists():
            entries[str(root)] = None
            continue
        for item in sorted(root.rglob("*")):
            if "__pycache__" in item.parts:
                continue
            if item.is_file():
                entries[str(item)] = hashlib.sha256(item.read_bytes()).hexdigest()
            else:
                entries[str(item)] = "<dir>"
    return entries


def _run_cli(arguments: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *arguments],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=_SUBPROCESS_ENV,
        check=False,
    )


# ---------------------------------------------------------------------------
# 1) import 零副作用
# ---------------------------------------------------------------------------
def test_import_modules_has_no_filesystem_side_effects(tmp_path: Path) -> None:
    before = _snapshot([SCRIPTS_DIR, tmp_path])
    code = (
        "import sys; sys.path.insert(0, r'" + str(SCRIPTS_DIR) + "'); "
        "import seed_stress_data; "
        "import stress_seed.cli, stress_seed.paths, stress_seed.counts, "
        "stress_seed.context, stress_seed.schema, stress_seed.pipeline, "
        "stress_seed.manifest, stress_seed.inspect; "
        "print('IMPORT_OK')"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=str(tmp_path),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=_SUBPROCESS_ENV,
        check=False,
    )
    assert result.returncode == 0, result.stderr[-3000:]
    assert "IMPORT_OK" in result.stdout
    after = _snapshot([SCRIPTS_DIR, tmp_path])
    assert after == before, (
        f"import 产生了文件系统副作用: {set(after.items()) ^ set(before.items())}"
    )


# ---------------------------------------------------------------------------
# 2) --help / 非法参数不落盘
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "arguments,expected_code",
    [
        (["--help"], 0),
        (["--definitely-not-an-option"], 2),
    ],
)
def test_help_and_invalid_args_create_nothing(
    tmp_path: Path, arguments: list[str], expected_code: int
) -> None:
    sandbox = tmp_path / "sandbox"
    sandbox.mkdir()
    working_dir = tmp_path / "cwd"
    working_dir.mkdir()
    before = _snapshot([sandbox, working_dir])
    result = _run_cli(arguments, cwd=working_dir)
    assert result.returncode == expected_code, result.stderr[-2000:]
    assert _snapshot([sandbox, working_dir]) == before, "--help/非法参数不得写任何文件"


# ---------------------------------------------------------------------------
# 3) 目标已存在 → 拒绝且原文件不变
# ---------------------------------------------------------------------------
def test_rejects_existing_target_and_keeps_files_intact(tmp_path: Path) -> None:
    sandbox = tmp_path / "sandbox"
    run_dir = sandbox / "stress-20200101-0000-abcd"
    run_dir.mkdir(parents=True)
    db = run_dir / "stress.db"
    original = b"KEEP-ME-UNCHANGED"
    db.write_bytes(original)

    result = _run_cli(["--out", str(run_dir), "--sandbox-root", str(sandbox)], cwd=tmp_path)
    assert result.returncode != 0
    assert "already exists" in (result.stderr + result.stdout)
    assert db.read_bytes() == original
    assert sorted(p.name for p in run_dir.iterdir()) == ["stress.db"], "不得写入任何新文件"

    # 目标等于 sandbox 根本身同样必须被拒绝。
    result = _run_cli(["--out", str(sandbox), "--sandbox-root", str(sandbox)], cwd=tmp_path)
    assert result.returncode != 0


# ---------------------------------------------------------------------------
# 4) symlink / junction 逃逸 → 拒绝
# ---------------------------------------------------------------------------
def _make_dir_link(link: Path, target: Path) -> bool:
    """Create a directory symlink (or junction on Windows); False if unsupported."""
    try:
        os.symlink(target, link, target_is_directory=True)
        return True
    except (OSError, NotImplementedError):
        pass
    if sys.platform == "win32":
        try:
            import _winapi  # noqa: PLC0415

            _winapi.CreateJunction(str(target), str(link))
            return True
        except (OSError, ImportError):
            return False
    return False


def test_rejects_symlink_escape(tmp_path: Path) -> None:
    sandbox = tmp_path / "sandbox"
    outside = tmp_path / "outside"
    sandbox.mkdir()
    outside.mkdir()

    # 形态一：sandbox 直接放一个指向外面的链接（目标"存在"，也必须拒绝）。
    link = sandbox / "escape"
    if not _make_dir_link(link, outside):
        pytest.skip("当前环境无法创建 symlink/junction")
    result = _run_cli(["--out", str(link), "--sandbox-root", str(sandbox)], cwd=tmp_path)
    assert result.returncode != 0
    assert list(outside.iterdir()) == [], "逃逸目录里不得出现任何文件"

    # 形态二：链接藏在路径中段（目标本身不存在，靠解析后逃逸被拦）。
    nested = sandbox / "nested"
    nested.mkdir()
    nested_link = nested / "jump"
    _make_dir_link(nested_link, outside)
    result = _run_cli(
        ["--out", str(nested_link / "inner"), "--sandbox-root", str(sandbox)], cwd=tmp_path
    )
    assert result.returncode != 0
    assert list(outside.iterdir()) == [], "逃逸目录里不得出现任何文件"


# ---------------------------------------------------------------------------
# 5) --check-only 严格只读
# ---------------------------------------------------------------------------
def _craft_existing_run(run_dir: Path) -> None:
    run_dir.mkdir(parents=True)
    connection = sqlite3.connect(run_dir / "stress.db")
    try:
        connection.execute("CREATE TABLE job (id INTEGER PRIMARY KEY, title TEXT)")
        connection.executemany("INSERT INTO job (title) VALUES (?)", [("a",), ("b",)])
        connection.commit()
    finally:
        connection.close()
    (run_dir / "manifest.json").write_text('{"seed": 42}', encoding="utf-8")
    files_dir = run_dir / "user_files"
    files_dir.mkdir()
    (files_dir / "stray.txt").write_bytes(b"x")


def test_check_only_is_strictly_read_only(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _craft_existing_run(run_dir)
    before = _snapshot([run_dir])

    result = _run_cli(["--check-only", str(run_dir)], cwd=tmp_path)
    assert result.returncode == 0, result.stderr[-2000:]
    assert _snapshot([run_dir]) == before, "--check-only 不得改动任何字节"
    assert "check-only (read-only)" in result.stdout
    assert "job: 2" in result.stdout


def test_check_only_missing_target_creates_nothing(tmp_path: Path) -> None:
    sandbox = tmp_path / "sandbox"
    sandbox.mkdir()
    before = _snapshot([sandbox])
    result = _run_cli(["--check-only", str(sandbox / "nope")], cwd=tmp_path)
    assert result.returncode == 2
    assert _snapshot([sandbox]) == before, "check-only 目标缺失时不得创建任何东西"


# ---------------------------------------------------------------------------
# 6) 完整装配链路 + manifest 正确性（最小规模，进程内）
# ---------------------------------------------------------------------------
def test_seed_run_produces_consistent_manifest(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pytest.importorskip("alembic")
    pytest.importorskip("sqlalchemy")
    sandbox = tmp_path / "sandbox"
    saved_env = {key: os.environ.get(key) for key in ("DATABASE_URL", "LOG_FILE_ENABLED")}
    counts = smoke_counts()
    try:
        code = cli.run_seed(
            out_dir=None,
            sandbox_root=sandbox,
            counts=counts,
            seed=1234,
            argv=["--smoke"],
            api_check=False,
        )
        assert code == 0
    finally:
        for key, value in saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    run_dirs = [p for p in sandbox.iterdir() if p.is_dir()]
    assert len(run_dirs) == 1, "默认应生成一个 stress-<timestamp>-<rand> run 目录"
    run_dir = run_dirs[0]
    assert run_dir.name.startswith("stress-")

    db_path = run_dir / "stress.db"
    assert db_path.is_file()

    import json

    manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))

    # 声明的引擎路径 == 实际数据库路径
    assert manifest["engine_url"].endswith(db_path.as_posix())
    assert Path(manifest["database"]) == db_path.resolve()

    # 种子 / 规模 / 时间锚点
    assert manifest["seed"] == 1234
    assert manifest["scale_counts"]["job"] == counts.job
    assert manifest["now_anchor"]

    # schema head 与库内 alembic_version 一致（真实 Alembic head，不是 create_all）
    connection = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    try:
        head_in_db = connection.execute("SELECT version_num FROM alembic_version").fetchone()[0]
    finally:
        connection.close()
    assert manifest["schema_head"] == head_in_db
    assert head_in_db[0:4].isdigit(), "head revision 应形如 00NN_xxx"

    # 行数与规模一致
    assert manifest["table_counts"]["job"] == counts.job
    assert manifest["table_counts"]["knowledge_entry"] == counts.knowledge_entry

    # 数据库哈希可复算
    assert manifest["database_sha256"] == hashlib.sha256(db_path.read_bytes()).hexdigest()

    # user_files 物理文件与 DB 引用一致
    files_dir = run_dir / "user_files"
    disk_names = {p.name for p in files_dir.iterdir()}
    assert len(manifest["user_files"]) == len(disk_names)
    connection = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    try:
        referenced = {row[0] for row in connection.execute("SELECT disk_name FROM user_file")}
    finally:
        connection.close()
    assert referenced == disk_names, "user_file 表引用必须与物理文件一一对应"

    # 导入报告落盘
    report = (run_dir / "import_report.md").read_text(encoding="utf-8")
    assert "| job |" in report


def test_check_only_accepts_freshly_seeded_run(tmp_path: Path) -> None:
    """check-only 与 seed 完全分离：对刚造好的库做只读检查必须通过。"""
    pytest.importorskip("alembic")
    sandbox = tmp_path / "sandbox"
    saved = os.environ.get("DATABASE_URL")
    try:
        assert (
            cli.run_seed(out_dir=None, sandbox_root=sandbox, counts=smoke_counts(), seed=7, argv=[])
            == 0
        )
    finally:
        if saved is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = saved
    run_dir = next(p for p in sandbox.iterdir() if p.is_dir())

    from stress_seed.inspect import inspect_existing

    assert inspect_existing(run_dir) == 0


def test_counts_respect_track_pool_capacity() -> None:
    """回归（PR-17）：每个规模档位的进度条数都不得超过公司池容量。

    ``gen_apply.seed_tracks`` 用 ``company = COMPANIES[i // 12]`` 保证
    (company_key, title_key) 唯一，公司池（120 家）就是硬上限——修复前
    scale=2000 派生出 2304 条进度，直接 IndexError。派生值必须被钉在
    容量内，且仍是 12 的倍数。
    """
    from stress_seed.counts import ALLOWED_SCALES, TRACK_MAX_COUNT, counts_for_scale
    from stress_seed.vocab import COMPANIES

    assert len(COMPANIES) * 12 == TRACK_MAX_COUNT
    for scale in ALLOWED_SCALES:
        counts = counts_for_scale(scale)
        assert counts.application_track <= TRACK_MAX_COUNT, f"scale={scale}"
        assert counts.application_track % 12 == 0, f"scale={scale}"
