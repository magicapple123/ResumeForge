# SPDX-License-Identifier: Apache-2.0
"""#20「同一份资料被识别成多份、字段重复」的固定夹具回归（纯函数，不调模型）。

夹具按详册 `resumeforge-issues-draft-2026-11-11.md` 第 1867–1950 行引用的**原始输出**
重建（D2 的 educations / projects / skills 就是那三行原文），不是原始会话的素材本身，
所以这里的通过率只代表"本夹具口径"，不等于原会话的条数。

四条必须钉住的性质：

1. **同分区按锚点合并（FIX-9）**：`浙江大学` + `浙江大学 计算机科学与技术 本科` →
   1 条，且 `major` / `degree` 不丢；
2. **日期保护是硬门槛**：同一家公司两段不连续任职（同角色、不同起止）必须保留 2 条；
3. **技能合法性（FIX-10）与头部字段兜底（FIX-11）**：姓名、联系方式、求职意向不进技能；
4. **反向样本**：`C#` / `C++` / `.NET` / `Power BI` / `Node.js` / `Java` vs `JavaScript` /
   `北京某某科技有限公司` / `MIT` 都不能被清洗规则吃掉。
"""

from __future__ import annotations

from app.services.profile_entry_dedup import is_legal_skill_name
from app.services.profile_entry_merge import (
    is_usable_anchor,
    merge_entries,
    normalized_key,
)
from app.services.profile_text_parser import parse_profile_text
from app.services.text_extraction_normalization import normalize_profile_result

# ===== D2：同一份内容贴两遍 =====

D2_RESUME = """李明
电话：13800138000｜邮箱：liming@example.com｜杭州
求职意向：后端开发工程师
教育经历
2014.09-2018.06  浙江大学  计算机科学与技术  本科
项目经历
分布式任务调度平台  核心开发  Go
专业技能
Java、Python、Go、MySQL、Redis
"""


def d2_ai_payload() -> dict:
    """D2 的原始输出：教育/项目各两条前缀变体，技能里混进姓名、联系方式、求职意向。"""
    return {
        "name": "李明",
        "phone": "13800138000",
        "email": "liming@example.com",
        "city": "杭州",
        "job_intent": "后端开发工程师",
        "educations": [
            {"school": "浙江大学"},
            {"school": "浙江大学 计算机科学与技术 本科"},
        ],
        "projects": [
            {"name": "分布式任务调度平台"},
            {"name": "分布式任务调度平台 核心"},
        ],
        "skills": [
            {"name": "Java"},
            {"name": "Python"},
            {"name": "Go"},
            {"name": "MySQL"},
            {"name": "Redis"},
            {"name": "李明"},
            {"name": "电话：13800138000｜邮箱：liming@example.com｜杭州"},
            {"name": "求职意向：后端开发工程师"},
        ],
    }


def test_d2_same_content_twice_collapses_to_one_entry_per_section() -> None:
    """D2 必须转绿：教育 1 / 项目 1 / 技能 5。"""
    source = D2_RESUME + "\n" + D2_RESUME
    result = normalize_profile_result(d2_ai_payload(), parse_profile_text(source), source)

    assert len(result.educations) == 1
    assert len(result.projects) == 1
    assert len(result.skills) == 5


def test_d2_prefix_variant_merge_keeps_major_and_degree() -> None:
    """`浙江大学` + `浙江大学 计算机科学与技术 本科` 合 1 条，专业与学历不能丢。"""
    source = D2_RESUME + "\n" + D2_RESUME
    result = normalize_profile_result(d2_ai_payload(), parse_profile_text(source), source)

    education = result.educations[0]
    assert education.school == "浙江大学"
    assert education.major == "计算机科学与技术"
    assert education.degree == "本科"
    assert education.start_date == "2014-09"
    assert education.end_date == "2018-06"


def test_d2_header_fields_never_become_skills() -> None:
    """姓名 / 电话邮箱 / 求职意向不能占着技能位。"""
    source = D2_RESUME + "\n" + D2_RESUME
    result = normalize_profile_result(d2_ai_payload(), parse_profile_text(source), source)

    names = [skill.name for skill in result.skills]
    assert names == ["Java", "Python", "Go", "MySQL", "Redis"]
    assert not any("李明" in name for name in names)
    assert not any("13800138000" in name for name in names)
    assert not any("求职意向" in name for name in names)


