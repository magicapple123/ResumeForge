"""网申字段目录与匹配用常量表——**单一事实来源**。

这个模块只放常量与纯数据，不放算法（算法在 ``matching.py``）。分四组：

- ``FORM_FIELDS``：能填的字段清单。驱动前端渲染、限制写入的键、也是测试比对的基准。
- ``FIELD_SYNONYMS``：字段 → 页面上的中文/英文说法。**顺序即分配优先级**。
- ``FIELD_EXCLUDE_HINTS``：负向词。网申表单里塞满了"紧急联系人姓名""父亲电话"，纯包含
  匹配会把**用户本人的资料**填进亲属栏——这是这类功能最典型的低级错误。
- ``FIELD_DENYLIST``：永不自动填的控件（密码、验证码、银行卡）。与"遇到验证码不绕过"
  是同一条纪律。

## 加字段时改哪里

在 ``FORM_FIELDS`` 加一行、在 ``FIELD_SYNONYMS`` 加同名的条目即可，**不需要迁移、不需要
改前端**（表单元数据驱动渲染）。若数据来自资料里的新列，再改 ``data.build_form_data``。
"""

from __future__ import annotations

from dataclasses import dataclass

# 分组名同时用作前端的分区标题。
GROUP_IDENTITY = "身份信息"
GROUP_CONTACT = "联系方式"
GROUP_EDUCATION = "教育经历"
GROUP_OTHER = "其他"
# 「网申资料」专有：**简历里没有、只有网申表单会问**的那些栏目的分组名。
GROUP_EXTRA_SCHOOL = "学籍与档案"
GROUP_EXTRA_LANGUAGE = "语言与证书"
GROUP_EXTRA_FAMILY = "家庭与紧急联系人"
GROUP_EXTRA_PARTY = "党团信息"
GROUP_EXTRA_HEALTH = "身体情况"
GROUP_EXTRA_INTENT = "意向与到岗"
GROUP_EXTRA_MISC = "其他补充"

# 值从哪来。
SOURCE_PROFILE = "profile"  # 从 ``UserProfile`` 取（简历资料，现有行为）
SOURCE_EXTRA = "extra"  # 从 ``web_form_profile_entry`` 取（用户专门为网申填的补充资料）


@dataclass(frozen=True)
class FormField:
    """目录里的一条字段定义。"""

    key: str
    label: str
    group: str
    # 期望的控件类型，供同分时的偏好加权与前端选择合适的输入控件。
    kind: str = "text"  # text | longtext | date | tel | email
    # 是否属于高敏感数据。前端据此提示"只存本机、不会进入简历导出"，
    # 并让用户知道这一项为什么值得多想一秒。
    sensitive: bool = False
    # 派生字段：值来自资料里的**子表**（实习/项目/获奖），不在「我的资料」里单独录，
    # 所以前端**不该**给它渲染输入框。``GET /api/webform/fields`` 会带上这个标记。
    derived: bool = False
    # 值从哪来：``SOURCE_PROFILE`` 从简历资料取，``SOURCE_EXTRA`` 从「网申资料」取。
    #
    # **这个标记是"生成简历不读网申资料"那条边界的落点**：``source="extra"`` 的字段只在
    # ``webform/data.py::extra_to_form_data`` 里取值，而简历生成链读的是 ``UserProfile``，
    # 两边在代码路径上就不相交。
    #
    # 用户在「我的资料 → 网申资料」里录的，正是这一批；``source="profile"`` 的那批由
    # 简历资料提供，不在网申资料里重复录一遍（否则同一个值有两个来源，改哪边都不对）。
    source: str = SOURCE_PROFILE


