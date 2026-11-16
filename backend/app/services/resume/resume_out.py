# SPDX-License-Identifier: Apache-2.0
"""简历记录的**唯一**详情序列化实现：``ResumeRecord`` -> ``ResumeOut``。

从 ``api/resumes/_shared.py`` 原样搬入服务层（RF-03b）：详情视图有两条入口——
``GET /api/resumes/{id}`` 的 handler 与助手动作 ``get_resume`` 的 ``run``。后者按守卫
不许 import ``app.api``，所以这份"记录 → 响应"的映射必须住在服务层，否则只能复制一份。

**为什么不各写一份**：``ResumeOut`` 有十几个字段，其中 ``page_limit`` 的语义值 0
（「不限篇幅」）、``revision`` 的 ``or 0`` 兜底、``language`` 的读取侧归一都是踩过坑的
细节；两份实现里漏掉任意一条，界面上就会表现为"保存成功却读不回来"。

``api/resumes/_shared.py`` 仍然 re-export ``_to_resume_out``（历史名字），调用点与
monkeypatch 位置都不用动。
"""

from __future__ import annotations

from typing import Literal, get_args

from sqlalchemy.orm import Session

from ...models.resume import ResumeRecord
from ...schemas.resume import (
    FactAnnotation,
    ResumeFontScale,
    ResumeOut,
)
from . import document_io
from .resume_labels import normalize_language
from .resume_templates import DEFAULT_FONT_SCALE, DEFAULT_TEMPLATE

# 与 ResumeBrief 对应字段上的 Literal 保持一致（schema 里未起别名，这里就近镜像）。
ResumeSource = Literal["ai", "manual"]
ResumeEnhancementLevel = Literal["light", "balanced", "strong"]

# 模型层三列都是 ``str``，出口处收窄为 schema 的 ``Literal``（未知值大声失败，
# 与 pydantic Literal 字段的校验语义一致——以前响应模型校验也会在同一位置拦下）。
_SOURCE_VALUES: tuple[ResumeSource, ...] = get_args(ResumeSource)
_ENHANCEMENT_LEVEL_VALUES: tuple[ResumeEnhancementLevel, ...] = get_args(ResumeEnhancementLevel)
_FONT_SCALE_VALUES: tuple[ResumeFontScale, ...] = get_args(ResumeFontScale)


def _as_resume_source(value: str) -> ResumeSource:
    if value not in _SOURCE_VALUES:
        raise ValueError(f"未知的简历来源：{value!r}")
    return value


def _as_enhancement_level(value: str) -> ResumeEnhancementLevel:
    if value not in _ENHANCEMENT_LEVEL_VALUES:
        raise ValueError(f"未知的美化档位：{value!r}")
    return value


def _as_font_scale(value: str) -> ResumeFontScale:
    if value not in _FONT_SCALE_VALUES:
        raise ValueError(f"未知的字号系数：{value!r}")
    return value


def build_resume_out(
    record: ResumeRecord,
    db: Session | None = None,
    *,
    document_conversion: dict | None = None,
) -> ResumeOut:
    """记录 -> 详情响应。读路径统一收口：v1 记录一次性转 v2（不写库）。

    document_conversion 由**写路径**传入（创建时请求体是 v1，响应要告诉用户已升级）；
    读路径下它是 None = 库内本来就是 v2，或转换发生在本次读取（document_for_record 返回摘要）。
    """
    content, conversion = document_io.document_for_record(db, record)
    if document_conversion is not None:
        conversion_summary = document_conversion
    else:
        conversion_summary = document_io.conversion_summary(conversion)
    return ResumeOut(
        id=record.id,
        title=record.title,
        job_id=record.job_id,
        job_title=record.job_title,
        company=record.company,
        source=_as_resume_source(record.source or "ai"),
        favorite=record.favorite,
        favorited_at=record.favorited_at,
        favorited_at_estimated=bool(record.favorited_at_estimated),
        model=record.model,
        enhancement_enabled=record.enhancement_enabled,
        enhancement_level=_as_enhancement_level(record.enhancement_level),
        note=record.note or "",
        # W14/0054：旧行 server_default 读作 resume。
        document_mode=getattr(record, "document_mode", "resume") or "resume",
        template=record.template or DEFAULT_TEMPLATE,
        format_name=record.format_name or "",
        # 这个字段漏了不会报错，只会让保存成功却读不回来——界面上表现为"按了没反应"。
        format_config=record.format_config or {},
        # 语义值原样回传：``0`` = 「不限篇幅」（前端按 ``=== 0`` 判定）。写成
        # ``or 1`` 会让 API 把「不限」答成"1 页"，编辑器立刻显示最严的篇幅——用户
        # 明明选了不限，界面却告诉他只能写一页。只有 NULL 列（老数据）才回落 1。
        page_limit=record.page_limit if record.page_limit is not None else 1,
        font_scale=_as_font_scale(record.font_scale or DEFAULT_FONT_SCALE),
        # 读取侧收口而不是直接透传：库里的值被外部工具改成 "fr" 或空串时按 zh-CN 读，
        # 否则 schema 的 Literal 校验会让整份简历列表 500（见 resume_labels 的说明）。
        language=normalize_language(record.language),
        created_at=record.created_at,
        parent_revision_id=record.parent_revision_id,
        content=content,
        document_conversion=conversion_summary,
        warnings=record.warnings or [],
        parse_error=record.parse_error,
        rationale=record.rationale or "",
        coverage_notes=record.coverage_notes or [],
        # JSON 列里存的是 dict，逐条显式校验成 FactAnnotation（与 pydantic 构造时的
        # 隐式校验同语义，这里写明让类型检查器也看得到）。
        fact_annotations=[
            FactAnnotation.model_validate(item) for item in (record.fact_annotations or [])
        ],
        # 制作台靠它决定要不要把「保存」常驻（见 schema 里的说明）。
        draft=bool(record.draft),
        # 保存次数（0052）：前端把它记成 ``expectedRevision``，下次条件写原样发回。
        # ``or 0`` 兜住 0052 之前写入的旧行与"列刚加、还没 refresh"的实例。
        revision=int(record.revision or 0),
        # A5：这份简历生成时冻结的职业场景快照（旧行/手写简历为 None，不按当前场景回填）。
        context_snapshot=getattr(record, "context_snapshot", None),
    )


__all__ = [
    "ResumeEnhancementLevel",
    "ResumeSource",
    "build_resume_out",
]
