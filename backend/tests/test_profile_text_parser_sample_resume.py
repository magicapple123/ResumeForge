# SPDX-License-Identifier: Apache-2.0
"""粘贴文本识别：用户实测简历样本的验收测试。

样本结构取自用户反馈截图，个人身份信息（姓名/手机号/邮箱）已全部替换为虚构值。

样本来自用户从简历截图抄录的原文（列间是大空格/制表对齐），它把此前解析器的几类
实测缺陷一次性钉住：分区别名缺失（项目/实践经历、个人技能）、``X.Y``/``X.Y.Z``/
``X 至今`` 的日期形态、日期开头的多列条目、教育分区内的 GPA/荣誉奖项行被误当
条目头、技能的分类行（语言/计算机/摄影）与长句技能。
"""

import pytest
from app.schemas.date_format import normalize_partial_date
from app.services.profile_parser.entry_constants import _DATE_RANGE_RE
from app.services.profile_text_parser import parse_profile_text

SAMPLE_RESUME_TEXT = """个人简历
个人信息
姓名：林晓样        年龄：21
电话：13800001234        邮箱：linxiaoyang@example.com
教育背景
2023-至今        天津工业大学        软件工程专业/本科
主修课程：C语言程序设计、JAVA程序设计、PYTHON程序设计语言、数据库原理及应用、网页设计基础等等。
GPA：3.53/4
荣誉奖项：第16届中国大学生服务外包创新创业大赛全国赛企业命题类三等奖
项目/实践经历
2025.3—至今        校外兼职        约拍摄影、学生剧组演员
2025—2026学年        暑期“三下乡”        摄影、视频后期制作
负责整个活动过程中的拍摄以及活动结束后的视频剪辑、推文投稿，并在学院公众号、视频号等发表推文和视频。最高至国家级媒体。
2025.6.11—2025.7.11        应用软件设计实习        前端
软件前端编写采用VUE实现，成果汇报展示中所在团队获得项目最高分。
2024—2025学年        暑期“三下乡”        摄影、视频后期制作
2025.6        第16届中国大学生服务外包创新创业大赛        前端
基于OPENHARMONY编写前端并与成员相互协作完成项目文档的撰写。
2024        第15届中国大学生服务外包创新创业大赛        前端
前端编写采用HTML、CSS和JAVASCRIPT实现并与成员相互协作完成项目文档的撰写。还负责项目成品展示视频的制作。
2023—2024学年        天津工业大学软件学院公众号        推文排版、视频剪辑
累计发表推文、视频20+，宣传各类学院活动，收获不错的浏览及点赞量。
校园经历
2025.3 至今    软件学院向阳工作室总负责人
2024.9 至今    天津工业大学软件学院2301班团支书
2024-2025学年    天津工业大学软件学院团委宣传部部长
2023-2024学年    天津工业大学软件学院团委宣传部部员
个人技能
语言：英语CET-4
计算机：达芬奇、剪映、ADOBE PHOTOSHOP
摄影：熟练掌握相机的使用，能独自完成视频拍摄与剪辑工作"""


@pytest.fixture(scope="module")
def sample_result():
    return parse_profile_text(SAMPLE_RESUME_TEXT)


def test_date_range_recognizes_space_before_ongoing_and_school_year():
    """``2025.3 至今``（空格 + 至今）与 ``2024—2025学年`` 都要能抽出日期范围。"""
    assert _DATE_RANGE_RE.search("2025.3 至今    软件学院向阳工作室总负责人")
    assert _DATE_RANGE_RE.search("2024.9 至今    天津工业大学软件学院2301班团支书")
    match = _DATE_RANGE_RE.search("2024—2025学年    天津工业大学软件学院团委宣传部部长")
    assert match is not None
    assert match.group("start") == "2024"
    assert match.group("end") == "2025"