def test_d2_reports_what_was_ignored() -> None:
    """静默删数据是不允许的：至少给一条"已忽略 N 条"的说明。"""
    source = D2_RESUME + "\n" + D2_RESUME
    result = normalize_profile_result(d2_ai_payload(), parse_profile_text(source), source)

    assert any("已忽略" in warning for warning in result.warnings)


# ===== FIX-9 的硬门槛：日期保护 =====

SAME_COMPANY_TWO_PERIODS = """李明
工作经历
阿里巴巴  后端工程师  2020.07-2021.06
阿里巴巴  后端工程师  2023.01-2024.06
"""


def test_same_company_same_role_two_periods_stay_two_entries() -> None:
    """同一家公司、同一角色、两段不连续任职 = 两条真实履历，绝不能并成一条。

    这条是 FIX-9 日期保护的**唯一反证目标**：删掉 `_date_conflict` 之后，两条锚点相等
    的条目会被合掉，这个用例立刻变红。
    """
    data = {
        "name": "李明",
        "experiences": [
            {
                "company": "阿里巴巴",
                "role": "后端工程师",
                "start_date": "2020-07",
                "end_date": "2021-06",
            },
            {
                "company": "阿里巴巴",
                "role": "后端工程师",
                "start_date": "2023-01",
                "end_date": "2024-06",
            },
        ],
    }
    result = normalize_profile_result(
        data, parse_profile_text(SAME_COMPANY_TWO_PERIODS), SAME_COMPANY_TWO_PERIODS
    )

    assert len(result.experiences) == 2
    assert [(item.start_date, item.end_date) for item in result.experiences] == [
        ("2020-07", "2021-06"),
        ("2023-01", "2024-06"),
    ]


def test_same_company_two_periods_with_different_roles_stay_two_entries() -> None:
    """详册原例（角色也不同）：两条都要留下。"""
    source = """李明
工作经历
阿里巴巴  后端工程师  2020.07-2021.06
阿里巴巴  高级后端工程师  2023.01-2024.06
"""
    data = {
        "name": "李明",
        "experiences": [
            {
                "company": "阿里巴巴",
                "role": "后端工程师",
                "start_date": "2020-07",
                "end_date": "2021-06",
            },
            {
                "company": "阿里巴巴",
                "role": "高级后端工程师",
                "start_date": "2023-01",
                "end_date": "2024-06",
            },
        ],
    }
    result = normalize_profile_result(data, parse_profile_text(source), source)

    assert len(result.experiences) == 2
    assert [item.role for item in result.experiences] == ["后端工程师", "高级后端工程师"]


def test_prefix_variant_without_dates_is_merged() -> None:
    """没有日期的前缀变体照常合并（日期保护只在"两侧都有且不同"时生效）。"""
    merged = merge_entries(
        "projects",
        [{"name": "分布式任务调度平台"}, {"name": "分布式任务调度平台 核心"}],
        [],
    )

    assert len(merged) == 1
    assert merged[0]["name"] == "分布式任务调度平台"


def test_markdown_decoration_variant_is_merged() -> None:
    """`*清华大学**` 与 `清华大学` 是同一条（FIX-1 剥装饰符号）。"""
    merged = merge_entries(
        "educations",
        [{"school": "*清华大学**", "major": "计算机"}, {"school": "清华大学"}],
        [],
    )

    assert len(merged) == 1
    assert merged[0]["school"] == "清华大学"


# ===== FIX-10 / FIX-11：技能与头部字段 =====


def test_skill_name_legality_rules() -> None:
    """过长、含键值冒号、命中头部字段词的技能名不合法；真技能全部合法。"""
    assert is_legal_skill_name("Java") is True
    assert is_legal_skill_name("Power BI") is True
    assert is_legal_skill_name("Node.js") is True
    assert is_legal_skill_name("C#") is True
    assert is_legal_skill_name("C++") is True
    assert is_legal_skill_name("熟练掌握相机的使用，能独自完成视频拍摄与剪辑工作") is True
    assert is_legal_skill_name("电话：13800138000") is False
    assert is_legal_skill_name("求职意向：后端开发工程师") is False
    assert is_legal_skill_name("期望薪资 25k") is False
    assert is_legal_skill_name("A" * 25) is False


