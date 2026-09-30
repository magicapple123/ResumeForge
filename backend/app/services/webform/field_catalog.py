"""网申单值字段目录。匹配词与排除规则分别位于 field_synonyms / field_matching_rules。

可重复网申补充记录单独定义在 repeated_profile_catalog；原有导入出口是 fields。
"""

from __future__ import annotations

from .repeated_profile_catalog import REPEATED_FIELD_LABELS
from .field_supplement_catalog import SUPPLEMENT_FIELDS
from .field_types import (
    FormField,
    GROUP_CONTACT,
    GROUP_EDUCATION,
    GROUP_EXTRA_FAMILY,
    GROUP_EXTRA_HEALTH,
    GROUP_EXTRA_INTENT,
    GROUP_EXTRA_LANGUAGE,
    GROUP_EXTRA_MISC,
    GROUP_EXTRA_PARTY,
    GROUP_EXTRA_SCHOOL,
    GROUP_IDENTITY,
    GROUP_OTHER,
    SOURCE_EXTRA,
    SOURCE_PROFILE as SOURCE_PROFILE,
)

# 能填的字段。顺序即前端分区内的展示顺序。
FORM_FIELDS: tuple[FormField, ...] = (
    # ===== 身份信息 =====
    FormField("name", "姓名", GROUP_IDENTITY),
    FormField("gender", "性别", GROUP_IDENTITY, kind="select", options=("男", "女", "其他")),
    FormField(
        "birth_date", "出生日期", GROUP_IDENTITY, kind="date", sensitive=True, source=SOURCE_EXTRA
    ),
    FormField("birth_year", "出生年份", GROUP_IDENTITY),
    FormField(
        "country_region",
        "国家和地区",
        GROUP_IDENTITY,
        kind="select",
        options=("中国大陆", "中国香港", "中国澳门", "中国台湾", "其他"),
        source=SOURCE_EXTRA,
    ),
    FormField("native_place", "籍贯", GROUP_IDENTITY, source=SOURCE_EXTRA),
    FormField(
        "political_status",
        "政治面貌",
        GROUP_IDENTITY,
        kind="select",
        options=("中共党员", "中共预备党员", "共青团员", "群众", "其他"),
        sensitive=True,
        source=SOURCE_EXTRA,
    ),
    FormField(
        "id_type",
        "证件类型",
        GROUP_IDENTITY,
        kind="select",
        options=("居民身份证", "护照", "港澳居民来往内地通行证", "台湾居民来往大陆通行证", "其他"),
        sensitive=True,
        source=SOURCE_EXTRA,
    ),
    FormField("id_number", "证件号码", GROUP_IDENTITY, sensitive=True, source=SOURCE_EXTRA),
    # ===== 联系方式 =====
    FormField("phone", "手机号", GROUP_CONTACT, kind="tel"),
    FormField("phone_country_code", "手机区号", GROUP_CONTACT, source=SOURCE_EXTRA),
    FormField("email", "邮箱", GROUP_CONTACT, kind="email"),
    FormField("wechat", "微信号", GROUP_CONTACT),
    FormField("qq", "QQ 号", GROUP_CONTACT),
    FormField("city", "当前所处地", GROUP_CONTACT),
    FormField("target_city", "期望工作地点", GROUP_CONTACT),
    # ===== 教育经历（取最高学历那一条）=====
    FormField("school", "学校", GROUP_EDUCATION),
    FormField("department", "院系", GROUP_EDUCATION),
    FormField("advisor", "导师", GROUP_EDUCATION, source=SOURCE_EXTRA),
    FormField("research_direction", "研究方向", GROUP_EDUCATION, source=SOURCE_EXTRA),
    # 实验室与论文：腾讯校招简历页紧挨着导师/研究方向的那两栏（实测快照见
    # ``engine.evidence_key`` 的注释）。**加这两个是因为它们本来就该在目录里**——
    # 它们不是某一家的怪字段，而是"研究生简历"这类页面的常客。认得出 → 走 missing_data
    # （用户知道去补什么）→ 补上之后能自动填，而且不经过"自定义字段"那条降级路径。
    FormField("laboratory", "实验室", GROUP_EDUCATION),
    FormField("paper", "论文", GROUP_EDUCATION),
    FormField("major", "专业", GROUP_EDUCATION),
    FormField("degree", "学历", GROUP_EDUCATION, kind="select", options=("高中", "大专", "本科", "硕士", "博士")),
    FormField("degree_type", "学位", GROUP_EDUCATION, kind="select", options=("学士", "硕士学位", "博士学位", "其他")),
    FormField("study_mode", "学习形式", GROUP_EDUCATION, kind="select", options=("全日制", "非全日制")),
    FormField("education_start", "入学时间", GROUP_EDUCATION, kind="date"),
    FormField("education_end", "毕业时间", GROUP_EDUCATION, kind="date"),
    FormField("gpa", "绩点或排名", GROUP_EDUCATION),
    # 四六级分数录在**教育经历**上（成绩是某段学历期间考出来的），网申表单普遍问具体分数。
    # 取的是最高学历那一条，与上面这些教育字段同源同规则。
    FormField("cet4_score", "英语四级分数", GROUP_EDUCATION),
    FormField("cet6_score", "英语六级分数", GROUP_EDUCATION),
    FormField("courses", "核心课程", GROUP_EDUCATION, kind="longtext"),
    FormField("achievements", "在校成果", GROUP_EDUCATION, kind="longtext"),
    # ===== 其他 =====
    FormField("job_intent", "求职意向", GROUP_OTHER),
    FormField("preferred_industry", "意向行业", GROUP_OTHER, source=SOURCE_EXTRA),
    FormField("salary", "期望薪资", GROUP_OTHER, source=SOURCE_EXTRA),
    FormField("company", "最近实习和工作单位", GROUP_OTHER),
    FormField("job_title", "最近实习和工作职位", GROUP_OTHER),
    FormField("work_start", "实习和工作开始时间", GROUP_OTHER, kind="date"),
    FormField("work_end", "实习和工作结束时间", GROUP_OTHER, kind="date"),
    # ===== 多段经历的兼容字段（值取自资料子表，不在「我的资料」里单独录）=====
    # 网申表单普遍把实习/项目/获奖做成「可添加多条」的区块，每条一组同名控件。
    #
    # 无序号 key 保留给旧页面/旧调用方，严格对应资料列表第 1 条；读取到带序号的页面区块时，
    # 匹配器会使用动态的 experience_2_* / project_3_* 等 key，不能把它们混用。
    # 程序仍不点页面上的「添加」按钮；用户添加新行并重新读取后，才会填入对应序号。
    FormField("experience_company", "实习单位（第一条）", GROUP_OTHER, derived=True),
    FormField("experience_role", "实习职位（第一条）", GROUP_OTHER, derived=True),
    FormField("experience_start", "实习开始（第一条）", GROUP_OTHER, kind="date", derived=True),
    FormField("experience_end", "实习结束（第一条）", GROUP_OTHER, kind="date", derived=True),
    FormField(
        "experience_description", "实习描述（第一条）", GROUP_OTHER, kind="longtext", derived=True
    ),
    FormField("project_name", "项目名称（第一条）", GROUP_OTHER, derived=True),
    FormField("project_role", "项目角色（第一条）", GROUP_OTHER, derived=True),
    FormField("project_start", "项目开始（第一条）", GROUP_OTHER, kind="date", derived=True),
    FormField("project_end", "项目结束（第一条）", GROUP_OTHER, kind="date", derived=True),
    FormField(
        "project_description", "项目描述（第一条）", GROUP_OTHER, kind="longtext", derived=True
    ),
    FormField("project_tech_stack", "项目技术栈（第一条）", GROUP_OTHER, derived=True),
    FormField("project_highlights", "项目成果（第一条）", GROUP_OTHER, kind="longtext", derived=True),
    FormField("campus_organization", "校园组织（第一条）", GROUP_OTHER, derived=True),
    FormField("campus_role", "校园职务（第一条）", GROUP_OTHER, derived=True),
    FormField("campus_start", "校园经历开始（第一条）", GROUP_OTHER, kind="date", derived=True),
    FormField("campus_end", "校园经历结束（第一条）", GROUP_OTHER, kind="date", derived=True),
    FormField("campus_description", "校园经历描述（第一条）", GROUP_OTHER, kind="longtext", derived=True),
    FormField("award_name", "奖项名称（第一条）", GROUP_OTHER, derived=True),
    FormField("award_date", "获奖时间（第一条）", GROUP_OTHER, kind="date", derived=True),
    FormField("award_description", "奖项说明（第一条）", GROUP_OTHER, derived=True),
    FormField("summary", "自我评价", GROUP_OTHER, kind="longtext"),
    FormField(
        "family_info", "家庭信息", GROUP_OTHER, kind="longtext", sensitive=True, source=SOURCE_EXTRA
    ),
    FormField("github", "GitHub", GROUP_OTHER),
    FormField("personal_website", "个人主页", GROUP_OTHER),
    # ===== 「网申资料」专有（source=extra）：简历里没有、网申表单却常问 =====
    #
    # 用户在「我的资料 → 网申资料」里录这些；它们**不参与简历生成**。
    # 收录判据是「**至少两类企业反复问**」——只有个别企业问的定制项不收（否则一屏空框）。
    # 每一条后面注明它在哪类表单上出现，供日后判断该不该留。
    #
    # 为什么不把这些直接加进 ``UserProfile``：那会让简历生成自动带上它们（它读整份资料），
    # 而用户的明确要求是"生成简历模块默认不读这里的信息"。
    #
    # ---- 学籍与档案 ----
    # 学号（校招网申几乎必填，用于核对学籍）；培养方式/学制（国企、事业单位、选调生）；
    # 专业排名（大厂、银行看这个，往往要"名次/总人数"两个数）；档案与报到证（国企、公务员、
    # 事业单位的派遣流程）。这些在简历上**从不出现**，所以只能单独录。
    FormField("student_id", "学号", GROUP_EXTRA_SCHOOL, source=SOURCE_EXTRA),
    FormField("training_mode", "培养方式", GROUP_EXTRA_SCHOOL, kind="select", options=("统招", "定向", "委培", "其他"), source=SOURCE_EXTRA),
    FormField("school_system", "学制", GROUP_EXTRA_SCHOOL, source=SOURCE_EXTRA),
    FormField("rank_total", "专业排名总人数", GROUP_EXTRA_SCHOOL, source=SOURCE_EXTRA),
    FormField("rank_position", "专业排名名次", GROUP_EXTRA_SCHOOL, source=SOURCE_EXTRA),
    FormField("second_major", "第二专业或双学位", GROUP_EXTRA_SCHOOL, source=SOURCE_EXTRA),
    FormField("archives_location", "档案所在地", GROUP_EXTRA_SCHOOL, source=SOURCE_EXTRA),
    FormField("dispatch_unit", "报到证抬头和派遣单位", GROUP_EXTRA_SCHOOL, source=SOURCE_EXTRA),
    # ---- 语言与证书 ----
    # 四六级**分数**已挪到「教育经历」（成绩是某段学历期间考出来的，见上面 GROUP_EDUCATION
    # 那两条），这里不再重复一份——同一个值有两个来源，改哪边都不对。
    # 其他语种与职业资格证在国企、银行、外企是加分项。
    FormField(
        "language_other",
        "其他语种及等级",
        GROUP_EXTRA_LANGUAGE,
        kind="longtext",
        source=SOURCE_EXTRA,
    ),
    FormField(
        "computer_cert",
        "计算机等级证书",
        GROUP_EXTRA_LANGUAGE,
        kind="longtext",
        source=SOURCE_EXTRA,
    ),
    FormField(
        "professional_cert",
        "职业资格证书",
        GROUP_EXTRA_LANGUAGE,
        kind="longtext",
        source=SOURCE_EXTRA,
    ),
    # ---- 家庭与紧急联系人 ----
    # 国企、银行、公务员类网申会问家庭情况与紧急联系人（政审、背调、亲属回避核查）。
    # **全部标 sensitive**：含他人信息，且"是否有亲属在本单位任职"是回避制度的直接判据。
    FormField(
        "emergency_contact_name",
        "紧急联系人姓名",
        GROUP_EXTRA_FAMILY,
        sensitive=True,
        source=SOURCE_EXTRA,
    ),
    FormField(
        "emergency_contact_relation",
        "与紧急联系人关系",
        GROUP_EXTRA_FAMILY,
        sensitive=True,
        source=SOURCE_EXTRA,
    ),
    FormField(
        "emergency_contact_phone",
        "紧急联系人电话",
        GROUP_EXTRA_FAMILY,
        kind="tel",
        sensitive=True,
        source=SOURCE_EXTRA,
    ),
    FormField("father_name", "父亲姓名", GROUP_EXTRA_FAMILY, sensitive=True, source=SOURCE_EXTRA),
    FormField(
        "father_workplace", "父亲工作单位", GROUP_EXTRA_FAMILY, sensitive=True, source=SOURCE_EXTRA
    ),
    FormField("mother_name", "母亲姓名", GROUP_EXTRA_FAMILY, sensitive=True, source=SOURCE_EXTRA),
    FormField(
        "mother_workplace", "母亲工作单位", GROUP_EXTRA_FAMILY, sensitive=True, source=SOURCE_EXTRA
    ),
    FormField(
        "home_address",
        "家庭住址",
        GROUP_EXTRA_FAMILY,
        kind="longtext",
        sensitive=True,
        source=SOURCE_EXTRA,
    ),
    FormField("home_postcode", "家庭邮编", GROUP_EXTRA_FAMILY, sensitive=True, source=SOURCE_EXTRA),
    # ---- 党团信息 ----
    # 国企、事业单位、选调生、公务员的硬性栏目。简历上不写，网申必问。
    FormField(
        "party_join_date",
        "入党或入团时间",
        GROUP_EXTRA_PARTY,
        kind="date",
        sensitive=True,
        source=SOURCE_EXTRA,
    ),
    FormField(
        "party_branch",
        "所在党支部或团支部",
        GROUP_EXTRA_PARTY,
        sensitive=True,
        source=SOURCE_EXTRA,
    ),
    # ---- 身体情况 ----
    # 部分国企、公务员、军队文职有体检标准。**全部 sensitive**，且这一组最该让用户
    # 想一秒再填——它们是健康隐私，只存本机。
    FormField("height", "身高(cm)", GROUP_EXTRA_HEALTH, sensitive=True, source=SOURCE_EXTRA),
    FormField("weight", "体重(kg)", GROUP_EXTRA_HEALTH, sensitive=True, source=SOURCE_EXTRA),
    FormField("eyesight", "视力", GROUP_EXTRA_HEALTH, sensitive=True, source=SOURCE_EXTRA),
    FormField(
        "medical_history",
        "既往病史",
        GROUP_EXTRA_HEALTH,
        kind="longtext",
        sensitive=True,
        source=SOURCE_EXTRA,
    ),
    # ---- 意向与到岗 ----
    # "是否服从调剂"与"可到岗时间"是网申高频项，而简历里没有对应位置；
    # 期望年薪与简历上的"期望薪资"口径常常不同（一个年薪一个月薪），所以分开。
    FormField("available_date", "可到岗时间", GROUP_EXTRA_INTENT, kind="date", source=SOURCE_EXTRA),
    FormField("expected_annual_salary", "期望年薪", GROUP_EXTRA_INTENT, source=SOURCE_EXTRA),
    FormField("recruit_source", "招聘信息来源", GROUP_EXTRA_INTENT, source=SOURCE_EXTRA),
    FormField("referral_code", "内推信息", GROUP_EXTRA_INTENT, source=SOURCE_EXTRA),
    # ---- 其他补充 ----
    FormField("specialty", "个人特长", GROUP_EXTRA_MISC, kind="longtext", source=SOURCE_EXTRA),
    FormField("hobbies", "兴趣爱好", GROUP_EXTRA_MISC, kind="longtext", source=SOURCE_EXTRA),
    *SUPPLEMENT_FIELDS,
)

FIELD_KEYS: tuple[str, ...] = tuple(field.key for field in FORM_FIELDS)
FIELD_LABELS: dict[str, str] = {field.key: field.label for field in FORM_FIELDS}
# 动态教育记录使用 ``education_1_courses`` / ``education_1_achievements``，
# ``split_repeated_key`` 会把它们还原成这两个基础键。
FIELD_LABELS.update(
    {
        "education_courses": "核心课程",
        "education_achievements": "在校成果",
    }
)
SENSITIVE_FIELD_KEYS: frozenset[str] = frozenset(
    field.key for field in FORM_FIELDS if field.sensitive
)

# 动态重复资料沿用同一套字段标签与 key 清单，但不进入单值「网申资料」输入框。
for key, label in REPEATED_FIELD_LABELS.items():
    FIELD_LABELS.setdefault(key, label)
FIELD_KEYS = (*FIELD_KEYS, *(key for key in REPEATED_FIELD_LABELS if key not in FIELD_KEYS))
FIELD_KEYS = (*FIELD_KEYS, "education_courses", "education_achievements")
