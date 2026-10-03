"""备份密钥安全：明文密钥收集、剥离（secure_delete+VACUUM）与最终闸（职责③）。

安全语义整函数搬运零改动。
"""
from __future__ import annotations

import json
import sqlite3

from contextlib import closing
from pathlib import Path
from sqlalchemy import Engine

from ..settings_service import API_KEY_MASK, _LLM_CONFIG_KEY

from .paths import BackupError, database_path


def _plaintext_api_keys(bind: Engine) -> list[str]:
    """收集当前库里真实存在的明文密钥，用于导出后的残留校验。"""
    return _plaintext_api_keys_in(database_path(bind))


def _plaintext_api_keys_in(database: Path) -> list[str]:
    """从**一个数据库文件**里收集明文密钥。

    按文件而不是按 Engine 取，是因为"导出全部数据集"要为**每一份**数据集各做一次
    密钥剥离——否则随包带走的第二份数据集会把它的明文 Key 一起送出去，而这个包正是
    用户会长期保存或转发的东西。

    ``********`` 开头的是记录引用占位符而不是密钥本身，不参与校验。
    """
    found: list[str] = []
    with closing(sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True)) as connection:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        if "app_setting" in tables:
            row = connection.execute(
                "SELECT value FROM app_setting WHERE key = ?", (_LLM_CONFIG_KEY,)
            ).fetchone()
            if row and row[0]:
                try:
                    value = json.loads(row[0]).get("api_key", "")
                except (json.JSONDecodeError, AttributeError):
                    value = ""
                if value and not value.startswith(API_KEY_MASK):
                    found.append(value)
        if "llm_config_record" in tables:
            found.extend(
                key
                for (key,) in connection.execute("SELECT api_key FROM llm_config_record")
                if key and not key.startswith(API_KEY_MASK)
            )
    # 太短的值会在几 MB 的文件里随机命中，只校验长度像密钥的内容。
    return [item for item in found if len(item) >= 8]


def _strip_api_keys(database: Path) -> None:
    """把备份副本里的模型密钥置空，并抹掉已释放页面中的残留。

    ``UPDATE`` 只改活着的行：用户删除过的配置记录、或历史版本被覆盖的取值，都会
    把明文密钥留在 SQLite 的空闲页里，而 ``sqlite3.Connection.backup()`` 是逐页
    复制的，会把这些页一起带进备份。所以先开 ``secure_delete`` 让删除操作就地清零，
    再用 ``VACUUM`` 按存活数据重建整个文件。只做其一都清不干净。
    """
    with closing(sqlite3.connect(database, timeout=30)) as connection:
        connection.execute("PRAGMA secure_delete = ON")
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        if "llm_config_record" in tables:
            connection.execute("UPDATE llm_config_record SET api_key = ''")
        if "app_setting" in tables:
            row = connection.execute(
                "SELECT value FROM app_setting WHERE key = ?", (_LLM_CONFIG_KEY,)
            ).fetchone()
            if row is not None:
                try:
                    config = json.loads(row[0])
                except (TypeError, json.JSONDecodeError):
                    config = None
                if isinstance(config, dict):
                    config["api_key"] = ""
                    connection.execute(
                        "UPDATE app_setting SET value = ? WHERE key = ?",
                        (json.dumps(config, ensure_ascii=False), _LLM_CONFIG_KEY),
                    )
                else:
                    # 配置本身已损坏时读取端本来就会退回默认值，直接删掉等价。
                    connection.execute("DELETE FROM app_setting WHERE key = ?", (_LLM_CONFIG_KEY,))
        connection.commit()
        # VACUUM 必须独立于事务之外执行。
        connection.execute("VACUUM")


def _assert_no_plaintext_key(database: Path, secrets_to_find: list[str]) -> None:
    """导出前的最后一道闸：确认快照里再也找不到任何明文密钥。"""
    if not secrets_to_find:
        return
    content = database.read_bytes()
    if any(secret.encode("utf-8") in content for secret in secrets_to_find):
        raise BackupError(
            "导出已取消：备份中仍能匹配到明文 API Key，请联系维护者",
            status_code=500,
        )

