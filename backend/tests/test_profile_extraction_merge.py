# SPDX-License-Identifier: Apache-2.0
"""资料识别准确率的四类缺陷回归（2026-10-27，纯函数级、不联网）。

四类缺陷与对应断言：

1. **同名条目互相串日期**：`_merge_entries` 原用 `{anchor: item}` 字典，同名条目互相
   覆盖 → 后 3 条的日期都被写成最后一条。现在是一对一 FIFO 配对。
2. **凭空多出脏条目**：本地解析把学历粘进校名（`第一中学 高中`）而模型给 `第一中学`，
   字面不等 → AI 一条 + 本地一条；模型偶尔还会把一行劈成 `项目8号` + `0`。
3. **「2023年7月至今」被拆坏**：`至` 前那个 `月` 残留成公司名。属 `profile_parser`。
4. **日期接地过严**：抄录写 `2014.09`、模型写 `2014-09` 就判"无出处"清空（图片通路
   没有本地兜底 → 日期全空）。

这里刻意直接调用内核（`merge_entries` / `_is_grounded`）：它们就是缺陷所在，
通过公开入口绕一圈只会让失败信息变模糊。公开入口另有覆盖
（`test_text_extraction.py`、`test_profile_text_parser_variants.py`）。
"""

from __future__ import annotations

import pytest
from app.services.profile_entry_merge import merge_entries
from app.services.profile_parser.normalization import _heading_parts
from app.services.profile_text_parser import parse_profile_text
from app.services.text_extraction_normalization import (
    _is_grounded,
    normalize_profile_result,
)

# ===== 1) 同名条目一对一 =====

ZHEJIANG_TEXT = """张伟
教育经历
2016.09-2019.06  浙江大学  计算机  专科
2019.09-2021.06  浙江大学  计算机  本科
2021.09-2024.06  浙江大学  计算机  硕士
"""


def test_three_same_school_entries_keep_their_own_dates() -> None:
    """3 条同名学校各取一条本地条目：日期不再被最后一条统一覆盖。"""
    local = parse_profile_text(ZHEJIANG_TEXT).educations
    ai = [
        {"school": "浙江大学", "start_date": "2016-09", "end_date": "2019-06", "degree": "专科"},
        {"school": "浙江大学", "start_date": "2019-09", "end_date": "2021-06", "degree": "本科"},
        {"school": "浙江大学", "start_date": "2021-09", "end_date": "2024-06", "degree": "硕士"},
    ]
    merged = merge_entries("educations", ai, [item.model_dump() for item in local])
    assert len(merged) == 3
    assert [(item["start_date"], item["end_date"]) for item in merged] == [
        ("2016-09", "2019-06"),
        ("2019-09", "2021-06"),
        ("2021-09", "2024-06"),
    ]
    # AI 的学历纠正了本地分类，且没有互相串。
    assert [item["degree"] for item in merged] == ["专科", "本科", "硕士"]


def test_five_same_company_entries_pair_in_order() -> None:
    """5 条同名公司：每条 AI 条目各认领一条本地条目，剩下的不重复追加。"""
    ai = [
        {"company": "腾讯", "role": f"职级{index}", "start_date": f"20{15 + index}-07"}
        for index in range(5)
    ]
    local = [
        {"company": "腾讯", "role": f"职级{index}", "start_date": "", "description": ""}
        for index in range(5)
    ]
    merged = merge_entries("experiences", ai, local)
    assert len(merged) == 5
    assert [item["start_date"] for item in merged] == [
        "2015-07",
        "2016-07",
        "2017-07",
        "2018-07",
        "2019-07",
    ]


def test_more_ai_entries_than_local_are_all_kept() -> None:
    """AI 条目多于本地时，多出来的直接保留（不能因为配不上就丢）。"""
    ai = [
        {"company": "腾讯", "role": "工程师"},
        {"company": "腾讯", "role": "高级工程师"},
    ]
    merged = merge_entries("experiences", ai, [{"company": "腾讯", "role": "工程师"}])
    assert len(merged) == 2
    assert [item["role"] for item in merged] == ["工程师", "高级工程师"]


# ===== 2) 锚点归一与脏条目清洗 =====


