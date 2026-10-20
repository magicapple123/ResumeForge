# SPDX-License-Identifier: Apache-2.0
"""Fictional word pools and small text builders shared by the generators.

Every name/company/school below is invented for stress testing. The pools
are moved verbatim from the original monolithic script so generated datasets
stay byte-identical for a given seed.
"""

from __future__ import annotations

COMPANY_BASES = [
    "云帆科技",
    "星特朗数据",
    "临江智能",
    "青梧网络",
    "白泽信息",
    "岚山传媒",
    "远岫软件",
    "临港精密",
    "九章云图",
    "拾光文化",
    "南枝生物",
    "鹤鸣金融",
    "拓原新能源",
    "墨白教育",
    "观澜游戏",
    "旋玑航天",
    "长庚半导体",
    "青崖汽车",
    "曲水医疗",
    "灼华零售",
    "岱宗云服务",
    "聆音音频",
    "折桂咨询",
    "沉香物流",
    "既明电气",
    "洛书算法",
    "燕归人力",
    "枫泽地产",
    "沄涛环保",
    "跃鲲出海",
    "枢星安防",
    "棠悦美妆",
    "岸芷农业",
    "临镜影像",
    "跃马出行",
    "云汀计算",
    "岳峙机械",
    "沧澜能源",
    "知微舆情",
    "鹿鸣餐饮",
]
COMPANY_SUFFIXES = ["有限公司", "科技有限公司", "信息技术有限公司"]
# 40 base names x 3 suffixes = 120 fictional companies, which exactly covers
# the unique merge key of application_track (120 companies x 12 titles).
COMPANIES = [base + suffix for base in COMPANY_BASES for suffix in COMPANY_SUFFIXES]

TITLES = [
    "数据分析师",
    "数据产品经理",
    "算法工程师",
    "后端开发工程师",
    "前端开发工程师",
    "测试开发工程师",
    "产品运营专员",
    "市场运营专员",
    "新媒体运营",
    "用户增长运营",
    "项目经理",
    "人力资源专员",
    "财务专员",
    "行政专员",
    "UI设计师",
    "销售代表",
    "客户成功经理",
    "供应链专员",
    "内容运营",
    "商务拓展",
]
CITY_AREAS = [
    "上海·浦东新区",
    "上海·徐汇区",
    "北京·海淀区",
    "北京·朝阳区",
    "深圳·南山区",
    "杭州·西湖区",
    "广州·天河区",
    "成都·武侯区",
    "南京·建邺区",
    "苏州·工业园区",
    "武汉·江汉区",
    "西安·雁塔区",
]
JOB_TYPES = ["社招", "校招", "实习", "其他"]
JOB_SOURCES = ["BOSS直聘", "智联招聘", "猎聘", "拉勾", "招聘网站", "手动录入", "官网采集"]
_COLLECTED_SOURCES = {"BOSS直聘", "智联招聘", "猎聘", "拉勾", "招聘网站"}

JOB_STATUSES = ("开放中", "已截止", "已投递")
SALARIES = [
    "12-18K",
    "15-25K·13薪",
    "20-30K",
    "10-15K",
    "9-14K",
    "18-28K·14薪",
    "25-40K",
    "8-12K",
    "16-24K",
    "180-220 元/天",
]
JD_DUTY_BLOCKS = [
    "1. 负责{area}方向的数据体系建设，对核心指标的准确性与时效性负责；",
    "2. 搭建并维护{area}的看板与报表，把分散在各处的数据收拢成同一套口径；",
    "3. 与产品、研发、运营协作，把{area}的结论推进到具体的功能或活动里；",
    "4. 定期输出{area}复盘报告，沉淀可复用的分析方法与模板；",
    "5. 参与年度规划，为{area}的预算与人力分配提供数据依据；",
    "6. 跟进行业动态，把外部可借鉴的做法引入团队并落地验证。",
]
JD_REQ_BLOCKS = [
    "1. 本科及以上学历，{major}相关专业优先；",
    "2. {years}年以上{area}相关经验，有独立负责模块的经历；",
    "3. 熟练使用 SQL 与 Excel，能独立完成数据提取、清洗与分析；",
    "4. 有良好的沟通表达，能把数据结论讲给非数据背景的同事听懂；",
    "5. 加分项：有{area}头部公司经验，或主导过从 0 到 1 的项目。",
]
JD_MAJORS = ["统计学", "计算机", "市场营销", "信息管理", "数学", "电子商务"]
JD_AREAS = ["用户增长", "商业分析", "供应链", "内容生态", "风控", "会员体系"]

