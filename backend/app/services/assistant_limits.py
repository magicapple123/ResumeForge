# SPDX-License-Identifier: Apache-2.0
"""求职助手的运行上限设置（工具轮次上限 + 整链时间预算）。

两条上限都由用户在设置页调整，存进 ``AppSetting``（JSON，零迁移）：
``assistant_max_tool_rounds``（默认 30）与 ``assistant_stream_budget_seconds``（默认 1800）。

**为什么单独成一个模块**：``settings_service`` 与 ``api/settings`` 都已贴近 500 行硬
预算，而这两条上限恰好被编排层读到（``services/assistant/assistant_stream_turns``），
放这里既不给两个大文件继续加长，也让编排层只依赖一个小而稳的读口。

**读取纪律**：
- 轮次上限在**每一轮工具循环开始时重读**——用户在生成途中改小，下一轮立即生效；
- 时间预算在**请求开始时读一次**——它决定整条流的硬墙钟，跑到一半改它没有意义。

DB 缺省 / 损坏 / 越界一律回落到默认值：宁可回到已验证的默认，也不要拿着脏值把一次
对话跑成十万轮。
"""

from __future__ import annotations

import json
import logging

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models.setting import AppSetting

logger = logging.getLogger(__name__)

# AppSetting 的 key（不是字段名：这张表是 KV，值统一 JSON 编码）。
MAX_TOOL_ROUNDS_KEY = "assistant_max_tool_rounds"
STREAM_BUDGET_SECONDS_KEY = "assistant_stream_budget_seconds"

DEFAULT_MAX_TOOL_ROUNDS = 30
MIN_TOOL_ROUNDS = 1
MAX_TOOL_ROUNDS_LIMIT = 100
MIN_STREAM_BUDGET_SECONDS = 1
MAX_STREAM_BUDGET_SECONDS = 86400


def _read_int(db: Session, key: str, *, minimum: int, maximum: int) -> int | None:
    """读一条整数设置；缺失 / 脏数据 / 越界返回 ``None``，默认值由调用方决定。"""
    row = db.get(AppSetting, key)
    if row is None:
        return None
    try:
        value = json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        logger.warning("助手上限设置 %s 数据损坏，已按默认值处理", key)
        return None
    # bool 是 int 的子类：`true` 若被当成 1 轮，一次对话就只剩一次工具调用。
    if isinstance(value, bool) or not isinstance(value, int):
        logger.warning("助手上限设置 %s 类型不对，已按默认值处理", key)
        return None
    if not minimum <= value <= maximum:
        logger.warning("助手上限设置 %s 越界（%s），已按默认值处理", key, value)
        return None
    return value


def _write_int(db: Session, key: str, value: int) -> None:
    """写一条整数设置（KV 整对象落库，不做增量更新）。"""
    row = db.get(AppSetting, key)
    serialized = json.dumps(int(value))
    if row is None:
        db.add(AppSetting(key=key, value=serialized))
    else:
        row.value = serialized
    db.commit()


def get_max_tool_rounds(db: Session) -> int:
    """一次回复最多几轮工具调用（默认 30）。**每轮工具循环都会调用它**。"""
    value = _read_int(
        db,
        MAX_TOOL_ROUNDS_KEY,
        minimum=MIN_TOOL_ROUNDS,
        maximum=MAX_TOOL_ROUNDS_LIMIT,
    )
    return DEFAULT_MAX_TOOL_ROUNDS if value is None else value


def save_max_tool_rounds(db: Session, rounds: int) -> int:
    """保存轮次上限。越界由请求模型拒绝（422），这里不做静默夹取。"""
    _write_int(db, MAX_TOOL_ROUNDS_KEY, rounds)
    return rounds


