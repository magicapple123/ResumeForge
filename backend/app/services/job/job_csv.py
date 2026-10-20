# SPDX-License-Identifier: Apache-2.0
"""岗位 CSV 导入/导出（岗位广场批量搬家的离线路径）。

- **导出**：把勾选的岗位序列化成带 UTF-8 BOM 的 CSV（Excel 双击打开不乱码），
  列集与导入共用同一份 ``CSV_COLUMNS``——导出什么就能原样导回，来回不丢字段。
  表头用**手动添加岗位表单的字段名**；字段内换行折叠成空格（Excel 里引用字段内的
  换行会把一行撑成好几行、整个表格看起来"散架"，折叠后每条岗位恰好一行）。
- **导入**：宽容解析（UTF-8/GBK、表头别名、空行跳过）、逐行报错（**物理行号** +
  原因），解析与入库分成两步（先预览确认、再提交），用户不会"选完文件就静默进了几百条"。
  解析骨架（行号口径、行级隔离、重复表头检测）与备选岗位 CSV 共用
  :func:`csv_io.parse_csv_table`——规则只写一份。

注意：``recognition_source``（录入方式）不参与 CSV——那是系统内部的溯源字段，
CSV 导入的录入方式就是"CSV 导入"这一行为本身，无需用户填写。
"""

from __future__ import annotations

from typing import Any

from ...models.job import JOB_STATUSES, Job
from ..csv_io import (
    MAX_IMPORT_FILE_CHARS,
    MAX_IMPORT_ROWS,
    decode_csv_bytes,
    parse_csv_table,
    records_to_csv_text,
)

# 列定义：[(中文表头, 字段名)]。导出用它写表头，导入按它映射——**两边共用一份**。
# 表头用**手动添加岗位表单的字段名**（岗位名称/公司名称/工作地点/薪资范围…），用户在
# 表格和表单之间来回对字段不用做翻译；顺序也跟着表单走。「收藏」表单里没有，但导出
# 要能带回收藏状态，排在最后一列。
# 「来源」对应 0042 起的独立字段 origin_source；「备注」是用户自己写的内容。
CSV_COLUMNS: list[tuple[str, str]] = [
    ("岗位名称", "title"),
    ("公司名称", "company"),
    ("工作地点", "location"),
    ("薪资范围", "salary"),
    ("岗位类型", "job_type"),
    ("状态", "status"),
    ("投递链接", "source_url"),
    ("发布时间", "posted_at"),
    ("岗位描述", "description"),
    ("任职要求", "requirements"),
    ("其他招聘信息", "additional_info"),
    ("来源", "origin_source"),
    ("备注", "note"),
    ("收藏", "favorite"),
]
HEADER_TO_FIELD = {header: field for header, field in CSV_COLUMNS}
# 导入宽容表头：同一字段可能被写成别的名字（用户从别处导出的表，或 2026-10-12 两次
# 表头口径调整之前的旧文件：标题/公司/地点/薪资、职位类型/职位描述、-all 表头等）。
# 老文件也要能原样导回，所以这些名字不撤。
HEADER_ALIASES: dict[str, str] = {
    "标题": "title",
    "职位名称": "title",
    "岗位名称": "title",
    "职位": "title",
    "公司": "company",
    "单位": "company",
    "公司名称": "company",
    "地点": "location",
    "工作地点": "location",
    "薪资": "salary",
    "链接": "source_url",
    "网址": "source_url",
    "招聘链接": "source_url",
    "JD": "description",
    "岗位描述": "description",
    "职位描述": "description",
    "职位类型": "job_type",
    "补充信息": "additional_info",
    "要求": "requirements",
    "任职要求": "requirements",
}

# 体量上限（MAX_IMPORT_ROWS / MAX_IMPORT_FILE_CHARS）从 csv_io 引入：
# 备选岗位 CSV 共用同一上限，这里不再重复定义。

_TRUE_TOKENS = {"是", "y", "yes", "true", "1", "收藏"}


def jobs_to_csv_text(jobs: list[Job]) -> str:
    """把岗位列表序列化成 CSV 文本（开头带 UTF-8 BOM，Excel 直开不乱码）。"""
    headers = [header for header, _ in CSV_COLUMNS]
    records = [
        [
            ("是" if job.favorite else "") if field == "favorite" else getattr(job, field)
            for _, field in CSV_COLUMNS
        ]
        for job in jobs
    ]
    return records_to_csv_text(headers, records)


def _clean_status(value: str) -> str:
    value = (value or "").strip()
    if value and value not in JOB_STATUSES:
        allowed = "、".join(JOB_STATUSES)
        raise ValueError(f"状态必须是：{allowed}")
    return value or "开放中"


def _clean_url(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    if not value.lower().startswith(("http://", "https://")):
        raise ValueError("投递链接必须以 http:// 或 https:// 开头")
    return value


def _parse_favorite(value: str) -> bool:
    return (value or "").strip().lower() in _TRUE_TOKENS


def row_to_payload(row: dict[str, str]) -> dict[str, Any]:
    """把一行解析结果清洗成可直接建 ``JobCreate`` 的字段字典。

    值域是 ``str``（文本字段）与 ``bool``（favorite），但调用方以 ``**`` 解包进
    ``JobCreate``，键集合随行内容变化——声明 ``Any`` 让解包交给 pydantic 校验。
    """
    payload: dict[str, Any] = {}
    for field, value in row.items():
        text = (value or "").strip()
        if field == "favorite":
            payload[field] = _parse_favorite(text)
        elif field == "status":
            payload[field] = _clean_status(text)
        elif field == "source_url":
            payload[field] = _clean_url(text)
        else:
            payload[field] = text
    title = str(payload.get("title") or "").strip()
    if not title:
        raise ValueError("标题不能为空")
    return payload


def parse_job_csv(text: str) -> tuple[list[tuple[int, dict[str, str]]], list[dict[str, object]]]:
    """解析 CSV 文本，返回 ``(可导入的 (行号, 字段字典) 列表, 错误行)``。

    行号是文件里的**物理起始行号**（含表头算 1，带引号内换行的记录按起始行报），
    用户能直接在 Excel 里定位到那一行。解析骨架与备选岗位 CSV 共用
    :func:`csv_io.parse_csv_table`。
    """
    return parse_csv_table(
        text,
        header_to_field=HEADER_TO_FIELD,
        header_aliases=HEADER_ALIASES,
        validate_row=row_to_payload,
        title_field="title",
        title_missing_message="缺少「标题」列，无法识别哪一列是岗位名",
    )


__all__ = [
    "CSV_COLUMNS",
    "MAX_IMPORT_FILE_CHARS",
    "MAX_IMPORT_ROWS",
    "decode_csv_bytes",
    "jobs_to_csv_text",
    "parse_job_csv",
    "row_to_payload",
]
