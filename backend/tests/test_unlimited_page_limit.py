# SPDX-License-Identifier: Apache-2.0
"""需求 7B：「不限篇幅」（``page_limit = 0``）的契约。

为什么单独一个文件：这条需求横跨四处契约——请求 schema、篇幅指令、篇幅闸门、
模式夹紧——任何一处漏了都会表现为"用户选不限，结果还是被裁成 1 页"。集中钉住
比散在四个文件里更容易看出漏了哪一层。

**0 不是缺省值**：缺省仍是 1 页；0 只在用户显式选「不限」时出现，语义是
"不裁剪、不做版式收敛、不发删减/超页警告"。
"""

from __future__ import annotations

import pytest
from app.schemas.resume_generation import (
    UNLIMITED_PAGE_LIMIT,
    UNLIMITED_RENDER_MAX_PAGES,
    GenerateOptions,
    mode_page_limit,
)
from app.services.resume.resume_generation_levels import build_layout_guide
from app.services.resume.resume_space_gate import finalize_page_budget, page_overage
from pydantic import ValidationError


def _resume_with_points(count: int = 40) -> dict:
    """构造一份"要点很多、必然超页"的简历（不需要真实渲染就能走完不裁剪分支）。"""
    return {
        "experience": [
            {
                "company": "示例公司",
                "role": "后端工程师",
                "description": [f"要点 {index} " + "细节" * 20 for index in range(count)],
            }
        ],
        "projects": [
            {
                "name": "示例项目",
                "description": [f"项目要点 {index} " + "细节" * 20 for index in range(count)],
            }
        ],
        "skills": [{"name": "Java", "level": "熟练"}],
    }


class TestRequestContract:
    def test_zero_is_accepted_in_both_modes(self):
        assert GenerateOptions(page_limit=UNLIMITED_PAGE_LIMIT).page_limit == 0
        assert GenerateOptions(page_limit=0, document_mode="long_cv").page_limit == 0

    def test_default_is_still_one_page(self):
        # 0 只是"显式不限"，不能顺手把缺省改成不限。
        assert GenerateOptions().page_limit == 1

    def test_normal_bounds_are_unchanged(self):
        with pytest.raises(ValidationError):
            GenerateOptions(page_limit=4)
        with pytest.raises(ValidationError):
            GenerateOptions(page_limit=-1)

    def test_render_clamp_maps_zero_to_hard_cap(self):
        assert mode_page_limit(0, "resume") == UNLIMITED_RENDER_MAX_PAGES
        assert mode_page_limit(0, "long_cv") == UNLIMITED_RENDER_MAX_PAGES
        # 正常值仍按模式夹紧（回归）
        assert mode_page_limit(9, "resume") == 3
        assert mode_page_limit(9, "long_cv") == 9


class TestPromptContract:
    def test_layout_guide_says_unlimited_and_drops_page_budget(self):
        guide = build_layout_guide(UNLIMITED_PAGE_LIMIT, "standard", "balanced")
        assert "不限" in guide
        assert "最多" not in guide
        assert "页 A4" not in guide

    def test_limited_guide_still_mentions_pages(self):
        # 回归：不限分支不能把"有上限"的措辞也改掉。
        assert "1 页 A4" in build_layout_guide(1, "standard", "balanced")
        assert "最多 2 页" in build_layout_guide(2, "standard", "balanced")


class TestSpaceGateContract:
    def test_no_overage_when_unlimited(self):
        assert page_overage(_resume_with_points(), page_limit=0) == 0

    def test_no_trim_and_no_trim_warning_when_unlimited(self, monkeypatch):
        # 只要走到裁剪，这条用例就应该红：用一个"被调用即失败"的哨兵钉住。
        from app.services.resume import resume_space_gate

        def _boom(*_args, **_kwargs):
            raise AssertionError("不限篇幅时不应调用裁剪")

        monkeypatch.setattr(resume_space_gate, "trim_to_page_limit", _boom)
        warnings: list[str] = []
        resume = _resume_with_points()
        before = len(resume["experience"][0]["description"])
        result = finalize_page_budget(
            resume, warnings, page_limit=0, font_scale="standard", language="zh-CN"
        )
        assert len(result["experience"][0]["description"]) == before
        assert not [item for item in warnings if "自动删减" in item]
        assert not [item for item in warnings if "实际渲染仍超出" in item]

    def test_coverage_gap_warning_survives_unlimited(self):
        # 「不限篇幅」不等于"什么都别提醒"：核心板块一条都没留下仍然要说。
        resume = _resume_with_points()
        resume["projects"] = []
        warnings: list[str] = []
        finalize_page_budget(
            resume, warnings, page_limit=0, font_scale="standard", language="zh-CN"
        )
        assert any("没有保留任何条目" in item for item in warnings)
