# SPDX-License-Identifier: Apache-2.0
"""0009：事实台账关联资料条目——claim_record 加 entry_ids + 一次性保守回填。

问题清单 §20 的 D1：生成链路的关联判据原先只看 sources[].location 是否等于资料条目
的 entry_id（24 位十六进制），而界面让用户填的是"链接 / 文件名"——两者永远对不上，
于是页面显示 10 条已确认、真实生成时 0 条进入基线（「已确认事实基线」恒为空）。

这个迁移只做数据层的第一半（服务层判据、表单与提示词由同批代码改）：

- 给 claim_record 加 entry_ids（JSON，可空）与 entry_ids_auto（Boolean，可空）。
  **旧行保持 NULL**：NULL = 从未关联，与 []（用户清空了关联）区分开，读取侧统一按
  "无关联"处理，不改变老数据的任何行为。
- 一次性**保守回填**：按 subject 与资料条目主字段（公司 / 项目 / 学校 / 组织 / 奖项 /
  论文 / 科研项目 / 知识产权 / 证书名）**去空白后双向包含**匹配，命中即写入该条目的
  entry_id（**不是 profile_entry.id**——两者是两列，存错等于没关联），未命中保持 NULL。
  **只在迁移时跑一次**，不在运行时反复猜。
- entry_ids_auto 记下"这条关联是迁移按主体名自动匹配出来的"，界面据此显示
  「已自动关联，请核对」；用户保存一次后由服务层清掉。

判据刻意保守（宁漏勿错：错关联会让 A 经历的台账去约束 B 经历的写法）：

1. 只匹配"这条资料是关于谁的"那个主字段，不拿描述 / 技能栈 / 就读课程去凑；
2. 技能 / 语言分区不参与：它们的主字段（Python、Git…）太短且常作为别的条目子串
   出现，很容易把一条实习主张误挂到同名技能上；
3. 同分区命中多条时（例如同校两个学历），能用专业名区分就只保留命中的那条，
   不能区分才全部保留。

表 / 列 / profile_entry 不存在时全部跳过而不是报错（迁移会跑在只有部分业务表的候选
库上）。downgrade 判存在后删两列；数据随列一起消失，不额外清理。
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_claim_entry_ids"
down_revision: str | Sequence[str] | None = "0008_job_preference"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CLAIM_TABLE = "claim_record"
_ENTRY_TABLE = "profile_entry"
_ENTRY_IDS_COLUMN = "entry_ids"
_ENTRY_IDS_AUTO_COLUMN = "entry_ids_auto"
_ENTRY_VALUES_COLUMN = "values"  # 资料条目的值 JSON（SQL 关键字，必须带引号）

# 每个资料分区"这条记录是关于谁的"主字段；只拿它做匹配（见模块注释的保守取舍）。
_PRIMARY_FIELD_BY_SECTION = {
    "educations": "school",
    "experiences": "company",
    "projects": "name",
    "campus_experiences": "organization",
    "awards": "title",
    "publications": "title",
    "research_projects": "name",
    "patents": "title",
    "credentials": "title",
}
# 学历分区额外用专业名做消歧（同校多条时只保留专业对得上的一条）。
_EDUCATION_SECTION = "educations"
_EDUCATION_MAJOR_KEY = "educations.major"
# 太短的主体名（1 个字）参与双向包含会大量误命中，直接不匹配。
_MIN_MATCH_CHARS = 2
_WHITESPACE_RE = re.compile(r"\s+")


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _column_names(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _normalized(value: object) -> str:
    """去掉全部空白（含全角空格）后做大小写折叠，用于主体名的双向包含判断。"""
    return _WHITESPACE_RE.sub("", str(value or "")).casefold()


def _entry_candidates(bind) -> list[tuple[str, str, str, str]]:
    """读资料条目主字段：[(entry_id, 分区, 主体名, 学历专业名)]。"""
    if _ENTRY_TABLE not in _table_names():
        return []
    columns = _column_names(_ENTRY_TABLE)
    if not {"entry_id", "section_key", _ENTRY_VALUES_COLUMN} <= columns:
        return []
    where = " WHERE deleted_at IS NULL" if "deleted_at" in columns else ""
    rows = bind.execute(
        sa.text(
            f'SELECT entry_id, section_key, "{_ENTRY_VALUES_COLUMN}" FROM {_ENTRY_TABLE}{where}'
        )
    ).all()
    candidates: list[tuple[str, str, str, str]] = []
    for entry_id, section_key, raw_values in rows:
        section = str(section_key or "")
        primary_key = _PRIMARY_FIELD_BY_SECTION.get(section)
        if not primary_key or not entry_id:
            continue
        if isinstance(raw_values, str):
            try:
                raw_values = json.loads(raw_values)
            except ValueError:
                continue
        if not isinstance(raw_values, dict):
            continue
        primary = _normalized(raw_values.get(f"{section}.{primary_key}"))
        if len(primary) < _MIN_MATCH_CHARS:
            continue
        secondary = (
            _normalized(raw_values.get(_EDUCATION_MAJOR_KEY))
            if section == _EDUCATION_SECTION
            else ""
        )
        candidates.append((str(entry_id), section, primary, secondary))
    return candidates


def _match_entry_ids(subject: object, candidates: list[tuple[str, str, str, str]]) -> list[str]:
    """按"去空白后双向包含"把一条台账对到资料条目；结果去重并排序（迁移可重跑）。"""
    subject_norm = _normalized(subject)
    if not subject_norm:
        return []
    hits_by_section: dict[str, list[tuple[str, str]]] = {}
    for entry_id, section, primary, secondary in candidates:
        if primary in subject_norm or subject_norm in primary:
            hits_by_section.setdefault(section, []).append((entry_id, secondary))
    matched: list[str] = []
    for section in sorted(hits_by_section):
        hits = hits_by_section[section]
        if len(hits) > 1:
            refined = [
                entry_id
                for entry_id, secondary in hits
                if secondary and (secondary in subject_norm or subject_norm in secondary)
            ]
            if refined:
                matched.extend(refined)
                continue
        matched.extend(entry_id for entry_id, _secondary in hits)
    return sorted(dict.fromkeys(matched))


def _backfill_entry_ids(bind) -> int:
    """给 entry_ids 仍为 NULL 的台账行做一次保守回填；返回实际写入的行数。"""
    if _CLAIM_TABLE not in _table_names():
        return 0
    columns = _column_names(_CLAIM_TABLE)
    required = {"id", "subject", _ENTRY_IDS_COLUMN, _ENTRY_IDS_AUTO_COLUMN}
    if not required <= columns:
        return 0
    candidates = _entry_candidates(bind)
    if not candidates:
        return 0
    where = f"{_ENTRY_IDS_COLUMN} IS NULL"
    if "deleted_at" in columns:
        where = f"deleted_at IS NULL AND {where}"
    claim_rows = bind.execute(
        sa.text(f"SELECT id, subject FROM {_CLAIM_TABLE} WHERE {where}")
    ).all()
    updated = 0
    for claim_id, subject in claim_rows:
        matched = _match_entry_ids(subject, candidates)
        if not matched:
            continue
        bind.execute(
            sa.text(
                f"UPDATE {_CLAIM_TABLE} SET {_ENTRY_IDS_COLUMN} = :entry_ids, "
                f"{_ENTRY_IDS_AUTO_COLUMN} = 1 WHERE id = :claim_id"
            ),
            {
                "entry_ids": json.dumps(matched, ensure_ascii=False),
                "claim_id": claim_id,
            },
        )
        updated += 1
    return updated


def upgrade() -> None:
    """加两列后跑一次回填；表/列已存在则跳过（可重跑）。"""
    if _CLAIM_TABLE not in _table_names():
        return
    columns = _column_names(_CLAIM_TABLE)
    if _ENTRY_IDS_COLUMN not in columns:
        op.add_column(_CLAIM_TABLE, sa.Column(_ENTRY_IDS_COLUMN, sa.JSON(), nullable=True))
    if _ENTRY_IDS_AUTO_COLUMN not in columns:
        op.add_column(_CLAIM_TABLE, sa.Column(_ENTRY_IDS_AUTO_COLUMN, sa.Boolean(), nullable=True))
    _backfill_entry_ids(op.get_bind())


def downgrade() -> None:
    """删两列；表/列不存在则跳过（不额外清理数据——列删了本来也回不来）。"""
    if _CLAIM_TABLE not in _table_names():
        return
    columns = _column_names(_CLAIM_TABLE)
    if _ENTRY_IDS_AUTO_COLUMN in columns:
        op.drop_column(_CLAIM_TABLE, _ENTRY_IDS_AUTO_COLUMN)
    if _ENTRY_IDS_COLUMN in columns:
        op.drop_column(_CLAIM_TABLE, _ENTRY_IDS_COLUMN)
