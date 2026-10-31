# SPDX-License-Identifier: Apache-2.0
"""Markdown / TXT 出口（v2）：head 标题、lead/trail 标签行、body 要点与段落、
inline 分隔、语言切换、隐藏项与 TXT 去标记。"""

from __future__ import annotations

from app.services.exporter import export_markdown
from app.services.txt_exporter import export_txt
from tests.document_export_samples import HIDDEN_VALUES, make_document


def test_markdown_header_and_sections():
    markdown = export_markdown(make_document())
    header = markdown.splitlines()[0]
    assert header.startswith("# 陈可")
    assert "女" in header
    # 意向行由 planner 补上字段标签前缀（求职意向：产品经理），渲染器只画 plan 文本。
    assert "产品经理" in header
    assert "GitHub：https://github.com/example" in markdown
    assert "## 教育经历" in markdown
    assert "## 专业技能" in markdown
    assert "## 个人总结" in markdown


def test_markdown_entry_head_lead_body_trail_order():
    markdown = export_markdown(make_document())
    lines = [line.strip() for line in markdown.splitlines() if line.strip()]
    head = next(line for line in lines if line.startswith("### 示例大学"))
    assert "市场营销" in head and "本科" in head
    # education 是 2 列 equal：一行里两个灰字段用 · 连接（planner 装箱的结果）。
    lead_line = "- 绩点/排名：3.7/4.0 · 核心课程：市场调研、消费者行为"
    assert lead_line in lines
    assert "- 国家奖学金（2020）" in lines
    assert lines.index(head) < lines.index(lead_line) < lines.index("- 国家奖学金（2020）")


def test_markdown_inline_section_and_paragraph_body():
    markdown = export_markdown(make_document())
    assert "- Python（熟练） · 技能分类：后端" in markdown
    assert "从 0 到 1 策划校园招聘会。" in markdown
    assert "三年产品经验。" in markdown


def test_markdown_language_switch_keeps_values():
    markdown = export_markdown(make_document(), language="en-US")
    assert "Education" in markdown
    assert "示例大学" in markdown  # 数据不迁移，只有标题/标签换语言


def test_markdown_excludes_hidden_content():
    markdown = export_markdown(make_document())
    for hidden in HIDDEN_VALUES:
        assert hidden not in markdown


def test_txt_flattens_markdown_markup():
    plain = export_txt(make_document())
    for line in plain.splitlines():
        assert not line.startswith("#")
        assert not line.startswith("- ")
    assert "陈可" in plain and "国家奖学金（2020）" in plain
    for hidden in HIDDEN_VALUES:
        assert hidden not in plain