def get_stream_budget_override(db: Session) -> int | None:
    """用户设过的整链预算（秒）；没设过返回 ``None``。

    **为什么区分 None 与默认值**：``AssistantStreamBudget`` 的默认来自 ``config``
    （可被环境变量覆盖）；这里若一律返回一个数字，就等于把部署侧配置顶掉了。
    """
    return _read_int(
        db,
        STREAM_BUDGET_SECONDS_KEY,
        minimum=MIN_STREAM_BUDGET_SECONDS,
        maximum=MAX_STREAM_BUDGET_SECONDS,
    )


def get_stream_budget_seconds(db: Session) -> int:
    """整链预算（秒）的**解析值**：DB 优先，缺省回 config 默认（1800）。设置页读它。"""
    override = get_stream_budget_override(db)
    return get_settings().assistant_stream_budget_seconds if override is None else override


def save_stream_budget_seconds(db: Session, seconds: int) -> int:
    """保存整链预算；下次请求开始即生效（运行中的流不被新值改写）。"""
    _write_int(db, STREAM_BUDGET_SECONDS_KEY, seconds)
    return seconds


# ===== L1 单条工具结果上限（详册 #5 的 5.3）=====
#
# 为什么单条要单独限：一次 `list_profile_entries` 可能回 500 条、一条 JD 正文可能几万字。
# 单条不截，后面"总量预算"根本没机会生效——第 1 轮就把窗口吃满。
# 0 = 不限（用户在设置里主动选的，不是漏配）。

DEFAULT_TOOL_RESULT_MAX_CHARS = 8000
TOOL_RESULT_MAX_CHARS_KEY = "assistant_tool_result_max_chars"
MIN_TOOL_RESULT_MAX_CHARS = 0
MAX_TOOL_RESULT_MAX_CHARS = 200_000


def get_tool_result_max_chars(db: Session) -> int:
    """单条工具结果允许进入 messages 的最大字符数；0 = 不限。"""
    value = _read_int(
        db,
        TOOL_RESULT_MAX_CHARS_KEY,
        minimum=MIN_TOOL_RESULT_MAX_CHARS,
        maximum=MAX_TOOL_RESULT_MAX_CHARS,
    )
    return DEFAULT_TOOL_RESULT_MAX_CHARS if value is None else value


def save_tool_result_max_chars(db: Session, chars: int) -> int:
    if not MIN_TOOL_RESULT_MAX_CHARS <= chars <= MAX_TOOL_RESULT_MAX_CHARS:
        raise ValueError("单条工具结果上限超出允许范围")
    _write_int(db, TOOL_RESULT_MAX_CHARS_KEY, chars)
    return chars


def truncate_tool_result(text: str, limit: int) -> str:
    """把一条工具结果截到 ``limit`` 字符，并在末尾写明"原长多少、怎么重读"。

    占位文案必须是**可复原**的：工具基本都是只读查询，用户/模型可以用同样的参数
    重新读一次。写"已压缩"而不写原长，模型就不知道该不该重读。
    """
    if limit <= 0 or len(text) <= limit:
        return text
    head = text[:limit]
    note = (
        f"\n\n（此结果已截断：原 {len(text):,} 字符，上限 {limit:,}。"
        "需要时可用同一工具的分页/筛选参数重读。）"
    )
    return head + note


__all__ = [
    "DEFAULT_MAX_TOOL_ROUNDS",
    "DEFAULT_TOOL_RESULT_MAX_CHARS",
    "MAX_TOOL_ROUNDS_KEY",
    "MAX_TOOL_ROUNDS_LIMIT",
    "MAX_STREAM_BUDGET_SECONDS",
    "MIN_TOOL_ROUNDS",
    "MIN_STREAM_BUDGET_SECONDS",
    "STREAM_BUDGET_SECONDS_KEY",
    "get_max_tool_rounds",
    "get_tool_result_max_chars",
    "get_stream_budget_override",
    "get_stream_budget_seconds",
    "save_max_tool_rounds",
    "save_tool_result_max_chars",
    "save_stream_budget_seconds",
    "truncate_tool_result",
]
