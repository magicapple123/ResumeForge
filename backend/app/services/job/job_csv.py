"""岗位 CSV 导入/导出（岗位广场批量搬家的离线路径）。

- **导出**：把勾选的岗位序列化成带 UTF-8 BOM 的 CSV（Excel 双击打开不乱码），
  列集与导入共用同一份 ``CSV_COLUMNS``——导出什么就能原样导回，来回不丢字段。
- **导入**：宽容解析（UTF-8/GBK、表头别名、空行跳过）、逐行报错（行号 + 原因），
  解析与入库分成两步（先预览确认、再提交），用户不会"选完文件就静默进了几百条"。

注意：``recognition_source``（录入方式）不参与 CSV——那是系统内部的溯源字段，
CSV 导入的录入方式就是"CSV 导入"这一行为本身，无需用户填写。
"""

from __future__ import annotations

import csv
import io

from ...models.job import JOB_STATUSES, Job

# 列定义：[(中文表头, 字段名)]。导出用它写表头，导入按它映射——**两边共用一份**。
# 「来源」对应 0042 起的独立字段 origin_source；「备注」是用户自己写的内容。
CSV_COLUMNS: list[tuple[str, str]] = [
    ("标题", "title"),
    ("公司", "company"),
    ("地点", "location"),
    ("薪资", "salary"),
    ("职位类型", "job_type"),
    ("状态", "status"),
    ("来源", "origin_source"),
    ("投递链接", "source_url"),
    ("发布时间", "posted_at"),
    ("职位描述", "description"),
    ("任职要求", "requirements"),
    ("补充信息", "additional_info"),
    ("备注", "note"),
    ("收藏", "favorite"),
]
HEADER_TO_FIELD = {header: field for header, field in CSV_COLUMNS}
# 导入宽容表头：同一字段可能被写成别的名字（用户从别处导出的表）。
HEADER_ALIASES: dict[str, str] = {
    "职位名称": "title",
    "岗位名称": "title",
    "职位": "title",
    "单位": "company",
    "公司名称": "company",
    "工作地点": "location",
    "链接": "source_url",
    "网址": "source_url",
    "招聘链接": "source_url",
    "JD": "description",
    "岗位描述": "description",
    "要求": "requirements",
    "任职要求": "requirements",
}

# 一场批量导入的体量上限：与批量操作（选择/删除/分析）的 500 上限对齐。
MAX_IMPORT_ROWS = 500
MAX_IMPORT_FILE_CHARS = 2_000_000

_TRUE_TOKENS = {"是", "y", "yes", "true", "1", "收藏"}


def jobs_to_csv_text(jobs: list[Job]) -> str:
    """把岗位列表序列化成 CSV 文本（开头带 UTF-8 BOM，Excel 直开不乱码）。"""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([header for header, _ in CSV_COLUMNS])
    for job in jobs:
        writer.writerow(
            [
                ("是" if job.favorite else "")
                if field == "favorite"
                else (getattr(job, field) or "")
                for _, field in CSV_COLUMNS
            ]
        )
    return "\ufeff" + buffer.getvalue()


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


def row_to_payload(row: dict[str, str]) -> dict[str, object]:
    """把一行解析结果清洗成可直接建 ``JobCreate`` 的字段字典。"""
    payload: dict[str, object] = {}
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

    行号是文件里的真实行号（含表头算 1），用户能直接在 Excel 里定位到那一行。
    """
    reader = csv.reader(io.StringIO(text))
    rows: list[dict[str, str]] = []
    errors: list[dict[str, object]] = []

    try:
        header_row = next(reader)
    except StopIteration:
        return [], [{"line": 1, "message": "文件是空的"}]

    fields: list[str | None] = []
    seen_fields: set[str] = set()
    for _index, cell in enumerate(header_row):
        name = cell.strip().lstrip("\ufeff")
        field = HEADER_TO_FIELD.get(name) or HEADER_ALIASES.get(name)
        if field and field not in seen_fields:
            seen_fields.add(field)
        fields.append(field)
    if "title" not in seen_fields:
        return [], [{"line": 1, "message": "缺少「标题」列，无法识别哪一列是岗位名"}]

    for offset, raw_row in enumerate(reader):
        line = offset + 2  # 表头是第 1 行
        if not any((cell or "").strip() for cell in raw_row):
            continue  # 空行不算数据，也不报错
        if len(rows) >= MAX_IMPORT_ROWS:
            errors.append(
                {"line": line, "message": f"一次最多导入 {MAX_IMPORT_ROWS} 行，后面的行已忽略"}
            )
            break
        row: dict[str, str] = {}
        for index, field in enumerate(fields):
            if field is None or index >= len(raw_row):
                continue
            row[field] = raw_row[index]
        try:
            row_to_payload(row)
        except ValueError as exc:
            errors.append({"line": line, "message": str(exc)})
            continue
        rows.append((line, row))
    return rows, errors


def decode_csv_bytes(raw: bytes) -> str:
    """解码上传的 CSV 字节：优先 UTF-8（带 BOM 也行），失败退回 GBK（Excel 中文导出常见）。"""
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        pass
    try:
        return raw.decode("gbk")
    except UnicodeDecodeError as exc:
        raise ValueError("无法识别文件编码：请用 UTF-8 或 GBK 保存 CSV 后重试") from exc


__all__ = [
    "CSV_COLUMNS",
    "MAX_IMPORT_FILE_CHARS",
    "MAX_IMPORT_ROWS",
    "decode_csv_bytes",
    "jobs_to_csv_text",
    "parse_job_csv",
    "row_to_payload",
]
