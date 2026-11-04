# SPDX-License-Identifier: Apache-2.0
"""生成 2.0 单基线迁移的 DDL 分片，并提供逐字漂移检查。

2.0 只保留一条迁移（migrations/versions/0001_baseline_v2.py），它建出的结构必须与
Base.metadata 完全一致。手抄 70 多张表必然漂移，所以由本脚本从模型注册表直接编译
SQLite DDL，按领域写进 migrations/baseline_v2/*.py 的 STATEMENTS /
DOWN_STATEMENTS，版本文件只按固定顺序执行它们。

本脚本负责三类语句：

1. Base.metadata.sorted_tables 的 CREATE TABLE（含表内 CHECK / UNIQUE / FOREIGN KEY）
   与 CREATE INDEX；
2. 不在 metadata 里的 FTS5 派生表：knowledge_fts 与 7 张 search_fts_* 外部内容虚拟表
   + 每表三个 AFTER 触发器 + 一次全量 rebuild（照抄迁移 0044/0046 的 DDL；检索列清单
   直接取 app.services.search_fts.SEARCH_FTS_SPECS，服务端与基线不允许各维护一份）；
3. 2.0 基线的 epoch 播种语句 INSERT INTO app_schema_epoch (epoch) VALUES (2)。

用法：

    cd backend
    PYTHONUTF8=1 .venv/Scripts/python.exe scripts/dump_baseline_ddl.py           # 重新生成
    PYTHONUTF8=1 .venv/Scripts/python.exe scripts/dump_baseline_ddl.py --check   # 只比对

基线一旦随 2.0 发布就冻结：--check 变红说明模型改了，正确做法是新增迁移，不是重跑
本脚本覆盖基线。2.0 改造期间（T01 建基线、T08 删补充事实模型后）允许再生成一次。
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterable, Sequence
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import models  # noqa: E402,F401 - 导入以注册全部映射表
from app.database import Base  # noqa: E402
from app.services.search_fts import SEARCH_FTS_SPECS  # noqa: E402
from sqlalchemy import Table  # noqa: E402
from sqlalchemy.dialects import sqlite  # noqa: E402
from sqlalchemy.schema import CreateIndex, CreateTable  # noqa: E402

BASELINE_DIR = BACKEND_DIR / "migrations" / "baseline_v2"

# upgrade 的执行顺序，也是 downgrade 的严格反序。顺序本身不是功能契约（SQLite 允许
# 建表时引用尚未创建的表），但固定顺序让生成结果与代码评审都可复现。
MODULE_ORDER: tuple[str, ...] = ("core", "profile", "resume", "apply_tasks", "other", "fts")

# 每个分片的行数上限（执行方案 §T01 的硬预算；超了必须重新分片，不允许长成巨型文件）。
MAX_MODULE_LINES = 500

# 与 pyproject.toml 的 [tool.ruff] line-length 保持一致：生成结果必须直接通过
# pre-commit 的 ruff format 校验，否则每次改模型都要先手工格式化再回头改生成器。
_FORMAT_LINE_LENGTH = 100

_MODULE_DOCS: dict[str, str] = {
    "core": "基础域：无外键依赖的根表（岗位、资料主表、会话、知识库、网申快照等）。",
    "profile": "个人资料域：资料子表与 2.0 条目标模型。",
    "resume": "简历域：简历记录、版本血缘、来源标注、模板与导出产物。",
    "apply_tasks": "投递与任务域：投递任务/队列、岗位匹配、跟进与交付记录。",
    "other": "其余业务域（面试/演练/题库）以及 app_schema_epoch 的建表与 epoch 播种。",
    "fts": "FTS5 检索派生表：knowledge_fts 与 7 张 search_fts_*（含触发器与 rebuild）。",
}

# 表 -> 分片。设计原则是「同一读模型/写链路放一起」，不是按字母切块：
# 未登记的新表自动落到 other（生成顺序仍按 sorted_tables，确定性不依赖登记顺序）。
_MODULE_TABLES: dict[str, tuple[str, ...]] = {
    "core": (
        "ai_task",
        "app_setting",
        "assistant_skill",
        "assistant_skill_file",
        "career_scenario",
        "chat_conversation",
        "chat_message",
        "claim_record",
        "job",
        "knowledge_entry",
        "llm_config_record",
        "material",
        "usage_pricing_record",
        "user_file",
        "user_profile",
        "web_form_fill_record",
        "web_form_profile_entry",
        "web_form_profile_record",
        "web_form_url_history",
    ),
    "profile": (
        "award",
        "campus_experience",
        "education",
        "experience",
        "profile_custom_field",
        "profile_custom_section",
        "profile_entry",
        "profile_fact",
        "profile_fact_field_pref",
        "profile_field_preference",
        "profile_group",
        "profile_group_member",
        "profile_photo",
        "profile_usage_snapshot",
        "profile_workspace_state",
        "project",
        "skill",
    ),
    "resume": (
        "resume_block_source",
        "resume_export_artifact",
        "resume_export_preset",
        "resume_fact_lock",
        "resume_generate_task",
        "resume_glossary_term",
        "resume_phrase",
        "resume_record",
        "resume_review_annotation",
        "resume_source",
        "resume_source_revision",
        "resume_template",
        "resume_variant",
        "resume_version",
    ),
    "apply_tasks": (
        "application_track",
        "application_track_event",
        "apply_queue_item",
        "apply_task",
        "apply_task_item",
        "candidate_job",
        "job_match_analysis",
        "job_match_batch",
        "referral",
        "reminder",
        "resume_delivery_record",
        "share_package",
    ),
    "other": (
        "drill_contract",
        "drill_session",
        "drill_turn",
        "interview_experience",
        "interview_message",
        "interview_review_record",
        "interview_session",
        "question_bank_record",
    ),
}

_TABLE_MODULE = {table: module for module, tables in _MODULE_TABLES.items() for table in tables}

_DIALECT = sqlite.dialect()

_GENERATED_NOTICE = (
    "本文件由 backend/scripts/dump_baseline_ddl.py 从 Base.metadata 生成，不要手工编辑。"
    "重新生成：cd backend && python scripts/dump_baseline_ddl.py；"
    "漂移检查：python scripts/dump_baseline_ddl.py --check（不一致退出码 1）。"
)


# ===== 第 1 类：metadata 里的业务表 =====


def _compile(ddl: object) -> str:
    """把 SQLAlchemy DDL 元素编译成单条 SQLite 语句。

    去掉首尾空行与行尾空白：SQLite 不关心这些空白，但源码里留着会被编辑器的
    "保存即去尾随空格"钩子静默改写，--check 就会误报漂移。
    """
    compiled = str(ddl.compile(dialect=_DIALECT))
    return "\n".join(line.rstrip() for line in compiled.strip("\n").splitlines())


def _table_statements(table: Table) -> list[str]:
    """一张表的建表语句 + 它全部显式索引（按索引名排序，保证生成确定）。"""
    statements = [_compile(CreateTable(table))]
    for index in sorted(table.indexes, key=lambda item: item.name):
        statements.append(_compile(CreateIndex(index)))
    return statements


def _drop_table_statement(table_name: str) -> str:
    quoted = _DIALECT.identifier_preparer.quote(table_name)
    return f"DROP TABLE IF EXISTS {quoted}"


# ===== 第 2 类：FTS5 派生表（不在 metadata 里） =====

_KNOWLEDGE_FTS_TABLE = "knowledge_fts"
_KNOWLEDGE_CONTENT_TABLE = "knowledge_entry"
_KNOWLEDGE_COLUMNS: tuple[str, ...] = ("title", "content")

# (虚拟表名, 外部内容表, 被索引列)。knowledge_fts 在前，其余顺序与
# SEARCH_FTS_SPECS 的登记顺序一致。
_FTS_TABLES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    (_KNOWLEDGE_FTS_TABLE, _KNOWLEDGE_CONTENT_TABLE, _KNOWLEDGE_COLUMNS),
) + tuple((f"search_fts_{base}", base, columns) for base, columns in SEARCH_FTS_SPECS.items())


def _create_fts_table_sql(table: str, content_table: str, columns: tuple[str, ...]) -> str:
    return (
        f"CREATE VIRTUAL TABLE IF NOT EXISTS {table} USING fts5(\n"
        f"    {', '.join(columns)},\n"
        f"    content='{content_table}', content_rowid='id',\n"
        "    tokenize='trigram'\n"
        ")"
    )


def _create_trigger_sqls(
    table: str, content_table: str, columns: tuple[str, ...]
) -> tuple[str, str, str]:
    """与 0044/0046 相同的三触发器模式：external content 表的增/删/改同步。"""
    column_list = ", ".join(columns)
    new_values = ", ".join(f"new.{column}" for column in columns)
    old_values = ", ".join(f"old.{column}" for column in columns)
    return (
        f"CREATE TRIGGER IF NOT EXISTS {table}_ai AFTER INSERT ON {content_table} BEGIN\n"
        f"    INSERT INTO {table}(rowid, {column_list})\n"
        f"    VALUES (new.id, {new_values});\n"
        "END",
        f"CREATE TRIGGER IF NOT EXISTS {table}_ad AFTER DELETE ON {content_table} BEGIN\n"
        f"    INSERT INTO {table}({table}, rowid, {column_list})\n"
        f"    VALUES ('delete', old.id, {old_values});\n"
        "END",
        f"CREATE TRIGGER IF NOT EXISTS {table}_au AFTER UPDATE ON {content_table} BEGIN\n"
        f"    INSERT INTO {table}({table}, rowid, {column_list})\n"
        f"    VALUES ('delete', old.id, {old_values});\n"
        f"    INSERT INTO {table}(rowid, {column_list})\n"
        f"    VALUES (new.id, {new_values});\n"
        "END",
    )


def _fts_statements() -> tuple[str, ...]:
    statements: list[str] = []
    for table, content_table, columns in _FTS_TABLES:
        statements.append(_create_fts_table_sql(table, content_table, columns))
        statements.extend(_create_trigger_sqls(table, content_table, columns))
        # 全量 rebuild：external content 表本身不存文本，rebuild 幂等、可重跑。
        statements.append(f"INSERT INTO {table}({table}) VALUES('rebuild')")
    return tuple(statements)


def _fts_down_statements() -> tuple[str, ...]:
    statements: list[str] = []
    for table, _content_table, _columns in reversed(_FTS_TABLES):
        for suffix in ("au", "ad", "ai"):
            statements.append(f"DROP TRIGGER IF EXISTS {table}_{suffix}")
        # 虚拟表用 DROP TABLE 即可；影子表随虚拟表一起删除。
        statements.append(f"DROP TABLE IF EXISTS {table}")
    return tuple(statements)


# ===== 第 3 类：epoch 播种 =====

_EPOCH_SEED_STATEMENTS: tuple[str, ...] = ("INSERT INTO app_schema_epoch (epoch) VALUES (2)",)


# ===== 渲染 =====


def _render_header(module: str) -> str:
    doc = _MODULE_DOCS[module]
    return (
        "# SPDX-License-Identifier: Apache-2.0\n"
        f'"""{doc}\n\n{_GENERATED_NOTICE}\n"""\n\n'
        "from __future__ import annotations"
    )


def _render_multiline_block(name: str, statements: Iterable[str]) -> str:
    """多行 SQL 用三引号内联；语句含三引号或反斜杠会让源码失真，直接拒绝。"""
    lines = [f"{name}: tuple[str, ...] = ("]
    for statement in statements:
        if '"""' in statement or "\\" in statement:
            raise SystemExit(f"语句无法安全内联（含三引号或反斜杠）：{statement[:120]}")
        lines.append('    """\\')
        lines.extend(statement.splitlines())
        lines.append('""",')
    lines.append(")")
    return "\n".join(lines)


