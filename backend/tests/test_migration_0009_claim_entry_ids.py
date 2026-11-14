# SPDX-License-Identifier: Apache-2.0
"""0009 迁移：claim_record.entry_ids / entry_ids_auto 与一次性保守回填。

迁移的验收不是"没报错"，而是三件事：

1. 空库能升到 head、能退到 0009 之前、再升回来，两列在/不在如实反映；
2. 回填真的把台账 subject 对到资料条目的 **entry_id**（24 位十六进制，不是自增 id）；
3. 匹配是保守的：未命中留 NULL、技能分区不参与、同校多学历用专业名消歧。

**测试里不写 revision 字面量**（迁移链还会再长）：head 从 head_revision() 取；
"让 0009 在真实数据上重跑一次"的办法是从 head 连续 downgrade 直到该列消失，再
upgrade head——这样即使以后 head 之后又加了迁移，本用例仍然只依赖 0009 那一层。
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from alembic import command
from app.database import build_engine
from app.database_migrations import build_alembic_config
from sqlalchemy import inspect
from sqlalchemy.orm import Session
from tests.migration_refs import alembic_version_of, head_revision

CLAIM_TABLE = "claim_record"
ENTRY_TABLE = "profile_entry"
# 24 位十六进制 = profile_entry 真实 entry_id 的形态（与 revision 无关）。
ENTRY_A = "a1" * 12
ENTRY_B = "b2" * 12
ENTRY_C = "c3" * 12
ENTRY_D = "d4" * 12


def _column_names(engine, table: str) -> set[str]:
    return {column["name"] for column in inspect(engine).get_columns(table)}


def _new_engine(tmp_path, name: str):
    return build_engine(f"sqlite:///{(tmp_path / name).as_posix()}")


def _downgrade_until_removed(engine, config, column: str) -> int:
    """从 head 连续退到该列消失为止；返回步数（防止迁移链有环时死循环）。"""
    steps = 0
    while column in _column_names(engine, CLAIM_TABLE):
        command.downgrade(config, "-1")
        steps += 1
        assert steps <= 14, "连续降级没有移除目标列，迁移链可能有环"
    return steps


class _FakeOp:
    """把迁移模块里的 alembic op 代理换成"直接返回这个连接"。

    迁移的查询辅助函数为了少传参数用的是 op.get_bind()；直接调用内部函数时没有
    alembic 上下文，这里只替换取连接这一步（不复制迁移逻辑，也不改迁移文件）。
    """

    def __init__(self, bind):
        self._bind = bind

    def get_bind(self):
        return self._bind


def _run_backfill(migration, connection) -> int:
    original = migration.op
    migration.op = _FakeOp(connection)
    try:
        return migration._backfill_entry_ids(connection)
    finally:
        migration.op = original


def _load_migration_module():
    """按文件路径加载迁移模块（文件名以数字开头，不能直接 import）。"""
    path = (
        Path(__file__).resolve().parents[1] / "migrations" / "versions" / "0009_claim_entry_ids.py"
    )
    spec = importlib.util.spec_from_file_location("claim_entry_ids_migration", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_columns_round_trip_between_head_and_previous_revision(tmp_path):
    """升到 head → 退到 0009 之前 → 再升回 head：两次都成功，列集合如实变化。"""
    engine = _new_engine(tmp_path, "claims-roundtrip.db")
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, "head")
        assert alembic_version_of(engine) == head_revision()
        assert {"entry_ids", "entry_ids_auto"} <= _column_names(engine, CLAIM_TABLE)

        steps = _downgrade_until_removed(engine, config, "entry_ids")
        assert steps >= 1, "至少要退一步才能到 0009 之前"
        assert {"entry_ids", "entry_ids_auto"}.isdisjoint(_column_names(engine, CLAIM_TABLE))
        assert alembic_version_of(engine) != head_revision()

        command.upgrade(config, "head")
        assert {"entry_ids", "entry_ids_auto"} <= _column_names(engine, CLAIM_TABLE)
        assert alembic_version_of(engine) == head_revision()
    finally:
        engine.dispose()


def _entry(entry_id: str, section_key: str, values: dict, sort_order: int):
    from app.models.profile_entry import ProfileEntry

    return ProfileEntry(
        entry_id=entry_id,
        section_key=section_key,
        sort_order=sort_order,
        values=values,
    )


def _claim(subject: str, **overrides):
    """entry_ids=None 显式写入 = 迁移前的旧行形态（列存在但值为 NULL）。"""
    from app.models.claim import VERIFICATION_CONFIRMED, ClaimRecord

    payload = {
        "title": "",
        "subject": subject,
        "source_fact": "在某公司负责某模块的开发与联调。",
        "candidate_wording": "负责模块开发与联调",
        "verification_status": VERIFICATION_CONFIRMED,
        "entry_ids": None,
    }
    payload.update(overrides)
    return ClaimRecord(**payload)


def test_backfill_writes_real_entry_ids_and_skips_unsure_matches(tmp_path):
    """回填：主体名命中才写 entry_id；技能分区不参与；同校多学历按专业名消歧。"""
    from app.models.claim import ClaimRecord

    engine = _new_engine(tmp_path, "claims-backfill.db")
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, "head")
        with Session(engine) as session:
            session.add_all(
                [
                    _entry(
                        ENTRY_A,
                        "experiences",
                        {"experiences.company": "杭州枢云信息科技有限公司"},
                        0,
                    ),
                    # 技能分区刻意不参与匹配：否则 "Python 后端实习" 会被挂到同名技能上。
                    _entry(ENTRY_B, "skills", {"skills.name": "Python"}, 0),
                    _entry(
                        ENTRY_C,
                        "educations",
                        {
                            "educations.school": "南京理工大学",
                            "educations.major": "计算机科学与技术",
                        },
                        0,
                    ),
                    _entry(
                        ENTRY_D,
                        "educations",
                        {
                            "educations.school": "南京理工大学",
                            "educations.major": "人工智能（微专业）",
                        },
                        1,
                    ),
                    _claim("杭州枢云信息科技有限公司 / 后端开发实习生"),
                    _claim("杭州枢云信息科技有限公司 / 后端开发实习生"),
                    _claim("南京理工大学 / 计算机科学与技术"),
                    _claim("Python 后端实习"),
                    _claim("查无此公司 / 查无此岗位"),
                ]
            )
            session.commit()

        # 退到 0009 之前再升回来 = 让回填在真实数据上重跑一次（列被删后旧行重新变 NULL）。
        _downgrade_until_removed(engine, config, "entry_ids")
        command.upgrade(config, "head")

        with Session(engine) as session:
            rows = [
                (row.subject or "", row.entry_ids, row.entry_ids_auto)
                for row in session.query(ClaimRecord).order_by(ClaimRecord.id)
            ]
        by_subject: dict[str, list[tuple[list[str] | None, bool | None]]] = {}
        for subject, entry_ids, auto in rows:
            by_subject.setdefault(subject, []).append((entry_ids, auto))

        experience_rows = by_subject["杭州枢云信息科技有限公司 / 后端开发实习生"]
        assert [row[0] for row in experience_rows] == [[ENTRY_A], [ENTRY_A]]
        assert all(row[1] is True for row in experience_rows), "回填出来的关联要打自动标记"

        # 同校两个学历：subject 里写了专业名，只应关联专业对得上的那一条。
        assert by_subject["南京理工大学 / 计算机科学与技术"] == [([ENTRY_C], True)]

        # 保守：技能分区不参与、完全对不上主体名的留 NULL（未关联）。
        assert by_subject["Python 后端实习"] == [(None, None)]
        assert by_subject["查无此公司 / 查无此岗位"] == [(None, None)]
    finally:
        engine.dispose()


def test_backfill_is_idempotent_and_never_overwrites_existing_links(tmp_path):
    """回填只处理 entry_ids IS NULL：显式 []/已有关联的行一个字都不改，重跑也不重复写。"""
    from app.models.claim import ClaimRecord

    migration = _load_migration_module()
    engine = _new_engine(tmp_path, "claims-existing.db")
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, "head")
        with Session(engine) as session:
            session.add(
                _entry(
                    ENTRY_A,
                    "experiences",
                    {"experiences.company": "杭州枢云信息科技有限公司"},
                    0,
                )
            )
            session.add_all(
                [
                    # 用户已确认清空关联：语义上不等于 NULL，迁移不得把它"修"回来。
                    _claim(
                        "杭州枢云信息科技有限公司 / 后端开发实习生",
                        entry_ids=[],
                        entry_ids_auto=False,
                    ),
                    # 迁移前的旧行：从未关联，允许回填。
                    _claim("杭州枢云信息科技有限公司 / 后端开发实习生"),
                ]
            )
            session.commit()
            # ORM 插入会把 None 当成"未赋值"而套用 Python 默认值（[]），所以旧行的
            # NULL 形态要用一条显式 UPDATE 造出来——那正是迁移加列时旧行的样子。
            from sqlalchemy import text

            old_row_id = session.query(ClaimRecord).order_by(ClaimRecord.id.desc()).first().id
            session.execute(
                text("UPDATE claim_record SET entry_ids = NULL WHERE id = :claim_id"),
                {"claim_id": old_row_id},
            )
            session.commit()

        with engine.connect() as connection:
            assert _run_backfill(migration, connection) == 1
            connection.commit()
            # 再跑一次：没有 NULL 行了，一条都不该再写。
            assert _run_backfill(migration, connection) == 0
            connection.commit()

        with Session(engine) as session:
            untouched, backfilled = session.query(ClaimRecord).order_by(ClaimRecord.id).all()
        assert untouched.entry_ids == []
        assert untouched.entry_ids_auto is False
        assert backfilled.entry_ids == [ENTRY_A]
        assert backfilled.entry_ids_auto is True
    finally:
        engine.dispose()


def test_backfill_skips_databases_without_partial_tables(tmp_path):
    """只有部分业务表（这里连业务表都没有）的候选库上，回填跳过而不是抛异常。"""
    migration = _load_migration_module()
    engine = _new_engine(tmp_path, "claims-partial.db")
    try:
        with engine.connect() as connection:
            assert _run_backfill(migration, connection) == 0
        assert ENTRY_TABLE not in {row[0] for row in inspect(engine).get_table_names()}
    finally:
        engine.dispose()