# 能填的字段。顺序即前端分区内的展示顺序。
FORM_FIELDS: tuple[FormField, ...] = (
    # ===== 身份信息 =====
    FormField("name", "姓名", GROUP_IDENTITY),
    FormField("gender", "性别", GROUP_IDENTITY, kind="select"),
    FormField("birth_date", "出生日期", GROUP_IDENTITY, kind="date", sensitive=True),
    FormField("birth_year", "出生年份", GROUP_IDENTITY),
    FormField("country_region", "国家/地区", GROUP_IDENTITY, kind="select"),
    FormField("native_place", "籍贯", GROUP_IDENTITY),
    FormField("political_status", "政治面貌", GROUP_IDENTITY, kind="select", sensitive=True),
    FormField("id_type", "证件类型", GROUP_IDENTITY, kind="select", sensitive=True),
    FormField("id_number", "证件号码", GROUP_IDENTITY, sensitive=True),
    # ===== 联系方式 =====
    FormField("phone", "手机号", GROUP_CONTACT, kind="tel"),
    FormField("phone_country_code", "手机区号", GROUP_CONTACT),
    FormField("email", "邮箱", GROUP_CONTACT, kind="email"),
    FormField("wechat", "微信号", GROUP_CONTACT),
    FormField("qq", "QQ 号", GROUP_CONTACT),
    FormField("city", "当前所处地", GROUP_CONTACT),
    FormField("target_city", "期望工作地点", GROUP_CONTACT),
    # ===== 教育经历（取最高学历那一条）=====
    FormField("school", "学校", GROUP_EDUCATION),
    FormField("department", "院系", GROUP_EDUCATION),
    FormField("advisor", "导师", GROUP_EDUCATION),
    FormField("research_direction", "研究方向", GROUP_EDUCATION),
    # 实验室与论文：腾讯校招简历页紧挨着导师/研究方向的那两栏（实测快照见
    # ``engine.evidence_key`` 的注释）。**加这两个是因为它们本来就该在目录里**——
    # 它们不是某一家的怪字段，而是"研究生简历"这类页面的常客。认得出 → 走 missing_data
    # （用户知道去补什么）→ 补上之后能自动填，而且不经过"自定义字段"那条降级路径。
    FormField("laboratory", "实验室", GROUP_EDUCATION),
    FormField("paper", "论文", GROUP_EDUCATION),
    FormField("major", "专业", GROUP_EDUCATION),
    FormField("degree", "学历", GROUP_EDUCATION, kind="select"),
    FormField("degree_type", "学位", GROUP_EDUCATION, kind="select"),
    FormField("study_mode", "学习形式", GROUP_EDUCATION, kind="select"),
    FormField("education_start", "入学时间", GROUP_EDUCATION, kind="date"),
    FormField("education_end", "毕业时间", GROUP_EDUCATION, kind="date"),
    FormField("gpa", "绩点/排名", GROUP_EDUCATION),
    # 四六级分数录在**教育经历**上（成绩是某段学历期间考出来的），网申表单普遍问具体分数。
    # 取的是最高学历那一条，与上面这些教育字段同源同规则。
    FormField("cet4_score", "英语四级分数", GROUP_EDUCATION),
    FormField("cet6_score", "英语六级分数", GROUP_EDUCATION),
    # ===== 其他 =====
    FormField("job_intent", "求职意向", GROUP_OTHER),
    FormField("preferred_industry", "意向行业", GROUP_OTHER),
    FormField("salary", "期望薪资", GROUP_OTHER),
    FormField("company", "最近实习/工作单位", GROUP_OTHER),
    FormField("job_title", "最近实习/工作职位", GROUP_OTHER),
    FormField("work_start", "实习/工作开始时间", GROUP_OTHER, kind="date"),
    FormField("work_end", "实习/工作结束时间", GROUP_OTHER, kind="date"),
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
    FormField("family_info", "家庭信息", GROUP_OTHER, kind="longtext", sensitive=True),
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
    FormField("training_mode", "培养方式", GROUP_EXTRA_SCHOOL, kind="select", source=SOURCE_EXTRA),
    FormField("school_system", "学制", GROUP_EXTRA_SCHOOL, source=SOURCE_EXTRA),
    FormField("rank_total", "专业排名总人数", GROUP_EXTRA_SCHOOL, source=SOURCE_EXTRA),
    FormField("rank_position", "专业排名名次", GROUP_EXTRA_SCHOOL, source=SOURCE_EXTRA),
    FormField("second_major", "第二专业/双学位", GROUP_EXTRA_SCHOOL, source=SOURCE_EXTRA),
    FormField("archives_location", "档案所在地", GROUP_EXTRA_SCHOOL, source=SOURCE_EXTRA),
    FormField("dispatch_unit", "报到证抬头/派遣单位", GROUP_EXTRA_SCHOOL, source=SOURCE_EXTRA),
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
        "入党/入团时间",
        GROUP_EXTRA_PARTY,
        kind="date",
        sensitive=True,
        source=SOURCE_EXTRA,
    ),
    FormField(
        "party_branch", "所在党支部/团支部", GROUP_EXTRA_PARTY, sensitive=True, source=SOURCE_EXTRA
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
    FormField("referral_code", "内推码/推荐人", GROUP_EXTRA_INTENT, source=SOURCE_EXTRA),
    # ---- 其他补充 ----
    FormField("specialty", "个人特长", GROUP_EXTRA_MISC, kind="longtext", source=SOURCE_EXTRA),
    FormField("hobbies", "兴趣爱好", GROUP_EXTRA_MISC, kind="longtext", source=SOURCE_EXTRA),
)

