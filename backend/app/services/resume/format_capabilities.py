# SPDX-License-Identifier: Apache-2.0
"""格式能力矩阵的**机器可读**版本（W11 / R03，与 W05 的人类可读矩阵同源）。

为什么要有第二份"数据"：W05 产出一份给人读的 markdown 矩阵，而检查面板要按格式回答
"这个能力支持到什么程度"。如果前端或检查服务各自再写一份 if/else，两份一定漂移——
所以矩阵只在**这里**定义一次，W05 文档的每个单元格必须标注同一组 capability key
（`tests/test_format_capabilities.py` 会解析文档并逐个核对），检查响应的
`capabilities` 字段直接下发这张表。

**本轮的事实边界（如实记录，不粉饰）**：

* PDF 只有 regular + bold 两个字形（`pdf_exporter/render.py` 的 `_register_fonts`），
  没有斜体文件 → `italic` 只能标 `approx`（不倾斜）；链接不可点击 → `link_clickable`
  标 `unsupported`，替代是纸面上可见的 URL 文本（W07 协议 v2：`[label](url)` 画成
  "label (URL)" 可见文本，并且禁用 fpdf2 markdown 的自动链接，见
  `pdf_exporter/rich_text.py`）。
* Word 的斜体是真斜体（`run.font.italic`）；链接同样画成 "label (URL)" 可见文本，
  不创建 OOXML 超链接关系，所以 `link_clickable` 维持 `approx`（可见 URL 文本替代点击）。
* 手动分页/续页信息（W08）与科研三栏目/长 CV（W14）均已落地；后续新增能力项仍必须
  在完成时同步改这里（任务书里已写成完成条件）。
* Word 的条目间距/正文色由 `docx_blocks` 自己的常量表达（与 HTML/PDF 同源化是 W05 的范围）。
"""

from typing import Literal

CapabilityLevel = Literal["supported", "approx", "unsupported"]

# format 键与 FORMAT_RENDERERS / 导出格式逐字一致：html/pdf/docx/markdown/txt/json。
FORMATS: tuple[str, ...] = ("html", "pdf", "docx", "markdown", "txt", "json")

# capability 键是稳定契约：W05 文档、前端面板、检查响应都引用它。
CAPABILITY_KEYS: tuple[str, ...] = (
    "bold",
    "italic",
    "link_clickable",
    "custom_font",
    "section_order",
    "hidden_entries",
    "manual_page_break",
    "keep_with_next",
    "entry_spacing",
    "body_color",
    "scholar_skills_grid",
    "research_fields",
    "long_cv",
    "page_numbers",
)

# 中文说明（检查面板与能力矩阵都从这里取，避免两处措辞漂移）。
_EXPLAIN: dict[str, str] = {
    "bold": "加粗",
    "italic": "斜体",
    "link_clickable": "链接可点击",
    "custom_font": "使用所选字体",
    "section_order": "自定义板块顺序",
    "hidden_entries": "隐藏条目不出现在产物里",
    "manual_page_break": "手动分页意图",
    "keep_with_next": "标题跟随后续内容",
    "entry_spacing": "条目间距",
    "body_color": "正文/辅助文字颜色",
    "scholar_skills_grid": "学术模板三列技能",
    "research_fields": "科研栏目（论文/项目/专利）",
    "long_cv": "长 CV 文档模式",
    "page_numbers": "页码/续页信息",
}

_LEVEL_TEXT: dict[CapabilityLevel, str] = {
    "supported": "支持",
    "approx": "近似",
    "unsupported": "不支持",
}

