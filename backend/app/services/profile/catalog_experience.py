# SPDX-License-Identifier: Apache-2.0
"""资料大字段定义目录数据：分区 3-8（实习/工作、项目、技能、校园、荣誉、总结）。

**纯数据**：字段顺序即展示顺序；枚举建议只是录入提示（需求 §3.3：不校验、不拒绝
枚举外的值），因此它属于数据而不是校验规则。行格式见 catalog_basic.py 模块说明。

承载区：本文件里所有自由文本承载区都是"该条目的标签值追加位置"（R-42），
basic_info/patents/languages 三行"仅素材"不在这里。
"""

from __future__ import annotations

SECTION_ROWS = (
    (
        "experiences",
        "实习/工作经历",
        "multi",
        "description",
        False,
        ("practice",),
        (
            ("company", "公司/机构", "s", False, ()),
            ("title", "职位/角色", "s", False, ()),
            ("start_date", "开始时间", "d", False, ()),
            ("end_date", "结束时间", "d", False, ()),
            ("description", "工作内容", "m", False, ()),
            ("team_size", "团队规模", "s", False, ()),
            (
                "work_type",
                "工作类型",
                "s",
                True,
                ("全职", "实习", "兼职", "志愿服务", "社会实践"),
            ),
        ),
    ),
    (
        "projects",
        "项目经历",
        "multi",
        "description",
        False,
        ("work_project",),
        (
            ("name", "项目名称", "s", False, ()),
            ("role", "角色", "s", False, ()),
            ("start_date", "开始时间", "d", False, ()),
            ("end_date", "结束时间", "d", False, ()),
            ("tech_stack", "技术栈", "s", False, ()),
            ("description", "项目描述", "m", False, ()),
            ("highlights", "亮点", "m", False, ()),
            ("project_size", "项目规模", "s", False, ()),
            ("public_url", "公开链接", "s", True, ()),
            (
                "outcome_type",
                "成果类型",
                "s",
                True,
                ("个人项目", "团队项目", "课程项目", "开源项目", "作品集"),
            ),
        ),
    ),
    (
        "skills",
        "专业技能",
        "multi",
        "level",
        False,
        (),
        (
            ("name", "技能名称", "s", False, ()),
            ("level", "熟练度", "s", False, ("精通", "熟练", "掌握", "了解")),
            (
                "category",
                "技能分类",
                "s",
                False,
                ("编程语言", "框架与库", "工具与平台", "软技能", "其他"),
            ),
        ),
    ),
    (
        "campus_experiences",
        "校园经历",
        "multi",
        "description",
        False,
        (),
        (
            ("organization", "组织", "s", False, ()),
            ("role", "角色", "s", False, ()),
            ("start_date", "开始时间", "d", False, ()),
            ("end_date", "结束时间", "d", False, ()),
            ("description", "经历描述", "m", False, ()),
            (
                "activity_type",
                "活动类型",
                "s",
                False,
                ("学生会", "社团", "志愿服务", "社会实践", "竞赛", "其他"),
            ),
        ),
    ),
    (
        "awards",
        "荣誉奖项",
        "multi",
        "description",
        False,
        ("award",),
        (
            ("title", "奖项名称", "s", False, ()),
            ("awarded_at", "获奖时间", "d", False, ()),
            ("description", "奖项说明", "m", False, ()),
            ("issuer", "颁发机构", "s", False, ()),
            (
                "level",
                "奖项级别",
                "s",
                False,
                ("国家级", "省级", "市级", "校级", "院级", "其他"),
            ),
            ("award_ratio", "获奖比例", "s", False, ()),
        ),
    ),
    (
        "summary",
        "个人总结/自我评价",
        "singleton",
        "content",
        False,
        (),
        (("content", "正文", "m", False, ()),),
    ),
)


# §3.2 审计标记：本篇分区新增 8 个字段；工作类型是改名字段；教育/技能移除 5 个旧字段。
NEW_FIELD_IDS = (
    "educations.rank",
    "educations.advisor",
    "educations.research_direction",
    "experiences.team_size",
    "projects.project_size",
    "skills.category",
    "campus_experiences.activity_type",
    "awards.award_ratio",
)
RENAMED_FIELD_LABELS = (("experiences.work_type", "关系类型"),)
REMOVED_FIELD_LABELS = (
    ("educations", "CET4"),
    ("educations", "CET6"),
    ("skills", "证书"),
    ("skills", "成绩"),
    ("skills", "取得时间"),
)
