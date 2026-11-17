# SPDX-License-Identifier: Apache-2.0
"""调研简报 v2（T16）：来源段只留一份、结论拆成 lead。

三条都是"顺序型"约定，写错时不会报错、只会让用户看到两份来源或一份没有来源的正文：

1. 模型自己写的「参考来源」必须先剥掉，**再**判断正文有没有 `[n]`；
2. 系统补的来源列表只能出现一次；
3. `## 一句话结论` 拆进 `lead` 后不能残留在正文里（否则界面上会重复一遍）。
"""

from __future__ import annotations

from app.services.job import company_research_brief as brief_mod


def _body(content: str, *, annotations: list[dict] | None = None) -> dict:
    return {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": content,
                    "annotations": annotations or [],
                    "server_tool_calls": [],
                }
            }
        ],
        "usage": {},
    }


def _annotation(url: str, title: str) -> dict:
    return {"type": "url_citation", "url_citation": {"url": url, "title": title}}


def test_model_source_block_is_stripped_before_citation_check():
    """正文没有任何行内 `[n]`，但模型自带了一份来源列表。

    正确行为：剥掉模型那份 → 判定"正文没有引用" → 补系统来源列表，最终**只有一份**。
    如果先判后剥，模型的 `[1]` 会骗过判定，系统不再补，用户拿到的是一份模型自拟的列表。
    """
    content = (
        "## 公司概况\n腾讯主营社交与游戏。\n\n"
        "## 近期动态\n上季度营收增长。\n\n"
        "参考来源：\n[1] 腾讯官网 — https://www.tencent.com/about\n"
        "[2] 财报 — https://news.example.com/q3\n"
    )
    brief = brief_mod.parse_brief(
        _body(
            content,
            annotations=[
                _annotation("https://www.tencent.com/about", "腾讯官网"),
                _annotation("https://news.example.com/q3", "财报"),
            ],
        ),
        deep=False,
    )
    markdown = brief["markdown"]
    assert markdown.count("参考来源") == 1
    assert "[1] 腾讯官网" in markdown
    assert "[2] 财报" in markdown


def test_source_block_in_the_middle_is_not_stripped():
    """正文里正常提到"参考来源"四个字（后面还有正文）不能被误删。"""
    content = (
        "## 公司概况\n下面的数字都可以核对。\n\n"
        "参考来源\n这一段是在解释怎么核对，不是列表。\n\n"
        "## 风险与提示\n公开信息里没有看到。\n"
    )
    brief = brief_mod.parse_brief(_body(content), deep=False)
    assert "这一段是在解释怎么核对" in brief["markdown"]


def test_lead_is_split_out_of_the_markdown():
    content = (
        "## 一句话结论\n建议投，但先补分布式系统经验。\n\n## 公司概况\n腾讯主营社交与游戏[1]。\n"
    )
    brief = brief_mod.parse_brief(
        _body(content, annotations=[_annotation("https://www.tencent.com/about", "腾讯官网")]),
        deep=False,
    )
    assert brief["lead"] == "建议投，但先补分布式系统经验。"
    # 正文里不能再出现结论小节（否则界面上结论带 + 正文重复一遍）。
    assert "一句话结论" not in brief["markdown"]
    assert "## 公司概况" in brief["markdown"]


def test_missing_lead_section_leaves_lead_empty():
    """旧格式没有结论小节：`lead` 为空，界面据此不渲染结论带（不拿第一段硬充）。"""
    brief = brief_mod.parse_brief(_body("## 公司概况\n腾讯主营社交与游戏。"), deep=False)
    assert brief["lead"] == ""
    assert "腾讯主营社交与游戏" in brief["markdown"]
