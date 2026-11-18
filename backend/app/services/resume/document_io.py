# SPDX-License-Identifier: Apache-2.0
"""简历文档 v2 的读写边界：API / 服务层访问 ``resumes.content`` 的唯一入口。

**为什么要有这一层**（计划 §7.5/§8.2）：v2 是唯一存储格式，v1 只存在于转换器输入。
但"读旧记录要宽容、写新记录要严格"这两件事散落在几十个路由里会各写一份：

- **读**：``GET /api/resumes/{id}``、render、export、AI、bilingual、history 等入口统一走
  ``ensure_document_version``——v2 直通并归一化，v1 一次性转换（**不写库**）；同一请求内
  只转一次，路由把结果继续往下传；
- **写**：保存前用 ``prepare_document_for_save`` 收口（v1 也接受 → 转 v2 → 校验 id →
  normalize），落库的永远是 v2 dict；
- **分析**：只读算法直接读取 v2 节点；历史持久路径由 document_paths 按节点解析，
  不构造旧槽位模型，不更新存储行。

本模块只做薄封装与"按记录取定义"的编排，不重复实现转换/归一化规则（唯一实现在
document_converter / schemas.resume_document）。
"""

from __future__ import annotations

import logging
import re
from collections.abc import Mapping, Sequence
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ...models.resume import ResumeRecord
from ...schemas.resume_document import (
    DocumentValidationError,
    ResumeDocument,
    document_to_json,
    parse_document,
    validate_document_ids_v2,
)
from .document_conversion_types import ConversionError, ConversionReport, CustomFieldHint
from .document_converter import ensure_document_version_with_report

__all__ = [
    "ConversionError",
    "ConversionReport",
    "CustomFieldHint",
    "DocumentValidationError",
    "ResumeDocument",
    "UNSUPPORTED_PHOTO_DETAIL",
    "conversion_error_detail",
    "conversion_summary",
    "custom_field_definitions",
    "document_for_record",
    "document_or_422",
    "ensure_document_version",
    "ensure_document_version_with_report",
    "parse_document",
    "prepare_document_for_save",
    "prepare_document_for_save_with_report",
    "validate_document_ids_v2",
]


logger = logging.getLogger(__name__)

#: I-02：照片 data URI 前缀。只判前缀、不解码（省掉每次保存一次 base64 decode）。
_PHOTO_DATA_URL_RE = re.compile(r"^data:image/(?:jpeg|jpg|png|webp|gif);base64,", re.IGNORECASE)


def _heal_header_photo_placements(document: dict) -> list[dict[str, str]]:
    """I-02 保存侧自愈：`placement="contact"` 但值其实是图片 data URI 的页眉字段写回 `photo`。

    返回被修复的字段（`item_id` / `key`），调用方拿它写结构化日志。
    `header.photo` 已被占用时**不重复**占用：那个字段原样留在 contact，由 planner 跳过，
    不在保存路径上静默删用户的字段。
    """
    header = document.get("header")
    if not isinstance(header, dict):
        return []
    items = header.get("items")
    if not isinstance(items, list):
        return []
    has_photo = any(
        isinstance(item, dict) and item.get("placement") == "photo" and item.get("value")
        for item in items
    )
    healed: list[dict[str, str]] = []
    for item in items:
        if not isinstance(item, dict) or item.get("placement") != "contact":
            continue
        value = item.get("value")
        if not isinstance(value, str) or not _PHOTO_DATA_URL_RE.match(value):
            continue
        if has_photo:
            continue
        item["placement"] = "photo"
        has_photo = True
        healed.append({"item_id": str(item.get("id") or ""), "key": str(item.get("key") or "")})
    return healed


def ensure_document_version(
    content: Any,
    *,
    language: str | None = None,
    format_config: Mapping[str, Any] | None = None,
    custom_fields: Mapping[str, Sequence[CustomFieldHint | Mapping[str, Any]]] | None = None,
) -> dict:
    """任意版本 content -> v2 dict（v2 直通；v1 转换；不写库；幂等）。"""
    return ensure_document_version_with_report(
        content, language=language, format_config=format_config, custom_fields=custom_fields
    )[0]


def conversion_summary(report: ConversionReport | None) -> dict | None:
    """读路径发生 v1→v2 转换时的响应摘要；None = 本来就是 v2（不提示"已升级"）。"""
    return None if report is None else report.as_dict()


def prepare_document_for_save_with_report(
    content: Any,
    *,
    language: str | None = None,
    format_config: Mapping[str, Any] | None = None,
    custom_fields: Mapping[str, Sequence[CustomFieldHint | Mapping[str, Any]]] | None = None,
) -> tuple[dict, ConversionReport | None]:
    """同 prepare_document_for_save，但额外返回 v1→v2 的转换报告（None = 本来就是 v2）。

    创建/保存响应里的 document_conversion 用它：只有真的发生过转换才提示"旧简历已升级"。

    I-02 保存侧自愈：历史缺陷把照片写成 `placement="contact"` 的文档，在这里写回 `photo`。
    渲染侧的容忍（planner 跳过图片型 contact）只保证"看起来对"，不自愈的话这个键会永远留着，
    下一次导出仍要走一遍跳过判断。写回时记一条结构化日志，不打扰用户。
    """
    document, report = ensure_document_version_with_report(
        content,
        language=language,
        format_config=format_config,
        custom_fields=custom_fields,
    )
    if language:
        from .resume_labels import normalize_language

        document["language"] = normalize_language(language)
    healed = _heal_header_photo_placements(document)
    if healed:
        logger.info(
            "resume_document.header_photo_placement_healed",
            extra={"healed_fields": healed, "healed_count": len(healed)},
        )
    normalized = parse_document(document)
    validate_document_ids_v2(normalized)
    return document_to_json(normalized), report


