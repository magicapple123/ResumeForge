# SPDX-License-Identifier: Apache-2.0
"""资料大字段/组的新表备份回归（F2 契约 §5.3 / 需求 R-48/R-49/R-51）。

钉住三件事：

1. 新模型 8 张表都在备份清单里（表集合 == 模型注册表，台账守卫继续成立）；
2. 仓库冻结的备份格式样本仍可导入，样本里新模型表为空、旧表行数与清单一致
   （格式号兼容面与库版本闸门是两件事：1.x 的**库**会被拒收，<= 当前格式号的
   **包**不因格式号被拒）；
3. 2.0 起 has_legacy_data 恒 False（不再探测 1.x 旧表，旧库由启动闸门整包归档），
   new_profile_has_entries 如实反映新资料模型是否有内容。

旧 revision（0063）相关用例随 1.x 备份拒收（T05）与旧迁移测试下线（T02）删除：
2.0 不再把 1.x 备份包迁移成新库，那条路径已不存在；"1.x 包被拒收"由
``test_backup_reject_legacy.py`` 覆盖。
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

from app import database
from app.database_migrations import application_tables
from app.models.profile import Education, UserProfile
from app.services.data_backup import (
    MANIFEST_MEMBER,
    asset_categories,
    create_backup_archive,
    inspect_archive,
)
from app.services.data_backup.coverage import COVERED_DIRECTORIES, RUNTIME_ONLY
from app.services.profile.entry_store import upsert_entry
from app.services.profile.profile_reader import load_workspace_upgrade_status
from sqlalchemy.orm import Session

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "backup-formats"
# F1 新增的 8 张表（0064 只加表）；备份清单必须包含它们。
NEW_PROFILE_TABLES = (
    "profile_entry",
    "profile_group",
    "profile_group_member",
    "profile_workspace_state",
    "profile_custom_section",
    "profile_custom_field",
    "profile_field_preference",
    "profile_usage_snapshot",
)
OLD_PROFILE_TABLES = ("user_profile", "education", "experience", "project", "skill", "award")


def _read_manifest(archive: Path) -> dict:
    with zipfile.ZipFile(archive) as handle:
        return json.loads(handle.read(MANIFEST_MEMBER))


def test_new_profile_tables_are_covered_by_the_backup_manifest(tmp_path, db_session):
    """新表进了清单、行数随包走；三盏红灯的表覆盖/资产类别两条继续成立。"""
    upsert_entry(db_session, "basic_info", values={"basic_info.name": "张三"})
    db_session.add(UserProfile(name="旧姓名"))
    db_session.flush()
    profile = db_session.query(UserProfile).first()
    db_session.add(Education(profile_id=profile.id, school="旧学校"))
    db_session.commit()

    archive = create_backup_archive(database.engine, tmp_path / "staging")
    manifest = _read_manifest(archive)
    tables = manifest["tables"]

    assert set(tables) == set(application_tables())
    assert set(NEW_PROFILE_TABLES) <= set(tables)
    assert tables["profile_entry"] == 1  # 新模型内容确实随包走
    assert tables["user_profile"] == 1 and tables["education"] == 1  # 旧表继续随包走（R-48）
    # 另两盏红灯的静态不变量（行为用例见 test_backup_coverage.py）。
    assert set(asset_categories.ASSET_CATEGORIES) == set(COVERED_DIRECTORIES)
    assert not (COVERED_DIRECTORIES & RUNTIME_ONLY)
    assert manifest["uncovered_count"] == len(manifest["uncovered"])


def test_frozen_backup_format_sample_imports_with_empty_new_tables(tmp_path):
    """仓库冻结的备份格式样本仍可导入；样本里新模型表为空、旧表行数与清单一致。"""
    fixture = FIXTURE_DIR / "format-6.zip"
    assert fixture.is_file(), "缺少格式样本包，请跑 scripts/make_backup_format_fixtures.py"

    preview = inspect_archive(fixture, database.engine, tmp_path / "staging")
    counts = preview["database"]["tables"]
    declared = preview["manifest"]["tables"]

    for name in NEW_PROFILE_TABLES:
        assert counts[name] == 0, f"格式样本导入后新表 {name} 不是空的"
    for name in OLD_PROFILE_TABLES:
        assert name in counts, f"旧表 {name} 在导入后不存在"
        assert counts[name] == declared.get(name, 0), f"旧表 {name} 行数与清单不一致"
    assert preview["manifest"]["format"] == 6


def test_new_model_write_makes_upgrade_status_disappear():
    """新模型一旦有实际内容，升级提示自然消失（R-47 的"后半个布尔"）。"""
    with Session(database.engine) as session:
        upsert_entry(session, "basic_info", values={"basic_info.name": "新姓名"})
        has_legacy, new_has_entries = load_workspace_upgrade_status(session)
    assert new_has_entries is True
    assert has_legacy is False