FIELD_KEYS: tuple[str, ...] = tuple(field.key for field in FORM_FIELDS)
FIELD_LABELS: dict[str, str] = {field.key: field.label for field in FORM_FIELDS}
SENSITIVE_FIELD_KEYS: frozenset[str] = frozenset(
    field.key for field in FORM_FIELDS if field.sensitive
)


# 亲属/他人信息的负向词。资料里的是**用户本人**的信息，这些块问的是别人，
# 命中就打住——否则"姓名"会把父亲的名字填成用户自己的。
#
# ⚠️ **这一组是公开的、语义单一的**：「这个框在问别人」。``FIELD_EXCLUDE_HINTS`` 则是
# 各字段自己的排除词表，里面**混了两种语义**——``phone_country_code`` 的
# ("手机", "号码") 意思是"这个框是手机号、不是区号"，跟"问别人"毫无关系。
# 服务层判断"要不要提示用户这是他人信息"时必须用**这一个**常量，
# 用错了会把「手机号」误判成亲属栏。
RELATIVE_HINTS: tuple[str, ...] = (
    "紧急联系人",
    "紧急联络",
    "联系人",
    "家庭成员",
    "家庭主要成员",
    "亲属",
    "父亲",
    "母亲",
    "父/母",
    "家长",
    "监护人",
    "推荐人",
    "证明人",
    "担保人",
)