SKILL_TAG_POOL = [
    {"name": "SQL", "category": "数据能力"},
    {"name": "Excel", "category": "数据能力"},
    {"name": "Python", "category": "编程语言"},
    {"name": "数据分析", "category": "数据能力"},
    {"name": "用户增长", "category": "业务能力"},
    {"name": "跨部门协作", "category": "软技能"},
    {"name": "活动策划", "category": "业务能力"},
    {"name": "文案撰写", "category": "业务能力"},
]

SURNAMES = ["张", "李", "王", "刘", "陈", "杨", "赵", "黄", "周", "吴", "徐", "孙", "林", "何"]
GIVEN_NAMES = ["示例", "晓桐", "沐辰", "书瑶", "嘉树", "知远", "云舒", "若谷", "见山", "听澜"]
PLACEHOLDER_PARA = (
    "本段为压力测试用的虚构文本：用于把条目撑到目标体积，观察列表、搜索与详情"
    "接口在长文本下的表现。内容本身不承载任何真实信息，随机编号 {n} 用来避免"
    "相邻段落完全相同，防止 SQLite 与 zlib 把重复文本压得过小。"
)

TEMPLATE_NAMES = [
    "classic",
    "modern",
    "compact",
    "elegant",
    "technical",
    "minimal",
    "editorial",
    "split",
]
RESUME_SUMMARIES = [
    "统计硕士，一年增长分析实习经验，擅长把口径收拢成一套可复用的看板。",
    "两段数据分析实习，覆盖增长与产品方向，习惯用数据解释结论。",
    "对指标字典与口径治理有实操经验，能独立完成从取数到复盘的全流程。",
    "压力测试用虚构简历，内容形态与真实简历一致。",
]

KNOWLEDGE_CATEGORIES = ("面试问答", "简历技巧", "求职策略", "行业认知", "谈薪技巧", "其他")

INTERVIEW_TYPES_ALL = (
    "技术面",
    "项目深挖",
    "行为面（STAR）",
    "HR 面",
    "综合面",
    "案例分析",
    "英语面试",
    "压力面",
)
DIFFICULTIES_ALL = ("初级", "中级", "高级")
STYLES_ALL = ("严谨专业", "温和引导", "持续追问", "压力质询")
EXPERIENCE_SOURCE_ALL = ("self", "peer", "public")
ROUND_TYPES_ALL = ("一面", "二面", "三面", "HR面", "笔试", "其他")

WEBFORM_KEYS = [
    "full_name",
    "phone",
    "email",
    "birth_date",
    "id_type",
    "id_number",
    "gender",
    "native_place",
    "political_status",
    "wechat",
    "qq",
    "cet4_score",
    "cet6_score",
    "emergency_contact",
    "emergency_phone",
    "height",
    "weight",
    "marital_status",
    "archive_location",
    "expected_salary",
    "available_date",
    "intern_days_per_week",
    "CUSTOM_导师姓名",
    "CUSTOM_实验室",
    "CUSTOM_意向事业群",
    "CUSTOM_内推码",
    "CUSTOM_申请编号",
    "CUSTOM_体检结论",
    "CUSTOM_荣誉补充",
    "CUSTOM_作品集链接",
]
WEBFORM_GROUPS = ("education", "family", "internship", "award", "project", "skill", "certificate")


def fake_name(index: int) -> str:
    return (
        SURNAMES[index % len(SURNAMES)] + GIVEN_NAMES[(index // len(SURNAMES)) % len(GIVEN_NAMES)]
    )


def recognition_source_of(source: str) -> str:
    """Value must land in schemas/job.py RECOGNITION_SOURCES whitelist."""
    if source == "官网采集":
        return "官网采集"
    return "岗位采集" if source in _COLLECTED_SOURCES else "手动填写"


def long_text(blocks: list[str], fillers: list[str], target_kb: float) -> str:
    """Concatenate numbered template paragraphs until size exceeds target_kb."""
    parts: list[str] = []
    size = 0
    index = 0
    while size < int(target_kb * 1024):
        template = blocks[index % len(blocks)]
        parts.append(template.format(area=fillers[index % len(fillers)], n=index))
        size += len(template) + 12
        index += 1
    return "\n".join(parts)