def _render_singleline_block(name: str, statements: Iterable[str]) -> str:
    """单行语句的元组：短到能一行放下就一行（ruff format 会这样排），否则逐条展开。"""
    items = [json.dumps(statement, ensure_ascii=False) for statement in statements]
    # 单元素元组的逗号不能丢，否则类型就从 tuple 变成 str。
    joined = items[0] + "," if len(items) == 1 else ", ".join(items)
    one_line = f"{name}: tuple[str, ...] = (" + joined + ")"
    if len(one_line) <= _FORMAT_LINE_LENGTH:
        return one_line
    lines = [f"{name}: tuple[str, ...] = ("]
    lines.extend(f"    {item}," for item in items)
    lines.append(")")
    return "\n".join(lines)


def _render_module(module: str, tables: Sequence[Table]) -> str:
    statements: list[str] = []
    for table in tables:
        statements.extend(_table_statements(table))
    down = [_drop_table_statement(table.name) for table in reversed(tables)]

    blocks = [_render_header(module)]
    if module == "fts":
        blocks.append(_render_multiline_block("STATEMENTS", _fts_statements()))
        blocks.append(_render_singleline_block("DOWN_STATEMENTS", _fts_down_statements()))
        exported = '["STATEMENTS", "DOWN_STATEMENTS"]'
    else:
        blocks.append(_render_multiline_block("STATEMENTS", statements))
        blocks.append(_render_singleline_block("DOWN_STATEMENTS", down))
        if module == "other":
            blocks.append(_render_singleline_block("EPOCH_SEED_STATEMENTS", _EPOCH_SEED_STATEMENTS))
            exported = '["STATEMENTS", "DOWN_STATEMENTS", "EPOCH_SEED_STATEMENTS"]'
        else:
            exported = '["STATEMENTS", "DOWN_STATEMENTS"]'
    blocks.append(f"__all__ = {exported}")
    return "\n\n".join(blocks) + "\n"