# 字段 → 页面上的说法。**顺序即优先级**：越具体的排越前，否则"最高学历"会被"学历"抢走。
FIELD_SYNONYMS: dict[str, tuple[str, ...]] = {
    # ===== 最具体的一批必须排在最前 =====
    "id_number": ("证件号码", "身份证号码", "身份证号", "证件号", "身份证", "id number", "idcard"),
    # ⚠️ 这里**不写**英文 "name"：签名里包含 HTML 的 name 属性，而 `userName`、
    # `companyName`、`fileName` 都含 "name"，加进去会把它们全认成姓名。
    "name": ("真实姓名", "本人姓名", "你的名字", "姓名", "full name", "fullname", "your name"),
    "id_type": ("证件类型", "证件种类", "身份证件类型", "证件类别", "id type"),
    # 区号要排在 phone 之前，但要靠负向词把自己从"手机号（含区号）"上摘出去。
    "phone_country_code": (
        "手机区号",
        "国际区号",
        "国家码",
        "电话区号",
        "区号",
        "country code",
        "area code",
    ),
    "phone": (
        "手机号码",
        "手机号",
        "手机",
        "联系电话",
        "联系号码",
        "联系方式",
        "电话",
        "phone",
        "mobile",
        "tel",
    ),
    "email": ("电子邮箱", "电子邮件", "邮箱地址", "邮箱", "邮件", "email", "e-mail"),
    "wechat": ("微信号码", "微信号", "微信", "wechat", "weixin"),
    # 只写"QQ号/QQ"：不写裸的 "QQ"，否则 "QQ邮箱" 会被抢走（邮箱在下面，优先级更低）。
    "qq": ("qq号码", "qq号", "腾讯qq"),
    # 有些校招页面（腾讯校招实测）只给教育经历的日期框写「起止时间」，没有「入学/毕业」
    # 标签；两个框的 DOM 顺序由 engine.date_order 区分开始与结束，且重复实习/项目区块会
    # 先经过 FIELD_BLOCK_HINTS 限定，不会被这条通用词抢走。
    "education_end": ("毕业时间", "毕业日期", "预计毕业", "毕业年月", "起止时间", "graduation"),
    "education_start": ("入学时间", "入学日期", "开始就读", "入学年月", "起止时间"),
    "degree_type": ("学位类型", "所获学位", "学位名称", "学位"),
    "study_mode": ("学习形式", "培养方式", "办学形式", "是否全日制", "学习方式"),
    "degree": ("最高学历", "学历层次", "学历", "education", "degree"),
    "school": ("毕业院校", "学校名称", "就读学校", "院校", "学校", "school", "university"),
    "major": ("所学专业", "专业名称", "专业", "major"),
    # 院系排在学校之后、专业之前：它比"学校"具体、比"专业"更接近院系本身。
    "department": ("所在院系", "院系名称", "院系", "学院", "系别", "department", "faculty"),
    "advisor": ("指导教师", "导师姓名", "我的导师", "导师", "advisor", "supervisor"),
    # 实验室：**不要把"研究"写进同义词**——`research_direction` 的框旁文里全是"研究"，
    # 那会让实验室栏被研究方向抢走（正是 ``evidence_key`` 记的那次踩坑）。同理不写"实验"，
    # 真实页面上的框名是"请输入实验室"，命中"实验室"这三个字足够。
    "laboratory": ("实验室名称", "所属实验室", "实验室", "课题组", "laboratory", "lab"),
    # 论文：只收"论文"这个词本身与常见完整说法。**不收"发表"**——"发表时间""是否发表"
    # 是天底下最泛的两个标签，收进来会把别的东西认成论文。
    "paper": ("已发表论文", "发表论文", "论文题目", "论文名称", "学术论文", "论文", "paper"),
    "research_direction": (
        "研究方向",
        "领域方向",
        "专业方向",
        "研究领域",
        "研究课题",
        "research direction",
        "research area",
    ),
    "preferred_industry": (
        "意向行业",
        "期望行业",
        "感兴趣的事业群",
        "事业群",
        "意向事业群",
        "行业意向",
        "意向部门",
        "期望部门",
    ),
    # ⚠️ 这里**不写"成绩排名"**：它是另一个数据（名次 vs 绩点），而资料里存的形状是
    # "3.7/4.0" 这种绩点。2026-09-26 实测：加上它之后，"绩点"会被"成绩排名"抢走
    # （同义词越长分越高），把绩点填进了排名框。
    "gpa": ("绩点", "平均分", "gpa"),
    # 四六级分数（录在教育经历上）。**写完整说法**，不收裸的"分数""成绩"——那两个词在
    # 成绩单类页面上到处都是，会被抄到别的框上。
    "cet4_score": ("英语四级", "四级成绩", "四级分数", "cet4", "cet-4"),
    "cet6_score": ("英语六级", "六级成绩", "六级分数", "cet6", "cet-6"),
    "birth_date": ("出生日期", "出生年月", "生日", "birth date", "birthday"),
    "birth_year": ("出生年份", "出生年", "birth year"),
    "gender": ("性别", "gender", "sex"),
    "native_place": ("籍贯", "出生地", "生源地", "户籍所在地"),
    "political_status": ("政治面貌", "党派", "政治身份"),
    "country_region": (
        "国家/地区",
        "国家和地区",
        "国家地区",
        "国籍",
        "所在国家",
        "country",
        "region",
    ),
    "company": ("实习单位", "工作单位", "最近公司", "所在公司", "公司名称", "任职单位", "company"),
    "job_title": ("实习岗位", "职位名称", "担任职位", "职务", "job title", "position"),
    "work_start": ("入职时间", "实习开始", "工作开始", "开始时间"),
    "work_end": ("离职时间", "实习结束", "工作结束", "结束时间"),
    # ===== 多段经历字段 =====
    #
    # 这些词**故意取得很短**（"职位"、"描述"、"起止时间"），单看会误伤一大片——所以它们
    # 全都配了 ``FIELD_BLOCK_HINTS`` 限定区块（见那张表的说明）。有了区块限定，短词才安全。
    #
    # 顺序要紧：``*_start`` 必须排在 ``*_end`` 前面。区块里那两个日期控件的签名一模一样
    # （占位符都是"选择日期"、邻近文本都是"起止时间"），靠 ``_best_control`` 按 DOM 顺序
    # 取第一个来区分——先跑 start 拿到前面的，end 再拿后面那个。
    "experience_company": ("实习公司", "公司名称", "公司"),
    "experience_role": ("实习职位", "职位", "岗位"),
    "experience_start": ("起止时间", "开始时间", "起始时间"),
    "experience_end": ("起止时间", "结束时间", "截止时间"),
    "experience_description": ("描述内容", "描述", "工作内容", "实习内容"),
    "project_name": ("项目名称", "项目名"),
    "project_role": ("担任的角色", "项目角色", "担任角色", "角色"),
    "project_start": ("起止时间", "开始时间", "起始时间"),
    "project_end": ("起止时间", "结束时间", "截止时间"),
    "project_description": ("描述内容", "描述", "项目描述"),
    "project_tech_stack": ("技术栈", "技术工具", "开发工具", "使用技术", "工具"),
    "project_highlights": ("项目成果", "项目亮点", "成果", "业绩"),
    "award_name": ("奖项名称", "获奖名称", "奖项"),
    "award_date": ("获奖时间", "获奖日期", "获奖年月"),
    "award_description": ("奖项说明", "获奖说明", "奖项描述"),
    "campus_organization": ("校园组织", "社团", "学生组织", "组织名称"),
    "campus_role": ("校园职务", "社团职务", "担任职务", "校园角色"),
    "campus_start": ("校园经历开始", "任职开始", "起止时间", "开始时间"),
    "campus_end": ("校园经历结束", "任职结束", "起止时间", "结束时间"),
    "campus_description": ("校园经历描述", "社团经历", "校园实践", "经历描述"),
    # ⚠️ 这里**不写**裸的 "年薪"：`expected_annual_salary` 专门接年薪（网申常把年薪与月薪
    # 分开问），留在两边会让同一个框被两个字段抢。
    "salary": ("期望薪资", "期望月薪", "薪资要求", "薪酬待遇", "薪酬", "salary"),
    "job_intent": ("求职意向", "意向岗位", "应聘职位", "期望职位", "期望岗位", "应聘岗位"),
    "summary": (
        "自我评价",
        "自我介绍",
        "个人简介",
        "个人优势",
        "个人评价",
        "补充信息",
        "简介",
        "summary",
        "about",
    ),
    "family_info": ("家庭信息", "家庭情况", "家庭状况", "家庭成员情况"),
    "github": ("github", "代码仓库", "开源主页"),
    "personal_website": ("个人主页", "个人网站", "博客", "portfolio", "website"),
    "target_city": (
        "期望工作地点",
        "期望工作城市",
        "期望城市",
        "意向城市",
        "期望工作地",
        "意向地区",
        "工作城市",
    ),
    "city": (
        "当前所处地",
        "现居住地",
        "现居地",
        "所在城市",
        "所在地区",
        "当前城市",
        "所在地",
        "城市",
        "city",
    ),
    # ===== 「网申资料」专有（source=extra）=====
    #
    # ⚠️ **同义词必须具体**。网申表单里"分数""姓名""电话"这类裸词到处都是，收进来会互相抢：
    # 实测踩过一次——`school` 靠旁文抢走了本该属于 `research_direction` 的框。所以这里一律写
    # 完整说法（"英语四级分数"而不是"分数"，"紧急联系人姓名"而不是"姓名"），
    # 宁可不匹配（如实列进"没认出来"），也不要匹配错（悄悄填错格）。
    #
    # ---- 学籍与档案 ----
    "student_id": ("学号", "学生编号", "student id"),
    "training_mode": ("培养方式", "培养类型", "招生类型"),
    "school_system": ("学制", "修业年限"),
    # 排名两个数分开：很多系统要"名次/总人数"两栏，合起来填不进去。
    "rank_position": ("专业排名", "成绩排名", "年级排名", "排名名次", "名次"),
    "rank_total": ("专业总人数", "排名总人数", "专业人数", "总人数"),
    "second_major": ("第二专业", "双学位", "辅修专业", "辅修"),
    "archives_location": ("档案所在地", "档案所在单位", "档案存放地", "人事档案"),
    "dispatch_unit": ("报到证抬头", "派遣单位", "报到单位", "派遣证"),
    # ---- 语言与证书 ----
    # ⚠️ 四六级的同义词在**上面「教育经历」那一段**（它们已挪过去），不要在这里再写一份。
    "language_other": (
        "其他语种",
        "第二外语",
        "外语等级",
        "小语种",
        "雅思",
        "托福",
        "日语",
        "韩语等级",
    ),
    "computer_cert": ("计算机等级", "计算机证书", "计算机水平", "计算机二级", "计算机三级"),
    "professional_cert": (
        "职业资格",
        "资格证书",
        "执业资格",
        "证书名称",
        "会计从业",
        "法律职业资格",
    ),
    # ---- 家庭与紧急联系人 ----
    # 这一组最需要具体："联系电话""姓名"在页面上到处都是，写裸词会把**用户本人**的信息
    # 填进亲属栏——那正是这类功能最典型的低级错误（见 FIELD_EXCLUDE_HINTS 的说明）。
    "emergency_contact_name": ("紧急联系人姓名", "紧急联系人", "紧急联络人"),
    "emergency_contact_relation": ("与本人关系", "紧急联系人关系", "联系人关系", "与联系人关系"),
    "emergency_contact_phone": ("紧急联系人电话", "紧急联系人手机", "紧急联络电话"),
    "father_name": ("父亲姓名", "父姓名", "父亲名字"),
    "father_workplace": ("父亲工作单位", "父亲单位", "父亲工作"),
    "mother_name": ("母亲姓名", "母姓名", "母亲名字"),
    "mother_workplace": ("母亲工作单位", "母亲单位", "母亲工作"),
    "home_address": ("家庭住址", "家庭地址", "家庭详细地址", "户籍地址"),
    "home_postcode": ("家庭邮编", "家庭邮政编码", "户籍邮编"),
    # ---- 党团信息 ----
    "party_join_date": ("入党时间", "入团时间", "入党日期", "入团日期"),
    "party_branch": ("所在党支部", "党支部", "团支部", "党组织关系"),
    # ---- 身体情况 ----
    "height": ("身高", "身高cm"),
    "weight": ("体重", "体重kg"),
    "eyesight": ("视力", "裸眼视力", "矫正视力"),
    "medical_history": ("既往病史", "病史", "重大疾病史", "传染病史"),
    # ---- 意向与到岗 ----
    "available_date": ("可到岗时间", "到岗时间", "可入职时间", "最快到岗", "预计到岗"),
    "expected_annual_salary": ("期望年薪", "年薪要求", "期望年收入"),
    "recruit_source": ("招聘信息来源", "信息来源", "获知渠道", "了解渠道"),
    "referral_code": ("内推码", "内推串码", "推荐人", "内推人", "推荐码", "内推编号"),
    # ---- 其他补充 ----
    "specialty": ("个人特长", "特长", "专长", "擅长"),
    "hobbies": ("兴趣爱好", "爱好", "兴趣"),
}

