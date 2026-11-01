# SPDX-License-Identifier: Apache-2.0
"""#33：三档美化的可度量定义与篇幅引导（从 resume_generator_prompts.py 拆出守 500 行预算）。

档位差异必须**可度量**（字数区间 + 要点数），不再依赖 reference_facts 是否存在——
旧版三档在没有 reference_facts 时退化为同一句"优化表达"，实测产出几乎无差别。
"""

from __future__ import annotations

from typing import Any

from .resume_templates import font_scale_spec

# 三档只控制对描述性字段的改写幅度；结构化事实始终由代码强制锚定。
# #33：差异必须**可度量**（字数区间 + 要点数下限），不再依赖 reference_facts 是否存在——
# 旧版三档在没有 reference_facts 时退化为同一句"优化表达"，实测产出几乎无差别。
ENHANCEMENT_LEVEL_GUIDES = {
    "light": (
        "轻度美化：每条要点 20-28 字，每个条目的 description/highlights 合计保持 1-2 条；"
        "只优化语序、动词和专业表达，不得展开新的技术细节或方法论述。"
        "原描述为空但存在 reference_facts 时，提炼 1-2 条最相关事实，不能继续留空。"
    ),
    "balanced": (
        "均衡美化：每条要点 28-36 字，每个条目的 description/highlights 合计写成 2-3 条；"
        "每条要点必须写出「方法 + 业务目的」。可围绕 JD 重组原有事实，"
        "允许合并同一条目内的相关证据，但不得推导未明确提供的结果。"
    ),
    "strong": (
        "深度美化：每条要点 40-55 字，每个条目的 description/highlights 合计写成 3-5 条；"
        "每条要点写出「方法 + 技术决策 + 业务结果」，并为每个条目补一句 description 概述。"
        "资料与 reference_facts 不足以支撑该密度时，按可用证据如实少写、不得虚构——"
        "此时深度档的结果会接近均衡档，这是资料边界，不是规则失效。"
    ),
}

# #33：每档的自查口径（替换 user 模板里写死的「30 字左右、最多 35 字」）。
# 上限随档放宽：深度档若仍被 35 字硬上限卡住，展开指令永远无法生效。
ENHANCEMENT_POINT_RULES = {
    "light": "每条描述性要点 20-28 字；同一段经历或项目的要点不超过 3 条。",
    "balanced": "每条描述性要点 28-36 字、最多不超过 40 字；同一段经历或项目的要点不超过 4 条。",
    "strong": "每条描述性要点 40-55 字；同一段经历或项目的要点不超过 6 条。",
}

_ENHANCEMENT_DISABLED_GUIDE = (
    "美化拓展已关闭：只能选择、排序并精确回填候选资料中的原文要点；"
    "不得合并、改写或扩充 description、highlights 和 summary。"
)

# 单页 A4 在不同字号下的汉字预算（含标题、联系方式等全部版面文字）。
# 数字是经验值，只用来给模型一个明确的篇幅目标，不参与任何校验。
_PAGE_CHAR_BUDGET = {
    "small": (850, 1100),
    "standard": (650, 880),
    "large": (550, 720),
}

# #33：三档的生成参数也必须可度量地不同（此前只差提示词，temperature 三档同为
# 用户配置值，审计里看不出档位）。基准取用户保存的 temperature：轻档收紧（更贴近
# 原文、减少改写漂移），深档放开（允许更大改写幅度），均衡档保持用户值不变——
# 默认档与改动前逐字节一致，不给既有用户制造行为漂移。
_ENHANCEMENT_TEMPERATURE_SCALE = {"light": 0.5, "balanced": 1.0, "strong": 2.0}


def enhancement_temperature(base: float, enhancement_level: str) -> float:
    """按美化档位缩放基准 temperature；结果夹在协议允许的 [0, 2] 区间内。"""
    scale = _ENHANCEMENT_TEMPERATURE_SCALE.get(enhancement_level, 1.0)
    return round(min(2.0, max(0.0, float(base) * scale)), 2)


