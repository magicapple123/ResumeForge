# SPDX-License-Identifier: Apache-2.0
"""备份清单：版本链、表计数与包内清单生成（职责②）。"""

from __future__ import annotations

import sqlite3
from collections.abc import Sequence
from contextlib import closing
from datetime import datetime
from pathlib import Path
from typing import Any

from alembic.script import ScriptDirectory
from sqlalchemy import Engine, text

from ...config import get_settings
from ...database_migrations import _APPLICATION_TABLES, build_alembic_config
from .paths import (
    BACKUP_FORMAT_GLOBAL_ASSETS,
    BACKUP_FORMAT_GLOBAL_CONFIG,
    BACKUP_FORMAT_MULTI_DATASET,
    BACKUP_FORMAT_WITH_KEYS,
)


def current_head_revision(bind: Engine) -> str | None:
    return ScriptDirectory.from_config(build_alembic_config(bind)).get_current_head()


def _revision_chain(bind: Engine) -> list[str]:
    """从当前 head 到最初版本的 revision 列表（本项目是线性链路）。"""
    scripts = ScriptDirectory.from_config(build_alembic_config(bind))
    head = scripts.get_current_head()
    if head is None:
        return []
    return [revision.revision for revision in scripts.iterate_revisions(head, "base")]


def _table_counts(bind: Engine) -> tuple[dict[str, int], list[str]]:
    """按**实际存在的表**统计；模型里有、库里没有的表记 0 并单独列出（H1）。

    为什么不能直接按 ``_APPLICATION_TABLES`` 逐张 COUNT：旧数据集（如停在 0040 的
    「体验示例」）没有后加的表，``COUNT(*)`` 会抛 ``no such table``，整包导出中止。
    备份工具的职责是"把能带走的都带走、把没有的说清楚"，不是要求每份库都是最新结构。
    """
    quote = bind.dialect.identifier_preparer.quote
    with bind.connect() as connection:
        present = {
            str(row[0])
            for row in connection.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))
        }
        counts: dict[str, int] = {}
        missing: list[str] = []
        for name in _APPLICATION_TABLES:
            if name not in present:
                counts[name] = 0
                missing.append(name)
                continue
            counts[name] = connection.execute(
                text(f"SELECT COUNT(*) FROM {quote(name)}")
            ).scalar_one()
    return counts, missing


def build_manifest(
    bind: Engine,
    *,
    datasets: Sequence[dict[str, Any]] = (),
    api_key_included: bool = False,
    asset_manifest: dict[str, Any] | None = None,
    snapshot: Path | None = None,
    global_llm_profiles: int | None = None,
    global_assets_fonts: int | None = None,
    uncovered: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """生成包内清单。

    **格式号按内容分级、显式计算**（分级定义见 ``paths.py``）：只有活动数据集且不含
    密钥时仍是格式 1，老版本照常可读；带上其余数据集标 2（老版本读不懂 ``datasets/``
    这一段，放行会让用户以为"恢复成功"而实际只恢复了一份）；用户勾选"包含 API Key"
    时标 3——这个选项老版本完全没有对应逻辑，必须让它们拿到"请先升级"的明确信号，
    所以它的优先级最高。5 = 带全局模型配置，6 = 再带上字体（P2）；**只有真写了字体
    才标 6**，字体目录为空时保持 5，不能让格式号虚升。

    ``asset_manifest`` 是活动数据集的资产清单（PR-15）：段内自带 ``manifest_version``。
    老版本读到这个**额外的段**会忽略——DB 照常恢复，只是不带附件（与老版本本来的
    行为一致，不会更差）；当前版本的导入侧按段内版本号 fail-closed 处理。

    ``uncovered`` 是导出侧的兜底扫描结果（P3）：只把**名字与字节数**写进清单，
    ``uncovered_count`` 让界面不必遍历就能报数。
    """
    settings = get_settings()
    extras = list(datasets)
    if global_assets_fonts is not None:
        format_version = BACKUP_FORMAT_GLOBAL_ASSETS
    elif global_llm_profiles is not None:
        format_version = BACKUP_FORMAT_GLOBAL_CONFIG
    elif api_key_included:
        format_version = BACKUP_FORMAT_WITH_KEYS
    elif extras:
        format_version = BACKUP_FORMAT_MULTI_DATASET
    else:
        format_version = 1
    if snapshot is not None:
        tables, missing_tables = _snapshot_table_counts(snapshot)
    else:
        tables, missing_tables = _table_counts(bind)
    manifest: dict[str, Any] = {
        "format": format_version,
        "app": settings.app_name,
        "app_version": settings.app_version,
        "alembic_revision": current_head_revision(bind),
        "exported_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "tables": tables,
        # 与 export 侧的剥离/保留逻辑对应：False 是默认（密钥已清空），True 只能来自
        # 用户的显式勾选。导入侧 fail-closed：这个字段缺失或乱值都拒收。
        "api_key_included": bool(api_key_included),
        # 包的类型（R16）：``collection`` 表示"这是一份包含多份数据集的整包"。
        # 它与 format 号是两件事——format 决定老版本能不能读（2/3 都要拒收），
        # type 决定**界面**怎么介绍它（"内含 3 份数据集"而不是"一份备份"）。
        # 导入逻辑不依赖这个字段：包里有 ``datasets/`` 就逐份恢复，缺失/乱值只影响文案。
        "type": "collection" if extras else "dataset",
    }
    if global_llm_profiles is not None:
        # 条数放进清单：导出侧响应头与导入确认都要能不解压就说出"带了几条配置"。
        manifest["global_llm"] = {"profiles": global_llm_profiles}
    if global_assets_fonts is not None:
        # 与 global_llm 同构：清单只放**摘要**（版本 + 字体数），细节在
        # ``global_assets.json`` 成员里。导入侧按这里的 version fail-closed。
        manifest["global_assets"] = {"version": 1, "fonts": int(global_assets_fonts)}
    if uncovered is not None:
        # P3：数据目录里"既不在包内、也不在已知不覆盖名单"的顶层项。段只增不改，
        # 旧版本读到会忽略（它们照样能恢复数据库），所以资产清单版本号不动。
        manifest["uncovered"] = list(uncovered.get("items") or [])
        manifest["uncovered_count"] = int(uncovered.get("count") or 0)
        if uncovered.get("truncated"):
            manifest["uncovered_truncated"] = True
    if missing_tables:
        # 旧库缺表（H1）：计数按 0 记，同时把名单写进清单，导入侧据此知道"这是历史库，
        # 不是导出失败"。导入后迁移会把这些表补出来，0 行的校验自然通过。
        manifest["missing_tables"] = missing_tables
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


def _snapshot_table_counts(snapshot: Path) -> tuple[dict[str, int], list[str]]:
    """快照库的表计数；缺失的表记 0 并返回名单（与 ``_table_counts`` 同一口径）。"""
    with closing(sqlite3.connect(snapshot.as_uri() + "?mode=ro", uri=True)) as connection:
        present = {
            str(row[0])
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        counts: dict[str, int] = {}
        missing: list[str] = []
        for name in _APPLICATION_TABLES:
            if name not in present:
                counts[name] = 0
                missing.append(name)
                continue
            counts[name] = connection.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
    return counts, missing
