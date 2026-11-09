# SPDX-License-Identifier: Apache-2.0
"""网申资料：字段值、可重复分组、填表历史与地址栏历史。

「网申资料」一屏由三部分组成，这里对应写三份：

1. ``extra_profile.save_entries`` —— 单个字段（籍贯、家庭、证书、健康等）。只写
   ``source=extra`` 的键：从资料里派生的键（姓名/学校/经历…）由 ``expand_form_data``
   实时合成，写进来反而会遮住资料页的更新。
2. ``repeated_profile.save_groups`` —— 可新增多条的补充资料（教育/实习/项目/奖项…）。
3. ``web_form_fill_record`` —— 「填过哪些页面、填成什么样」的历史；列表只读计数字段，
   详情才展开 items / page_snapshot，所以两者必须一起来。

人设：2027 届计算机本科（南京理工大学），投的是后端 / AI Agent 校招岗。
"""

from __future__ import annotations

from datetime import timedelta

from app.database import SessionLocal
from app.services.webform import extra_profile, repeated_profile

from dataset_seed.base import NOW, ins, row

# 只放 source=extra 的键（打开 /api/webform/fields 能看到哪些是 extra）。证件号码故意留空：
# 那是一串真的可能属于某个人的号码，数据里不该凭空造一个。
EXTRA_VALUES = {
    "birth_date": "2005-03-14",
    "country_region": "中国大陆",
    "native_place": "江苏南通",
    "political_status": "共青团员",
    "id_type": "居民身份证",
    "phone_country_code": "+86",
    "advisor": "周敏华",
    "research_direction": "检索增强生成与 Agent 可靠性评测",
    "preferred_industry": "互联网 / 企业服务 / AI 应用",
    "salary": "18-25K·14 薪",
    "family_info": "父母均在江苏南通在职，家庭无负担；可接受上海、杭州异地工作。",
    "student_id": "2023210467",
    "training_mode": "统招",
    "school_system": "4 年",
    "rank_total": "126",
    "rank_position": "9",
    "second_major": "人工智能（微专业）",
    "archives_location": "南京理工大学 计算机科学与工程学院 教务办",
    "dispatch_unit": "南京理工大学",
    "language_other": "英语 CET-6（561）；IELTS 6.5",
    "computer_cert": "全国计算机等级考试二级（Python）；软件设计师（软考中级）",
    "professional_cert": "华为认证 AI 工程师（HCIA-AI）",
    "emergency_contact_name": "沈建国",
    "emergency_contact_relation": "父亲",
    "emergency_contact_phone": "138 6287 4051",
    "father_name": "沈建国",
    "father_workplace": "南通港集团",
    "mother_name": "朱亚萍",
    "mother_workplace": "南通市崇川区实验小学",
    "home_address": "江苏省南通市崇川区文峰街道濠南路 88 号 6 幢 201 室",
    "home_postcode": "226001",
    "height": "176",
    "weight": "68",
    "eyesight": "双眼 5.0",
    "medical_history": "无",
    "available_date": "2027-07-01",
    "expected_annual_salary": "25-35 万",
    "recruit_source": "BOSS直聘 / 内推",
    "referral_code": "SY2027-3172",
    "specialty": "接口性能优化与 Agent 评测",
    "hobbies": "长跑（半马 1:48）、羽毛球、折腾自建服务",
    "former_name": "无",
    "age": "21",
    "ethnicity": "汉族",
    "marital_status": "未婚",
    "registered_residence": "江苏省南通市崇川区",
    "student_origin": "江苏南通",
    "mailing_address": "江苏省南京市玄武区孝陵卫 200 号 南京理工大学 计算机科学与工程学院 2023 级",
    "mailing_postcode": "210094",
    "health_status": "良好",
    "shoe_size": "265（43 码）",
    "disadvantaged_student": "是",
    "accept_assignment": "服从调剂",
    "referral_method": "员工内推",
    "interview_city": "上海",
    "written_test_city": "南京",
    "graduation_cohort": "2027 届",
    "failed_course_count": "0",
    "github_star_count": "186",
    "portfolio_showcase": "https://shenyizhou.github.io/portfolio",
}

