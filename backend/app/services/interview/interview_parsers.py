# SPDX-License-Identifier: Apache-2.0
"""模拟面试三段 LLM 输出的 JSON 解析：回合、收尾回应与评分报告。

纯搬迁自 ``interview.py``：解析是纯函数（只做结构归一化与长度截断），提示词
装配与调用编排留在原模块。"""

from __future__ import annotations

from typing import Any

from ..llm.base import LLMError
from ..llm.structured_output import parse_json_object

MAX_INTERVIEW_RESPONSE_CHARS = 40_000


MAX_QUESTION_CHARS = 2_000
MAX_FEEDBACK_CHARS = 1_200


def parse_turn(raw: str) -> tuple[str, str, bool]:
    """解析一轮返回：``(question, feedback, done)``。"""
    data = parse_json_object(raw, label="模拟面试", max_chars=MAX_INTERVIEW_RESPONSE_CHARS)
    question = str(data.get("question") or "").strip()[:MAX_QUESTION_CHARS]
    feedback = str(data.get("feedback") or "").strip()[:MAX_FEEDBACK_CHARS]
    if not question:
        # 没有问题时不能静默跳过：那会让界面停在"等面试官提问"。
        raise LLMError("面试官没有给出下一个问题，请重试或重新开始这场面试")
    return question, feedback, bool(data.get("done"))


def parse_closing(raw: str) -> str:
    """解析收尾那一轮：``{"reply": "..."}``。空回复视为失败（宁可走兜底，也不写空消息）。"""
    data = parse_json_object(raw, label="面试收尾", max_chars=MAX_INTERVIEW_RESPONSE_CHARS)
    reply = str(data.get("reply") or "").strip()[:MAX_FEEDBACK_CHARS]
    if not reply:
        raise LLMError("面试官没有给出收尾回应")
    return reply


def _score(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(100.0, number))


def parse_report(raw: str) -> dict[str, Any]:
    """解析并归一化评分报告。

    归一化是必要的：模型经常把分数写成 ``"78"``、把维度写成字符串数组，或者忘掉某一项。
    报告要展示给用户，宁缺毋滥——结构不对的项直接丢掉，而不是把原始文本塞进界面。
    """
    data = parse_json_object(raw, label="面试报告", max_chars=MAX_INTERVIEW_RESPONSE_CHARS)
    dimensions: list[dict[str, Any]] = []
    for item in data.get("dimensions") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()[:32]
        if not name:
            continue
        dimensions.append(
            {
                "name": name,
                "score": round(_score(item.get("score")), 1),
                "comment": str(item.get("comment") or "").strip()[:500],
            }
        )

    def _lines(key: str) -> list[str]:
        raw_items = data.get(key) or []
        if isinstance(raw_items, str):
            raw_items = [raw_items]
        return [str(item).strip()[:400] for item in raw_items if str(item).strip()][:6]

    return {
        "score": round(_score(data.get("score")), 1),
        "dimensions": dimensions[:6],
        "strengths": _lines("strengths"),
        "improvements": _lines("improvements"),
        "summary": str(data.get("summary") or "").strip()[:1000],
    }
