# SPDX-License-Identifier: Apache-2.0
"""2.0 单基线迁移的测试参照点（T02）。

迁移链只剩 ``0001_baseline_v2`` 一条；revision 字面量一旦散落在测试里，下一条迁移
落地时就会集体过期，而失败信息会指向不相干的地方。测试统一从这里取常量/函数。

**本文件是 backend/tests 下唯一允许出现 revision 字面量的文件**：T02 的守卫命令是
``grep -rnE '"[0-9]{4}_[a-z0-9_]+"' backend/tests --include=*.py``（只允许命中这里）。
``LEGACY_1X_REVISION`` 是已发行 1.0.2 的 head，只用于构造「1.x 备份/旧库必须被拒收」
的样本，不属于当前迁移链。
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

# 2.0 唯一基线的 revision；将来新增迁移时用 head_revision() 取真实 head。
BASELINE_REVISION = "0001_baseline_v2"
# 已发行 ResumeForge 1.0.2 的迁移 head：构造「1.x 库 / 1.x 备份包」样本用。
LEGACY_1X_REVISION = "0046_search_fts"


def head_revision() -> str:
    """当前迁移链的 head，从 Alembic 实际读（写死字符串会在下个迁移落地时静默过期）。"""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option(
        "script_location", str(Path(__file__).resolve().parents[1] / "migrations")
    )
    return str(ScriptDirectory.from_config(config).get_current_head())


def prior_revision(suffix: str) -> str:
    """按 revision 名后缀定位某条迁移，返回它的父版本（用于「退到某迁移之前」）。

    为什么不用 downgrade -1 数步数：链尾每加一条迁移，步数就过期一次，而失败会表现成
    「降级没删表」这种看起来像业务 bug 的形态。按名字找父版本对「加迁移」免疫。

    后缀必须恰好命中一条；找不到或多条都大声失败——拼写错误不能被静默吞掉。
    """
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option(
        "script_location", str(Path(__file__).resolve().parents[1] / "migrations")
    )
    script = ScriptDirectory.from_config(config)
    matches = [revision for revision in script.walk_revisions() if revision.revision.endswith(suffix)]
    assert len(matches) == 1, f"期望恰好一条 revision 以 {suffix!r} 结尾，实际命中 {len(matches)} 条"
    return str(matches[0].down_revision)


def alembic_version_of(db: Any) -> str | None:
    """读库里的 ``alembic_version``；接受 Engine 或 SQLite 文件路径。

    表不存在、行不存在、文件不存在都返回 None（调用方据此断言"还没版本号"）。
    文件路径用只读连接打开：判定不该创建或改写任何库文件。
    """
    if isinstance(db, (str, Path)):
        database = Path(db)
        if not database.is_file():
            return None
        try:
            with closing(sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True)) as connection:
                tables = {
                    row[0]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    )
                }
                if "alembic_version" not in tables:
                    return None
                row = connection.execute("SELECT version_num FROM alembic_version").fetchone()
                return str(row[0]) if row and row[0] is not None else None
        except sqlite3.Error:
            return None
    try:
        with db.connect() as connection:
            row = connection.execute(text("SELECT version_num FROM alembic_version")).fetchone()
    except SQLAlchemyError:
        return None
    return str(row[0]) if row and row[0] is not None else None


__all__ = [
    "BASELINE_REVISION",
    "LEGACY_1X_REVISION",
    "alembic_version_of",
    "head_revision",
    "prior_revision",
]
