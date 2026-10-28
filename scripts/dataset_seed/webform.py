# SPDX-License-Identifier: Apache-2.0
"""网申资料：字段值、可重复分组、填表历史与地址栏历史。

「网申资料」一屏由三部分组成，这里对应写三份：

1. ``extra_profile.save_entries`` —— 单个字段（籍贯、家庭、证书、健康等）。只写
   ``source=extra`` 的键：从资料里派生的键（姓名/学校/经历…）由 ``expand_form_data``
   实时合成，写进来反而会遮住资料页的更新。
2. ``repeated_profile.save_groups`` —— 可新增多条的补充资料（教育/实习/项目/奖项…）。
3. ``web_form_fill_record`` —— 「填过哪些页面、填成什么样」的历史；列表只读计数字段，
   详情才展开 items / page_snapshot，所以两者必须一起来。
"""

from __future__ import annotations

from datetime import timedelta

from app.database import SessionLocal
from app.services.webform import extra_profile, repeated_profile

from dataset_seed.base import NOW, ins, row

# 只放 source=extra 的键（打开 /api/webform/fields 能看到哪些是 extra）。证件号码故意留空：
# 那是一串真的可能属于某个人的号码，测试数据不该凭空造一个。
EXTRA_VALUES = {
    "birth_date": "1998-11-07",
    "country_region": "中国大陆",
    "native_place": "浙江宁波",
    "political_status": "群众",
    "id_type": "居民身份证",
    "phone_country_code": "+86",
    "advisor": "周敏华",
    "research_direction": "用户行为建模与因果推断",
    "preferred_industry": "互联网 / 消费零售 / 企业服务",
    "salary": "25-35K·14 薪",
    "family_info": "父母均在宁波在职，家庭无负担；可接受异地派驻，也能配合短期出差。",
    "student_id": "2021210418",
    "training_mode": "统招",
    "school_system": "2.5 年",
    "rank_total": "48",
    "rank_position": "6",
    "second_major": "无",
    "archives_location": "上海市杨浦区人才服务中心",
    "dispatch_unit": "上海财经大学",
    "language_other": "日语 JLPT N2（112/180）；英语 IELTS 7.0",
    "computer_cert": "全国计算机等级考试二级（Python）",
    "professional_cert": "阿里云数据分析师 ACP；Google Analytics 4 认证",
    "emergency_contact_name": "林建国",
    "emergency_contact_relation": "父亲",
    "emergency_contact_phone": "137 0584 2210",
    "father_name": "林建国",
    "father_workplace": "宁波港务集团",
    "mother_name": "王亚萍",
    "mother_workplace": "宁波市鄞州区实验小学",
    "home_address": "浙江省宁波市鄞州区中河街道春江花月 12 幢 302 室",
    "home_postcode": "315100",
    "height": "165",
    "weight": "52",
    "eyesight": "双眼 5.0",
    "medical_history": "无",
    "available_date": "2026-11-15",
    "expected_annual_salary": "35-45 万",
    "recruit_source": "BOSS直聘 / 内推",
    "referral_code": "GX2026-8842",
    "specialty": "数据可视化与长文写作",
    "hobbies": "长跑（半马 1:52）、手冲咖啡、城市徒步",
    "former_name": "无",
    "age": "27",
    "ethnicity": "汉族",
    "marital_status": "未婚",
    "registered_residence": "浙江省宁波市鄞州区",
    "student_origin": "浙江宁波",
    "mailing_address": "上海市杨浦区国定路 777 号 上海财经大学 2021 级应用统计硕士",
    "mailing_postcode": "200433",
    "health_status": "良好",
    "shoe_size": "235（37 码）",
    "disadvantaged_student": "否",
    "accept_assignment": "服从调剂",
    "referral_method": "员工内推",
    "interview_city": "上海",
    "written_test_city": "上海",
    "graduation_cohort": "2023 届",
    "failed_course_count": "0",
    "github_star_count": "12",
    "portfolio_showcase": "https://zhiyao.example.com/portfolio",
}

