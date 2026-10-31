#!/usr/bin/env python
# SPDX-License-Identifier: Apache-2.0
"""批量把旧 v1 简历内容转换为 v2 文档（默认 dry-run，只报告不写库）。

用法（在仓库根目录）：
  python scripts/convert_resume_documents.py --db runtime/demo/demo.db --report runtime/report.json
  python scripts/convert_resume_documents.py --db runtime/demo/demo.db --write --report ...

安全边界（计划 §13）：
- **默认 dry-run**：只读库、只输出报告，一个字节都不写；
- 真实库 backend/data/resume_forge.db 只有在显式 --write --allow-production-db 时才允许写，
  且要求先按计划备份（脚本会再提示一次）；生产批量转换不是本批的自动动作——真实库通常
  由用户打开旧简历时的读路径自动转换，这个脚本只用于用户确认后的批量升级；
- 已经是 v2 的行跳过（幂等），报告里单列 skipped；
- 报告只含标题/统计/警告，不包含简历正文与个人信息。

退出码：0 全部成功（或 dry-run 无失败）；1 有行转换失败。
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

PRODUCTION_DB = (REPO_ROOT / "backend" / "data" / "resume_forge.db").resolve()


def _load_definitions(db_path: Path) -> dict[str, list[dict[str, Any]]]:
    """读当前方案的自定义字段定义（只读；表不存在时返回空）。"""
    try:
        from app.database import build_engine  # 延迟导入：只有写路径/定义查询需要 app 包
        from app.services.profile.field_placement import custom_field_definitions
        from sqlalchemy.orm import Session
    except Exception:  # noqa: BLE001 - 纯 dry-run 在极简环境也应能跑
        return {}
    engine = build_engine(f"sqlite:///{db_path.as_posix()}")
    try:
        with Session(engine) as session:
            return custom_field_definitions(session)
    except Exception:  # noqa: BLE001 - 旧库没有定义表
        return {}
    finally:
        engine.dispose()


def _v1_strings(content: Any) -> list[str]:
    """收集 v1 内容里的非空字符串（用于"文字不丢"的保守对拍）。"""
    found: list[str] = []

    def walk(value: Any) -> None:
        if isinstance(value, str):
            text = value.strip()
            if text:
                found.append(text)
        elif isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, dict):
            for key, item in value.items():
                if key in ("photo", "id", "point_ids", "hidden_points"):
                    continue
                walk(item)

    walk(content)
    return found


def _missing_values(v1_content: Any, document: dict) -> list[dict[str, Any]]:
    """v1 里的字符串值有多少没出现在 v2 JSON 里（照片/长度上限除外）。

    报告只写"长度 + 指纹前缀"，**不写正文**（真实库报告不能夹带个人信息）。
    承载区「标签：值」行会被转换器拆成 label/value 两个 item，原文不再是连续子串；
    这里把冒号两侧分别再查一次，避免把"结构拆开"误报成"文字丢失"。
    """
    import hashlib

    serialized = json.dumps(document, ensure_ascii=False)
    missing: list[dict[str, Any]] = []
    for text in _v1_strings(v1_content):
        if text in serialized:
            continue
        parts = [part.strip() for part in text.split("：") if part.strip()]
        if len(parts) > 1 and all(part in serialized for part in parts):
            continue
        missing.append(
            {
                "chars": len(text),
                "sha256_12": hashlib.sha256(text.encode("utf-8")).hexdigest()[:12],
            }
        )
    return missing


def _convert_row(
    row: tuple[int, str, str, str],
    definitions: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    from app.services.resume.document_io import ensure_document_version_with_report

    resume_id, title, content_raw, row_context = row
    content = json.loads(content_raw or "{}")
    try:
        context = json.loads(row_context or "{}") if row_context else {}
    except json.JSONDecodeError:
        context = {}
    language = context.get("language") or None
    format_config = context.get("format_config") or {}
    document, report = ensure_document_version_with_report(
        content,
        language=language,
        format_config=format_config,
        custom_fields=definitions or None,
    )
    return {
        "resume_id": resume_id,
        "title": (title or "")[:80],
        "converted": report is not None,
        "report": report.as_dict() if report is not None else None,
        "missing_values": _missing_values(content, document),
        "document": document,
    }


def _iter_rows(connection: sqlite3.Connection):
    cursor = connection.execute(
        "SELECT id, title, content, json_object("
        "  'language', language, "
        "  'format_config', format_config "
        ") FROM resume_record ORDER BY id"
    )
    yield from cursor


def _write_backup_path(db_path: Path) -> Path:
    import datetime

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    return db_path.with_name(f"{db_path.name}.bak-convert-{stamp}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="把 v1 简历内容批量转换为 v2 文档")
    parser.add_argument("--db", required=True, help="SQLite 数据库文件路径（开发请用隔离演示库）")
    parser.add_argument("--report", default="", help="报告输出 JSON 路径（可选）")
    parser.add_argument("--dry-run", action="store_true", help="只报告不写库（默认行为）")
    parser.add_argument(
        "--write", action="store_true", help="真正写回 v2 content（需要显式给 --db）"
    )
    parser.add_argument(
        "--allow-production-db",
        action="store_true",
        help="允许写真实库 backend/data/resume_forge.db（必须先按计划备份）",
    )
    args = parser.parse_args(argv)
    if args.write and args.dry_run:
        parser.error("--write 与 --dry-run 不能同时给；默认就是 dry-run")

    db_path = Path(args.db)
    if not db_path.is_file():
        print(f"数据库不存在：{db_path}", file=sys.stderr)
        return 2
    resolved = db_path.resolve()
    write = bool(args.write) and not args.dry_run
    if write and resolved == PRODUCTION_DB and not args.allow_production_db:
        print(
            "拒绝写真实库：真实库只在最终应用重启后由用户打开旧简历触发转换。"
            "如确需批量升级，请先按计划备份，再加 --allow-production-db。",
            file=sys.stderr,
        )
        return 2
    if write and resolved == PRODUCTION_DB:
        backup = _write_backup_path(resolved)
        print(f"提示：请确认已有备份（建议复制到 {backup}）后再继续。")

    definitions = _load_definitions(resolved)
    connection = sqlite3.connect(str(resolved))
    rows: list[dict[str, Any]] = []
    failures = 0
    skipped = 0
    try:
        for row in _iter_rows(connection):
            try:
                result = _convert_row(row, definitions)
            except Exception as exc:  # noqa: BLE001 - 单行失败不拖垮整批，报告里记原因
                failures += 1
                rows.append({"resume_id": row[0], "error": str(exc)[:300]})
                continue
            if not result["converted"]:
                skipped += 1
                continue
            if write:
                document = result["document"]
                connection.execute(
                    "UPDATE resume_record SET content = ? WHERE id = ?",
                    (json.dumps(document, ensure_ascii=False), result["resume_id"]),
                )
                result.pop("document", None)
            else:
                result.pop("document", None)
            rows.append(result)
        if write:
            connection.commit()
    finally:
        connection.close()

    aggregate: dict[str, Any] = {
        "db": str(resolved),
        "mode": "write" if write else "dry-run",
        "total": len(rows) + skipped,
        "converted": len(rows),
        "skipped_already_v2": skipped,
        "failed": failures,
        "fields_recognized": sum(
            (item.get("report") or {}).get("fields_recognized", 0) for item in rows
        ),
        "lines_preserved": sum(
            (item.get("report") or {}).get("lines_preserved", 0) for item in rows
        ),
        "rows": rows,
    }
    if args.report:
        report_path = Path(args.report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(aggregate, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"报告已写入：{report_path}")
    print(
        f"模式={aggregate['mode']} 总数={aggregate['total']} 转换={aggregate['converted']} "
        f"已是v2跳过={skipped} 失败={failures}"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