def _render_package_init() -> str:
    order_lines = ",\n".join(f'    "{module}"' for module in MODULE_ORDER)
    return (
        "# SPDX-License-Identifier: Apache-2.0\n"
        '"""2.0 单基线迁移的 DDL 分片包。\n\n'
        "版本文件 versions/0001_baseline_v2.py 按 MODULE_ORDER 顺序执行各分片的\n"
        "STATEMENTS，downgrade 时严格反序执行 DOWN_STATEMENTS。本包内容全部由\n"
        "backend/scripts/dump_baseline_ddl.py 生成，不要手工编辑。\n"
        '"""\n\n'
        "from __future__ import annotations\n\n"
        "MODULE_ORDER: tuple[str, ...] = (\n"
        f"{order_lines},\n"
        ")\n\n"
        '__all__ = ["MODULE_ORDER"]\n'
    )


def _tables_by_module() -> dict[str, tuple[Table, ...]]:
    grouped: dict[str, list[Table]] = {module: [] for module in MODULE_ORDER}
    for table in Base.metadata.sorted_tables:
        grouped[_TABLE_MODULE.get(table.name, "other")].append(table)
    return {module: tuple(tables) for module, tables in grouped.items()}


def _render_all() -> dict[str, str]:
    grouped = _tables_by_module()
    rendered = {f"{module}.py": _render_module(module, grouped[module]) for module in MODULE_ORDER}
    rendered["__init__.py"] = _render_package_init()
    for filename, rendered_content in rendered.items():
        line_count = rendered_content.count("\n")
        if line_count > MAX_MODULE_LINES:
            raise SystemExit(
                f"{filename} 共 {line_count} 行，超过分片预算 {MAX_MODULE_LINES} 行；"
                "请重新分配 _MODULE_TABLES（不要调高预算）"
            )
    return rendered


