# SPDX-License-Identifier: Apache-2.0
"""重新生成备份格式矩阵夹具（backend/tests/fixtures/backup-formats/）。

为什么需要这个脚本：test_backup_coverage.py 的 test_backup_format_matrix 用仓库里
冻结的样本包证明「升级一次之后仍读得回历史格式」。样本必须由**生成时的当前代码**
导出——2.0 把迁移链换成单基线（0001_baseline_v2）并新增 app_schema_epoch 之后，2.0
之前生成的旧样本会被 _check_candidate_revision / epoch 校验拒收。所以夹具不是一次性
的：迁移链或备份格式变化后都要重跑本脚本。

产物（覆盖同名文件）：

    format-1.zip           单数据集、不含密钥 / 全局配置 / 字体
    format-3.zip           用户显式勾选「包含 API Key」（格式 3）
    format-4.zip           嵌套整包（格式 4，含 1 份额外数据集）
    format-5.zip           带全局模型配置（格式 5，含 global_llm.json）
    format-6.zip           再带全局字体（格式 6，含 global_assets.json + fonts/*.ttf）
    tampered-format-1.zip  清单 format 改成 99（「来自更新版本」的拒收样本）
    tampered-format-6.zip  清单 global_assets.version 改成不认识的版本（字体段 fail-closed）

隔离：脚本在系统临时目录里建 data/ 与 staging/，并在导入应用**之前**设好
DATABASE_URL / RF_DATA_DIR / LOG_FILE_ENABLED=false；不读写 backend/data。
数据全是合成的（「合成用户」、example.invalid、合成字体字节），不含真实个人信息。

用法（在 backend 目录）：

    PYTHONUTF8=1 .venv/Scripts/python.exe scripts/make_backup_format_fixtures.py
    PYTHONUTF8=1 .venv/Scripts/python.exe scripts/make_backup_format_fixtures.py --output D:/tmp/fixtures
"""

from __future__ import annotations

import argparse
import io
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = BACKEND_DIR / "tests" / "fixtures" / "backup-formats"

# 与 test_backup_coverage.FORMAT_FIXTURES 一致：文件名 →（format, type）。
FORMAT_FIXTURES: dict[str, tuple[int, str]] = {
    "format-1.zip": (1, "dataset"),
    "format-3.zip": (3, "dataset"),
    "format-4.zip": (4, "collection"),
    "format-5.zip": (5, "dataset"),
    "format-6.zip": (6, "dataset"),
}

SYNTHETIC_FONT_NAME = "Synthetic-Sans.ttf"
# 不要求是可用字体：格式 6 的夹具只需要「真实字体文件进包」这一形状（size + sha256），
# 导入侧按清单逐文件校验，不解析字形。
SYNTHETIC_FONT_BYTES = b"\x00\x01\x00\x00" + b"synthetic-font-bytes" * 16
SYNTHETIC_LLM = {
    "base_url": "https://example.invalid/v1",
    "model": "synthetic-fixture-model",
    "api_key": "sk-synthetic-fixture-not-a-real-key",
}


def _prepare_environment(root: Path) -> Path:
    """在导入 app 之前定好隔离数据目录；返回 staging（故意放在数据目录之外）。"""
    data_dir = root / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    staging_dir = root / "staging"
    staging_dir.mkdir(parents=True, exist_ok=True)
    os.environ["RF_DATA_DIR"] = str(data_dir)
    os.environ["DATABASE_URL"] = "sqlite:///" + (data_dir / "resume_forge.db").as_posix()
    os.environ["LOG_FILE_ENABLED"] = "false"
    return staging_dir


def _seed_synthetic_rows(engine: Any) -> None:
    """往旧六表里放几条纯合成数据（新模型表保持 0 行，测试按清单核对行数）。"""
    from app.models.profile import Education, UserProfile
    from sqlalchemy.orm import Session

    with Session(engine) as session:
        profile = UserProfile(
            name="合成用户",
            email="synthetic@example.invalid",
            phone="00000000000",
            summary="合成样例数据，不含任何真实个人信息。",
        )
        session.add(profile)
        session.flush()
        session.add(
            Education(
                profile_id=profile.id,
                school="示例大学",
                department="示例学院",
                major="示例专业",
                degree="本科",
            )
        )
        session.commit()


def _seed_global_llm() -> None:
    from app.schemas.setting import LLMConfig
    from app.services.global_llm_profiles import write_global_llm

    write_global_llm(LLMConfig(**SYNTHETIC_LLM))