def apply_enhancement_temperature(provider: Any, options: Any) -> float | None:
    """把档位写入本次生成的 provider 配置**副本**，返回最终 temperature。

    为什么改配置副本而不是 request_overrides：Anthropic 原生协议不消费
    request_overrides 里的 temperature，两条协议共用的唯一入口就是 provider.config。
    为什么只在 enhance=True 时生效：关闭美化时正文是资料原文，档位没有意义，
    请求体必须与改动前一致（兼容既有测试与用户预期）。
    """
    if not getattr(options, "enhance", False):
        return None
    config = getattr(provider, "config", None)
    base = getattr(config, "temperature", None)
    if config is None or isinstance(base, bool) or not isinstance(base, (int, float)):
        return None
    value = enhancement_temperature(
        float(base), str(getattr(options, "enhancement_level", "balanced"))
    )
    try:
        provider.config = config.model_copy(update={"temperature": value})
    except AttributeError:
        # 测试替身可能没有 pydantic 复制能力：退回原地赋值，行为等价。
        config.temperature = value
    return value


# JSON 输出相比纸面正文多出的结构开销（键名/数组/转义）系数，以及固定底数。
_OUTPUT_TOKENS_PER_CHAR = 2
_OUTPUT_BASE_TOKENS = 600


def generation_token_budget(options: Any) -> int:
    """#35/A1：生成入口的 token 预算声明（审计列，不是硬截断）。

    口径 = 单页汉字上限（按字号，随美化档位放宽） × 页数 × JSON 结构开销系数 + 底数。
    真正的硬约束仍是模型服务端的 max_tokens 配置与整链时间预算；这里给出一个
    与篇幅上限挂钩、可复核的整数，让审计能比较不同入口/不同页数的预算声明。
    """
    spec = font_scale_spec(str(getattr(options, "font_scale", "standard")))
    _, high = _PAGE_CHAR_BUDGET.get(spec["name"], _PAGE_CHAR_BUDGET["standard"])
    factor = {"light": 0.9, "balanced": 1.0, "strong": 1.3}.get(
        str(getattr(options, "enhancement_level", "balanced")), 1.0
    )
    chars = int(high * factor) * max(1, int(getattr(options, "page_limit", 1) or 1))
    return int(chars * _OUTPUT_TOKENS_PER_CHAR) + _OUTPUT_BASE_TOKENS


def build_layout_guide(
    page_limit: int, font_scale: str, enhancement_level: str = "balanced"
) -> str:
    """把「页数 + 字号 + 美化档位」翻译成模型可执行的篇幅要求。

    #33：总字数上限随档位放宽（deep 档要点更长更多，沿用均衡档预算必然互相抵消）；
    light 档略收紧。系数只作用于上限，下限不动——"至少写多少"不随档位缩水。
    """
    spec = font_scale_spec(font_scale)
    low, high = _PAGE_CHAR_BUDGET.get(spec["name"], _PAGE_CHAR_BUDGET["standard"])
    factor = {"light": 0.9, "balanced": 1.0, "strong": 1.3}.get(enhancement_level, 1.0)
    high = int(high * factor)
    if page_limit <= 1:
        return (
            f"目标篇幅：1 页 A4、{spec['label']}。整份简历（含联系方式与全部文字）"
            f"控制在 {low}-{high} 个汉字以内；个人总结不超过 100 字。"
            "宁可少写，也不要为了完整而超出篇幅。"
        )
    total_low = low * page_limit
    total_high = high * page_limit
    return (
        f"目标篇幅：最多 {page_limit} 页 A4、{spec['label']}。整份简历控制在 "
        f"{total_low}-{total_high} 个汉字以内：优先写满第一页，确有必要再用第二页；"
        "不要为了填满页数而堆砌次要内容，也不要留下大半页空白。"
    )