# ===== 写盘 / 检查 =====


def _read(path: Path) -> str | None:
    if not path.exists():
        return None
    # read_text 走通用换行：CRLF 工作区也按 LF 比对，内容漂移才是 --check 的判据。
    return path.read_text(encoding="utf-8")


def _diff_hint(expected: str, actual: str) -> str:
    expected_lines = expected.splitlines()
    actual_lines = actual.splitlines()
    for number, (want, got) in enumerate(zip(expected_lines, actual_lines, strict=False), start=1):
        if want != got:
            return f"第 {number} 行不一致：期望 {want!r}，实际 {got!r}"
    return f"行数不一致：期望 {len(expected_lines)} 行，实际 {len(actual_lines)} 行"


def _write(rendered: dict[str, str]) -> int:
    BASELINE_DIR.mkdir(parents=True, exist_ok=True)
    changed = 0
    for filename, payload in rendered.items():
        path = BASELINE_DIR / filename
        previous = _read(path)
        if previous == payload:
            print(f"unchanged {path}")
            continue
        path.write_text(payload, encoding="utf-8", newline="\n")
        print(f"{'updated' if previous is not None else 'created'} {path}")
        changed += 1
    return changed


def _check(rendered: dict[str, str]) -> int:
    failures: list[str] = []
    for filename, expected in rendered.items():
        path = BASELINE_DIR / filename
        actual = _read(path)
        if actual is None:
            failures.append(f"缺少文件：{path}")
        elif actual != expected:
            failures.append(f"{path}：{_diff_hint(expected, actual)}")
    if failures:
        print("基线 DDL 与模型注册表不一致：", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        print(
            "基线随 2.0 发布后只能新增迁移修正；2.0 改造期间请重新运行本脚本生成。",
            file=sys.stderr,
        )
        return 1
    print(f"基线 DDL 与模型注册表一致（{len(rendered)} 个文件）")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="生成 / 校对 2.0 单基线迁移的 DDL 分片")
    parser.add_argument(
        "--check",
        action="store_true",
        help="只比对已提交的分片与当前模型，不一致退出码 1（不写文件）",
    )
    args = parser.parse_args(argv)
    rendered = _render_all()
    if args.check:
        return _check(rendered)
    changed = _write(rendered)
    print(f"完成：{len(rendered)} 个文件，{changed} 个有变化")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
