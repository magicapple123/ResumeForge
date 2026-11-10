# SPDX-License-Identifier: Apache-2.0
"""内置示例包（问题清单 §6）：随包发布的完整演示数据集，走真实导入管线。

三层守卫：

1. **包内容计数**：直接打开 zip 里的数据库数行，与验收口径逐项比对。改了
   scripts/dataset_seed/** 却忘了重新生成包时，这里会红（清单 §6.4 防漂移）。
2. **包是干净/安全的**：没有 API Key、app_setting 为空、llm_config_record 为 0。
3. **载入行为**：导入后切到「体验示例」、计数正确、附件恢复；第二次复用同一份；
   旧代码播种的示例不会被复用；包导入失败时**明确报错、不回退代码播种**。
"""

from __future__ import annotations

import hashlib
import sqlite3
import zipfile
from pathlib import Path

import pytest
from app import database
from app.dataset_registry import datasets_directory
from app.services import sample_dataset
from app.services.data_backup import DATABASE_MEMBER, MANIFEST_MEMBER, BackupError
from app.services.sample_dataset import SAMPLE_SEED_VERSION, sample_seed_version
from sqlalchemy import text

PACK_PATH = Path(__file__).resolve().parents[1] / "app" / "assets" / "sample" / "sample_dataset.zip"

#: 验收口径（清单 §6.8 / 施工图第 6 条）：14 岗位 / 6 简历 / 52 资料 / 8 资料箱 /
#: 8 知识库 / 4 面经 / 10 台账 / 12 进度 / 60 网申资料 / 10 附件。
SAMPLE_PACK_EXPECTED_COUNTS = {
    "job": 14,
    "resume_record": 6,
    "profile_entry": 52,
    "material": 8,
    "knowledge_entry": 8,
    "interview_experience": 4,
    "claim_record": 10,
    "application_track": 12,
    "web_form_profile_entry": 60,
    "user_file": 10,
}


def _extract_pack_db(tmp_path: Path) -> Path:
    """把包里的数据库解到临时目录，供 sqlite3 直接读（不启动应用）。"""
    target = tmp_path / "pack.db"
    with zipfile.ZipFile(PACK_PATH) as archive:
        target.write_bytes(archive.read(DATABASE_MEMBER))
    return target


def _pack_manifest() -> dict:
    import json

    with zipfile.ZipFile(PACK_PATH) as archive:
        return json.loads(archive.read(MANIFEST_MEMBER))


def test_sample_pack_file_exists_and_is_not_ignored():
    """包必须真的在仓库里（随包发布；被 .gitignore 掉就会在发布包里消失）。"""
    assert PACK_PATH.is_file(), f"缺少内置示例包：{PACK_PATH}"
    assert PACK_PATH.stat().st_size > 600 * 1024, "示例包体积异常（应包含 10 个附件）"


def test_sample_pack_counts_match_acceptance(tmp_path):
    """计数守卫：包的逐表行数与验收口径一致（改了播种脚本却忘记重新打包会变红）。"""
    db_path = _extract_pack_db(tmp_path)
    connection = sqlite3.connect(str(db_path))
    try:
        for table, expected in SAMPLE_PACK_EXPECTED_COUNTS.items():
            actual = connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
            assert actual == expected, f"{table}: 期望 {expected} 行，包里是 {actual} 行"
    finally:
        connection.close()


def test_sample_pack_manifest_is_a_dataset_and_has_no_keys(tmp_path):
    manifest = _pack_manifest()
    assert manifest["format"] == 1
    assert manifest["type"] == "dataset"
    assert manifest["api_key_included"] is False
    assert manifest["app_version"]

    # 数据库层面再查一遍：全局设置空、模型配置 0 条，且没有任何 api_key 列带值。
    db_path = _extract_pack_db(tmp_path)
    connection = sqlite3.connect(str(db_path))
    try:
        assert connection.execute("SELECT COUNT(*) FROM app_setting").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM llm_config_record").fetchone()[0] == 0
        tables = [
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        ]
        for table in tables:
            columns = [
                row[1]
                for row in connection.execute(f'PRAGMA table_info("{table}")')
                if "api_key" in row[1].lower()
            ]
            for column in columns:
                rows = connection.execute(
                    f'SELECT COUNT(*) FROM "{table}" WHERE "{column}" IS NOT NULL AND "{column}" != ""'
                ).fetchone()
                assert rows[0] == 0, f"{table}.{column} 里有 {rows[0]} 行密钥"
    finally:
        connection.close()


def test_sample_seed_version_comes_from_pack_content_hash():
    """版本 = pack:<sha256 前 12>：内容变了 hash 自动变，不会复用旧内容。"""
    if sample_dataset._sample_pack_path() is None:  # pragma: no cover - 仓库里一定带包
        pytest.skip("仓库里没有内置示例包")
    digest = hashlib.sha256(PACK_PATH.read_bytes()).hexdigest()[:12]
    assert sample_seed_version() == f"pack:{digest}"


