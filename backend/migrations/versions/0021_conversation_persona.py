# SPDX-License-Identifier: Apache-2.0
"""0021：助手视角从「对话技能」解耦到 `chat_conversation.persona_id`（T26）。

为什么必须落列：视角原先复用「对话技能」通道（把 `视角 · X` 这条内置技能挂到会话上），
于是视角与用户自己的技能共用同一张关联表、同一份预算、同一套消息级语义（T24 把技能改成
按消息生效后，视角会被"下一条消息"的语义一起带走）。视角是**会话属性**，不是技能。

迁移做三件事，顺序不能换：

1. **加列**（`server_default=""`，存量会话一律"通用视角"，行为与升级前一致）；
2. **把历史视角搬回列里**：`assistant_conversation_skill` join `assistant_skill`，名字命中
   `视角 · %` 的行按会话写回 `persona_id`。名字 → id 的映射写死在本文件里（迁移必须能独立
   跑，不 import 应用代码；新增视角不需要改这里——本迁移只处理"这一次"的历史行）；
3. **删掉这些关联行**：不删的话 `current_persona_id` 的"一个版本的回退读取"会在用户把
   视角切回通用之后又把旧视角读回来。`assistant_skill` 行本身**保留**（用户可能已导出/
   引用，删了不可逆；技能列表接口按前缀过滤，界面看不到它们）。

降级：尽力把列里的视角写回关联行（技能行还在就复用，不在就重建一条最小行），然后删列。
降级只保证"视角不丢"，不保证 `assistant_skill.prompt` 与当前 prompt 文件同步——那本来就
是运行时读取的。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021_conversation_persona"
down_revision: str | Sequence[str] | None = "0020_fk_indexes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "chat_conversation"
_COLUMN = "persona_id"
_LINK = "assistant_conversation_skill"
_SKILL = "assistant_skill"
_PREFIX = "视角 · "

#: 技能名 → 视角 id。**只用于搬历史数据**，与 `assistant_personas.PERSONAS` 的 label 对应。
_NAME_TO_ID: dict[str, str] = {
    f"{_PREFIX}HR 六秒扫描": "hr_scan",
    f"{_PREFIX}面试官追问": "interviewer",
    f"{_PREFIX}猎头判断": "headhunter",
}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns(table)}


def upgrade() -> None:
    """加列 → 把历史视角搬进列 → 删掉视角关联行（表缺失则整段跳过）。"""
    tables = _tables()
    if _TABLE not in tables:
        return
    if _COLUMN not in _columns(_TABLE):
        with op.batch_alter_table(_TABLE) as batch:
            batch.add_column(
                sa.Column(_COLUMN, sa.String(length=16), nullable=False, server_default="")
            )

    # 2/3 只在两张关联表都在时才可能。
    if _LINK not in tables or _SKILL not in tables:
        return
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            f"SELECT csk.conversation_id AS conversation_id, s.name AS name "  # noqa: S608
            f"FROM {_LINK} AS csk JOIN {_SKILL} AS s ON s.id = csk.skill_id "
            "WHERE s.name LIKE :pattern"
        ),
        {"pattern": f"{_PREFIX}%"},
    ).fetchall()
    for row in rows:
        persona_id = _NAME_TO_ID.get(str(row.name or "").strip())
        if not persona_id:
            continue
        bind.execute(
            sa.text(
                f"UPDATE {_TABLE} SET {_COLUMN} = :persona_id "  # noqa: S608
                "WHERE id = :conversation_id AND ("
                f"{_COLUMN} IS NULL OR {_COLUMN} = '')"
            ),
            {"persona_id": persona_id, "conversation_id": int(row.conversation_id)},
        )

    # 删掉"视角技能"的关联行（用户的其它技能行一条不动）。
    bind.execute(
        sa.text(
            f"DELETE FROM {_LINK} WHERE skill_id IN ("  # noqa: S608
            f"SELECT id FROM {_SKILL} WHERE name LIKE :pattern)"
        ),
        {"pattern": f"{_PREFIX}%"},
    )


def downgrade() -> None:
    """尽力把列写回关联行，然后删列；缺表/缺列一律跳过而不是报错。"""
    tables = _tables()
    if _TABLE not in tables or _COLUMN not in _columns(_TABLE):
        return
    bind = op.get_bind()

    if _LINK in tables and _SKILL in tables:
        rows = bind.execute(
            sa.text(
                f"SELECT id, {_COLUMN} AS persona_id FROM {_TABLE} "  # noqa: S608
                f"WHERE {_COLUMN} IS NOT NULL AND {_COLUMN} != ''"
            )
        ).fetchall()
        id_to_name = {persona_id: name for name, persona_id in _NAME_TO_ID.items()}
        for row in rows:
            name = id_to_name.get(str(row.persona_id))
            if not name:
                continue
            skill_id = bind.execute(
                sa.text(f"SELECT id FROM {_SKILL} WHERE name = :name"),  # noqa: S608
                {"name": name},
            ).scalar()
            if skill_id is None:
                # 技能行被用户删过：重建一条最小行，视角本身不丢。
                # 这些列在模型里是 NOT NULL（Python 侧 default 在裸 SQL 上不生效），逐个给值。
                bind.execute(
                    sa.text(
                        f"INSERT INTO {_SKILL} "  # noqa: S608
                        "(name, description, prompt, enabled, source_name, when_to_use, steps, "
                        "pitfalls, version, generated, validation_status, created_at, updated_at) "
                        "VALUES (:name, '', '', 1, '', '', '', '', 1, 0, '', "
                        "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                    ),
                    {"name": name},
                )
                skill_id = bind.execute(
                    sa.text(f"SELECT id FROM {_SKILL} WHERE name = :name"),  # noqa: S608
                    {"name": name},
                ).scalar()
            exists = bind.execute(
                sa.text(
                    f"SELECT 1 FROM {_LINK} WHERE conversation_id = :cid AND skill_id = :sid"  # noqa: S608
                ),
                {"cid": int(row.id), "sid": int(skill_id)},
            ).scalar()
            if exists:
                continue
            bind.execute(
                sa.text(
                    f"INSERT INTO {_LINK} (conversation_id, skill_id, created_at) "  # noqa: S608
                    "VALUES (:cid, :sid, CURRENT_TIMESTAMP)"
                ),
                {"cid": int(row.id), "sid": int(skill_id)},
            )

    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_column(_COLUMN)