CAPABILITIES: dict[str, dict[str, CapabilityLevel]] = {
    "html": {
        "bold": "supported",
        "italic": "supported",
        "link_clickable": "supported",
        "custom_font": "supported",
        "section_order": "supported",
        "hidden_entries": "supported",
        "manual_page_break": "approx",  # 草稿只显示断点标记，实际分页以 PDF 为准
        "keep_with_next": "approx",
        "entry_spacing": "supported",
        "body_color": "supported",
        "scholar_skills_grid": "supported",
        "research_fields": "supported",
        "long_cv": "supported",
        "page_numbers": "unsupported",
    },
    "pdf": {
        "bold": "supported",
        "italic": "approx",  # 无斜体字形：不倾斜（D6）
        "link_clickable": "unsupported",  # W07：画成 "label (URL)" 可见文本，不可点击
        "custom_font": "supported",
        "section_order": "supported",
        "hidden_entries": "supported",
        "manual_page_break": "supported",  # W08：语义锚点强制新页（含终止规则）
        "keep_with_next": "supported",  # W08：start_block 预留 N 行
        "entry_spacing": "supported",
        "body_color": "supported",
        "scholar_skills_grid": "supported",
        "research_fields": "supported",  # W14：论文/科研项目/专利三板块
        "long_cv": "supported",  # W14：长 CV 1–10 页（默认 2 页）
        "page_numbers": "supported",  # W08：页边距内绘制（默认关闭）
    },
    "docx": {
        "bold": "supported",
        "italic": "supported",
        "link_clickable": "approx",  # W07：可见 "label (URL)" 文本，不承诺点击
        "custom_font": "approx",  # 写入所选字体的真实族名，但 python-docx 不嵌入字体（查看端替代）
        "section_order": "supported",
        "hidden_entries": "supported",
        "manual_page_break": "supported",  # W08：w:pageBreakBefore
        "keep_with_next": "supported",  # W08：w:keepNext / keepLines
        "entry_spacing": "supported",  # W05：按模板 entry_gap 写段前距
        "body_color": "supported",  # W05：与 PDF 同源解析正文/辅助色
        "scholar_skills_grid": "approx",
        "research_fields": "supported",  # W14
        "long_cv": "supported",  # W14
        "page_numbers": "supported",  # W08：section.footer 里的 PAGE/NUMPAGES 域（默认关闭）
    },
    "markdown": {
        "bold": "supported",
        "italic": "supported",
        "link_clickable": "supported",
        "custom_font": "unsupported",
        "section_order": "supported",
        "hidden_entries": "supported",
        "manual_page_break": "unsupported",
        "keep_with_next": "unsupported",
        "entry_spacing": "unsupported",
        "body_color": "unsupported",
        "scholar_skills_grid": "unsupported",
        "research_fields": "supported",
        "long_cv": "supported",
        "page_numbers": "unsupported",
    },
    "txt": {
        "bold": "unsupported",
        "italic": "unsupported",
        "link_clickable": "unsupported",
        "custom_font": "unsupported",
        "section_order": "supported",
        "hidden_entries": "supported",
        "manual_page_break": "unsupported",
        "keep_with_next": "unsupported",
        "entry_spacing": "unsupported",
        "body_color": "unsupported",
        "scholar_skills_grid": "unsupported",
        "research_fields": "supported",
        "long_cv": "supported",
        "page_numbers": "unsupported",
    },
    "json": {
        "bold": "unsupported",
        "italic": "unsupported",
        "link_clickable": "unsupported",
        "custom_font": "unsupported",
        "section_order": "supported",
        "hidden_entries": "supported",
        "manual_page_break": "unsupported",
        "keep_with_next": "unsupported",
        "entry_spacing": "unsupported",
        "body_color": "unsupported",
        "scholar_skills_grid": "supported",
        "research_fields": "supported",
        "long_cv": "supported",
        "page_numbers": "unsupported",
    },
}


def level_of(fmt: str, capability: str) -> CapabilityLevel:
    """某个格式下某项能力的等级；未知格式/能力一律按 `unsupported`（不吹牛）。"""
    return CAPABILITIES.get(fmt, {}).get(capability, "unsupported")


def explain(fmt: str, capability: str) -> str:
    """给人读的一句：`PDF：斜体 近似（无斜体字形，不倾斜）`。"""
    name = _EXPLAIN.get(capability, capability)
    level = _LEVEL_TEXT[level_of(fmt, capability)]
    return f"{fmt.upper()}：{name} {level}"


def matrix(formats: list[str] | None = None, capabilities: list[str] | None = None) -> dict:
    """按需裁剪的矩阵（检查响应只下发被点名的格式，避免每响多半 KB）。"""
    wanted_formats = formats or list(FORMATS)
    wanted_caps = capabilities or list(CAPABILITY_KEYS)
    return {
        fmt: {cap: level_of(fmt, cap) for cap in wanted_caps}
        for fmt in wanted_formats
        if fmt in CAPABILITIES
    }


__all__ = [
    "CAPABILITIES",
    "CAPABILITY_KEYS",
    "FORMATS",
    "CapabilityLevel",
    "explain",
    "level_of",
    "matrix",
]