def _table_count(table: str) -> int:
    with database.SessionLocal() as session:
        return int(session.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar_one())


def test_load_sample_from_pack_creates_full_demo_dataset(client):
    """点一次「载入示例数据体验」：切到「体验示例」，各页面都有完整演示数据。"""
    response = client.post("/api/settings/datasets/sample/load")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["sample"] is True
    assert payload["reused"] is False
    assert payload["name"] == "体验示例"
    assert payload["source"] == "sample"

    # 数据集列表：它是激活项，且带示例来源标记（前端据此显示「示例」徽标）。
    datasets = client.get("/api/settings/datasets").json()
    active = [item for item in datasets if item["is_active"]]
    assert len(active) == 1
    assert active[0]["name"] == "体验示例"
    assert active[0]["source"] == "sample"
    assert active[0]["source_code"] == "sample"

    # 从 API 侧抽两处对账（其余表直接查库，避免依赖每个列表接口的形状）：
    # 14 行岗位里有 1 条在回收站（演示数据集刻意带一条已删除岗位），列表只显示 13；
    # 6 份简历里有 1 份是制作台草稿（draft），列表只显示 5。行数验收以表为准。
    assert client.get("/api/jobs").json()["total"] == 13
    assert client.get("/api/resumes").json()["total"] == 5
    for table, expected in SAMPLE_PACK_EXPECTED_COUNTS.items():
        assert _table_count(table) == expected, f"{table} 行数不对"


def test_load_sample_from_pack_restores_attachments(client):
    """导入要把包里的 10 个附件恢复到共享资产目录，且图片/PDF 内容可读。"""
    assert client.post("/api/settings/datasets/sample/load").status_code == 200

    user_files = datasets_directory() / "user_files"
    assert user_files.is_dir(), "附件目录没有恢复"
    files = sorted(path for path in user_files.iterdir() if path.is_file())
    assert len(files) == 10, f"附件数量不对：{[p.name for p in files]}"

    png = next((path for path in files if path.suffix.lower() == ".png"), None)
    pdf = next((path for path in files if path.suffix.lower() == ".pdf"), None)
    assert png is not None and png.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert pdf is not None and pdf.read_bytes()[:4] == b"%PDF"


def test_second_load_reuses_the_same_pack_dataset(client):
    """第二次点击复用同一份（reused=True、id 不变、列表里只有一份「体验示例」）。"""
    first = client.post("/api/settings/datasets/sample/load")
    assert first.status_code == 200, first.text
    first_id = first.json()["id"]

    second = client.post("/api/settings/datasets/sample/load")
    assert second.status_code == 200, second.text
    assert second.json()["id"] == first_id
    assert second.json()["reused"] is True
    assert second.json()["sample"] is True

    names = [item["name"] for item in client.get("/api/settings/datasets").json()]
    assert names.count("体验示例") == 1


def test_old_code_seeded_sample_is_not_reused_when_pack_exists(client, monkeypatch):
    """旧代码播种的示例（seed_version=3）不被复用：新包新建一份，旧份原样保留。"""
    monkeypatch.setattr(sample_dataset, "_sample_pack_path", lambda: None)
    legacy = client.post("/api/settings/datasets/sample/load")
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()["reused"] is False

    monkeypatch.setattr(sample_dataset, "_sample_pack_path", lambda: PACK_PATH)
    packed = client.post("/api/settings/datasets/sample/load")
    assert packed.status_code == 200, packed.text
    assert packed.json()["reused"] is False
    assert packed.json()["id"] != legacy.json()["id"]
    # 包版本落在新数据集上；旧份原样保留（不就地升级）。
    from app.dataset_registry import read_metadata

    assert read_metadata(packed.json()["id"])["seed_version"].startswith("pack:")
    assert read_metadata(legacy.json()["id"])["seed_version"] == SAMPLE_SEED_VERSION


def test_broken_pack_fails_loudly_instead_of_silently_seeding(client, monkeypatch):
    """包存在却导不进来：明确报错，**不回退**代码播种（否则用户以为载入成功）。"""
    monkeypatch.setattr(sample_dataset, "_sample_pack_path", lambda: PACK_PATH)

    def broken_import(*_args, **_kwargs):
        raise BackupError("备份包的数据库行数与清单不符，已停止导入：job")

    monkeypatch.setattr(sample_dataset, "import_dataset", broken_import)

    response = client.post("/api/settings/datasets/sample/load")
    assert response.status_code == 400, response.text
    assert "体验示例数据包导入失败" in response.json()["detail"]
    # 失败等于什么都没发生：列表里没有新建的「体验示例」。
    assert [item["name"] for item in sample_dataset.list_datasets()] == ["主数据"]
