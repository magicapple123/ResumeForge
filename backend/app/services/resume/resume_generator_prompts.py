"""简历生成的提示词常量与篇幅引导（从 :mod:`app.services.resume.resume_generator` 纯搬迁拆出）。

只含提示词组装侧的常量与纯函数：用量汇总（``usage_records``）、预算接线与流式
主循环留在 ``resume_generator.py``——测试在该模块命名空间上 monkeypatch
（如 ``get_settings``），落点不能动。``resume_generator`` 对以下名字做 re-export，
既有消费方与 ``__all__`` 契约不变。
"""

from .resume_templates import font_scale_spec

# 控制总输入体积：先筛选资料，再为 JD 保留独立预算，避免超长资料/JD 挤掉彼此。
MAX_JD_CHARS = 5_000
MAX_PROFILE_CHARS = 9_000

# 三档只控制对描述性字段的改写幅度；结构化事实始终由代码强制锚定。
ENHANCEMENT_LEVEL_GUIDES = {
    "light": (
        "轻度美化：只优化语序、动词和专业表达，保持原有要点数量与职责边界；"
        "每条内容应能直接对应原资料或参考事实。原描述为空但存在 reference_facts 时，"
        "提炼 1-2 条最相关事实，不能继续留空。"
    ),
    "balanced": (
        "均衡美化：可围绕 JD 重组原有事实，补足动作、方法和业务目的，使表达更扎实；"
        "允许合并同一条目内的相关证据，但不得推导未明确提供的结果。含 reference_facts "
        "的相关条目在可用事实达到 2 条时，应将 description/highlights 合计写成 2-4 条。"
    ),
    "strong": (
        "深度美化：充分挖掘同一条目及 reference_facts/reference_excerpt 中的岗位相关证据，"
        "以专业简历语言展开技术决策、实施过程和价值，可以增加描述要点。存在至少 3 条 "
        "reference_facts 时，必须将 description/highlights 合计写成 3-5 条；不足 3 条时全部"
        "使用，不得为凑数虚构。每个事实都必须能追溯到该条目来源。"
    ),
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


def build_layout_guide(page_limit: int, font_scale: str) -> str:
    """把「页数 + 字号」翻译成模型可执行的篇幅要求。"""
    spec = font_scale_spec(font_scale)
    low, high = _PAGE_CHAR_BUDGET.get(spec["name"], _PAGE_CHAR_BUDGET["standard"])
    if page_limit <= 1:
        return (
            f"目标篇幅：1 页 A4、{spec['label']}。整份简历（含联系方式与全部文字）"
            f"控制在 {low}-{high} 个汉字以内：每段经历保留 2-3 条最相关的要点，"
            "每条要点 25-35 字，个人总结不超过 100 字。宁可少写，也不要为了完整而超出篇幅。"
        )
    total_low = low * page_limit
    total_high = high * page_limit
    return (
        f"目标篇幅：最多 {page_limit} 页 A4、{spec['label']}。整份简历控制在 "
        f"{total_low}-{total_high} 个汉字以内：优先写满第一页，确有必要再用第二页；"
        "不要为了填满页数而堆砌次要内容，也不要留下大半页空白。"
    )
