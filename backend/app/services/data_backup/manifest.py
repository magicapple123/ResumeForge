"""备份清单：版本链、表计数与包内清单生成（职责②）。"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import Any

from alembic.script import ScriptDirectory
from sqlalchemy import Engine, text

from ...config import get_settings
from ...database_migrations import _APPLICATION_TABLES, build_alembic_config
from .paths import BACKUP_FORMAT_MULTI_DATASET, BACKUP_FORMAT_WITH_KEYS


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
    bind: Engine,
    *,
    datasets: Sequence[dict[str, Any]] = (),
    api_key_included: bool = False,
    asset_manifest: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """生成包内清单。

    **格式号按内容分级、显式计算**（分级定义见 ``paths.py``）：只有活动数据集且不含
    密钥时仍是格式 1，老版本照常可读；带上其余数据集标 2（老版本读不懂 ``datasets/``
    这一段，放行会让用户以为"恢复成功"而实际只恢复了一份）；用户勾选"包含 API Key"
    时标 3——这个选项老版本完全没有对应逻辑，必须让它们拿到"请先升级"的明确信号，
    所以它的优先级最高。

    ``asset_manifest`` 是活动数据集的资产清单（PR-15）：段内自带 ``manifest_version``。
    老版本读到这个**额外的段**会忽略——DB 照常恢复，只是不带附件（与老版本本来的
    行为一致，不会更差）；当前版本的导入侧按段内版本号 fail-closed 处理。
    """
    settings = get_settings()
    extras = list(datasets)
    if api_key_included:
        format_version = BACKUP_FORMAT_WITH_KEYS
    elif extras:
        format_version = BACKUP_FORMAT_MULTI_DATASET
    else:
        format_version = 1
    manifest: dict[str, Any] = {
        "format": format_version,
        "app": settings.app_name,
        "app_version": settings.app_version,
        "alembic_revision": current_head_revision(bind),
        "exported_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "tables": _table_counts(bind),
        # 与 export 侧的剥离/保留逻辑对应：False 是默认（密钥已清空），True 只能来自
        # 用户的显式勾选。导入侧 fail-closed：这个字段缺失或乱值都拒收。
        "api_key_included": bool(api_key_included),
    }
    if asset_manifest is not None:
        manifest["asset_manifest"] = asset_manifest
    if api_key_included:
        # RF-24：随包密钥的风险要在包里自带说明——恢复时用户可能早已忘了勾过这个框。
        # Windows 的 DPAPI 密文绑定原用户与原机器，跨机不可解（应用按"未配置"处理）；
        # 非 Windows 平台本就按明文存，随包走的就是明文。
        manifest["api_key_note"] = (
            "本包包含 API Key：Windows 上导出的是绑定原电脑与原用户的加密密文，"
            "在其他电脑上无法解密（导入后按未配置处理，请重新填写）；"
            "在 macOS/Linux 上密钥以明文随包，请妥善保管或传输后立即删除。"
        )
    if extras:
        manifest["datasets"] = extras
    return manifest
