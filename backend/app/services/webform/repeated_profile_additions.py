"""网申清单中需要按条新增的经历、作品与账号字段。

资料页中已有的简历经历是第一来源；这些字段允许补记仅用于网申的记录。
附件字段只记录说明，文件须由用户在招聘网站手动上传。
"""

# key、界面名称、控件类型、是否包含敏感信息。
FieldSpec = tuple[str, str, str, bool]

GROUP_FIELD_ADDITIONS: dict[str, tuple[FieldSpec, ...]] = {
    "education": (
        ("school", "学校名称（仅网申独有时填写）", "text", False),
        ("major", "专业名称（仅网申独有时填写）", "text", False),
        ("degree", "学历层次（仅网申独有时填写）", "text", False),
        ("education_expected_graduation", "预计毕业时间", "date", False),
        ("education_qualification_type", "学历类型", "text", False),
        ("education_laboratory", "实验室", "text", False),
    ),
    "experience": (
        ("experience_company", "单位名称（仅网申独有时填写）", "text", False),
        ("experience_role", "职位名称（仅网申独有时填写）", "text", False),
        ("experience_start", "开始时间（仅网申独有时填写）", "date", False),
        ("experience_end", "结束时间（仅网申独有时填写）", "date", False),
    ),
    "project": (
        ("project_name", "项目名称（仅网申独有时填写）", "text", False),
        ("project_role", "项目角色（仅网申独有时填写）", "text", False),
        ("project_content", "项目内容补充", "longtext", False),
    ),
    "campus": (
        ("campus_organization", "校园组织（仅网申独有时填写）", "text", False),
        ("campus_role", "担任职位（仅网申独有时填写）", "text", False),
    ),
    "academic": (
        ("academic_attachment_note", "论文附件说明（需手动上传）", "longtext", False),
    ),
    "award": (
        ("award_name", "奖项名称（仅网申独有时填写）", "text", False),
        ("award_date", "获奖时间（仅网申独有时填写）", "date", False),
    ),
    "skill": (
        ("skill_name", "技能名称", "text", False),
    ),
}

# 一件作品或一个社交平台对应一条，可由用户按需要新增多条。
ADDITIONAL_GROUPS: tuple[tuple[str, str, str, tuple[FieldSpec, ...]], ...] = (
    (
        "portfolio", "作品和附件", "portfolio",
        (
            ("portfolio_name", "作品名称", "text", False),
            ("portfolio_link", "作品链接", "text", False),
            ("portfolio_blog_name", "在线作品或博客名称", "text", False),
            ("portfolio_blog_link", "在线作品或博客链接", "text", False),
            ("portfolio_attachment_note", "作品附件说明（需手动上传）", "longtext", False),
        ),
    ),
    (
        "social", "社交账号", "social",
        (
            ("social_platform", "社交平台", "text", False),
            ("social_account", "社交账号", "text", False),
            ("social_link", "社交链接", "text", False),
        ),
    ),
)

ADDITIONAL_SYNONYMS: dict[str, tuple[str, ...]] = {
    "education_expected_graduation": ("预计毕业时间", "预计毕业年月"),
    "education_qualification_type": ("学历类型", "教育类型"),
    "education_laboratory": ("实验室", "所属实验室"),
    "project_content": ("项目内容", "项目职责补充"),
    "academic_attachment_note": ("论文附件说明",),
    "skill_name": ("技能名称", "IT技能名称"),
    "portfolio_name": ("作品名称", "作品集名称"),
    "portfolio_link": ("作品链接", "作品集链接", "作品网址"),
    "portfolio_blog_name": ("在线作品名称", "博客名称"),
    "portfolio_blog_link": ("在线作品链接", "博客链接"),
    "portfolio_attachment_note": ("作品附件说明",),
    "social_platform": ("社交平台", "社交媒体平台"),
    "social_account": ("社交账号", "社交平台账号"),
    "social_link": ("社交链接", "社交主页网址"),
}