REPEATED = {
    "education": [
        {
            "values": {
                "education_class_rank": "3/32",
                "education_major_rank": "6",
                "education_rank_total": "48",
                "education_gpa_scale": "4.0",
                "education_school_location": "上海市杨浦区",
                "education_campus": "国定路校区",
                "education_special_notes": "研二赴企业做横向课题，毕业论文因此延期半年答辩。",
                "education_qualification_type": "全日制专业学位",
                "education_laboratory": "行为与数据实验室",
            }
        }
    ],
    "experience": [
        {
            "values": {
                "experience_department": "增长组",
                "experience_work_type": "全职",
                "experience_location": "上海·徐汇区",
                "experience_industry": "互联网 / 数据服务",
                "experience_company_type": "民营企业",
                "experience_annual_salary": "32 万",
                "experience_min_expected_annual_salary": "35 万",
                "experience_max_expected_annual_salary": "45 万",
                "experience_achievements": (
                    "季度召回率 8.1%→12.4%；新客 7 日留存 31%→38%；获客成本下降 17%。"
                ),
                "experience_leave_reason": "在职，暂无离职；看机会主要为了做更完整的增长闭环。",
            }
        }
    ],
    "project": [
        {
            "values": {
                "project_link": "https://zhiyao.example.com/attribution",
                "project_additional_notes": "项目代码与口径文档已归档，可提供演示环境。",
            }
        }
    ],
    "campus": [
        {
            "values": {
                "campus_practice_name": "上海科技馆志愿服务",
                "campus_location": "上海·浦东新区",
                "campus_additional_notes": "累计 48 小时，负责散客与团队两套讲解词。",
            }
        }
    ],
    "academic": [
        {
            "values": {
                "academic_paper_name": "价格框架对复购意愿的影响：基于眼动实验的证据",
                "academic_publication": "中国营销科学学术年会（JMSAC）",
                "academic_journal_level": "会议论文",
                "academic_author_order": "第二作者",
                "academic_impact_factor": "无",
                "academic_link": "https://example.org/jmsac2022/paper-118",
            }
        }
    ],
    "award": [
        {
            "values": {
                "award_scholarship_name": "国家奖学金",
                "award_scholarship_level": "国家级",
                "award_scholarship_date": "2020-10",
            }
        },
        {
            "values": {
                "award_competition": "全国大学生数学建模竞赛",
                "award_level": "上海赛区三等奖",
                "award_rank": "三人队（负责建模与写作）",
            }
        },
    ],
    "language": [
        {
            "values": {
                "language_name": "英语",
                "language_level": "熟练",
                "language_speaking": "可英文面试与日常沟通",
                "language_reading": "可读英文行业报告与论文",
                "language_study_experience": "课程与论文以英文材料为主，无海外经历。",
            }
        },
        {
            "values": {
                "language_name": "日语",
                "language_level": "日常交流",
                "language_speaking": "可做简单日常交流",
                "language_reading": "可读产品文档",
            }
        },
    ],
    "certificate": [
        {
            "values": {
                "certificate_name": "CET-6",
                "certificate_type": "语言证书",
                "certificate_score": "590",
                "certificate_issue_date": "2019-12",
                "certificate_exam_type": "CET-6",
                "certificate_exam_score": "590",
                "certificate_obtained_date": "2019-12",
            }
        },
        {
            "values": {
                "certificate_name": "阿里云数据分析师 ACP",
                "certificate_type": "职业资格",
                "certificate_level": "ACP",
                "certificate_issue_date": "2023-11",
                "certificate_expiry_date": "2026-11",
            }
        },
    ],
    "skill": [
        {"values": {"skill_name": "SQL", "skill_category": "编程语言", "skill_mastery": "精通"}},
        {"values": {"skill_name": "Python", "skill_category": "编程语言", "skill_mastery": "熟练"}},
        {
            "values": {
                "skill_name": "Tableau",
                "skill_category": "工具与平台",
                "skill_mastery": "熟练",
                "skill_other": "Metabase、Hive、Git 均可日常使用。",
            }
        },
    ],
    "emergency_contact": [
        {
            "values": {
                "contact_name": "林建国",
                "contact_relation": "父亲",
                "contact_phone": "137 0584 2210",
            }
        }
    ],
    "portfolio": [
        {
            "values": {
                "portfolio_name": "多渠道活动归因看板",
                "portfolio_link": "https://zhiyao.example.com/attribution",
                "portfolio_blog_name": "知遥的增长笔记",
                "portfolio_blog_link": "https://zhiyao.example.com/notes",
            }
        }
    ],
    "social": [
        {
            "values": {
                "social_platform": "小红书",
                "social_account": "zhiyao_notes",
                "social_link": "https://example.com/xiaohongshu/zhiyao_notes",
            }
        }
    ],
}

