# SPDX-License-Identifier: Apache-2.0
"""JD 相关性排序：把最贴 JD 的项目排到「项目经历」最前面。

这些用例不依赖任何外部服务或夹具——排序是纯确定性计算，输入输出都能直接断言。
"""
from __future__ import annotations

from app.services.job.jd_relevance import reorder_projects_by_relevance

_BODY = """## 项目经历
### 电商后台管理系统
负责订单与库存模块，日活 3 万。

### AI 简历排版引擎
用大模型做版式自适应，处理 1.2 万份简历，导出耗时从 3 分钟降到 12 秒。

### 校园二手交易小程序
校内二手物品发布与检索，注册用户 2000+。
"""

_LLM_JD = {
    "title": "AI 应用工程师",
    "description": "负责大模型应用落地：Prompt 工程、RAG 检索、Agent 编排。",
}


def _names(body: str) -> list[str]:
    return [line.lstrip("# ").strip() for line in body.splitlines() if line.startswith("###")]


def test_most_relevant_project_moves_to_front():
    """LLM 岗：讲大模型的那个项目必须排第一。"""
    out = reorder_projects_by_relevance(_BODY, _LLM_JD)
    assert _names(out)[0] == "AI 简历排版引擎"


def test_first_project_carries_an_instruction_line():
    """第一名要带一行标注，告诉模型「第 3 句优先举这个」。

    没有这行标注时，模型只是"恰好先看到"它；有了才是显式指令。
    """
    out = reorder_projects_by_relevance(_BODY, _LLM_JD)
    assert "最相关" in out and "优先举" in out


def test_no_jd_returns_body_unchanged():
    """没有 JD 就没有排序依据——原样返回，绝不乱排。"""
    assert reorder_projects_by_relevance(_BODY, None) == _BODY
    assert reorder_projects_by_relevance(_BODY, {}) == _BODY


def test_no_matching_topic_returns_body_unchanged():
    """JD 与所有项目都不沾边（全部 0 分）时也原样返回。"""
    unrelated = {"title": "会计", "description": "负责月度结账与税务申报。"}
    assert reorder_projects_by_relevance(_BODY, unrelated) == _BODY


def test_body_without_project_section_returns_unchanged():
    """没有「项目经历」板块时不该凭空插入内容。"""
    body = "## 工作经历\n### 某公司\n做了一些事。\n"
    assert reorder_projects_by_relevance(body, _LLM_JD) == body


def test_single_project_returns_unchanged():
    """只有一个项目时排序没有意义，不加标注（标注只会让输出变脏）。"""
    body = "## 项目经历\n### 唯一项目\n大模型相关。\n"
    assert reorder_projects_by_relevance(body, _LLM_JD) == body


def test_equal_scores_keep_original_order():
    """同分保持原顺序：稳定排序，避免每次生成的顺序都不一样。"""
    body = """## 项目经历
### 项目甲
大模型。
### 项目乙
大模型。
"""
    out = reorder_projects_by_relevance(body, _LLM_JD)
    assert _names(out) == ["项目甲", "项目乙"]


def test_content_outside_project_section_is_preserved():
    """「项目经历」之外的段落必须原样保留——只重排那一个板块。"""
    body = """## 个人简介
一句话。

## 项目经历
### 电商后台
订单模块。
### AI 排版引擎
大模型版式。

## 教育经历
某大学。
"""
    out = reorder_projects_by_relevance(body, _LLM_JD)
    assert "## 个人简介" in out and "一句话。" in out
    assert "## 教育经历" in out and "某大学。" in out
    # 板块之间的相对顺序不变
    assert out.index("## 个人简介") < out.index("## 项目经历") < out.index("## 教育经历")