def test_anchor_prefix_match_does_not_duplicate_sticky_degree() -> None:
    """本地 `第一中学 高中` 与模型的 `第一中学` 是同一条，不能再各留一条。"""
    local = [
        {"school": "第一中学 高中", "degree": "", "start_date": "2010-09", "end_date": "2014-06"},
        {"school": "浙江大学", "degree": "本科", "start_date": "2014-09", "end_date": "2018-06"},
    ]
    ai = [
        {"school": "第一中学", "degree": "高中"},
        {"school": "浙江大学", "degree": "本科"},
    ]
    merged = merge_entries("educations", ai, local)
    assert len(merged) == 2
    assert merged[0]["school"] == "第一中学"  # 模型给的名字优先
    assert merged[0]["degree"] == "高中"
    assert merged[0]["start_date"] == "2010-09"  # 本地日期不被清掉


def test_anchor_normalizes_whitespace_and_fullwidth() -> None:
    """锚点比对前折叠空白与全半角：`复旦 大学` 与 `复旦大学` 是同一条。"""
    local = [{"school": "复旦 大学", "start_date": "2016-09", "end_date": "2020-06"}]
    ai = [{"school": "复旦大学", "major": "新闻学"}]
    merged = merge_entries("educations", ai, local)
    assert len(merged) == 1
    assert merged[0]["major"] == "新闻学"
    assert merged[0]["start_date"] == "2016-09"


def test_fragment_entry_with_single_char_anchor_is_dropped() -> None:
    """模型把一行劈成两条时，多出的 `0` 这类短锚点条目丢掉。"""
    ai = [
        {"name": "项目8号", "start_date": "2023-10", "end_date": "2024-02"},
        {"name": "0", "start_date": "2023-10", "end_date": "2024-02"},
    ]
    merged = merge_entries("projects", ai, [])
    assert [item["name"] for item in merged] == ["项目8号"]


def test_fragment_entry_quoted_from_neighbour_description_is_dropped() -> None:
    """整条只有身份字段、且这段文字出现在邻条描述里 → 它是重复的一段文字，不是记录。"""
    ai = [
        {"name": "项目8号", "description": "负责召回模块，QPS 提升 3 倍"},
        {"name": "负责召回模块"},
    ]
    merged = merge_entries("projects", ai, [])
    assert [item["name"] for item in merged] == ["项目8号"]


def test_page_footer_noise_is_not_an_entry() -> None:
    """页眉页脚噪声（「第 2 页」）不能被当成一条记录。"""
    ai = [
        {"school": "中山大学", "major": "统计学", "start_date": "2015-09", "end_date": "2019-06"},
        {"school": "第 2 页"},
        {"school": "共 3 页"},
        {"school": "1/3"},
    ]
    merged = merge_entries("educations", ai, [])
    assert [item["school"] for item in merged] == ["中山大学"]


def test_identical_entries_are_deduplicated() -> None:
    """同一份内容粘贴两遍 / 同一张图提交两次：完全相同的条目只留一条。"""
    duplicate = {
        "school": "四川大学",
        "major": "数学",
        "degree": "本科",
        "start_date": "2013-09",
        "end_date": "2017-06",
    }
    merged = merge_entries("educations", [duplicate, dict(duplicate)], [])
    assert len(merged) == 1


def test_same_school_with_different_dates_is_not_deduplicated() -> None:
    """同名但日期不同的多条教育是真实数据，不能被去重吃掉。"""
    ai = [
        {"school": "浙江大学", "start_date": "2016-09", "end_date": "2019-06"},
        {"school": "浙江大学", "start_date": "2019-09", "end_date": "2021-06"},
    ]
    merged = merge_entries("educations", ai, [])
    assert len(merged) == 2


def test_one_entry_section_is_never_pruned() -> None:
    """只有一条时不做碎片清洗（没有"邻条"可比，宁可留着让用户核对）。"""
    merged = merge_entries("skills", [{"name": "C"}], [])
    assert merged == [{"name": "C"}]


# ===== 3) 「YYYY年M月至今」整段消费 =====


