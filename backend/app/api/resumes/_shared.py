# SPDX-License-Identifier: Apache-2.0
"""简历接口子模块共享件：PDF 响应头常量与三个跨域 helper。

从原 ``api/resumes.py`` 原样搬运（Wave5 拆分）：常量与 helper 的实现逻辑零改动，
仅随文件移动改变导入路径。
"""

import json
from typing import Literal, get_args

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ...models.resume import ResumeRecord
from ...schemas.resume import (
    FactAnnotation,
    ResumeContent,
    ResumeFontScale,
    ResumeOut,
)
from ...services import trash
from ...services.resume.resume_labels import normalize_language
from ...services.resume.resume_templates import DEFAULT_FONT_SCALE, DEFAULT_TEMPLATE

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


# 服务端 PDF 的实际页数与用户选定的上限。前端靠它们提示"下载下来的页数和你选的不一样"，
# 因此这两个响应头必须出现在 CORS 的 expose_headers 里（见 application.py）。
PDF_PAGES_HEADER = "X-Resume-Pages"
PDF_PAGE_LIMIT_HEADER = "X-Resume-Page-Limit"
# 按当前版式**真实需要**几页（未截断）。`X-Resume-Pages` 是文件里实际排了几页——超限时
# 两者不相等，界面用这句话说"按当前设置约需 N 页（上限 M 页）"，与草稿预览同一套措辞。
PDF_PAGES_NEEDED_HEADER = "X-Resume-Pages-Needed"

# 这份 PDF 由哪个引擎排版（当前唯一实现就是 fpdf2）。以前只能靠"样式像不像"猜，
# 前端与排查脚本要判断"这份文件到底出自服务端引擎还是浏览器打印"就没有依据。
PDF_ENGINE_HEADER = "X-Pdf-Engine"
PDF_ENGINE_NAME = "fpdf2"

# "按当前版式放不进所选页数、尾部已被截断"的如实标记（取 ``artifact.overflow``）。界面要能
# 提示用户加页/删内容，靠的是响应头而不是日志——日志只有开发者看得到。**标志不许说谎**：
# 它必须与 ``X-Resume-Pages-Needed`` 和 ``X-Resume-Page-Limit`` 的结论一致
# （``overflow`` 为真 ⇔ ``needed > limit``）。
#
# 2026-10-21 起服务端**不再缩字号**：以前会把字号乘一个 0.5~1.0 的系数硬塞进页数上限，
# 于是滑杆上的 18px 在纸面上可能是 9px。现在按真实参数排版，超限就截断并标记。
RESUME_OVERFLOW_HEADER = "X-Resume-Overflow"


def _format_sse(payload: dict) -> str:
    """把事件转成 SSE 数据帧。"""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _to_resume_out(record: ResumeRecord) -> ResumeOut:
    return ResumeOut(
        id=record.id,
        title=record.title,
        job_id=record.job_id,
        job_title=record.job_title,
        company=record.company,
        source=_as_resume_source(record.source or "ai"),
        favorite=record.favorite,
        model=record.model,
        enhancement_enabled=record.enhancement_enabled,
        enhancement_level=_as_enhancement_level(record.enhancement_level),
        note=record.note or "",
        template=record.template or DEFAULT_TEMPLATE,
        format_name=record.format_name or "",
        # 这个字段漏了不会报错，只会让保存成功却读不回来——界面上表现为"按了没反应"。
        format_config=record.format_config or {},
        page_limit=record.page_limit or 1,
        font_scale=_as_font_scale(record.font_scale or DEFAULT_FONT_SCALE),
        # 读取侧收口而不是直接透传：库里的值被外部工具改成 "fr" 或空串时按 zh-CN 读，
        # 否则 schema 的 Literal 校验会让整份简历列表 500（见 resume_labels 的说明）。
        language=normalize_language(record.language),
        created_at=record.created_at,
        parent_revision_id=record.parent_revision_id,
        content=ResumeContent.model_validate(record.content),
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
    )


def _get_live_resume(db: Session, resume_id: int) -> ResumeRecord:
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    return record


def _mark_saved(record: ResumeRecord) -> None:
    """把**制作台草稿**转成一份真正的简历（0051）。

    "用户保存过"= 他点了保存、而且写入真的成功了：只有到这一步，这份简历才该出现在
    简历中心的列表/搜索/统计里。所以这个调用点必须落在**写入成功之后**（``db.commit()``
    之前），不能放在进入制作台、打开编辑器这类"用户看了一眼"的动作上。

    写入本身不提交：调用方各自 ``db.commit()``，与它们原有的提交点保持同一处——
    多一次 commit 就会把"内容存了、草稿标记没存"拆成两笔事务。

    非草稿记录不受影响（``if`` 判掉），所以重复调用是安全的。
    """
    if record.draft:
        record.draft = False