# 字段 → **必须在场**的区块名。控件签名里没有它就不参与该字段的匹配。
#
# 解决的问题：网申表单把实习/项目/获奖做成「可添加多条」的区块，每条的控件长得一模一样
# （占位符都是"选择日期"、邻近文本都是"起止时间"）。没有区块限定的话，"起止时间"这种
# 短词会在教育、实习、项目三个区块上同时命中，而谁抢到全靠控件序号——填错格且用户看不出来。
#
# 实测（2026-09-26 腾讯校招简历页）：区块内的控件签名里都带着区块名——"实习经历-1"、
# "项目经历-1"、"获奖信息-1"，而教育区块的两个日期控件没有序号区块标签；它们改用
# 「起止时间」同义词 + DOM date_order 区分开始/结束。重复区块仍必须靠这里做类型隔离。
FIELD_BLOCK_HINTS: dict[str, str] = {
    "experience_company": "实习经历",
    "experience_role": "实习经历",
    "experience_start": "实习经历",
    "experience_end": "实习经历",
    "experience_description": "实习经历",
    "project_name": "项目经历",
    "project_role": "项目经历",
    "project_start": "项目经历",
    "project_end": "项目经历",
    "project_description": "项目经历",
    "project_tech_stack": "项目经历",
    "project_highlights": "项目经历",
    "award_name": "获奖信息",
    "award_date": "获奖信息",
    "award_description": "获奖信息",
    "campus_organization": "校园经历",
    "campus_role": "校园经历",
    "campus_start": "校园经历",
    "campus_end": "校园经历",
    "campus_description": "校园经历",
}