REPEATED = {
    "education": [
        {
            "values": {
                "education_class_rank": "2/32",
                "education_major_rank": "9",
                "education_rank_total": "126",
                "education_gpa_scale": "4.0",
                "education_school_location": "江苏省南京市玄武区",
                "education_campus": "孝陵卫校区",
                "education_special_notes": "大三下起在实验室做横向项目，课程与实习并行。",
                "education_qualification_type": "全日制本科",
                "education_laboratory": "智能软件实验室",
            }
        }
    ],
    "experience": [
        {
            "values": {
                "experience_department": "交易中台组",
                "experience_work_type": "实习",
                "experience_location": "杭州·余杭区",
                "experience_industry": "互联网 / 电商交易",
                "experience_company_type": "民营企业",
                "experience_annual_salary": "6 万（实习折算）",
                "experience_min_expected_annual_salary": "20 万",
                "experience_max_expected_annual_salary": "28 万",
                "experience_achievements": (
                    "订单详情 P95 380 ms→95 ms；慢查询日均 2.3 万→900 条；对账导出 42 s→6 s。"
                ),
                "experience_leave_reason": "实习期结束返校上课；组里希望我毕业后再回去。",
            }
        }
    ],
    "project": [
        {
            "values": {
                "project_link": "https://github.com/yizhou-shen/agent-workbench",
                "project_additional_notes": "项目代码与评测集已归档，可提供本地演示环境。",
            }
        }
    ],
    "campus": [
        {
            "values": {
                "campus_practice_name": "南京理工大学 ACM-ICPC 集训队",
                "campus_location": "南京·玄武区",
                "campus_additional_notes": "两年 180 余场训练赛，主讲图论与动态规划 8 次。",
            }
        }
    ],
    "academic": [
        {
            "values": {
                "academic_paper_name": "基于工具调用轨迹的轻量 Agent 失败归因方法",
                "academic_publication": "江苏省计算机学会学术年会 · 学生论文专场（JSCS 2025）",
                "academic_journal_level": "会议论文",
                "academic_author_order": "第二作者",
                "academic_impact_factor": "无",
                "academic_link": "",
            }
        }
    ],
    "award": [
        {
            "values": {
                "award_scholarship_name": "国家励志奖学金",
                "award_scholarship_level": "国家级",
                "award_scholarship_date": "2025-10",
            }
        },
        {
            "values": {
                "award_competition": "中国大学生程序设计竞赛（CCPC）",
                "award_level": "江苏省赛银奖",
                "award_rank": "三人队（负责图论与 DP）",
            }
        },
    ],
    "language": [
        {
            "values": {
                "language_name": "英语",
                "language_level": "熟练",
                "language_speaking": "可英文面试与日常沟通",
                "language_reading": "可读英文技术文档与论文",
                "language_study_experience": "课程与论文以英文材料为主，无海外经历。",
            }
        },
        {
            "values": {
                "language_name": "英语",
                "language_level": "熟练",
                "language_speaking": "雅思口语 6.0，可做技术方向的口头交流",
                "language_reading": "可读 RFC 与框架源码注释",
            }
        },
    ],
    "certificate": [
        {
            "values": {
                "certificate_name": "CET-6",
                "certificate_type": "语言证书",
                "certificate_score": "561",
                "certificate_issue_date": "2025-06",
                "certificate_exam_type": "CET-6",
                "certificate_exam_score": "561",
                "certificate_obtained_date": "2025-06",
            }
        },
        {
            "values": {
                "certificate_name": "软件设计师（软考中级）",
                "certificate_type": "职业资格",
                "certificate_level": "中级",
                "certificate_issue_date": "2026-05",
                "certificate_expiry_date": "",
            }
        },
    ],
    "skill": [
        {
            "values": {"skill_name": "Python", "skill_category": "编程语言", "skill_mastery": "熟练"}
        },
        {
            "values": {"skill_name": "FastAPI", "skill_category": "框架与库", "skill_mastery": "熟练"}
        },
        {
            "values": {
                "skill_name": "PostgreSQL",
                "skill_category": "工具与平台",
                "skill_mastery": "熟练",
                "skill_other": "Redis、Docker、Git 均可日常使用。",
            }
        },
    ],
    "emergency_contact": [
        {
            "values": {
                "contact_name": "沈建国",
                "contact_relation": "父亲",
                "contact_phone": "138 6287 4051",
            }
        }
    ],
    "portfolio": [
        {
            "values": {
                "portfolio_name": "求职场景 LLM Agent 工作台",
                "portfolio_link": "https://github.com/yizhou-shen/agent-workbench",
                "portfolio_blog_name": "沈亦舟的技术博客",
                "portfolio_blog_link": "https://shenyizhou.github.io/posts",
            }
        }
    ],
    "social": [
        {
            "values": {
                "social_platform": "掘金",
                "social_account": "shenyizhou",
                "social_link": "https://juejin.cn/user/shenyizhou",
            }
        }
    ],
}