# 填表历史：列表只显示计数，详情才展开 items；两段必须自洽（计数 = items 里各类的条数）。
FILL_RECORDS = [
    {
        "url": "https://join.example.com/campus/application/step-2",
        "page_title": "校园招聘 · 简历填写（第 2 步）",
        "source": "batch",
        "items": [
            {
                "index": 0,
                "field": "name",
                "field_label": "姓名",
                "control_label": "请填写姓名",
                "value": "林知遥",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 1,
                "field": "phone",
                "field_label": "手机号",
                "control_label": "联系电话",
                "value": "138 0173 8891",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 2,
                "field": "email",
                "field_label": "邮箱",
                "control_label": "常用邮箱",
                "value": "lin.zhiyao@example.com",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 3,
                "field": "school",
                "field_label": "学校",
                "control_label": "毕业院校",
                "value": "上海财经大学",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 4,
                "field": "cet6_score",
                "field_label": "英语六级分数",
                "control_label": "六级成绩",
                "value": "590",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 5,
                "field": "home_address",
                "field_label": "家庭住址",
                "control_label": "现居住地址",
                "value": "浙江省宁波市鄞州区中河街道春江花月 12 幢 302 室",
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
                "value": "35-45 万",
                "status": "unverified",
                "detail": "控件只接受数字，范围写法需要人工改成 40。",
                "source": "extra",
            },
        ],
        "page_snapshot": [
            {"index": 0, "label": "请填写姓名", "value": "林知遥", "filled": True},
            {"index": 1, "label": "联系电话", "value": "138 0173 8891", "filled": True},
            {"index": 2, "label": "常用邮箱", "value": "lin.zhiyao@example.com", "filled": True},
            {"index": 3, "label": "毕业院校", "value": "上海财经大学", "filled": True},
            {"index": 4, "label": "六级成绩", "value": "590", "filled": True},
            {
                "index": 5,
                "label": "现居住地址",
                "value": "浙江省宁波市鄞州区中河街道春江花月 12 幢 302 室",
                "filled": True,
            },
            {"index": 6, "label": "身份证号", "value": "", "filled": False},
            {"index": 7, "label": "期望年薪（万元）", "value": "35-45 万", "filled": True},
        ],
        "days_ago": 2,
    },
    {
        "url": "https://careers.example-corp.com/workday/job/REQ-88213/apply",
        "page_title": "Careers · Application for Growth Analyst",
        "source": "live",
        "items": [
            {
                "index": 0,
                "field": "name",
                "field_label": "姓名",
                "control_label": "Full Name",
                "value": "Zhiyao Lin",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 1,
                "field": "email",
                "field_label": "邮箱",
                "control_label": "Email Address",
                "value": "lin.zhiyao@example.com",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 2,
                "field": "phone",
                "field_label": "手机号",
                "control_label": "Mobile Phone",
                "value": "138 0173 8891",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 3,
                "field": "salary",
                "field_label": "期望薪资",
                "control_label": "Expected Salary (CNY/month)",
                "value": "25-35K·14 薪",
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
            {"index": 0, "label": "Full Name", "value": "Zhiyao Lin", "filled": True},
            {
                "index": 1,
                "label": "Email Address",
                "value": "lin.zhiyao@example.com",
                "filled": True,
            },
            {"index": 2, "label": "Mobile Phone", "value": "138 0173 8891", "filled": True},
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
        "url": "https://jobs.example-bytedance.com/school/apply?position=growth",
        "page_title": "校园招聘 · 投递信息",
        "source": "batch",
        "items": [
            {
                "index": 0,
                "field": "name",
                "field_label": "姓名",
                "control_label": "姓名",
                "value": "林知遥",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 1,
                "field": "school",
                "field_label": "学校",
                "control_label": "学校名称",
                "value": "上海财经大学",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 2,
                "field": "major",
                "field_label": "专业",
                "control_label": "专业名称",
                "value": "应用统计",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 3,
                "field": "degree",
                "field_label": "学历",
                "control_label": "最高学历",
                "value": "硕士",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
            {
                "index": 4,
                "field": "education_start",
                "field_label": "入学时间",
                "control_label": "入学时间",
                "value": "2021-09",
                "status": "filled",
                "detail": "",
                "source": "profile",
            },
        ],
        "page_snapshot": [
            {"index": 0, "label": "姓名", "value": "林知遥", "filled": True},
            {"index": 1, "label": "学校名称", "value": "上海财经大学", "filled": True},
            {"index": 2, "label": "专业名称", "value": "应用统计", "filled": True},
            {"index": 3, "label": "最高学历", "value": "硕士", "filled": True},
            {"index": 4, "label": "入学时间", "value": "2021-09", "filled": True},
        ],
        "days_ago": 13,
    },
]

URL_HISTORY = [
    ("https://join.example.com/campus/application/step-2", "校园招聘 · 简历填写（第 2 步）", 2),
    ("https://careers.example-corp.com/workday/job/REQ-88213/apply", "Careers · Growth Analyst", 6),
    ("https://jobs.example-bytedance.com/school/apply?position=growth", "校园招聘 · 投递信息", 13),
    ("https://hr.example-retail.com/apply/entry", "社会招聘 · 在线申请", 20),
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