# `autocomplete` 属性 → 字段。
#
# **这是唯一一个不需要猜的信号**：HTML 规范把字段类型标准化了，写得规矩的表单会带上它，
# 读到就是高置信命中。Chrome 的自动填充也把它当第一优先级，没有才退回启发式。
#
# 只收录**有把握**的映射。像 `address-level1`（省/州）这种，我们这边没有对应字段
# （`native_place` 是籍贯、`city` 是现居地），**宁可不要**——拿不准就不填。
AUTOCOMPLETE_FIELDS: dict[str, str] = {
    # 姓名（合称与分称都归到姓名）
    "name": "name",
    "given-name": "name",
    "family-name": "name",
    "additional-name": "name",
    "nickname": "name",
    # 联系方式
    "email": "email",
    "tel": "phone",
    "tel-national": "phone",
    "tel-local": "phone",
    "tel-country-code": "phone_country_code",
    "url": "personal_website",
    # 出生日期
    "bday": "birth_date",
    "bday-year": "birth_year",
    # 单位与职务
    "organization": "company",
    "organization-title": "job_title",
    # 地址
    "country": "country_region",
    "country-name": "country_region",
    "address-level2": "city",  # 市 —— 对应"当前所处地"
    # 非标准但真实存在（一些国内表单这么写）
    "sex": "gender",
}

