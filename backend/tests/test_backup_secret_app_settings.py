# SPDX-License-Identifier: Apache-2.0
"""备份「不含 API Key」导出必须剥离 app_setting 里的裸密钥行（语音 / 联网搜索）。

为什么单独一份：encrypt_key() 在 macOS/Linux 上**按设计返回明文**（只有 Windows 走
DPAPI），所以"不含密钥"的备份包里原本会留下语音服务与 DeepSeek 搜索的明文 Key。
本文件逐字证明这两个键在导出副本里既搜不到字符串、也不再留着那一行；勾选"包含
API Key"时仍按用户选择原样保留，本机正在用的设置不受影响。
"""

import json
import sqlite3
import zipfile
from contextlib import closing

from app.database import engine
from app.models.setting import AppSetting
from app.services.data_backup import (
    BACKUP_FORMAT_WITH_KEYS,
    DATABASE_MEMBER,
    MANIFEST_MEMBER,
    create_backup_archive,
)

ASR_KEY = "sk-asr-backup-canary-0123456789abcdef"
SEARCH_KEY = "sk-search-backup-canary-0123456789ab"


def _export(tmp_path, *, include_api_keys: bool = False):
    staging = tmp_path / ("staging-keys" if include_api_keys else "staging")
    return create_backup_archive(engine, staging, include_api_keys=include_api_keys)


def _database_bytes(archive_path) -> bytes:
    with zipfile.ZipFile(archive_path) as archive:
        return archive.read(DATABASE_MEMBER)


def _manifest(archive_path) -> dict:
    with zipfile.ZipFile(archive_path) as archive:
        return json.loads(archive.read(MANIFEST_MEMBER))


def _insert_plaintext_rows(db_session) -> None:
    """模拟非 Windows 的存储形态：加密函数按设计返回明文。

    直接写 AppSetting 行而不是走保存路径：本次守的是**备份层**，写路径的 Key 口径
    由 test_asr_profiles / test_search_deepseek 各自负责。
    """
    db_session.add_all(
        [
            AppSetting(key="asr_api_key", value=ASR_KEY),
            AppSetting(key="search_deepseek_api_key", value=SEARCH_KEY),
        ]
    )
    db_session.commit()
    db_session.expire_all()


def _secret_rows(archive) -> list[tuple[str, str]]:
    with closing(sqlite3.connect(f"{archive.as_uri()}?mode=ro", uri=True)) as connection:
        return connection.execute(
            "SELECT key, value FROM app_setting"
            " WHERE key LIKE 'asr_api_key%' OR key LIKE 'search_deepseek_api_key%'"
        ).fetchall()


def test_default_export_strips_plaintext_asr_and_search_keys(db_session, tmp_path):
    _insert_plaintext_rows(db_session)
    archive = _export(tmp_path)

    raw = _database_bytes(archive)
    assert ASR_KEY.encode() not in raw
    assert SEARCH_KEY.encode() not in raw
    assert _manifest(archive)["api_key_included"] is False

    # 行本身也不在备份副本里（备份是副本，删除即可）。
    extracted = tmp_path / "extracted.db"
    extracted.write_bytes(raw)
    assert _secret_rows(extracted) == []


def test_export_keeps_them_when_the_user_opts_in(db_session, tmp_path):
    _insert_plaintext_rows(db_session)
    archive = _export(tmp_path, include_api_keys=True)

    raw = _database_bytes(archive)
    assert ASR_KEY.encode() in raw
    assert SEARCH_KEY.encode() in raw
    manifest = _manifest(archive)
    assert manifest["api_key_included"] is True
    assert manifest["format"] == BACKUP_FORMAT_WITH_KEYS


def test_stripping_only_touches_the_backup_copy(db_session, tmp_path):
    """剥离的是快照，不能顺手清掉本机正在用的设置行。"""
    _insert_plaintext_rows(db_session)
    _export(tmp_path)

    db_session.expire_all()
    asr_row = db_session.get(AppSetting, "asr_api_key")
    search_row = db_session.get(AppSetting, "search_deepseek_api_key")
    assert asr_row is not None and asr_row.value == ASR_KEY
    assert search_row is not None and search_row.value == SEARCH_KEY
