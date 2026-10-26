# SPDX-License-Identifier: Apache-2.0
"""备选岗位 CSV 导入/导出：与岗位广场 CSV 同一套规则（列集不同）。

- **导出**：勾选的候选序列化成带 UTF-8 BOM 的 CSV；列集与导入共用 ``CSV_COLUMNS``。
  候选的字段比正式岗位少（没有 JD 结构、类型、收藏），列集就是添加备选表单的字段。
  **这是「精简交换格式」，不是完整无损备份**：地点/薪资等库内字段不在列集里、
  字段内换行折叠成空格——导出的文件用于在表格工具里批量编辑再导回，不承诺
  round-trip 还原每一条字段。
- **导入**：宽容解析（UTF-8/GBK、表头别名、空行跳过）、逐行报错（**物理行号** +
  原因）、与既有候选按「链接」或「岗位名 + 公司」判重跳过；解析与入库两步走
  （先预览确认）。解析骨架（行号口径、行级隔离、重复表头检测）与岗位 CSV
  共用 :func:`csv_io.parse_csv_table`——规则只写一份。
  导入的候选 ``source`` 一律标「CSV 导入」——这是录入方式的事实，不冒充粘贴/截图。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..models.material import CandidateJob
from ..schemas.material import CandidateJobCreate
from .candidate_jobs import create_candidate_job
from .csv_io import (
    decode_csv_bytes,
    parse_csv_table,
    records_to_csv_text,
)
from .trash import live_only

# 列定义：[(中文表头, 字段名)]。与「添加备选岗位」表单的字段名一致；
# 「来源 / 状态 / 截图」是系统侧的溯源信息，不参与 CSV 往返。
CSV_COLUMNS: list[tuple[str, str]] = [
    ("岗位名称", "title"),
    ("公司名称", "company"),
    ("岗位链接", "source_url"),
    ("招聘原文", "raw_text"),
    ("备注", "note"),
]
HEADER_TO_FIELD = {header: field for header, field in CSV_COLUMNS}
# 导入宽容表头：别的工具导出的表用词可能不同。
HEADER_ALIASES: dict[str, str] = {
    "标题": "title",
    "职位名称": "title",
    "职位": "title",
    "公司": "company",
    "单位": "company",
    "地点": "location",
    "城市": "location",
    "薪资": "salary",
    "链接": "source_url",
    "网址": "source_url",
    "招聘链接": "source_url",
    "原文": "raw_text",
    "招聘信息": "raw_text",
    "JD": "raw_text",
}


def _original_text(candidate: CandidateJob) -> str:
    """「招聘原文」列的取值：手动候选在 raw_text；采集候选的原文已被切成三段，
    导出时拼回一段（换行随后会折叠）——否则采集来的候选导出后这一列全是空。"""
    if candidate.raw_text:
        return candidate.raw_text
    return "\n".join(
        part
        for part in (candidate.description, candidate.requirements, candidate.additional_info)
        if part
    )


def candidates_to_csv_text(candidates: list[CandidateJob]) -> str:
    """把候选列表序列化成 CSV 文本（带 BOM、字段内换行折叠——每条恰好一行）。"""
    headers = [header for header, _ in CSV_COLUMNS]
    records = [
        [
            _original_text(candidate) if field == "raw_text" else getattr(candidate, field)
            for _, field in CSV_COLUMNS
        ]
        for candidate in candidates
    ]
    return records_to_csv_text(headers, records)


def _clean_url(value: str) -> str:
    text = (value or "").strip()
    if text and not text.lower().startswith(("http://", "https://")):
        raise ValueError("岗位链接必须以 http:// 或 https:// 开头")
    return text


def _row_to_payload(row: dict[str, str]) -> dict[str, str]:
    payload: dict[str, str] = {}
    for field, value in row.items():
        text = (value or "").strip()
        payload[field] = _clean_url(text) if field == "source_url" else text
    if not payload.get("title"):
        raise ValueError("岗位名称不能为空")
    return payload


def find_duplicate(db: Session, title: str, company: str, source_url: str) -> CandidateJob | None:
    """与既有候选判重：链接相同必是同一条；没链接时退回「岗位名 + 公司」。

    只看**未删除**的候选（0050 起候选进回收站）：导入 CSV 的意图是"把这些岗位加进待办
    清单"，一条已删掉的候选不该拦住它——否则用户删了再导同一份 CSV，每一行都会被判
    "已有这一条"却看不见任何东西。
    """
    query = db.query(CandidateJob).filter(live_only(CandidateJob))
    if source_url:
        return query.filter(CandidateJob.source_url == source_url).first()
    if title and company:
        return (
            query.filter(CandidateJob.title == title, CandidateJob.company == company)
            .filter(CandidateJob.source_url == "")
            .first()
        )
    return None


def parse_candidate_csv(
    text: str,
) -> tuple[list[tuple[int, dict[str, str]]], list[dict[str, object]]]:
    """解析候选 CSV 文本，返回 ``(可导入的 (行号, 字段字典) 列表, 错误行)``。

    行号是文件里的**物理起始行号**（含表头算 1，带引号内换行的记录按起始行报），
    用户能直接在 Excel 里定位到那一行。解析骨架与岗位 CSV 共用
    :func:`csv_io.parse_csv_table`。
    """
    rows, errors = parse_csv_table(
        text,
        header_to_field=HEADER_TO_FIELD,
        header_aliases=HEADER_ALIASES,
        validate_row=_row_to_payload,
        title_field="title",
        title_missing_message="缺少「岗位名称」列，无法识别哪一列是岗位名",
    )
    return rows, [{**error, "code": "invalid"} for error in errors]


def import_candidate_rows(
    db: Session, rows: list[tuple[int, dict[str, str]]]
) -> tuple[int, list[dict[str, object]]]:
    """逐行建候选；与既有候选重复的行跳过并说明。返回 (导入数, 失败账目)。"""
    imported = 0
    failed: list[dict[str, object]] = []
    for line, row in rows:
        try:
            clean = _row_to_payload(row)
            title = clean.get("title", "")
            company = clean.get("company", "")
            source_url = clean.get("source_url", "")
            if find_duplicate(db, title, company, source_url) is not None:
                failed.append(
                    {
                        "line": line,
                        "message": "备选岗位里已有这一条，已跳过",
                        "code": "duplicate",
                    }
                )
                continue
            create_candidate_job(
                db,
                CandidateJobCreate(
                    title=title,
                    company=company,
                    location=clean.get("location", ""),
                    salary=clean.get("salary", ""),
                    source_url=source_url,
                    raw_text=clean.get("raw_text", ""),
                    note=clean.get("note", ""),
                    source="CSV 导入",
                ),
            )
            imported += 1
        except ValueError as exc:
            db.rollback()
            failed.append(
                {"line": line, "message": str(exc) or "这一行导入失败", "code": "invalid"}
            )
        except Exception as exc:  # noqa: BLE001 - 单行失败不拖垮整批，逐行给原因
            db.rollback()
            failed.append({"line": line, "message": str(exc) or "这一行导入失败", "code": "error"})
    return imported, failed


__all__ = [
    "CSV_COLUMNS",
    "candidates_to_csv_text",
    "decode_csv_bytes",
    "find_duplicate",
    "import_candidate_rows",
    "parse_candidate_csv",
]