# `autocomplete` 里**明确表示"别自动填"**的取值：密码、验证码、银行卡。
# 站点这么标是在声明这是一类不该被程序填的控件——与我们的黑名单是同一条纪律，
# 而且这次是站点自己说的，比我们从标签猜更可信。
AUTOCOMPLETE_DENY: dict[str, str] = {
    "current-password": "密码",
    "new-password": "密码",
    "one-time-code": "验证码",
    "cc-number": "银行卡号",
    "cc-name": "持卡人姓名",
    "cc-exp": "银行卡有效期",
    "cc-csc": "银行卡安全码",
}

# `autocomplete="off"` 是**反信号**（站点在说"别自动填"）。
#
# 但我们**不据此拦下**：它绝大多数时候是对**浏览器自带填充**的表态（很多站点无差别地
# 整表加 off），而不是针对用户用自己工具填自己的资料。Chrome 自己也是这么处理的
# （它把 off 当提示、不当禁令）。所以这里既不匹配、也不拦——当"没有信息"。
AUTOCOMPLETE_OFF = "off"

# 字段 → 负向词。命中即跳过该控件（宁可漏填，不可错填）。
FIELD_EXCLUDE_HINTS: dict[str, tuple[str, ...]] = {
    "name": RELATIVE_HINTS + ("拼音", "英文名", "曾用名"),
    "phone": RELATIVE_HINTS,
    "email": RELATIVE_HINTS,
    "wechat": RELATIVE_HINTS,
    "company": RELATIVE_HINTS + ("父母", "配偶"),
    "job_title": RELATIVE_HINTS + ("父母", "配偶"),
    "id_number": RELATIVE_HINTS,
    # "手机号（含区号）"这类合并框：区号只是括号里的补充说明，整框要填的是号码。
    "phone_country_code": RELATIVE_HINTS + ("手机", "号码"),
}

# 永不自动填的控件：签名命中任一即拦下。与"遇到验证码不绕过"同一条纪律。
FIELD_DENYLIST: tuple[str, ...] = (
    "密码",
    "验证码",
    "校验码",
    "动态码",
    "短信码",
    "图形码",
    "password",
    "passwd",
    "captcha",
    "otp",
    "银行卡",
    "信用卡",
    "银行账号",
    "银行卡号",
    "支付",
)

# 需要**你本人**确认的勾选项：隐私政策、用户协议、信息推送、简历真实性承诺…
#
# **代勾这些等于替你做出了法律意义上的同意**，所以永不自动勾选，只在预览里如实列出来。
# 这与"验证码不绕过"是同一条纪律：程序不替用户表达意愿。
CONSENT_HINTS: tuple[str, ...] = (
    "我已阅读",
    "已阅读并同意",
    "隐私政策",
    "服务条款",
    "用户协议",
    "真实性",
    "承诺",
    "信息推送",
    "接受推送",
    "订阅",
    "同意",
)

