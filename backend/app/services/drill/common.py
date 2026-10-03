"""提示词加载、上下文长度上限与文本规整辅助（drill 各子模块的公共底座）。"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


# **本波拆分中唯一的非纯移动改动**：原 ``drill.py`` 位于 ``app/services/`` 下，
# ``parent.parent`` 即 ``app/``；转包后本文件位于 ``app/services/drill/``，深了一层，
# 改用 ``parents[2]`` 取到同一目录 ``app/prompts``，与原值完全等价。
PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts"

MAX_CLAIM_CONTEXT_CHARS = 3_000
MAX_JOB_CONTEXT_CHARS = 2_000
MAX_TRANSCRIPT_CHARS = 12_000
MAX_QUESTION_CHARS = 1_000
MAX_FEEDBACK_CHARS = 1_000
MAX_REVIEW_RESPONSE_CHARS = 60_000
MAX_LIST_ITEMS = 6

MAX_ACTIONS = 5
MAX_REHEARSAL = 6


def load_prompt(name: str) -> str:
    """读一个提示词文件；API 层的复练接口也要用同一份。"""
    return (PROMPTS_DIR / name).read_text(encoding="utf-8")


def _clip(value: str, limit: int) -> str:
    text = (value or "").strip()
    return text if len(text) <= limit else text[:limit] + "…"


def _clean_list(value: Any, limit: int = MAX_LIST_ITEMS, item_limit: int = 300) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        text = str(item or "").strip()[:item_limit]
        if text and text not in result:
            result.append(text)
    return result[:limit]