def test_normalize_partial_date_covers_the_sample_date_shapes():
    """样本里出现的日期写法都要规范成 PartialDateSelect 认的 canonical 形态。"""
    assert normalize_partial_date("2025.3") == "2025-03"
    assert normalize_partial_date("2025.6") == "2025-06"
    assert normalize_partial_date("2025.6.11") == "2025-06-11"
    assert normalize_partial_date("2025.7.11") == "2025-07-11"
    assert normalize_partial_date("2023") == "2023"
    assert normalize_partial_date("2024") == "2024"
    assert normalize_partial_date("至今") == "至今"


def test_sample_extracts_basic_identity(sample_result):
    """姓名/电话/邮箱正确；年龄不可靠，不换算出生年份（留空即可）。"""
    assert sample_result.name == "林晓样"
    assert sample_result.phone == "13800001234"
    assert sample_result.email == "linxiaoyang@example.com"
    assert sample_result.birth_year == ""


def test_sample_extracts_one_education_with_gpa_and_awards(sample_result):
    """教育 1 条：学校/专业/学历/日期正确，GPA 与分区内的荣誉奖项落到对应字段。"""
    assert len(sample_result.educations) == 1
    education = sample_result.educations[0]
    assert education.school == "天津工业大学"
    assert education.major == "软件工程"
    assert education.degree == "本科"
    assert education.start_date == "2023"
    assert education.end_date == "至今"
    assert education.gpa == "3.53/4"
    assert "C语言程序设计" in education.courses
    assert "第16届中国大学生服务外包创新创业大赛" in education.achievements


def test_sample_extracts_date_leading_project_entries(sample_result):
    """「项目/实践经历」分区按日期开头拆条目：≥4 条、日期规范化、描述归位。"""
    projects = sample_result.projects
    assert len(projects) >= 4

    names = [project.name for project in projects]
    assert "校外兼职" in names
    assert "应用软件设计实习" in names
    # 同名「暑期“三下乡”」出现两次（2025—2026 与 2024—2025），各自独立成条，
    # 无描述的那条**不吞并**下一条日期行。
    assert names.count("暑期“三下乡”") == 2
    contest = [project for project in projects if "服务外包创新创业大赛" in project.name]
    assert len(contest) == 2

    practice = next(project for project in projects if project.start_date == "2025-06-11")
    assert practice.end_date == "2025-07-11"
    assert practice.role == "前端"
    assert "VUE" in practice.description

    with_description = next(
        project
        for project in projects
        if project.start_date == "2025" and project.end_date == "2026"
    )
    assert "负责整个活动过程中的拍摄" in with_description.description
    part_time = next(project for project in projects if project.name == "校外兼职")
    assert part_time.role == "约拍摄影、学生剧组演员"
    assert part_time.description == ""
    part_time_dates = [project for project in projects if project.name == "暑期“三下乡”"]
    assert {project.end_date for project in part_time_dates} == {"2026", "2025"}


def test_sample_extracts_campus_entries_with_roles(sample_result):
    """「校园经历」4 条，角色从单列头部的尾部职责词里拆出来。"""
    campus = sample_result.campus_experiences
    assert len(campus) == 4
    assert {item.role for item in campus} == {"总负责人", "团支书", "部长", "部员"}
    assert any(item.organization == "软件学院向阳工作室" for item in campus)
    assert any(item.start_date == "2023" and item.end_date == "2024" for item in campus)


def test_sample_extracts_categorized_skills(sample_result):
    """「语言/计算机/摄影」分类行拆成逐条技能；长句整条保留并带上等级。"""
    skills = sample_result.skills
    names = {skill.name for skill in skills}
    assert {"英语CET-4", "达芬奇", "剪映", "ADOBE PHOTOSHOP"} <= names
    long_skill = next(skill for skill in skills if skill.name.startswith("相机的使用"))
    assert long_skill.level == "熟练掌握"
    assert "视频拍摄与剪辑" in long_skill.name


def test_sample_has_no_unrecognized_section_warning(sample_result):
    assert not any("未识别到" in warning for warning in sample_result.warnings)