# 声明类勾选的**精确**标签（"无…经历/信息"那类按前缀规则匹配，见 ``_skip_reason``）。
#
# 勾上它们等于替用户**陈述事实**（"我没有这段经历" / "这段还在进行"），而不只是填一个值。
# 与"不替用户表达意愿"是同一条纪律，所以永不自动勾选。
CLAIM_LABELS: frozenset[str] = frozenset({"至今", "在职", "在读", "目前仍在", "至今仍在"})

# 下拉里的占位项：永远不选。规范化后逐字比对（见 ``matching.normalize_option_text``）。
#
# ⚠️ **"无"不在其中**——"婚姻状况：无"是一个合法选项。占位项的共同特征是"没有做出选择"，
# 而不是"值为空"。
PLACEHOLDER_TEXTS: frozenset[str] = frozenset(
    {
        "",
        "-",
        "--",
        "---",
        "—",
        "——",
        "请选择",
        "请选择…",
        "请选择...",
        "请选择：",
        "请选择地区",
        "请选择国家",
        "请选择省份",
        "请选择城市",
        "请选取",
        "请选",
        "请填写",
        "请选择（必填）",
        "choose",
        "select",
        "please select",
        "please choose",
        "全部",
        "不限",
    }
)

# 选项别名：同一个概念的多种写法。**不含纯数字**——`<option value="1">` 里的 1 在不同
# 站点含义完全不同，按数字匹配等于瞎猜。
OPTION_ALIASES: dict[str, tuple[str, ...]] = {
    # 学历层次
    "本科": ("大学本科", "本科生", "全日制本科", "本科（学士）", "bachelor", "bachelors"),
    "硕士": ("研究生", "硕士研究生", "硕士生", "研究生（硕士）", "master", "masters"),
    "博士": ("博士研究生", "博士生", "doctor", "doctoral", "phd"),
    "大专": ("专科", "高职", "大学专科", "专科（高职）", "associate"),
    "高中": ("普通高中", "高中毕业"),
    # 学习形式
    "全日制": ("普通全日制", "全日制统招", "统招", "full-time", "fulltime"),
    "非全日制": ("非全", "在职", "part-time", "parttime"),
    # 学位类型
    "学士": ("学士学位", "bachelor degree"),
    "硕士学位": ("硕士", "master degree"),
    "博士学位": ("博士", "doctor degree"),
    # 性别
    "男": ("男性", "male", "m"),
    "女": ("女性", "female", "f"),
    # 是否类
    "是": ("yes", "y", "有", "true"),
    "否": ("no", "n", "没有", "无", "false"),
}

# 字段更"适配"的控件类型（命中加权重分，避免把"姓名"填进下拉框）。
FIELD_PREFERRED_TYPES: dict[str, tuple[str, ...]] = {
    "summary": ("textarea", "richtext"),
    "family_info": ("textarea", "richtext"),
    "gender": ("select", "radio"),
    "country_region": ("select",),
    "political_status": ("select",),
    "id_type": ("select",),
    "degree": ("select",),
    "degree_type": ("select",),
    "study_mode": ("select",),
    "preferred_industry": ("select", "text"),
    "qq": ("text", "tel", "number"),
    "birth_date": ("date", "text"),
    "education_start": ("date", "month", "text"),
    "education_end": ("date", "month", "text"),
    "work_start": ("date", "month", "text"),
    "work_end": ("date", "month", "text"),
    "email": ("email", "text"),
    "phone": ("tel", "text"),
}


__all__ = [
    "AUTOCOMPLETE_DENY",
    "AUTOCOMPLETE_FIELDS",
    "AUTOCOMPLETE_OFF",
    "CLAIM_LABELS",
    "CONSENT_HINTS",
    "FIELD_BLOCK_HINTS",
    "FIELD_DENYLIST",
    "FIELD_EXCLUDE_HINTS",
    "FIELD_KEYS",
    "FIELD_LABELS",
    "FIELD_PREFERRED_TYPES",
    "FIELD_SYNONYMS",
    "FORM_FIELDS",
    "GROUP_CONTACT",
    "GROUP_EDUCATION",
    "GROUP_IDENTITY",
    "GROUP_OTHER",
    "OPTION_ALIASES",
    "PLACEHOLDER_TEXTS",
    "RELATIVE_HINTS",
    "SENSITIVE_FIELD_KEYS",
    "FormField",
]
