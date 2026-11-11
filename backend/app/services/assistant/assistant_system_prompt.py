# SPDX-License-Identifier: Apache-2.0
"""求职助手系统提示词装配（从 ``api/assistant.py`` 下沉的公共实现）。

每次请求现拼：基础提示（``app/prompts/assistant_system.md``）+ 平台事实 + 能力地图 +
放宽模式说明 + 写操作状态 + 求职偏好注入块（期二）+ 本地时间 + 本对话技能 + 界面上下文（T25）。
不缓存是刻意的——改提示词不必重启，启用的技能与新状态即时生效。

联网开关**不再影响这段提示**：打开它只是把 ``web_search`` 工具下发给模型（R08 删掉了
"打开开关就自动预搜一次"以及随附的那段联网说明）；联网工具的完整度口径写在工具描述里
（``assistant_tools/_types.py``），跟着设置里的抓取条数走。

依赖方向：只依赖 ``services``，不含任何路由代码；路由层按原路径再导出本模块符号，
既有 import 点与 monkeypatch 落点不变。
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from ..assistant_tools.proposal_store import status_block as _proposal_status_block
from ..feature_catalog import build_capability_map
from ..job_preference_prompt import render_preference_block
from ..product_knowledge import build_platform_note
from .assistant_client_context import build_client_context_block
from .assistant_skills import build_skill_prompt
from .assistant_task_rules import build_task_rules_block
from .memory import render_memory_block
from .memory_extract import schedule_extraction

logger = logging.getLogger(__name__)

# 提示词正文路径：本模块位于 ``app/services/assistant/``，故回退三层到 ``app/``。
_PROMPT_PATH = Path(__file__).resolve().parents[2] / "prompts" / "assistant_system.md"


def _local_time_note() -> str:
    """用户本地时间行：本应用是本地单用户，服务器本地时间即用户时间。

    每次请求实时生成（``_system_prompt`` 本就不缓存），模型据此才能给出时段化建议；
    用 ``astimezone`` 取本地时区，与 data_backup/datasets 的既有写法一致。
    """
    now = datetime.now().astimezone()
    weekday = "星期" + "一二三四五六日"[now.weekday()]
    return (
        f"【当前时间】{now:%Y-%m-%d %H:%M} {weekday}（用户本地时间）。"
        "你可以自然地结合时段给出合适建议（例如深夜或凌晨时分提醒用户适当休息），"
        "但不要生硬重复。"
    )


_RELAXED_MODE_NOTE = """【放宽模式已开启】用户已在设置里知情开启助手放宽模式：本次对话允许你读取完整资料——姓名、电话等敏感身份字段（get_profile 现在返回未脱敏视图）、网申填表的真实填写值（list_web_form_fills / get_web_form_fill）以及历史对话（list_chat_conversations / get_chat_conversation）。约束：① 敏感值（证件号、手机号、薪资外的个人身份信息）只在用户的提问需要时才引用，不要罗列或复述无关敏感值；② API 密钥与全局配置仍然读不到，也没有任何工具能读到它们；③ 回答仍只服务当前用户本人，不要建议把敏感内容复制到外部。"""


def build_system_prompt_parts(
    db: Session,
    *,
    relaxed: bool = False,
    conversation_id: int | None = None,
    client_context: Any = None,
) -> dict[str, str]:
    """把系统提示词拆成三段，供「上下文用量」按构造分桶（需求 #6）。

    三段与 `_system_prompt` 的拼装是同一份实现，**拆分只是为了能分别计量**：

    - ``base``：基础提示 + 平台事实 + 能力地图 + 放宽模式说明 + 写操作状态 + 求职偏好
      + 本地时间（即原 ``parts`` 里除技能与界面上下文之外的全部内容，按空行连接）；
    - ``skills``：本对话启用的技能提示词；没启用时是空串；
    - ``client``：界面上下文块（T25）；没有时是空串。

    ``_system_prompt`` 就是这三段按 ``base`` → ``skills`` → ``client`` 顺序用空行连接
    并跳过空串——所以输出与拆分前**逐字节一致**。

    依赖方向：仍然只依赖 ``services``，不引入路由或流式模块（那些模块要 import 本模块）。
    """
    base_text = _PROMPT_PATH.read_text(encoding="utf-8")
    # 能力地图改为每次请求从 feature_catalog 动态渲染：新增功能只需登记目录，
    # 不必再改这里的装配顺序或手写提示词。
    parts = [
        base_text,
        # 启动/升级/平台支持事实从 product_knowledge 单一来源取：改口径只动那份
        # 快照，提示词正文（assistant_system.md）不重复维护一份会漂移的副本。
        build_platform_note(),
        build_capability_map(),
        _RELAXED_MODE_NOTE if relaxed else "",
        _proposal_status_block(db, conversation_id),
        # 18A：何时建长任务的规则块（与 task_* 三个工具同批；0 条时也是稳定文本）。
        build_task_rules_block(),
    ]
    # 期二（T13）：求职偏好注入块。位置有讲究（计划 §6.3.4）：必须在写操作状态之后
    # （偏好效力来自"用户在环确认"，不是系统规则升级）、本地时间与技能之前（技能是更
    # 具体的写作规范，应压过泛化偏好）。0 条时渲染为空串，不产生空块。
    preference_block = render_preference_block(db)
    if preference_block:
        parts.append(preference_block)
    # #31B：按当前用户消息相关性取 top 5 注入固定区块（没有相关记忆时不产生空块）。
    # 位置在求职偏好之后、本地时间之前：它是"用户说过的事实"，不是系统规则。
    try:
        memory_block = render_memory_block(db, conversation_id)
    except Exception:  # noqa: BLE001 - 记忆块是增强项，不能挡住提示词装配
        logger.warning("助手记忆区块渲染失败", exc_info=True)
        memory_block = ""
    if memory_block:
        parts.append(memory_block)
    # #31A：会话空闲 5 分钟后的抽取在**下一次交互**时登记（不跑定时器、不占本轮生成）。
    # 默认关闭；幂等由 cursor + 在跑任务双保险，重复调用不会重复登记。
    try:
        if conversation_id is not None:
            schedule_extraction(db, conversation_id)
    except Exception:  # noqa: BLE001 - 登记失败不能挡住本轮对话
        logger.warning("助手记忆抽取登记失败", exc_info=True)
    parts.append(_local_time_note())
    return {
        "base": "\n\n".join(part for part in parts if part),
        "skills": build_skill_prompt(db, conversation_id) or "",
        # T25：界面上下文（route/view/选中对象）——后端重查后的线索，不是用户指令。
        "client": build_client_context_block(db, client_context) or "",
    }


def _system_prompt(
    db: Session,
    *,
    relaxed: bool = False,
    conversation_id: int | None = None,
    client_context: Any = None,
) -> str:
    """基础系统提示 + 技能/放宽模式说明 + 写操作状态 + 当前界面上下文（T25）。

    每次请求重读：改提示词不必重启，启用的技能与新状态即时生效。

    联网开关不再改动这段提示：打开它只是**把 ``web_search`` 工具下发给模型**（R08 之前
    会在这里追加一段"已经自动搜过一次"的说明，并声称用户消息里已有联网资料）。

    实现上只是把 `build_system_prompt_parts` 的三段接回去：输出与分段前逐字节相同
    （顺序 base → skills → client，空串跳过）。保留这个函数是为了既有调用点与测试的
    monkeypatch 落点不变。
    """
    segments = build_system_prompt_parts(
        db, relaxed=relaxed, conversation_id=conversation_id, client_context=client_context
    )
    return "\n\n".join(
        part for part in (segments["base"], segments["skills"], segments["client"]) if part
    )


__all__ = [
    "_RELAXED_MODE_NOTE",
    "_local_time_note",
    "_proposal_status_block",
    "_system_prompt",
    "build_system_prompt_parts",
]
