# SPDX-License-Identifier: Apache-2.0
"""搜索筛选：中文标签 → BOSS 编码，以及按标签的本地二次筛选。"""
from __future__ import annotations

from types import SimpleNamespace

from app.services.job_hunt.search_filters import (
    filter_stub_by_tags,
    filter_options,
    resolve_search_filters,
)


def test_resolves_chinese_labels_to_codes():
    """界面给用户看中文，站点只认数字编码。"""
    result = resolve_search_filters(
        {"experience": ["应届生", "1-3年"], "degree": ["本科"], "jobType": ["全职"]}
    )

    assert result.params["experience"] == "102,104"
    assert result.params["degree"] == "203"
    assert result.params["jobType"] == "1901"
    assert result.unapplied == []


def test_unlimited_is_not_a_filter():
    """「不限」等于没筛：不该产生参数（站点收到 experience=0 语义不一样）。"""
    result = resolve_search_filters({"experience": ["不限"], "degree": ["学历不限"]})

    # 「不限」在快照里编码是 0 —— 它不进 params。
    assert "experience" not in result.params
    # 「学历不限」是真实编码 201 之前的语义项……快照里它是 (0, 不限) 形态之外的值，
    # 这里只断言「不限」这条不产生参数。
    assert result.unapplied  # 至少有一个没生效（如实上报，不静默）


def test_unknown_label_is_reported_not_dropped():
    """认不出的标签必须进 unapplied——静默丢弃会让用户以为筛了。"""
    result = resolve_search_filters({"experience": ["不存在的年限"]})

    assert "experience" not in result.params
    assert any("不存在的年限" in item for item in result.unapplied)


def test_filter_options_drop_unlimited():
    """下拉选项里不该出现「不限」——不清空就等于没选，界面上用清空表达。"""
    options = filter_options("degree")
    codes = [code for code, _ in options]

    assert "0" not in codes
    assert "203" in codes  # 本科


def test_local_filter_drops_mismatched_experience():
    """本地兜底：选了应届生，10 年经验的卡要被挡掉。

    站点侧筛选不严格（实测选「应届生」仍会看到「1-3年」），所以要有一道按标签的兜底。
    """
    senior = SimpleNamespace(experience="10年以上", education="本科")
    fresh = SimpleNamespace(experience="应届生", education="本科")

    selected = {"experience": ["应届生"]}
    assert filter_stub_by_tags(fresh, selected) is True
    assert filter_stub_by_tags(senior, selected) is False


def test_local_filter_passes_when_tag_missing():
    """标签读不到就放过——宁可多留一条，也不要静默少数据。"""
    unknown = SimpleNamespace(experience="", education="")

    assert filter_stub_by_tags(unknown, {"experience": ["应届生"], "degree": ["本科"]}) is True


def test_unlimited_experience_does_not_constrain():
    """选了「经验不限」就不该筛掉任何岗位。"""
    senior = SimpleNamespace(experience="10年以上", education="")

    assert filter_stub_by_tags(senior, {"experience": ["经验不限"]}) is True


def test_local_filter_keeps_education_unlimited_jobs():
    """「学历不限」的岗位对任何学历都开放，不该被学历筛选挡掉。"""
    job = SimpleNamespace(experience="", education="学历不限")

    assert filter_stub_by_tags(job, {"degree": ["本科"]}) is True


# ---------------------------------------------------------------------------
# 薪资区间（BOSS 没有自定义区间参数，靠"档位并集 + 本地精筛"两步）
# ---------------------------------------------------------------------------


def test_salary_range_maps_to_covering_tiers():
    """8-12K 要拉覆盖它的档位并集：5-10K(404) + 10-20K(405)。

    **宁可多拉不可漏拉**：取交集就永远看不到 8-12K 里属于 5-10K 的那部分。
    """
    from app.services.job_hunt.search_filters import salary_tiers_for_range

    assert salary_tiers_for_range(8, 12) == "404,405"


def test_salary_range_empty_when_unset():
    from app.services.job_hunt.search_filters import salary_tiers_for_range

    assert salary_tiers_for_range(0, 0) == ""


def test_salary_passes_rejects_too_low():
    """够不着就拦：岗位上限低于期望下限。规则对齐 BossHunter prefilter。"""
    from app.services.job_hunt.search_filters import salary_passes

    assert salary_passes("3-5K", 8, 12) is False


def test_salary_passes_allows_overlap():
    """有交集就放过：8-12K 与 12-24K 在 12 上接上。"""
    from app.services.job_hunt.search_filters import salary_passes

    assert salary_passes("8-12K", 8, 12) is True
    assert salary_passes("12-24K·14薪", 8, 12) is True


def test_salary_passes_rejects_far_above_with_ceiling():
    """好高骛远也拦：岗位下限超过期望上限 × 1.5。

    1.5 是"值得一试"的余量——开 20K 而想要 12K 仍可能谈到，开 60K 就不是同一层级。
    """
    from app.services.job_hunt.search_filters import salary_passes

    # 12 × 1.5 = 18；下限 20 > 18 → 拦
    assert salary_passes("20-30K", 8, 12) is False
    # 下限 15 < 18 → 放过
    assert salary_passes("15-25K", 8, 12) is True


def test_salary_passes_allows_negotiable():
    """面议 / 解析不出 → 放过。

    BossHunter 默认拦（它是海投自动投递）；我们这里是收集候选给人挑，
    多留一条面议岗位比误杀更划算。
    """
    from app.services.job_hunt.search_filters import salary_passes

    assert salary_passes("面议", 8, 12) is True
    assert salary_passes("", 8, 12) is True


def test_salary_passes_no_range_means_no_filter():
    """用户没填区间就不筛。"""
    from app.services.job_hunt.search_filters import salary_passes

    assert salary_passes("3-5K", 0, 0) is True


# ---------------------------------------------------------------------------
# 求职类型回填（BOSS 列表页不带岗位类型 → 全是「校招」的根因）
# ---------------------------------------------------------------------------


def test_job_type_from_full_time_filter():
    """用户选「全职」→ 库内「社招」。

    库内只有 校招/社招/实习 三档；「全职」表达的是"不是学生岗"，
    对应「社招」而不是字面反义的「实习」。
    """
    from app.services.job_hunt.search_filters import job_type_from_filters

    assert job_type_from_filters({"jobType": ["全职"]}) == "社招"


def test_job_type_from_intern_filter():
    """「实习」→ 实习。

    注意：离线快照的 jobTypeList 里**没有实习**（只采到 不限/全职/兼职），
    所以映射表不能只依赖快照 —— BOSS 的 jobType=1902 是实存在的。
    """
    from app.services.job_hunt.search_filters import job_type_from_filters

    assert job_type_from_filters({"jobType": ["实习"]}) == "实习"


def test_job_type_empty_when_not_selected():
    """没选类型时返回空串，让导入侧按标题推断——那条链路本来是对的，
    不该被采集覆盖。"""
    from app.services.job_hunt.search_filters import job_type_from_filters

    assert job_type_from_filters({}) == ""
    assert job_type_from_filters({"jobType": []}) == ""
    assert job_type_from_filters(None) == ""