def prepare_document_for_save(
    content: Any,
    *,
    language: str | None = None,
    format_config: Mapping[str, Any] | None = None,
    custom_fields: Mapping[str, Sequence[CustomFieldHint | Mapping[str, Any]]] | None = None,
) -> dict:
    """保存/落库前的收口：接受 v1 与 v2，返回**已归一化且 id 合法**的 v2 dict。

    非法结构/非法 id 抛 ConversionError / DocumentValidationError（API 统一翻 422，
    不静默重生成——重生成等于把用户设备上的对象标识悄悄换掉）。
    """
    document = ensure_document_version(
        content,
        language=language,
        format_config=format_config,
        custom_fields=custom_fields,
    )
    if language:
        # 记录的语言是这份简历显示语言的唯一权威：内容语言随记录同步，
        # 避免"切了语言但文档里还写着旧语言"的下一次渲染漂移。
        from .resume_labels import normalize_language

        document["language"] = normalize_language(language)
    normalized = parse_document(document)
    validate_document_ids_v2(normalized)
    return document_to_json(normalized)


def custom_field_definitions(db: Session | None) -> dict[str, list[dict]] | None:
    """当前方案的自定义字段纸面属性（converter 识别"标签：值"行与落位置用）。

    db 为空（脚本/纯函数上下文）时返回 None：转换器按"没有自定义字段提示"保守处理，
    已识别的内置字段不受影响。
    """
    if db is None:
        return None
    from ..profile.field_placement import custom_field_definitions as _definitions

    return _definitions(db)


def document_for_record(
    db: Session | None,
    record: ResumeRecord,
) -> tuple[dict, ConversionReport | None]:
    """读一份简历记录 -> (v2 dict, 转换报告或 None)。

    同一请求只调用一次并把返回值往下传（详情/render/export 不再各自转换第二遍）。
    ``format_config`` / ``language`` 都取记录自己的值：旧简历的 v1 field_layout 与
    contact_breaks 在转换时迁移进 v2 文档，不能丢。

    第二个元素是 ``ConversionReport`` 而不是「摘要 dict」：摘要形状由
    ``conversion_summary`` 一处生成，读路径把报告原样交给它（这里是 None 表示本来就是 v2）。
    """
    return ensure_document_version_with_report(
        record.content,
        language=getattr(record, "language", None),
        format_config=getattr(record, "format_config", None),
        custom_fields=custom_field_definitions(db),
    )


# v1 内容的 pydantic 校验错误（尤其照片 data URL）对用户没有可读性：这里统一翻成人话。
UNSUPPORTED_PHOTO_DETAIL = (
    "简历照片格式不受支持：照片必须是 JPEG、PNG 或 WebP 格式的 base64 data URL，"
    "请重新上传后再预览或导出"
)


def conversion_error_detail(exc: Exception) -> str:
    """把 ConversionError / pydantic 校验错误翻成可读的 422 detail（照片单独给指引）。

    **为什么在服务层**：读/写两个边界（``document_or_422`` 与 ``_validated_content``）与
    RF-03 之后的动作层都要产出同一句用户可读提示；文案一旦有第二份实现，
    "非法照片" 与 "结构不合法" 的措辞就会随改动漂移。
    """
    text = str(exc).strip()
    lowered = text.lower()
    if "photo" in lowered or "data url" in lowered or "data_url" in lowered:
        return UNSUPPORTED_PHOTO_DETAIL
    if text:
        return f"简历内容无法解析：{text[:300]}"
    return "简历内容无法解析：请检查内容结构后重试"


def document_or_422(
    payload: Any,
    db: Session | None = None,
    *,
    language: str | None = None,
    format_config: dict | None = None,
) -> dict:
    """读/渲染入口的版本收口：v1/v2 -> v2 dict；结构不合法统一 422（不 500）。

    从 ``api/resumes/_shared.py`` 原样搬入服务层（RF-03b）：分页报告与渲染入口的编排
    下沉到 ``services/resume/**`` 之后，动作层（不允许 import ``app.api``）必须能复用
    同一个收口函数，否则"结构不合法 → 422"就会出现第二份实现。

    返回 ``HTTPException`` 而不是自定义异常是有意为之：调用方**两侧**（路由 handler 与
    ActionSpec.run）都要把同一条提示变成 422，错误形状是接口层契约，翻译只允许一处。
    """
    try:
        return ensure_document_version(
            payload,
            language=language,
            format_config=format_config,
            custom_fields=custom_field_definitions(db),
        )
    except (ConversionError, DocumentValidationError) as exc:
        raise HTTPException(status_code=422, detail=conversion_error_detail(exc)) from exc
