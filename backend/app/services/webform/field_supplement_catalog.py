"""网申清单中新增的单值补充资料及精准匹配词。

简历资料已有的姓名、联系方式和求职意向等不在这里重复存储。
"""

from .field_types import (
    GROUP_EXTRA_FAMILY,
    GROUP_EXTRA_HEALTH,
    GROUP_EXTRA_INTENT,
    GROUP_EXTRA_MISC,
    GROUP_EXTRA_SCHOOL,
    GROUP_IDENTITY,
    SOURCE_EXTRA,
    FormField,
)

SUPPLEMENT_FIELDS: tuple[FormField, ...] = (
    FormField("former_name", "曾用名", GROUP_IDENTITY, source=SOURCE_EXTRA),
    FormField("age", "年龄", GROUP_IDENTITY, source=SOURCE_EXTRA),
    FormField("ethnicity", "民族", GROUP_IDENTITY, sensitive=True, source=SOURCE_EXTRA),
    FormField("marital_status", "婚姻状况", GROUP_IDENTITY, kind="select", options=("未婚", "已婚", "离异", "丧偶", "其他"), sensitive=True, source=SOURCE_EXTRA),
    FormField("registered_residence", "户口所在地", GROUP_EXTRA_FAMILY, sensitive=True, source=SOURCE_EXTRA),
    FormField("student_origin", "高考前户口所在地", GROUP_EXTRA_SCHOOL, sensitive=True, source=SOURCE_EXTRA),
    FormField("mailing_address", "通信地址", GROUP_EXTRA_FAMILY, kind="longtext", sensitive=True, source=SOURCE_EXTRA),
    FormField("mailing_postcode", "通信邮政编码", GROUP_EXTRA_FAMILY, sensitive=True, source=SOURCE_EXTRA),
    FormField("health_status", "健康状况", GROUP_EXTRA_HEALTH, sensitive=True, source=SOURCE_EXTRA),
    FormField("shoe_size", "鞋码", GROUP_EXTRA_HEALTH, sensitive=True, source=SOURCE_EXTRA),
    FormField("disadvantaged_student", "是否贫困生", GROUP_EXTRA_HEALTH, kind="select", options=("是", "否"), sensitive=True, source=SOURCE_EXTRA),
    FormField("accept_assignment", "是否服从调剂", GROUP_EXTRA_INTENT, kind="select", options=("是", "否"), source=SOURCE_EXTRA),
    FormField("referral_method", "推荐方式", GROUP_EXTRA_INTENT, source=SOURCE_EXTRA),
    FormField("interview_city", "可线下面试城市", GROUP_EXTRA_INTENT, source=SOURCE_EXTRA),
    FormField("written_test_city", "笔试意向城市", GROUP_EXTRA_INTENT, source=SOURCE_EXTRA),
    FormField("graduation_cohort", "应届生届别", GROUP_EXTRA_SCHOOL, source=SOURCE_EXTRA),
    FormField("failed_course_count", "挂科门数", GROUP_EXTRA_SCHOOL, source=SOURCE_EXTRA),
    FormField("github_star_count", "GitHub 最高星标数", GROUP_EXTRA_MISC, source=SOURCE_EXTRA),
    FormField("portfolio_showcase", "作品橱窗", GROUP_EXTRA_MISC, kind="longtext", source=SOURCE_EXTRA),
)

# 只放具体且有把握的说法；不要让「城市」等裸词抢走简历资料的现居地。
SUPPLEMENT_SYNONYMS: dict[str, tuple[str, ...]] = {
    "former_name": ("曾用名", "原姓名"),
    "age": ("年龄", "周岁"),
    "ethnicity": ("民族", "所属民族"),
    "marital_status": ("婚姻状况", "婚姻状态"),
    "registered_residence": ("户口所在地", "户籍所在地", "户口地址"),
    "student_origin": ("高考前户口所在地", "高考生源地", "生源地"),
    "mailing_address": ("通信地址", "通讯地址", "邮寄地址"),
    "mailing_postcode": ("通信邮政编码", "通信邮编", "通讯邮编"),
    "health_status": ("健康状况", "健康情况"),
    "shoe_size": ("鞋码", "鞋子尺码"),
    "disadvantaged_student": ("是否贫困生", "贫困生身份", "家庭经济困难学生"),
    "accept_assignment": ("是否服从调剂", "服从调剂", "接受岗位调剂"),
    "referral_method": ("推荐方式", "内推方式"),
    "interview_city": ("可线下面试城市", "线下面试城市", "面试意向城市"),
    "written_test_city": ("笔试意向城市", "笔试地点", "意向笔试城市"),
    "graduation_cohort": ("应届生届别", "毕业届别", "应届毕业年份"),
    "failed_course_count": ("挂科门数", "挂科科目数", "不及格科目数"),
    "github_star_count": ("GitHub最高星级", "GitHub星标数", "GitHub Stars"),
    "portfolio_showcase": ("作品橱窗", "作品展示"),
}