def test_skill_with_symbols_survives_end_to_end() -> None:
    """`C#` / `C++` / `.NET` / `Power BI` / `Node.js` 走完整链路后原样保留。"""
    source = "李明\n专业技能\nC#、C++、.NET、Power BI、Node.js"
    data = {
        "name": "李明",
        "skills": [
            {"name": "C#"},
            {"name": "C++"},
            {"name": ".NET"},
            {"name": "Power BI"},
            {"name": "Node.js"},
        ],
    }
    result = normalize_profile_result(data, parse_profile_text(source), source)

    assert [skill.name for skill in result.skills] == [
        "C#",
        "C++",
        ".NET",
        "Power BI",
        "Node.js",
    ]


def test_java_and_javascript_are_not_merged() -> None:
    """技能不做前缀合并：`Java` 是 `JavaScript` 的前缀，合并会吃掉一个真技能。"""
    source = "李明\n专业技能\nJava、JavaScript"
    data = {"name": "李明", "skills": [{"name": "Java"}, {"name": "JavaScript"}]}
    result = normalize_profile_result(data, parse_profile_text(source), source)

    assert [skill.name for skill in result.skills] == ["Java", "JavaScript"]


# ===== 反向样本（R1/R2/R3）=====


def test_real_company_name_with_generic_word_is_not_blacklisted() -> None:
    """`北京某某科技有限公司` 是真公司名：黑名单只做整串精确匹配。"""
    assert is_usable_anchor("experiences", "北京某某科技有限公司") is True
    assert is_usable_anchor("experiences", "公司") is False
    assert is_usable_anchor("experiences", "现在这家公司") is False
    assert is_usable_anchor("educations", "学校") is False

    source = "李明\n工作经历\n北京某某科技有限公司  后端工程师  2021.07-2024.06"
    data = {
        "name": "李明",
        "experiences": [
            {
                "company": "北京某某科技有限公司",
                "role": "后端工程师",
                "start_date": "2021-07",
                "end_date": "2024-06",
            }
        ],
    }
    result = normalize_profile_result(data, parse_profile_text(source), source)

    assert [item.company for item in result.experiences] == ["北京某某科技有限公司"]


def test_english_school_name_without_university_keyword_is_kept() -> None:
    """`MIT` 是合法校名：不能用"含大学/学院"当教育的必要条件。"""
    source = (
        "Alexander\nEducation\nMIT  Computer Science  2014.09-2018.06\nGoogle  SWE  2019.07-present"
    )
    data = {
        "name": "Alexander",
        "educations": [
            {
                "school": "MIT",
                "major": "Computer Science",
                "start_date": "2014-09",
                "end_date": "2018-06",
            }
        ],
        "experiences": [
            {
                "company": "Google",
                "role": "SWE",
                "start_date": "2019-07",
                "end_date": "至今",
            }
        ],
    }
    result = normalize_profile_result(data, parse_profile_text(source), source)

    assert [item.school for item in result.educations] == ["MIT"]
    assert [item.company for item in result.experiences] == ["Google"]


def test_decoration_stripping_keeps_short_technical_names() -> None:
    """FIX-1 只剥长度 ≥4 的首尾装饰：`C#` / `C++` / `.NET` 归一后不变。"""
    assert normalized_key("C#") == "c#"
    assert normalized_key("C++") == "c++"
    assert normalized_key(".NET") == ".net"
    assert normalized_key("*清华大学**") == "清华大学"
    assert normalized_key("**Go**") == "go"


def test_one_entry_section_is_never_cleared() -> None:
    """单条分区不做碎片清洗（合法的短技能名 `C` 不能被当成脏条目）。"""
    source = "李明\n专业技能\nC"
    data = {"name": "李明", "skills": [{"name": "C"}]}
    result = normalize_profile_result(data, parse_profile_text(source), source)

    assert [skill.name for skill in result.skills] == ["C"]