def _seed_fonts() -> None:
    from app.services import user_fonts

    directory = user_fonts.fonts_dir()
    directory.mkdir(parents=True, exist_ok=True)
    (directory / SYNTHETIC_FONT_NAME).write_bytes(SYNTHETIC_FONT_BYTES)
    (directory / user_fonts.ACTIVE_FILENAME).write_text(
        json.dumps({"name": SYNTHETIC_FONT_NAME}, ensure_ascii=False), encoding="utf-8"
    )
    (directory / user_fonts.NAMES_FILENAME).write_text(
        json.dumps({SYNTHETIC_FONT_NAME: "合成字体"}, ensure_ascii=False), encoding="utf-8"
    )


def _rewrite_manifest(source: Path, target: Path, mutate: Any) -> None:
    """复制一份包并改写清单（其余成员原样搬运）；与测试里的同名助手保持同一形状。"""
    from app.services.data_backup.paths import MANIFEST_MEMBER

    with (
        zipfile.ZipFile(source) as src,
        zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as dst,
    ):
        for info in src.infolist():
            payload = src.read(info.filename)
            if info.filename == MANIFEST_MEMBER:
                manifest = json.loads(payload)
                mutate(manifest)
                payload = json.dumps(manifest, ensure_ascii=False).encode("utf-8")
            dst.writestr(info, payload)


def _build_archives(engine: Any, staging_dir: Path) -> dict[str, Path]:
    """按内容分级生成七个包，返回 {目标文件名: 生成出的临时包路径}。"""
    from app.dataset_registry import dataset_database_file
    from app.services.data_backup import ExtraDatabase, create_backup_archive
    from app.services.data_backup.collection_export import create_collection_archive
    from app.services.datasets import create_dataset

    created: dict[str, Path] = {}

    # 1/3：单数据集。先做这两个，保证包里没有全局成员。
    created["format-1.zip"] = create_backup_archive(engine, staging_dir)
    created["format-3.zip"] = create_backup_archive(engine, staging_dir, include_api_keys=True)

    # 4：嵌套整包。额外数据集与主数据各自一份子包；全局成员只在外层且这里不带。
    extra = create_dataset("合成数据集", engine)
    created["format-4.zip"] = create_collection_archive(
        engine,
        staging_dir,
        extras=[
            ExtraDatabase(
                dataset_id=extra["id"],
                name=extra["name"],
                source=dataset_database_file(extra["id"]),
            )
        ],
        include_global_llm=False,
        include_global_assets=False,
    )

    # 5：带全局模型配置（字体目录仍空 → 格式号停在 5，不虚升到 6）。
    _seed_global_llm()
    created["format-5.zip"] = create_backup_archive(engine, staging_dir, include_global_llm=True)

    # 6：再带上字体（有真实字体文件才升到 6）。
    _seed_fonts()
    created["format-6.zip"] = create_backup_archive(
        engine, staging_dir, include_global_llm=True, include_global_assets=True
    )
    return created


def _candidate_database_bytes(archive: Path) -> bytes:
    """取活动数据集候选库字节：格式 4 从 datasets/main.zip 里取，其余取包根。"""
    from app.services.data_backup.paths import DATABASE_MEMBER, MANIFEST_MEMBER

    with zipfile.ZipFile(archive) as handle:
        manifest = json.loads(handle.read(MANIFEST_MEMBER))
        if manifest.get("format") != 4:
            return handle.read(DATABASE_MEMBER)
        entry = next(item for item in manifest["datasets"] if item.get("id") == "main")
        with zipfile.ZipFile(io.BytesIO(handle.read(entry["file"]))) as sub:
            return sub.read(DATABASE_MEMBER)