@pytest.mark.parametrize(
    ("line", "company", "role", "start_date", "end_date"),
    [
        ("2023年7月至今  上海广播电视台  记者", "上海广播电视台", "记者", "2023-07", "至今"),
        ("2023.07-至今  上海广播电视台  记者", "上海广播电视台", "记者", "2023-07", "至今"),
        ("2023/07—至今  上海广播电视台  记者", "上海广播电视台", "记者", "2023-07", "至今"),
        ("2023年7月—现在  上海广播电视台  记者", "上海广播电视台", "记者", "2023-07", "至今"),
        ("2023.07至今  上海广播电视台  记者", "上海广播电视台", "记者", "2023-07", "至今"),
        # 英文公司名里带空格时本地规则会从第一个空格切开（`Shanghai` / `TV Reporter`）——
        # 这是**另一类**缺陷（多词英文机构名），与「至今」无关，这里只钉日期部分。
        ("2023-07 ~ Present  Shanghai TV  Reporter", "Shanghai", "TV Reporter", "2023-07", "至今"),
    ],
)
def test_ongoing_date_range_is_consumed_whole(
    line: str, company: str, role: str, start_date: str, end_date: str
) -> None:
    """`至今/现在/Present` 前面没有分隔符也要整段吃掉，不能把 `月` 留成公司名。"""
    result = parse_profile_text("工作经历\n" + line)
    assert len(result.experiences) == 1
    entry = result.experiences[0]
    assert entry.company == company
    assert entry.role == role
    assert entry.start_date == start_date
    assert entry.end_date == end_date


# ===== 4) 日期接地：分隔符不同不算幻觉 =====


@pytest.mark.parametrize(
    ("value", "source"),
    [
        ("2014-09", "2014.09-2018.06  南京大学"),
        ("2014/09", "2014年9月 - 2018年6月 南京大学"),
        ("2014.9", "2014-09 至 2018-06 南京大学"),
        ("２０１４－０９", "2014.09-2018.06 南京大学"),  # 全角
        ("至今", "2021.07-至今 江苏凤凰文艺出版社"),
    ],
)
def test_date_grounding_ignores_separator_style(value: str, source: str) -> None:
    assert _is_grounded(value, source, "start_date") is True


def test_non_date_fields_keep_literal_grounding() -> None:
    """放宽只限日期字段：同样的值放在学校名上仍然判"无出处"。"""
    assert _is_grounded("2014-09", "2014.09-2018.06 南京大学", "school") is False


def test_date_grounding_still_rejects_fabricated_dates() -> None:
    """原文里没有这个年份 → 仍然清空（不能把校验放成"任何日期都算对"）。"""
    assert _is_grounded("2019-09", "2014.09-2018.06 南京大学", "start_date") is False


def test_normalize_result_keeps_dates_written_with_other_separators() -> None:
    """端到端：抄录写 `2014.09`、模型写 `2014-09`，日期必须留下。"""
    source = "教育背景\n2014.09-2018.06  南京大学  汉语言文学  本科"
    data = {
        "educations": [
            {
                "school": "南京大学",
                "major": "汉语言文学",
                "start_date": "2014-09",
                "end_date": "2018-06",
            }
        ]
    }
    result = normalize_profile_result(data, parse_profile_text(source), source)
    assert result.educations[0].start_date == "2014-09"
    assert result.educations[0].end_date == "2018-06"


# ===== 5) 出生年月只回年份（2026-10-27 QA B2）=====


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("李雷 男 1998年7月生", "1998-07"),
        ("出生年月：1996年8月", "1996-08"),
        ("出生年月：1998", "1998"),
        ("出生年月：1998.07", "1998-07"),
        ("出生年月：1998年7月出生", "1998-07"),
    ],
)
def test_local_parser_keeps_birth_month(source: str, expected: str) -> None:
    """出生年月这个字段名里就有"月"：原文写了月份就必须留下来（此前只剩 1998）。"""
    assert parse_profile_text(source).birth_year == expected


@pytest.mark.parametrize(
    ("ai_value", "source", "expected"),
    [
        # 模型只回年份、原文同年只出现一个月份 → 补回月份（不是编造，月份就在原文里）。
        ("1998", "李雷 男 1998年7月生", "1998-07"),
        ("1996", "李雷\n出生年月：1996年8月", "1996-08"),
        # 原文同年有多个不同月份（入学 / 毕业 / 入职）→ 宁可不猜，保持四位年份。
        ("1998", "李雷 男 1998年7月生\n1998.09-2022.06  某大学", "1998"),
        # 模型自己带月份时原样保留。
        ("1998-07", "李雷 男 1998年7月生", "1998-07"),
        # 只有年份的原文保持不变。
        ("1998", "李雷\n出生年月：1998", "1998"),
    ],
)
def test_ai_birth_year_is_refined_to_month_only_when_unambiguous(
    ai_value: str, source: str, expected: str
) -> None:
    data = {"name": "李雷", "birth_year": ai_value}
    result = normalize_profile_result(data, parse_profile_text(source), source)
    assert result.birth_year == expected


