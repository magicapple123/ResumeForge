# SPDX-License-Identifier: Apache-2.0
"""识别路由：按"有没有图 / 模型能不能看图 / OCR 能不能用"决定这一单怎么走（I-34）。

四个字：**先判再发**。能力表（``llm/capabilities.py``）已经知道某个 (host, model) 收不收
图片；过去调用前不查，先把 ``image_url`` 发出去、等 400 回来再"猜"原因，用户看到的是一条
含糊的"可能是当前模型不支持图片输入"。四条出口：

===========================================  ===================================
输入                                          走法
===========================================  ===================================
无图                                          文本模型（不变）
有图 + 模型有 vision                            视觉（现状路径，发 image_url）
有图 + 无 vision + OCR 可用                     OCR → 文本模型（不发原图）
有图 + 无 vision + OCR 不可用                   一个请求都不发：本地草稿 + 精确提示
===========================================  ===================================

``prepare_extraction_images``（``ocr/scan.py``）早就实现了"逐张 OCR、成功的不再送视觉模型、
失败的回退视觉并记警告"，但全仓零调用方；本模块就是那个调用点。它把图片**换成文字**之后
再交给文本模型：既不需要多模态，也不需要把同一份内容付两次钱（OCR 文本与原图不同时发）。
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from starlette.concurrency import run_in_threadpool

from ..schemas.setting import LLMConfig
from .llm.base import BaseLLMProvider
from .llm.capabilities import resolve_capabilities
from .ocr import OcrContext, prepare_extraction_images
from .ocr.client import OcrError
from .ocr.scan import user_message_for

logger = logging.getLogger(__name__)

#: 一次识别的路由结果。``blocked`` 表示"能力上就发不出去"，调用方不得再请求模型。
RecognitionRoute = Literal["text", "vision", "ocr", "blocked"]

#: 岗位草稿里"前端会回填"的内容字段（与 ``JobFormModal`` 的
#: ``RECOGNIZED_CONTENT_FIELDS`` 同源）。判"白调一次视觉模型"只看这几项：
#: ``job_type`` / ``status`` 有默认值，算进来会让判空恒假。
JOB_CONTENT_FIELDS: tuple[str, ...] = (
    "title",
    "company",
    "location",
    "salary",
    "description",
    "requirements",
    "additional_info",
    "source_url",
    "posted_at",
)

#: 资料草稿的内容字段。同样排除有默认值的 ``phone_country_code`` / ``section_order``。
PROFILE_CONTENT_FIELDS: tuple[str, ...] = (
    "name",
    "gender",
    "phone",
    "email",
    "city",
    "target_city",
    "job_intent",
    "personal_website",
    "github",
    "summary",
    "educations",
    "experiences",
    "campus_experiences",
    "projects",
    "skills",
    "awards",
)


@dataclass(frozen=True)
class RecognitionSetup:
    """一次识别请求的模型侧上下文（都在 ``db.close()`` 之前取好）。"""

    provider: BaseLLMProvider | None
    model: str
    vision: bool
    ocr: OcrContext

    @property
    def ocr_available(self) -> bool:
        return ocr_available(self.ocr)

    @property
    def ocr_forced(self) -> bool:
        """用户显式选了「只用 OCR」：要压过"模型能看图"这条更宽的判据。"""
        return self.ocr.ocr_required()

    @property
    def ocr_engine(self) -> str:
        """用户选的引擎档位：``auto`` / ``ocr`` / ``vision``。

        提示文案要区分"档位禁用了 OCR"（只用视觉）与"档位允许但没配 Key"（自动档）——
        两者的出路不同，混成一句话就会给出与用户选择相反的建议。
        """
        return self.ocr.engine


def recognition_setup(
    config: LLMConfig, provider: BaseLLMProvider | None, ocr: OcrContext
) -> RecognitionSetup:
    return RecognitionSetup(
        provider=provider,
        model=str(config.model or "").strip(),
        # 没有 provider 就没有"模型能不能看图"这回事；False 让路由把图判成不可发。
        vision=resolve_capabilities(config).vision if provider is not None else False,
        ocr=ocr,
    )


def ocr_available(ctx: OcrContext | None) -> bool:
    """``OCR 可用`` = 这次请求愿意用 OCR（引擎档位允许）且 Key 真的配了。"""
    return bool(ctx is not None and ctx.uses_ocr() and ctx.configured)


def decide_route(
    *, has_images: bool, vision: bool, ocr_usable: bool, ocr_forced: bool = False
) -> RecognitionRoute:
    """纯函数：四条出口的判据只有这一份，便于用矩阵测。

    ``ocr_forced`` 是用户在「识别引擎」里显式选了"只用 OCR"（``OcrContext.ocr_required()``）。
    它必须压过 ``vision``：选了只用 OCR 却因为模型能看图就偷偷走视觉，等于 ignoring 用户
    的选择，也让"按页计费"的预期落空。没有 Key 时仍然是 ``blocked``（不能用文本模型硬发图）。
    """
    if not has_images:
        return "text"
    if ocr_forced:
        # 选了"只用 OCR"就必须走 OCR：没 Key 时宁可 blocked，也不偷偷改用视觉模型。
        return "ocr" if ocr_usable else "blocked"
    if vision:
        return "vision"
    return "ocr" if ocr_usable else "blocked"


def blocked_image_warning(model: str, *, ocr_engine: str = "auto") -> str:
    """无 vision 且用不了 OCR：不再猜原因，直接说清当前模型、两条出路。

    三种措辞对应三种档位：
    - ``ocr``（选了只用 OCR 却没配 Key）→ 先配 Key；
    - ``vision``（选了只用视觉）→ 不能劝他去配 OCR，要说"切回自动 + 配 Key"；
    - ``auto``（默认档，只是没配 Key）→ 换视觉模型或配 OCR。
    """
    name = model.strip() or "当前模型"
    if ocr_engine == "ocr":
        return (
            "识别引擎当前是「只用 OCR」，但还没有配置 OCR Key。"
            "请到「外部连接 → 识别引擎」填写 Key，"
            "或把引擎切回「自动」并改用支持视觉的模型（qwen-vl / gpt-4o / glm-4v）。"
        )
    if ocr_engine == "vision":
        return (
            f"当前模型 {name} 不支持图片输入，而识别引擎当前是「只用视觉」。"
            "请改用支持视觉的模型（qwen-vl / gpt-4o / glm-4v），"
            "或把「外部连接 → 识别引擎」切回「自动」并配置 OCR。"
        )
    return (
        f"当前模型 {name} 不支持图片输入。"
        "改用支持视觉的模型（qwen-vl / gpt-4o / glm-4v），"
        "或在「外部连接 → 识别引擎」配置 OCR。"
    )


def dropped_images_warning(count: int) -> str:
    """OCR 没读出字、模型又看不了图：这几张只能放弃，但要说明后果。"""
    return f"有 {count} 张图片没有读出文字，已跳过（当前模型不支持图片输入），请对照原图手填。"


def image_payloads(image_urls: Sequence[str]) -> list[dict[str, str]]:
    """``documents.images`` 是 data URL 字符串，OCR 那边要 ``{data_url, name}`` 形态。"""
    return [
        {"data_url": url, "name": f"page-{index}.png"}
        for index, url in enumerate(image_urls, start=1)
    ]


def merge_text(source_text: str, extra: str) -> str:
    """把 OCR 文本接在粘贴文本之后：两份都是原文，锚定与本地规则看同一份材料。"""
    return "\n\n".join(part for part in (source_text, extra) if part.strip())


@dataclass(frozen=True)
class OcrPrep:
    """图片过 OCR 的结果；``remaining`` 是没读到字、仍想交给视觉模型的图片。"""

    text: str = ""
    warnings: tuple[str, ...] = ()
    remaining: tuple[str, ...] = ()
    used_ocr: bool = False


async def ocr_images(image_urls: Sequence[str], ctx: OcrContext | None) -> OcrPrep:
    """把图片逐张过 OCR（同步 httpx，必须走线程池）。

    单张失败不判整单失败：失败的留在 ``remaining``，由调用方决定交给视觉模型还是放弃。
    但用户明确选了"只用 OCR"时 ``prepare_extraction_images`` 会抛 ``OcrError``——那种
    情况把原因翻成一句话带回去，不静默降级、也不把整个草稿打成 500。
    """
    if not image_urls or ctx is None:
        return OcrPrep(remaining=tuple(image_urls))
    try:
        outcome = await run_in_threadpool(
            prepare_extraction_images, image_payloads(image_urls), ctx
        )
    except OcrError as exc:
        logger.warning("图片 OCR 失败（引擎=%s）：%s", ctx.engine, exc.code)
        return OcrPrep(warnings=(user_message_for(exc),), remaining=tuple(image_urls))
    return OcrPrep(
        text=outcome.text,
        warnings=tuple(outcome.warnings),
        remaining=tuple(outcome.remaining),
        used_ocr=outcome.ok,
    )


@dataclass(frozen=True)
class OcrTextInput:
    """OCR 路线下"已经变成文字"的输入：合并原文、本地草稿与过程说明。"""

    source_text: str
    local_draft: Any
    warnings: tuple[str, ...] = ()
    dropped_images: int = 0
    #: 只来自图片的那段 OCR 文本（给 ``recognized_text`` 用，不能把粘贴文本也算进去）。
    ocr_text: str = ""


async def ocr_to_text(
    *,
    source_text: str,
    image_urls: Sequence[str],
    ctx: OcrContext | None,
    parse_local: Callable[[str], Any],
) -> OcrTextInput:
    """无 vision 时的唯一入口：图片 → 文字 → 本地草稿，原图一律不再下发。"""
    prep = await ocr_images(image_urls, ctx)
    merged = merge_text(source_text, prep.text) if prep.text else source_text
    return OcrTextInput(
        source_text=merged,
        # 本地规则重跑一遍 OCR 文本：模型调用失败时兜底草稿也才有内容。
        local_draft=parse_local(merged),
        warnings=prep.warnings,
        dropped_images=len(prep.remaining) if prep.text else len(image_urls),
        ocr_text=prep.text,
    )


@dataclass(frozen=True)
class RescueOutcome:
    """视觉结果为空后补的一次 OCR 抽取。"""

    result: Any
    source_text: str
    warnings: tuple[str, ...] = ()
    ocr_text: str = ""


async def ocr_rescue(
    *,
    source_text: str,
    image_urls: Sequence[str],
    ctx: OcrContext | None,
    parse_local: Callable[[str], Any],
    run_extraction: Callable[[str, Any, Sequence[str]], Awaitable[Any]],
) -> RescueOutcome | None:
    """视觉结果一个字段都没回填时的补一次 OCR（只在兜底路径上多花一次调用）。"""
    prep = await ocr_images(image_urls, ctx)
    if not prep.text:
        return None
    merged = merge_text(source_text, prep.text)
    result = await run_extraction(merged, parse_local(merged), ())
    return RescueOutcome(
        result=result, source_text=merged, warnings=prep.warnings, ocr_text=prep.text
    )


def filled_field_count(result: Any, fields: Sequence[str]) -> int:
    """数一份识别结果到底填了几个内容字段（判断"白调一次"用，不是质量分）。"""
    try:
        data = result.model_dump()
    except AttributeError:  # pragma: no cover - 识别结果一定是 pydantic 模型
        return 0
    count = 0
    for name in fields:
        value = data.get(name)
        if isinstance(value, str):
            count += 1 if value.strip() else 0
        elif isinstance(value, (list, tuple, dict)):
            count += 1 if len(value) else 0
    return count


def trim_recognized_text(result: Any, text: str, limit: int) -> Any:
    """OCR 路线没有抄录（没发改图），用 OCR 文本补上"模型读到了什么"。"""
    if not text.strip() or getattr(result, "recognized_text", ""):
        return result
    return result.model_copy(update={"recognized_text": text[:limit]})


__all__ = [
    "JOB_CONTENT_FIELDS",
    "PROFILE_CONTENT_FIELDS",
    "OcrPrep",
    "OcrTextInput",
    "RecognitionRoute",
    "RecognitionSetup",
    "RescueOutcome",
    "blocked_image_warning",
    "decide_route",
    "dropped_images_warning",
    "filled_field_count",
    "image_payloads",
    "merge_text",
    "ocr_available",
    "ocr_images",
    "ocr_rescue",
    "ocr_to_text",
    "recognition_setup",
    "trim_recognized_text",
]
