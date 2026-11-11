# SPDX-License-Identifier: Apache-2.0
"""抽取结果的行模型（列表字段 + 详情四态 + 原文依据）。

为什么需要它：预览表要同时回答三个问题——「这一条有哪些字段」「这些字段是页面给的还是
没抓到」「每个值在原文哪里」。只用 JobImportRow（line + data）回答不了后两个，所以列表
阶段用 ExtractedRow，提交阶段才转成 JobImportRow 喂现有导入通道。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .field_rules import (
    DETAIL_FIELDS,
    FETCH_FAILED,
    FILLED,
    NOT_FETCHED,
    NOT_ON_PAGE,
    WRITABLE_FIELDS,
    infer_job_type,
    normalize_posted_at,
    normalize_row_fields,
    summary_of,
)

#: 详情页能补的字段之外，列表阶段就应填好的 8 个字段。
LIST_FIELDS = (
    "title",
    "company",
    "location",
    "salary",
    "job_type",
    "source_url",
    "posted_at",
    "status",
)
_ALL_FIELDS = (*WRITABLE_FIELDS, *DETAIL_FIELDS)


@dataclass
class ExtractedRow:
    """一条待导入岗位（列表阶段或已补完详情）。"""

    data: dict[str, str] = field(default_factory=dict)
    #: 详情页 URL（source_url 的来源）；空串表示列表页没有给出详情链接。
    detail_url: str = ""
    #: 字段 → 原文依据（截断后的片段，用于预览 hover 核对）。
    evidence: dict[str, str] = field(default_factory=dict)
    #: 原文摘要（≤120 字）：防幻觉最有效的一招。
    summary: str = ""
    #: 字段 → filled / not_on_page / not_fetched / fetch_failed（17B 四态）。
    field_states: dict[str, str] = field(default_factory=dict)
    #: 详情抓取失败原因（fetch_failed 时给用户看）。
    detail_error: str = ""
    #: 无法归一、只在预览展示的发布时间原文（17C：原文不落库）。
    posted_at_raw: str = ""
    posted_at_inferred: bool = False
    job_type_inferred: bool = False
    #: JD 是否按明确小标题切开了职责/要求（17E；false 时预览显示「未区分职责/要求」）。
    jd_split: bool = False
    #: 导入时由服务层填：岗位广场里是否已有同一岗位。
    existing_job_id: int | None = None

    # ===== 构造与更新 =====

    @classmethod
    def build(
        cls,
        data: dict[str, str],
        *,
        page_url: str,
        page_text: str,
        fetched_on: str,
        detail_url: str = "",
        evidence: dict[str, str] | None = None,
        summary: str = "",
        posted_at_raw: str = "",
        require_detail: bool = False,
    ) -> ExtractedRow:
        """由原始抽取字段构造一行：统一归一 + 计算四态 + 兜底摘要。"""
        normalized = normalize_row_fields(
            {**data, "source_url": data.get("source_url") or detail_url},
            page_url=page_url,
            page_text=page_text,
            fetched_on=fetched_on,
        )
        raw_posted = posted_at_raw or data.get("posted_at", "")
        posted_inferred = False
        if raw_posted:
            # 相对日期（3天前/昨天/刚刚/本周）按抓取日换算 → 标记「按抓取日推算」。
            _, posted_inferred = normalize_posted_at(raw_posted, fetched_on=fetched_on)
        # 17D：页面明确写才用；没写就按 URL 频道推断（校招频道 → 校招），其余「其他」。
        job_type_inferred = False
        if not normalized.get("job_type"):
            inferred_value, inferred = infer_job_type(page_url=page_url, text="")
            normalized["job_type"] = inferred_value or "其他"
            job_type_inferred = inferred
        row = cls(
            data=normalized,
            detail_url=detail_url or normalized.get("source_url", ""),
            evidence=dict(evidence or {}),
            summary=summary or summary_of(page_text),
            posted_at_raw=raw_posted,
            posted_at_inferred=posted_inferred,
            job_type_inferred=job_type_inferred,
        )
        if detail_url and require_detail:
            row._refresh_states(pending_detail=True)
        else:
            row._refresh_states(pending_detail=False)
        return row

    def _refresh_states(self, *, pending_detail: bool) -> None:
        self.field_states = {}
        for name in _ALL_FIELDS:
            if (self.data.get(name) or "").strip():
                self.field_states[name] = FILLED
            elif name in DETAIL_FIELDS and pending_detail:
                self.field_states[name] = NOT_FETCHED
            else:
                self.field_states[name] = NOT_ON_PAGE

    def apply_detail(
        self,
        detail: dict[str, str],
        *,
        page_url: str,
        page_text: str,
        fetched_on: str,
        evidence: dict[str, str] | None = None,
        jd_split: bool = False,
    ) -> None:
        """把详情页抽到的字段合进这一行，状态从 not_fetched 变 filled / not_on_page。"""
        normalized = normalize_row_fields(
            detail, page_url=page_url, page_text=page_text, fetched_on=fetched_on
        )
        for name in DETAIL_FIELDS:
            value = normalized.get(name, "")
            if value:
                self.data[name] = value
                self.field_states[name] = FILLED
            else:
                self.field_states[name] = NOT_ON_PAGE
        if evidence:
            self.evidence.update(evidence)
        if not self.detail_url:
            self.detail_url = normalized.get("source_url", "")
        self.jd_split = jd_split
        self.detail_error = ""
        # 详情页也可能补上列表没给的 salary/location 等：列表阶段缺失的才补。
        for name in ("company", "location", "salary", "posted_at"):
            if not (self.data.get(name) or "").strip() and normalized.get(name):
                self.data[name] = normalized[name]
                self.field_states[name] = FILLED

    def mark_fetch_failed(self, reason: str) -> None:
        """详情抓取失败：四个详情字段标 fetch_failed（逐条容错，不拖垮整批）。"""
        for name in DETAIL_FIELDS:
            if self.field_states.get(name) != FILLED:
                self.field_states[name] = FETCH_FAILED
        self.detail_error = reason

    # ===== 输出 =====

    @property
    def title(self) -> str:
        return (self.data.get("title") or "").strip()

    def to_dict(self) -> dict[str, object]:
        """给前端/证据用的快照（不含 JobImportRow 的 line 概念）。"""
        return {
            "data": dict(self.data),
            "detail_url": self.detail_url,
            "summary": self.summary,
            "evidence": dict(self.evidence),
            "field_states": dict(self.field_states),
            "detail_error": self.detail_error,
            "posted_at_raw": self.posted_at_raw,
            "posted_at_inferred": self.posted_at_inferred,
            "job_type_inferred": self.job_type_inferred,
            "jd_split": self.jd_split,
            "existing_job_id": self.existing_job_id,
        }

    def has_pending_detail(self) -> bool:
        return any(state == NOT_FETCHED for state in self.field_states.values())


__all__ = ["ExtractedRow", "LIST_FIELDS"]
