# SPDX-License-Identifier: Apache-2.0
"""求职进度的导出层：CSV 行构造、流式分块与 JSON 序列化。

从 ``tracker.py`` 纯搬迁而来（PR-18 豁免拆分批）：导出与查询（``tracker_query.py``）、
写入（``tracker.py``）的接缝在此分开。``tracker.py`` 经门面 re-export 全部公开
名字——消费方（``api/tracker.py``）的 import 路径不变。
"""

from __future__ import annotations

import csv
import io
import json
from collections.abc import Iterator

from ..models.tracker import ApplicationTrack, status_label
from .csv_io import safe_csv_cell

_CSV_HEADER = (
    "公司",
    "岗位",
    "状态",
    "阶段说明",
    "投递日期",
    "状态日期",
    "下一步",
    "下一步日期",
    "备注",
)


def export_row(item: ApplicationTrack) -> list[str]:
    """一条进度记录的 CSV 导出行（备注换行压成空格）。"""
    return [
        item.company,
        item.title,
        status_label(item.status),
        item.stage_note,
        item.applied_at,
        item.status_date,
        item.next_action,
        item.next_action_date,
        item.note.replace("\n", " "),
    ]


def export_rows(records: list[ApplicationTrack]) -> list[list[str]]:
    """把进度记录转成 CSV 导出的行（备注换行压成空格）。"""
    return [export_row(item) for item in records]


def iter_csv_chunks(records) -> Iterator[str]:
    """逐条产出 CSV 导出文本（含 BOM 与表头行），与 :func:`to_csv` 字节级一致。

    导出走 ``StreamingResponse``（2026-10-12 万级数据优化）：不再 fetchall 全量行
    拼一个几十 MB 的字符串，而是每写一行就 yield 一段。``records`` 是任意可迭代
    （通常是 :func:`iter_tracks` 的惰性行迭代器），BOM 与表头先行，行序即记录序。

    单元格编码与 ``records_to_csv_text`` **同源**（PR-12）：都经过
    :func:`csv_io.safe_csv_cell`——公式前缀（``=``/``+``/``-``/``@``/制表符等）
    的 Excel 注入防护只实现一份，改一处两处生效。
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    yield "﻿"
    writer.writerow(_CSV_HEADER)
    yield buffer.getvalue()
    for item in records:
        buffer.seek(0)
        buffer.truncate()
        writer.writerow([safe_csv_cell(value) for value in export_row(item)])
        yield buffer.getvalue()


def to_csv(records: list[ApplicationTrack]) -> str:
    """导出 CSV（一次性全量版本；流式端点走 :func:`iter_csv_chunks`）。

    ``\\ufeff`` 是 BOM：Excel 打开不带 BOM 的 UTF-8 CSV 会把中文显示成乱码，
    而这份文件最常见的用途恰恰是用 Excel 打开看看。
    """
    return "".join(iter_csv_chunks(records))


def to_json(records: list[ApplicationTrack]) -> str:
    """把求职进度记录序列化成 JSON 导出文本。"""
    payload = {
        "说明": "求职进度导出；状态取值与合并规则见 models/tracker.py",
        "总数": len(records),
        "记录": [
            {
                "公司": item.company,
                "岗位": item.title,
                "状态": status_label(item.status),
                "阶段说明": item.stage_note,
                "投递日期": item.applied_at,
                "状态日期": item.status_date,
                "下一步": item.next_action,
                "下一步日期": item.next_action_date,
                "备注": item.note,
                "来源": item.source,
            }
            for item in records
        ],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


__all__ = ["export_row", "export_rows", "iter_csv_chunks", "to_csv", "to_json"]