# 填表历史：列表只显示计数，详情才展开 items；两段必须自洽（计数 = items 里各类的条数）。
FILL_RECORDS = [
    {
        "url": "https://campus.xihe-ai.com/apply/step-2",
        "page_title": "校园招聘 · 简历填写（第 2 步）",
        "source": "batch",
        "items": [
            {
                "index": 0,
                "field": "name",
                "field_label": "姓名",
                "control_label": "请填写姓名",
                "value": "沈亦舟",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 1,
                "field": "phone",
                "field_label": "手机号",
                "control_label": "联系电话",
                "value": "139 0176 4428",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 2,
                "field": "email",
                "field_label": "邮箱",
                "control_label": "常用邮箱",
                "value": "shen.yizhou@foxmail.com",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 3,
                "field": "school",
                "field_label": "学校",
                "control_label": "毕业院校",
                "value": "南京理工大学",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 4,
                "field": "cet6_score",
                "field_label": "英语六级分数",
                "control_label": "六级成绩",
                "value": "561",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 5,
                "field": "home_address",
                "field_label": "家庭住址",
                "control_label": "现居住地址",
                "value": "江苏省南通市崇川区文峰街道濠南路 88 号 6 幢 201 室",
                "status": "unverified",
                "detail": "页面是三级联动下拉，写入后没回读校验，需要人工核对。",
                "source": "extra",
            },
            {
                "index": 6,
                "field": "id_number",
                "field_label": "证件号码",
                "control_label": "身份证号",
                "value": "",
                "status": "failed",
                "detail": "证件号码留空，未填写。",
                "source": "extra",
            },
            {
                "index": 7,
                "field": "expected_annual_salary",
                "field_label": "期望年薪",
                "control_label": "期望年薪（万元）",
                "value": "25-35 万",
                "status": "unverified",
                "detail": "控件只接受数字，范围写法需要人工改成 30。",
                "source": "extra",
            },
        ],
        "page_snapshot": [
            {"index": 0, "label": "请填写姓名", "value": "沈亦舟", "filled": True},
            {"index": 1, "label": "联系电话", "value": "139 0176 4428", "filled": True},
            {"index": 2, "label": "常用邮箱", "value": "shen.yizhou@foxmail.com", "filled": True},
            {"index": 3, "label": "毕业院校", "value": "南京理工大学", "filled": True},
            {"index": 4, "label": "六级成绩", "value": "561", "filled": True},
            {
                "index": 5,
                "label": "现居住地址",
                "value": "江苏省南通市崇川区文峰街道濠南路 88 号 6 幢 201 室",
                "filled": True,
            },
            {"index": 6, "label": "身份证号", "value": "", "filled": False},
            {"index": 7, "label": "期望年薪（万元）", "value": "25-35 万", "filled": True},
        ],
        "days_ago": 2,
    },
    {
        "url": "https://careers.shuyun-tech.com/workday/job/REQ-88213/apply",
        "page_title": "Careers · Application for Backend Engineer",
        "source": "live",
        "items": [
            {
                "index": 0,
                "field": "name",
                "field_label": "姓名",
                "control_label": "Full Name",
                "value": "Yizhou Shen",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 1,
                "field": "email",
                "field_label": "邮箱",
                "control_label": "Email Address",
                "value": "shen.yizhou@foxmail.com",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 2,
                "field": "phone",
                "field_label": "手机号",
                "control_label": "Mobile Phone",
                "value": "139 0176 4428",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 3,
                "field": "salary",
                "field_label": "期望薪资",
                "control_label": "Expected Salary (CNY/month)",
                "value": "18-25K·14 薪",
                "status": "failed",
                "detail": "控件要求纯数字，范围与「·14 薪」无法直接写入。",
                "source": "extra",
            },
            {
                "index": 4,
                "field": "work_authorization",
                "field_label": "工作许可",
                "control_label": "Are you legally authorized to work in China?",
                "value": "",
                "status": "failed",
                "detail": "页面上的单选组不在字段目录里，未尝试写入。",
                "source": "",
            },
        ],
        "page_snapshot": [
            {"index": 0, "label": "Full Name", "value": "Yizhou Shen", "filled": True},
            {
                "index": 1,
                "label": "Email Address",
                "value": "shen.yizhou@foxmail.com",
                "filled": True,
            },
            {"index": 2, "label": "Mobile Phone", "value": "139 0176 4428", "filled": True},
            {"index": 3, "label": "Expected Salary (CNY/month)", "value": "", "filled": False},
            {
                "index": 4,
                "label": "Are you legally authorized to work in China?",
                "value": "",
                "filled": False,
            },
        ],
        "days_ago": 6,
    },
    {
        "url": "https://campus.zhipin.com/apply?position=backend",
        "page_title": "校园招聘 · 投递信息",
        "source": "batch",
        "items": [
            {
                "index": 0,
                "field": "name",
                "field_label": "姓名",
                "control_label": "姓名",
                "value": "沈亦舟",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 1,
                "field": "school",
                "field_label": "学校",
                "control_label": "学校名称",
                "value": "南京理工大学",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 2,
                "field": "major",
                "field_label": "专业",
                "control_label": "专业名称",
                "value": "计算机科学与技术",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 3,
                "field": "degree",
                "field_label": "学历",
                "control_label": "最高学历",
                "value": "本科",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 4,
                "field": "education_start",
                "field_label": "入学时间",
                "control_label": "入学时间",
                "value": "2023-09",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
        ],
        "page_snapshot": [
            {"index": 0, "label": "姓名", "value": "沈亦舟", "filled": True},
            {"index": 1, "label": "学校名称", "value": "南京理工大学", "filled": True},
            {"index": 2, "label": "专业名称", "value": "计算机科学与技术", "filled": True},
            {"index": 3, "label": "最高学历", "value": "本科", "filled": True},
            {"index": 4, "label": "入学时间", "value": "2023-09", "filled": True},
        ],
        "days_ago": 13,
    },
]

URL_HISTORY = [
    ("https://campus.xihe-ai.com/apply/step-2", "校园招聘 · 简历填写（第 2 步）", 2),
    ("https://careers.shuyun-tech.com/workday/job/REQ-88213/apply", "Careers · Backend Engineer", 6),
    ("https://campus.zhipin.com/apply?position=backend", "校园招聘 · 投递信息", 13),
    ("https://campus.zhaopin.com/job/backend-2027/apply", "校园招聘 · 在线申请", 20),
]


def _counts(items: list[dict]) -> tuple[int, int, int]:
    filled = sum(1 for item in items if item["status"] == "filled")
    unverified = sum(1 for item in items if item["status"] == "unverified")
    failed = sum(1 for item in items if item["status"] in ("failed", "skipped", "conflict"))
    return filled, unverified, failed


def seed() -> None:
    """写网申资料：单字段、可重复分组、填表历史、地址栏历史。"""
    with SessionLocal() as db:
        extra_profile.save_entries(db, EXTRA_VALUES, commit=False)
        repeated_profile.save_groups(db, REPEATED, commit=False)
        db.commit()

    records = []
    for item in FILL_RECORDS:
        filled, unverified, failed = _counts(item["items"])
        created = NOW - timedelta(days=item["days_ago"])
        records.append(
            row(
                url=item["url"],
                page_title=item["page_title"],
                items=item["items"],
                filled=filled,
                unverified=unverified,
                failed=failed,
                page_snapshot=item["page_snapshot"],
                source=item["source"],
                created_at=created,
                updated_at=created,
                deleted_at=None,
            )
        )
    ins("web_form_fill_record", records)

    ins(
        "web_form_url_history",
        [
            row(
                url=url,
                title=title,
                created_at=NOW - timedelta(days=days),
                last_used_at=NOW - timedelta(days=days - 1),
            )
            for url, title, days in URL_HISTORY
        ],
    )
