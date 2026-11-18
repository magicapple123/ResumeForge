# SPDX-License-Identifier: Apache-2.0
"""I-12 · P0：把 `{@…}` / `**…**` 标记从存储层搬到结构化 runs（`item.rich`）。

**这条脚本只做一件事**：读 `resume_documents.content`（JSON），把每个 item 的
正文从"含标记的串"改成"纯文本 + 旁挂 `rich.runs`"。正文所在的字段随 kind 不同：
字段/页眉/作者是 `value`，正文文本块（`kind:"text"`）是 `text`。不猜、不改写
用户数据、不碰其它字段。

## 为什么需要它

标记语法现在存在**磁盘上的正文里**（`value` / 文本块的 `text`），四个出口各自解析。
I-12 的目标是让磁盘上不再出现 `{@…}`。迁移完以后：正文是纯文本（AI 上下文 / 搜索 /
去重 / diff / 排序一行都不用改），样式在 `rich.runs`（下标基于纯文本）。

## 三条安全约定

1. **默认只读**：不加 `--apply` 就只打印报告，**不写库**。
2. **不猜**：解析后纯文本里仍残留 `{@` 或 `**` 的（未闭合、未知属性），**原样保留**，
   逐条写进报告让用户看。绝不"尽力而为"地删掉几个字符——那会静默改掉用户正文。
3. **幂等**：已经有 `rich` 的 item 直接跳过；跑第二次不会把 runs 叠加两遍。

## 用法

```bash
# 只出报告（默认）
python scripts/migrate_inline_marks.py --db sqlite:///D:/rf_tools/data/verify-x.db

# 只跑一条简历
python scripts/migrate_inline_marks.py --db ... --only 3

# 真正写库（先备份！）
python scripts/migrate_inline_marks.py --db ... --apply
```
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from dataclasses import dataclass, field
from pathlib import Path

# 允许 `python scripts/xxx.py` 从仓库根跑（scripts/ 不是包）。
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.resume.resume_rich_marks import parse_marks  # noqa: E402

#: 快筛：没有这些子串的 value 不可能含标记，跳过（90% 的 item 走这条）。
_MAYBE = ("{@", "*", "](")


@dataclass
class ItemReport:
    """一个 item 的迁移结论。"""

    document_id: int
    path: str
    kind: str  # converted / residual / skipped-has-rich
    plain_length: int = 0
    run_count: int = 0
    sample_before: str = ""
    sample_after: str = ""


@dataclass
class Report:
    scanned: int = 0
    converted: list[ItemReport] = field(default_factory=list)
    residual: list[ItemReport] = field(default_factory=list)
    skipped: list[ItemReport] = field(default_factory=list)

    def counts(self) -> dict[str, int]:
        return {
            "扫描 item": self.scanned,
            "可转换": len(self.converted),
            "含畸形串（保留原样）": len(self.residual),
            "已有 rich（跳过）": len(self.skipped),
        }


def _text_field(item: dict) -> str:
    """正文存在哪个键：文本块是 `text`，其余（字段/页眉/作者）是 `value`。

    与 `resume_rich_marks.item_text(key=...)` 的口径一致——**这是唯一的分叉点**，
    迁移与四个出口不能各判各的。`kind` 缺失时按 `value`（旧文档没有文本块判别字段）。
    """
    return "text" if item.get("kind") == "text" else "value"


def _iter_items(doc: dict) -> list[tuple[str, dict]]:
    """产出 `(路径, item)`。只走 `header.items` 与 `sections[].entries[].items`，
    与 planner 读的路径一致；别的位置（key/id/kind/placement）不是用户正文。"""
    out: list[tuple[str, dict]] = []
    for index, item in enumerate(doc.get("header", {}).get("items", []) or []):
        if isinstance(item, dict):
            out.append((f"header.items[{index}]", item))
    for section_index, section in enumerate(doc.get("sections", []) or []):
        if not isinstance(section, dict):
            continue
        for entry_index, entry in enumerate(section.get("entries", []) or []):
            if not isinstance(entry, dict):
                continue
            for item_index, item in enumerate(entry.get("items", []) or []):
                if isinstance(item, dict):
                    out.append(
                        (
                            f"sections[{section_index}].entries[{entry_index}].items[{item_index}]",
                            item,
                        )
                    )
    return out


def _residual(plain: str, before: str) -> bool:
    """纯文本里还留着未闭合标记的前缀 → 这条不猜。"""
    return ("{@" in plain and "{@" in before) or ("**" in plain and "**" in before)


def migrate_document(
    document_id: int, doc: dict, *, apply: bool, report: Report, sample_limit: int = 3
) -> bool:
    """处理一份文档；返回是否有改动。"""
    changed = False
    for path, item in _iter_items(doc):
        field = _text_field(item)
        value = item.get(field)
        if not isinstance(value, str) or not value:
            continue
        report.scanned += 1
        if item.get("rich"):
            report.skipped.append(ItemReport(document_id, path, "skipped-has-rich"))
            continue
        if not any(token in value for token in _MAYBE):
            continue  # 无标记，不需要动
        plain, runs = parse_marks(value)
        if _residual(plain, value):
            report.residual.append(
                ItemReport(
                    document_id,
                    path,
                    "residual",
                    plain_length=len(plain),
                    sample_before=value[:80],
                    sample_after=plain[:80],
                )
            )
            continue
        if plain == value and not runs:
            continue  # 这里的 "*"/"](" 只是普通字符
        report.converted.append(
            ItemReport(
                document_id,
                path,
                "converted",
                plain_length=len(plain),
                run_count=len(runs),
                sample_before=value[:80] if len(report.converted) < sample_limit else "",
                sample_after=plain[:80] if len(report.converted) < sample_limit else "",
            )
        )
        if apply:
            item[field] = plain
            if runs:
                item["rich"] = {"runs": [run.as_dict() for run in runs]}
            else:
                item.pop("rich", None)
        changed = True
    return changed


def _open(db_url: str) -> sqlite3.Connection:
    if not db_url.startswith("sqlite:"):
        raise SystemExit("本脚本只支持 sqlite（其它库用同样的逻辑另写）")
    path = db_url.split("///", 1)[-1]
    if not Path(path).exists():
        raise SystemExit(f"库不存在：{path}")
    return sqlite3.connect(path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="I-12 P0：标记语法 → 结构化 runs")
    parser.add_argument("--db", required=True, help="sqlite URL，例 sqlite:///D:/path/x.db")
    parser.add_argument("--apply", action="store_true", help="真正写库（默认只出报告）")
    parser.add_argument("--only", type=int, default=None, help="只处理这一份简历")
    parser.add_argument("--limit", type=int, default=None, help="最多处理 N 份")
    parser.add_argument("--json-out", default=None, help="报告写到这个文件（默认 stdout）")
    args = parser.parse_args(argv)

    connection = _open(args.db)
    query = "select id, content from resume_record"
    params: list[object] = []
    if args.only is not None:
        query += " where id = ?"
        params.append(args.only)
    query += " order by id"
    if args.limit:
        query += f" limit {int(args.limit)}"

    report = Report()
    touched = 0
    for resume_id, content in connection.execute(query, params):
        if not content:
            continue
        doc = json.loads(content)
        if migrate_document(resume_id, doc, apply=args.apply, report=report):
            touched += 1
            if args.apply:
                connection.execute(
                    "update resume_record set content = ? where id = ?",
                    (json.dumps(doc, ensure_ascii=False), resume_id),
                )
    if args.apply:
        connection.commit()

    payload = {
        "模式": "apply（已写库）" if args.apply else "dry-run（未写库）",
        "库": args.db,
        "受影响简历": touched,
        **report.counts(),
        "可转换明细": [vars(r) for r in report.converted[:50]],
        "畸形串明细": [vars(r) for r in report.residual[:50]],
        "跳过明细": [vars(r) for r in report.skipped[:20]],
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.json_out:
        Path(args.json_out).write_text(text, encoding="utf-8")
        print(f"报告已写入 {args.json_out}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
