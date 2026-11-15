# SPDX-License-Identifier: Apache-2.0
"""扫描件识别引擎策略（设置项：自动 / 只用 OCR / 只用视觉模型）。

为什么做成**显式设置项**而不是"有 Key 就优先 OCR"：这两条路把同一份原件发给**不同的
第三方**（OCR 发给 DeepSeek、视觉模型发给用户自己配的服务商），成本结构也不同
（OCR 按页计费、视觉模型按 token）。谁看原件属于用户决策，不属于实现的隐式偏好。

三个档位的语义（与设置页文案一一对应）：

- ``auto``：配了 Key 就走 OCR，没配就沿用原来的视觉模型通路（默认值）；
- ``ocr``：扫描页**只**走 OCR；没配 Key 时直接报"缺少 Key"，不静默降级——用户既然
  明确选了只用 OCR，就不能让原件悄悄发给另一个服务商；
- ``vision``：**绝不**发出任何 OCR 请求（隐私/成本可控），保持改造前的行为。

Key 与联网搜索共用（``web_search.deepseek_api_key``）：同一个 DeepSeek 账户，用户
只需填一次。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy.orm import Session

from ...schemas.ocr import OcrConfig
from .. import global_settings
from .client import DEFAULT_PURPOSE

logger = logging.getLogger(__name__)

# 全局设置里的顶层键。与 `web_search` 平级：描述"这台机器怎么识别扫描件"，
# 与当前打开哪份数据集无关。
OCR_BLOCK = "ocr"

OcrEngine = Literal["auto", "ocr", "vision"]
OCR_ENGINES: tuple[str, ...] = ("auto", "ocr", "vision")

# 设置页用的说明文案。放在后端是为了让 API 与前端各有一份**同源**的描述，
# 而不是前端自己再写一遍中文（两边迟早说两套）。
ENGINE_LABELS: dict[str, str] = {
    "auto": "自动：配置了 DeepSeek Key 时用 OCR，否则用视觉模型",
    "ocr": "只用 OCR（DeepSeek）：扫描页发给 DeepSeek，按页计费",
    "vision": "只用视觉模型：扫描页仍渲染成图片发给你配置的多模态模型",
}

# 提醒用户"这份原件发给了谁"的文案：OCR 与视觉模型的告知义务不同，不能复用一句。
OCR_USED_WARNING = "共 {pages} 页无文字层，已用 DeepSeek OCR 识别（按页计费）。"
OCR_PARTIAL_WARNING = "OCR 只识别出部分扫描页（共 {total} 页），其余页仍无文字。"
OCR_PAGE_TRUNCATED_WARNING = "OCR 的 {pages} 页输出被截断，内容可能不完整。"
OCR_FAILED_FALLBACK_WARNING = (
    "OCR 识别失败，已改用视觉模型识别扫描页（原件会发给你配置的模型服务商）。"
)
OCR_IMAGES_USED_WARNING = "已用 DeepSeek OCR 识别 {count} 张图片中的文字（按页计费）。"
OCR_IMAGE_FAILED_WARNING = "第 {index} 张图片的 OCR 识别失败，已改走视觉模型。"
# 服务端偶发返回整页空文本（实测 9 页里有 1–2 页，重试即恢复）。这页钱照扣、字却没拿到，
# 所以必须**显式告诉用户哪几页缺**，而不是悄悄少一段——少的那段可能正是工作经历。
OCR_EMPTY_PAGES_WARNING = "OCR 的 {pages} 页没返回文字（已重试一次），建议对照原件核对该页。"


@dataclass(frozen=True)
class OcrContext:
    """一次请求的 OCR 决策上下文：引擎档位 + 真实密钥（只在本进程内使用）。"""

    engine: str = "auto"
    api_key: str = ""
    purpose: str = DEFAULT_PURPOSE

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def uses_ocr(self) -> bool:
        """本次请求是否应该调用 OCR。"""
        if self.engine == "vision":
            return False
        if self.engine == "ocr":
            return True
        return self.configured

    def ocr_required(self) -> bool:
        """用户是否明确要求"只用 OCR"——此时不允许静默降级到视觉模型。"""
        return self.engine == "ocr"

    @property
    def engine_label(self) -> str:
        return ENGINE_LABELS.get(self.engine, ENGINE_LABELS["auto"])


def _block_of(state: dict[str, Any] | None) -> dict[str, Any] | None:
    block = (state or {}).get(OCR_BLOCK)
    return block if isinstance(block, dict) else None


def get_ocr_config() -> OcrConfig:
    """读设置页可见的配置（不含密钥）：未配置时返回默认 ``auto``。"""
    block = _block_of(global_settings.load_state())
    if block is None:
        return OcrConfig()
    try:
        return OcrConfig.model_validate({"engine": block.get("engine", "auto")})
    except Exception:  # noqa: BLE001 - 设置文件是用户可手改的，坏值不该让应用起不来
        logger.warning("OCR 识别引擎设置非法，已按默认值处理；请在设置页重新保存")
        return OcrConfig()


def save_ocr_config(config: OcrConfig) -> OcrConfig:
    """保存引擎档位。密钥不在这里写（复用联网搜索的 Key，见 ``resolve_ocr_key``）。"""
    persisted = {"engine": config.engine}

    def _apply(state: dict[str, Any]) -> None:
        state[OCR_BLOCK] = persisted

    global_settings.mutate_state(_apply)
    return get_ocr_config()


def build_ocr_context(engine: str, api_key: str) -> OcrContext:
    return OcrContext(engine=engine if engine in OCR_ENGINES else "auto", api_key=api_key)


def load_ocr_context(db: Session) -> OcrContext:
    """按当前设置与本机 Key 组装上下文；密钥只在此处解密，且不回传前端。"""
    # 延迟导入：web_search_settings 会 import 不少设置层模块，而本模块被
    # document_text 间接引用，放在模块顶层容易形成循环。
    from ..web_search_settings import resolve_search_deepseek_key

    config = get_ocr_config()
    key = resolve_search_deepseek_key(db) if config.engine != "vision" else ""
    return build_ocr_context(config.engine, key)


def ocr_key_configured(db: Session) -> bool:
    """设置页用来显示"Key 是否已配置"（不返回真实值）。"""
    from ..web_search_settings import resolve_search_deepseek_key

    return bool(resolve_search_deepseek_key(db))


__all__ = [
    "ENGINE_LABELS",
    "OCR_BLOCK",
    "OCR_ENGINES",
    "OCR_EMPTY_PAGES_WARNING",
    "OCR_FAILED_FALLBACK_WARNING",
    "OCR_IMAGES_USED_WARNING",
    "OCR_IMAGE_FAILED_WARNING",
    "OCR_PAGE_TRUNCATED_WARNING",
    "OCR_PARTIAL_WARNING",
    "OCR_USED_WARNING",
    "OcrContext",
    "OcrEngine",
    "build_ocr_context",
    "get_ocr_config",
    "load_ocr_context",
    "ocr_key_configured",
    "save_ocr_config",
]
