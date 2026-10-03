"""备份清单：版本链、表计数与包内清单生成（职责②）。"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import Any

from alembic.script import ScriptDirectory
from sqlalchemy import Engine, text

from ...config import get_settings

from .paths import BACKUP_FORMAT_VERSION
from ...database_migrations import _APPLICATION_TABLES, build_alembic_config


def current_head_revision(bind: Engine) -> str | None:
    return ScriptDirectory.from_config(build_alembic_config(bind)).get_current_head()


def _revision_chain(bind: Engine) -> list[str]:
    """从当前 head 到最初版本的 revision 列表（本项目是线性链路）。"""
    scripts = ScriptDirectory.from_config(build_alembic_config(bind))
    head = scripts.get_current_head()
    if head is None:
        return []
    return [revision.revision for revision in scripts.iterate_revisions(head, "base")]


def _table_counts(bind: Engine) -> dict[str, int]:
    quote = bind.dialect.identifier_preparer.quote
    with bind.connect() as connection:
        return {
            name: connection.execute(text(f"SELECT COUNT(*) FROM {quote(name)}")).scalar_one()
            for name in _APPLICATION_TABLES
        }


def build_manifest(
    bind: Engine, *, datasets: Sequence[dict[str, Any]] = ()
) -> dict[str, Any]:
    """生成包内清单。

    **格式号随"包里有没有其余数据集"变化**：只有活动数据集时仍是格式 1，老版本照常可读；
    一旦带上了其余数据集就标成 2，老版本会明确拒收。这是刻意的——老版本读不懂
    ``datasets/`` 这一段，若还按格式 1 放行，用户会以为"恢复成功"，实际上那几份数据集
    根本没被恢复，而**这类故障通常要到很久以后翻旧记录时才发现**。
    """
    settings = get_settings()
    extras = list(datasets)
    manifest: dict[str, Any] = {
        "format": BACKUP_FORMAT_VERSION if extras else 1,
        "app": settings.app_name,
        "app_version": settings.app_version,
        "alembic_revision": current_head_revision(bind),
        "exported_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "tables": _table_counts(bind),
        "api_key_included": False,
    }
    if extras:
        manifest["datasets"] = extras
    return manifest