# ===== 6) 双语小标题导致串板块（2026-10-27 QA C2）=====

L2_MIXED_TEXT = """李雷
教育经历 Education
2015.09-2019.06  某大学  计算机  本科
工作经历 Experience
Microsoft  Software Engineer  2020.07-至今
"""


@pytest.mark.parametrize(
    ("heading", "expected"),
    [
        ("教育经历 Education", "educations"),
        ("工作经历 Experience", "experiences"),
        ("Work Experience 工作经历", "experiences"),
        ("项目经历 Projects", "projects"),
        ("专业技能 Skills", "skills"),
        ("教育经历（Education）", "educations"),
        ("教育经历 / Education", "educations"),
    ],
)
def test_bilingual_headings_are_recognized(heading: str, expected: str) -> None:
    """中英混排的标题必须算标题：英文尾缀不能让整行落到"认不出"那一档。"""
    assert _heading_parts(heading)[0] == expected


def test_bilingual_headings_do_not_cross_sections() -> None:
    """本地解析：双语标题下 Microsoft 只属于工作经历，不进教育（此前两栏都进）。"""
    result = parse_profile_text(L2_MIXED_TEXT)
    assert [entry.school for entry in result.educations] == ["某大学"]
    assert [entry.company for entry in result.experiences] == ["Microsoft"]
    assert result.experiences[0].start_date == "2020-07"
    assert result.experiences[0].end_date == "至今"


def test_model_entry_outside_its_section_is_dropped() -> None:
    """结构性兜底：模型把同一条工作经历也写进 educations，归一化时丢掉。"""
    data = {
        "name": "李雷",
        "educations": [
            {"school": "某大学", "major": "计算机", "start_date": "2015-09", "end_date": "2019-06"},
            # 模型把「工作经历」那一段也算成教育经历：学校栏写公司名。
            {
                "school": "Microsoft",
                "major": "Software Engineer",
                "start_date": "2020-07",
                "end_date": "至今",
            },
        ],
        "experiences": [
            {
                "company": "Microsoft",
                "role": "Software Engineer",
                "start_date": "2020-07",
                "end_date": "至今",
            }
        ],
    }
    result = normalize_profile_result(data, parse_profile_text(L2_MIXED_TEXT), L2_MIXED_TEXT)

    assert [entry.school for entry in result.educations] == ["某大学"]
    assert [entry.company for entry in result.experiences] == ["Microsoft"]


def test_structural_guard_skips_when_source_has_no_headings() -> None:
    """原文认不出任何分区标题时跳过结构校验，不能因为"没有边界"把条目全杀掉。"""
    source = "李雷 男\nMicrosoft"
    data = {"name": "李雷", "experiences": [{"company": "Microsoft", "role": "工程师"}]}
    result = normalize_profile_result(data, parse_profile_text(source), source)
    assert [entry.company for entry in result.experiences] == ["Microsoft"]


# ===== 7) 锚点判定收敛到一处 =====


def test_single_letter_skill_survives_and_page_noise_does_not() -> None:
    """`is_usable_anchor` 是唯一判定：技能名的短名字合法，页眉页脚永远不是记录。"""
    source = "李雷\n专业技能\nC、R、Go、Python"
    data = {
        "name": "李雷",
        "skills": [{"name": "C"}, {"name": "R"}, {"name": "Go"}, {"name": "Python"}],
    }
    result = normalize_profile_result(data, parse_profile_text(source), source)
    assert [entry.name for entry in result.skills] == ["C", "R", "Go", "Python"]

    # 同一条判定在合并侧也生效：噪声锚点进不了结果。
    noisy = [
        {"name": "第 2 页"},
        {"name": "C"},
    ]
    assert [entry["name"] for entry in merge_entries("skills", noisy, [])] == ["C"]