def _verify(output: Path, engine: Any) -> list[str]:
    """逐项核对验收事实；任何一条不满足都以非零退出码失败。"""
    from alembic.script import ScriptDirectory
    from app.database_migrations import application_tables, build_alembic_config
    from app.services import schema_epoch
    from app.services.data_backup.paths import MANIFEST_MEMBER

    head = ScriptDirectory.from_config(build_alembic_config(engine)).get_current_head()
    expected_tables = set(application_tables())
    lines: list[str] = []

    for name, (format_version, archive_type) in FORMAT_FIXTURES.items():
        archive = output / name
        assert archive.is_file(), f"缺少产物：{archive}"
        with zipfile.ZipFile(archive) as handle:
            assert handle.testzip() is None, f"{name} 压缩包损坏"
            manifest = json.loads(handle.read(MANIFEST_MEMBER))
            members = set(handle.namelist())
        assert manifest["format"] == format_version, (name, manifest["format"])
        assert manifest["type"] == archive_type, (name, manifest["type"])
        assert type(manifest["format"]) is int
        if format_version == 4:
            # 整包没有包根事务库：revision 在每份子包清单里各记一次。
            assert manifest["datasets"], manifest["datasets"]
            for entry in manifest["datasets"]:
                assert entry["alembic_revision"] == head, (name, entry["alembic_revision"])
        else:
            assert manifest["alembic_revision"] == head, (name, manifest["alembic_revision"])
            assert type(manifest["api_key_included"]) is bool

        database = output / ("verify-" + name + ".db")
        database.write_bytes(_candidate_database_bytes(archive))
        try:
            assert schema_epoch.read_revision(database) == head
            assert schema_epoch.read_epoch(database) == schema_epoch.SCHEMA_EPOCH
            # sqlite3 的连接上下文管理器只提交事务、不关闭连接；Windows 上不显式
            # close 就删不掉文件（WinError 32）。
            connection = sqlite3.connect(database)
            try:
                present = {
                    row[0]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    )
                }
            finally:
                connection.close()
            assert expected_tables <= present, sorted(expected_tables - present)
            # 与导入侧 _database_info 同一口径：候选库里不允许出现当前代码不认识的
            # 业务表（FTS 派生表与 SQLite 内部表除外）。夹具生成后若模型又变了，
            # 这里会先红，而不是等备份矩阵导入时才红。
            unexpected = sorted(
                table
                for table in present - expected_tables - {schema_epoch.ALEMBIC_TABLE}
                if not table.startswith("sqlite_")
                and not table.startswith(("knowledge_fts", "search_fts"))
            )
            assert not unexpected, (name, unexpected)
        finally:
            database.unlink(missing_ok=True)

        if format_version == 1:
            assert members == {"resume_forge.db", "manifest.json"}, members
        if format_version == 3:
            assert manifest["api_key_included"] is True
        if format_version == 4:
            assert {"manifest.json", "README.txt", "datasets/main.zip"} <= members, members
            assert len(manifest["datasets"]) == 2, manifest["datasets"]
        if format_version == 5:
            assert "global_llm.json" in members
            assert "global_assets.json" not in members
        if format_version == 6:
            assert "global_assets.json" in members
            assert manifest["global_assets"]["version"] == 1
            assert any(
                member.startswith("fonts/") and member.endswith(".ttf") for member in members
            ), members
        revision = (
            manifest["datasets"][0]["alembic_revision"]
            if format_version == 4
            else manifest["alembic_revision"]
        )
        lines.append(
            "  {name:22s} format={fmt} type={typ:10s} app={app} revision={rev} "
            "epoch={epoch} size={size}B".format(
                name=name,
                fmt=format_version,
                typ=archive_type,
                app=manifest["app_version"],
                rev=revision,
                epoch=schema_epoch.SCHEMA_EPOCH,
                size=archive.stat().st_size,
            )
        )

    def _future_format(manifest: dict[str, Any]) -> None:
        manifest["format"] = 99

    def _unknown_global_assets(manifest: dict[str, Any]) -> None:
        manifest["global_assets"]["version"] = manifest["global_assets"]["version"] + 1

    tampered_checks = (
        ("tampered-format-1.zip", "format-1.zip", _future_format),
        ("tampered-format-6.zip", "format-6.zip", _unknown_global_assets),
    )
    for target_name, source_name, mutate in tampered_checks:
        target = output / target_name
        _rewrite_manifest(output / source_name, target, mutate)
        with zipfile.ZipFile(target) as handle:
            manifest = json.loads(handle.read(MANIFEST_MEMBER))
        if target_name == "tampered-format-1.zip":
            assert manifest["format"] == 99, manifest["format"]
        else:
            assert manifest["global_assets"]["version"] > 1, manifest["global_assets"]
        lines.append(f"  {target_name:22s} tampered size={target.stat().st_size}B")
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="重新生成备份格式矩阵夹具。")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="夹具输出目录（默认 backend/tests/fixtures/backup-formats）",
    )
    args = parser.parse_args(argv)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    root = Path(tempfile.mkdtemp(prefix="rf-backup-fixtures-"))
    staging_dir = _prepare_environment(root)
    if str(BACKEND_DIR) not in sys.path:
        sys.path.insert(0, str(BACKEND_DIR))
    try:
        from app import database
        from app.database_migrations import run_database_migrations

        engine = database.engine
        try:
            run_database_migrations(engine)
            _seed_synthetic_rows(engine)
            created = _build_archives(engine, staging_dir)
            for name, source in created.items():
                shutil.move(str(source), str(output / name))
            lines = _verify(output, engine)
        finally:
            # Windows 上连接池没释放时临时目录删不掉（文件被占用）。
            engine.dispose()
    finally:
        module = sys.modules.get("app.database")
        if module is not None:
            module.engine.dispose()
        shutil.rmtree(root, ignore_errors=True)

    print(f"已生成 {len(lines)} 个备份格式夹具 -> {output}")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
