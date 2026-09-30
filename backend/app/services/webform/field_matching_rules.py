"""网申字段匹配、自动填充和安全规则常量。"""

from .field_synonyms import RELATIVE_HINTS
from .repeated_profile_catalog import REPEATED_FIELD_PREFERRED_TYPES

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
    # 「所在部门意见」是反馈/评价类栏目，不是经历里的任职部门；网申页面常把两者
    # 放在同一张表里，单纯包含「所在部门」会误填。
    "experience_department": ("意见", "评价", "建议"),
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
    "accept_assignment": ("select", "radio"),
    "disadvantaged_student": ("select", "radio"),
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


FIELD_PREFERRED_TYPES.update(REPEATED_FIELD_PREFERRED_TYPES)

__all__ = [
    "AUTOCOMPLETE_DENY",
    "AUTOCOMPLETE_FIELDS",
    "AUTOCOMPLETE_OFF",
    "CLAIM_LABELS",
    "CONSENT_HINTS",
    "FIELD_DENYLIST",
    "FIELD_EXCLUDE_HINTS",
    "FIELD_PREFERRED_TYPES",
    "OPTION_ALIASES",
    "PLACEHOLDER_TEXTS",
]
