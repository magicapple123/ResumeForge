# SPDX-License-Identifier: Apache-2.0
"""0067：单价档案表 + 用量账本缓存命中列。

只加表、只加列，不删任何东西（旧备份仍可导入）。

- ``usage_pricing_record``：单价从 `app_setting` 的一对键升级成**可命名、可回溯**的记录。
  一条记录 = 一份"某服务商在某时间点"的价目，三档单价按**每百万 token** 计：输入缓存命中、
  输入缓存未命中、输出。历史记录保留（`is_active=False`），可随时切回。
- ``llm_usage_record.cache_hit_tokens`` / ``cache_miss_tokens``：把输入 token 拆成两档。
  列可空——0067 之前的账本没有这个信息，NULL 表示"没记录过"，不是 0。

**升级安全**：两张表都先查存在性再动手（迁移链也会跑在只有部分业务表的历史库上）。
老的单价格式（每千 token）会被搬成一条名为「旧版单价」的记录，单位换算 ×1000——
否则升级后用户会突然看到"未配置单价"，已经算过的账对不上。

**downgrade 完整可逆**：先删两列（SQLite 走 batch_alter_table 重建表），再删表；
老 `app_setting` 的键不动（升级时只读不删），所以回退后旧配置仍然生效。

Revision ID: 0067_usage_pricing_records
Revises: 0066_interview_link_resume_duration
Create Date: 2026-10-28
"""

import contextlib
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0067_usage_pricing_records"
down_revision: str | Sequence[str] | None = "0066_interview_link_resume_duration"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PRICING_TABLE = "usage_pricing_record"
_USAGE_TABLE = "llm_usage_record"
_SETTING_TABLE = "app_setting"
# 老配置的键（与 services/llm/usage_ledger.py 的 PRICING_KEY_* 一致）。
_LEGACY_KEYS = ("llm_price_per_1k_input", "llm_price_per_1k_output", "llm_price_currency")
_LEGACY_NAME = "旧版单价（每千 token 换算）"
# (列名, 建列语句)
_COLUMNS: tuple[tuple[str, sa.Column], ...] = (
    ("cache_hit_tokens", sa.Column("cache_hit_tokens", sa.Integer(), nullable=True)),
    ("cache_miss_tokens", sa.Column("cache_miss_tokens", sa.Integer(), nullable=True)),
)


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return name in _inspector().get_table_names()


def _columns(table: str) -> set[str]:
    return {column["name"] for column in _inspector().get_columns(table)}


def _create_pricing_table() -> None:
    if _has_table(_PRICING_TABLE):
        return
    op.create_table(
        _PRICING_TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("input_cache_hit_per_million", sa.Float(), nullable=True),
        sa.Column("input_cache_miss_per_million", sa.Float(), nullable=True),
        sa.Column("output_per_million", sa.Float(), nullable=True),
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="CNY"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index(f"ix_{_PRICING_TABLE}_is_active", _PRICING_TABLE, ["is_active"])
    op.create_index(f"ix_{_PRICING_TABLE}_created_at", _PRICING_TABLE, ["created_at"])


def _add_usage_columns() -> None:
    if not _has_table(_USAGE_TABLE):
        return
    existing = _columns(_USAGE_TABLE)
    for name, column in _COLUMNS:
        if name in existing:
            continue
        with op.batch_alter_table(_USAGE_TABLE) as batch:
            batch.add_column(column)


def _legacy_settings() -> dict[str, float | str] | None:
    """读老的单价格式；没有配置（或表/行不存在）返回 None。"""
    if not _has_table(_SETTING_TABLE):
        return None
    # 孤儿库 / 部分历史库上可能出现同名但结构不全的 app_setting（比如只有 id 列）。
    # 迁移链承诺跑在这种库上：缺 key/value 列就意味着"不可能有旧单价"，直接跳过，
    # 否则下面的 SELECT key, value 会抛 no such column 让整条迁移链失败。
    if not {"key", "value"} <= _columns(_SETTING_TABLE):
        return None
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT key, value FROM app_setting WHERE key IN :keys").bindparams(
            sa.bindparam("keys", expanding=True)
        ),
        {"keys": list(_LEGACY_KEYS)},
    ).fetchall()
    values: dict[str, str] = {}
    for key, raw in rows:
        # 值是 JSON 编码的（`0.002` / `"CNY"`），容错解析：坏值当没配。
        text = str(raw).strip().strip('"')
        values[key] = text
    try:
        input_per_1k = float(values[_LEGACY_KEYS[0]])
        output_per_1k = float(values[_LEGACY_KEYS[1]])
    except (KeyError, TypeError, ValueError):
        return None
    currency = (values.get(_LEGACY_KEYS[2]) or "CNY")[:8] or "CNY"
    return {"input": input_per_1k, "output": output_per_1k, "currency": currency}


def _migrate_legacy_pricing() -> None:
    legacy = _legacy_settings()
    if legacy is None:
        return
    # 每千 → 每百万：×1000。老版本只有一个"输入价"，按未命中档承接（保守，宁可估高）。
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "INSERT INTO usage_pricing_record "
            "(name, input_cache_hit_per_million, input_cache_miss_per_million, "
            " output_per_million, currency, is_active, created_at, updated_at) "
            "VALUES (:name, NULL, :miss, :output, :currency, 1, "
            "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ),
        {
            "name": _LEGACY_NAME,
            "miss": float(legacy["input"]) * 1000.0,
            "output": float(legacy["output"]) * 1000.0,
            "currency": legacy["currency"],
        },
    )


def upgrade() -> None:
    _create_pricing_table()
    _add_usage_columns()
    if _has_table(_PRICING_TABLE):
        # 已有记录（重复升级）就不要重复插入。
        existing = (
            op.get_bind().execute(sa.text(f"SELECT COUNT(*) FROM {_PRICING_TABLE}")).scalar_one()
        )
        if not existing:
            _migrate_legacy_pricing()


def downgrade() -> None:
    if _has_table(_USAGE_TABLE):
        existing = _columns(_USAGE_TABLE)
        with op.batch_alter_table(_USAGE_TABLE) as batch:
            for name, _column in reversed(_COLUMNS):
                if name in existing:
                    batch.drop_column(name)
    if _has_table(_PRICING_TABLE):
        for index in (
            f"ix_{_PRICING_TABLE}_is_active",
            f"ix_{_PRICING_TABLE}_created_at",
        ):
            # 索引本来就不存在时继续（重复 downgrade 时不报错）。
            with contextlib.suppress(Exception):
                op.drop_index(index, table_name=_PRICING_TABLE)
        op.drop_table(_PRICING_TABLE)
