# SPDX-License-Identifier: Apache-2.0
"""简历接口子模块共享件：PDF 响应头常量、导出准入/版本收口与序列化 helper。

从原 ``api/resumes.py`` 原样搬运（Wave5 拆分）：常量与 helper 的实现逻辑零改动，
仅随文件移动改变导入路径。

**RF-03b**：``document_or_422`` / ``conversion_error_detail`` 与详情序列化
（``_to_resume_out``）的实现搬到了 ``services/resume/**``——分页报告、版式保存与
``get_resume`` 动作下沉到服务层之后，这两处若不搬就会被复制成第二份实现。
本文件保留同名 re-export（含历史名字 ``_to_resume_out``），调用点无需改动。
"""

import json
from typing import Any

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from ...middleware.loopback_origin import is_non_cross_site_request
from ...models.resume import ResumeRecord
from ...schemas.resume_document import DocumentValidationError
from ...services import trash
from ...services.resume import document_io
from ...services.resume.document_conversion_types import ConversionError
from ...services.resume.document_io import conversion_error_detail, document_or_422
from ...services.resume.resume_labels import DEFAULT_RESUME_LANGUAGE
from ...services.resume.resume_out import build_resume_out
from .. import settings as settings_api

# 历史名字（Wave5 之前叫 ``_to_resume_out``）：ai_edits / crud / layout_render /
# versions / resume_phrases 这些调用点与既有 monkeypatch 位置都还用这个名字。
_to_resume_out = build_resume_out


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


def page_limit_header_value(page_limit: int | None, *, is_unlimited: bool) -> str | None:
    """``X-Resume-Page-Limit`` 的值：**「不限篇幅」回 0**，其余回真实上限。

    为什么不直接回 ``artifact.page_limit``：用户选「不限」时记录里存的是 0，而
    ``mode_page_limit(0)`` 会把它折成 10 页——那 10 是给 PDF 的**渲染保护上限**，不是
    用户选的篇幅。把 10 写进这个头，界面就会显示"上限 10 页"，与用户刚才选的「不限」
    自相矛盾（也答不出"这份文件到底有没有篇幅约束"）。

    回 0 与记录里的语义值一致；前端 ``readCountHeader`` 把 0 当"没有上限"（null），
    正好是「不限」该有的展示。

    ``page_limit`` 为 ``None``（渲染器不报上限、也没裁剪）时不发这个头。
    """
    if page_limit is None:
        return None
    return "0" if is_unlimited else str(page_limit)


def _require_local_export_request(request: Request) -> None:
    """Resume exports expose private profile data and are a loopback-only capability."""
    if not settings_api._is_loopback_request(request) or not is_non_cross_site_request(request):
        raise HTTPException(status_code=403, detail="简历导出仅允许从本机前端访问")


def _document_for_request(db: Session, record: ResumeRecord, content_override: dict | None) -> dict:
    """导出输入的版本收口：v2 直通；旧记录/旧草稿一次性转换（不写库）。

    结构不合法（例如非法照片 data URL）统一 422 + 可读提示，不冒泡成 500。
    """
    return document_or_422(
        content_override if content_override is not None else record.content,
        db,
        language=record.language or DEFAULT_RESUME_LANGUAGE,
        format_config=record.format_config or {},
    )


def _format_sse(payload: dict) -> str:
    """把事件转成 SSE 数据帧。"""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _validated_content(
    payload: Any,
    db: Session | None = None,
    *,
    language: str | None = None,
    format_config: dict | None = None,
) -> dict:
    """写路径收口：接受 v1 / v2 内容 JSON，返回**归一化后的 v2 dict**（落库格式）。

    只在写路径调用：读取旧记录必须宽容（v1 在读路径一次性转换），而写入非法结构/非法
    对象标识会 422 而不是静默重生成——重生成等于把用户设备上的标识悄悄换掉。
    """
    try:
        return document_io.prepare_document_for_save(
            payload,
            language=language,
            format_config=format_config,
            custom_fields=document_io.custom_field_definitions(db),
        )
    except (ConversionError, DocumentValidationError) as exc:
        raise HTTPException(status_code=422, detail=conversion_error_detail(exc)) from exc


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
