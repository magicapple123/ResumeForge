"""生成一份**纯虚构**的大数据量压力测试数据集（独立库，绝不触碰 backend/data）。

用途：「大数据量极限体检」诊断阶段——只造数据 + 测量，不改任何业务代码。
输出库默认 ``runtime/stress/stress.db``（``runtime/`` 已被 .gitignore 忽略），
用户文件物理副本按应用自身的规则落在 ``<数据库同目录>/user_files/``，即
``runtime/stress/user_files/``——与真实用户数据目录天然隔离。

用法（在仓库根目录执行）：

    backend\\.venv\\Scripts\\python.exe scripts\\seed_stress_data.py
    backend\\.venv\\Scripts\\python.exe scripts\\seed_stress_data.py --check

``--check`` 需要 ``fastapi.testclient``（dev 依赖里已有），写完后把全部只读接口
跑一遍自检——压力数据写坏 schema 的后果是"某个页面打不开"，先自己撞一次墙。

启动隔离实例实测（在 backend 目录执行）：

    $env:DATABASE_URL = "sqlite:///D:/ResumeForge/runtime/stress/stress.db"
    .venv\\Scripts\\python.exe -m uvicorn app.main:app --port 9412

导入完成后把每张表行数、库体积与总耗时写到 ``runtime/stress/import_report.md``。
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import random
import struct
import sys
import time
import zipfile
import zlib
from datetime import datetime, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND))

DEFAULT_OUT = REPO_ROOT / "runtime" / "stress" / "stress.db"

# 数据的"现在"。与 seed_demo_data 同理用固定值：同一份脚本重跑结果可复现。
NOW = datetime(2026, 10, 12, 12, 0, 0)
EVENT_RANGE_START = datetime(2025, 8, 1, 0, 0, 0)
EVENT_RANGE_SECONDS = int((NOW - EVENT_RANGE_START).total_seconds())


def _preparse_out() -> Path:
    """在导入 app 之前把 ``--out`` 读出来。

    ``app.config`` 在**导入时**就通过 ``get_settings()`` 定下 ``database_url``
    （进程内缓存），所以环境变量必须先设好、后导入——顺序反了就还是会写到默认库上。
    """
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    known, _ = parser.parse_known_args()
    return Path(known.out).expanduser().resolve()


DB_PATH = _preparse_out()
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
os.environ["DATABASE_URL"] = "sqlite:///" + DB_PATH.as_posix()

# 断言隔离：环境变量必须指向 stress 路径，绝不允许退化到默认库。
_must_contain = "stress"
if _must_contain not in os.environ["DATABASE_URL"].casefold():
    raise SystemExit(f"DATABASE_URL 未指向 stress 库：{os.environ['DATABASE_URL']}")

from app.database import Base  # noqa: E402
from app.models import MATERIAL_CATEGORIES  # noqa: E402  # 导入即注册全部模型
from app.services.resume.resume_sample import sample_resume_content  # noqa: E402
from sqlalchemy import create_engine, func, insert, select  # noqa: E402

# 计时起点：模块级的批量插入都发生在导入阶段，从这一行起算到报告落盘为止。
START_TS = time.perf_counter()

rng = random.Random(20261012)

# 用户文件物理副本目录：与 services/user_files.user_files_dir 同一套规则
# （文件型 SQLite → 数据库同目录），因此应用读到的就是这里写出的文件。
USER_FILES_DIR = DB_PATH.parent / "user_files"
USER_FILES_DIR.mkdir(parents=True, exist_ok=True)

engine = create_engine("sqlite:///" + DB_PATH.as_posix())

# 先 drop 再 create，而不是先删文件：删文件会撞"文件被运行中的后端占用"与删除守卫，
# drop_all 对同一个文件同样能得到一份干净的库。
Base.metadata.drop_all(engine)
Base.metadata.create_all(engine)

T = Base.metadata.tables


def row(**kw):
    return kw


def ins(table: str, rows: list[dict], chunk: int = 400) -> None:
    """Core 批量插入：多值列表分片，避免单语句参数超限。"""
    if not rows:
        return
    for start in range(0, len(rows), chunk):
        with engine.begin() as conn:
            conn.execute(insert(T[table]), rows[start : start + chunk])


def date_str(value: datetime) -> str:
    return value.strftime("%Y-%m-%d")


def rand_dt(begin: datetime, end: datetime) -> datetime:
    """[begin, end) 内的随机时刻。"""
    span = int((end - begin).total_seconds())
    return begin + timedelta(seconds=rng.randint(0, max(span, 1)))


# ── 拟真词库（全部虚构）────────────────────────────────────────────────────
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
# 40 基名 × 3 后缀 = 120 家虚构公司，正好撑起 application_track 的唯一合并键。
COMPANIES = [b + s for b in COMPANY_BASES for s in COMPANY_SUFFIXES]

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


def fake_name(index: int) -> str:
    return (
        SURNAMES[index % len(SURNAMES)] + GIVEN_NAMES[(index // len(SURNAMES)) % len(GIVEN_NAMES)]
    )


def recognition_source_of(source: str) -> str:
    """取值落在 schemas/job.py 的 RECOGNITION_SOURCES 白名单里（踩过的坑见 seed_demo_data）。"""
    if source == "官网采集":
        return "官网采集"
    return "岗位采集" if source in _COLLECTED_SOURCES else "手动填写"


def long_text(blocks: list[str], fillers: list[str], target_kb: float) -> str:
    """把模板段落循环编号拼接，直到体积超过 target_kb。"""
    parts: list[str] = []
    size = 0
    index = 0
    while size < int(target_kb * 1024):
        template = blocks[index % len(blocks)]
        parts.append(template.format(area=fillers[index % len(fillers)], n=index))
        size += len(template) + 12
        index += 1
    return "\n".join(parts)


# ══ 个人资料 ═══════════════════════════════════════════════════════════════
ins(
    "user_profile",
    [
        row(
            id=1,
            name="张虚构",
            gender="女",
            birth_year="2001",
            birth_date="2001-05-12",
            phone="139-0000-0000",
            email="stress.example@example.com",
            city="上海",
            target_city="上海",
            job_intent="数据分析 / 数据产品",
            personal_website="https://example.com/stress",
            github="",
            photo="",
            summary="压力测试数据集的个人资料，全部为虚构内容。",
            section_order=[
                "experiences",
                "projects",
                "skills",
                "educations",
                "awards",
                "campus_experiences",
            ],
            wechat="stress_example",
            id_type="居民身份证",
            id_number="000000190001010000",
            country_region="中国",
            native_place="江苏",
            political_status="群众",
            phone_country_code="+86",
            family_info="父亲：张虚构（虚构）\n母亲：李示例（虚构）",
            expected_salary="18-25K",
            qq="1000000000",
            advisor="王虚构",
            research_direction="数据治理",
            preferred_industry="互联网 / 数据服务",
            updated_at=NOW,
        )
    ],
)

ins(
    "education",
    [
        row(
            profile_id=1,
            school="示例大学",
            department="数据科学学院",
            major="统计学",
            degree="本科",
            study_mode="全日制",
            degree_type="学士",
            start_date="2019.09",
            end_date="2023.06",
            gpa="3.6/4.0",
            cet4_score="568",
            cet6_score="532",
            courses="概率论；回归分析；数据挖掘；数据库系统",
            achievements="校三等奖学金一次",
            reference_file_name="",
            reference_content="",
        ),
        row(
            profile_id=1,
            school="示例财经大学",
            department="统计学院",
            major="应用统计",
            degree="硕士",
            study_mode="全日制",
            degree_type="硕士",
            start_date="2023.09",
            end_date="2026.06",
            gpa="3.7/4.0",
            cet4_score="",
            cet6_score="558",
            courses="多元统计；机器学习；贝叶斯方法",
            achievements="全国大学生统计建模大赛省二等奖",
            reference_file_name="",
            reference_content="",
        ),
    ],
)

ins(
    "experience",
    [
        row(
            profile_id=1,
            company="云帆科技有限公司",
            role="数据分析实习生",
            start_date="2025.07",
            end_date="2025.12",
            description=(
                "- 维护增长团队的日/周报看板，把口径从 3 份散表收拢成 1 套。\n"
                "- 参与一次拉新活动的复盘分析，给出渠道停投建议并被采纳。\n"
                "- 协助搭建活动数据核对清单，把口径问题从上线后发现提前到上线前。"
            ),
            reference_file_name="",
            reference_content="",
        ),
        row(
            profile_id=1,
            company="白泽信息技术有限公司",
            role="数据产品实习生",
            start_date="2024.07",
            end_date="2024.12",
            description=(
                "- 跟进指标字典项目，整理 60+ 指标的口径与负责人。\n"
                "- 参与需求评审，学习把分析结论翻译成功能需求。"
            ),
            reference_file_name="",
            reference_content="",
        ),
        row(
            profile_id=1,
            company="观澜游戏有限公司",
            role="运营助理（兼职）",
            start_date="2023.10",
            end_date="2024.05",
            description="- 负责社群日常维护与活动数据的手工汇总。",
            reference_file_name="",
            reference_content="",
        ),
    ],
)

ins(
    "campus_experience",
    [
        row(
            profile_id=1,
            organization="示例大学数据协会",
            role="副会长",
            start_date="2021.09",
            end_date="2022.06",
            description="- 组织数据技能工作坊 8 期，累计参与 400 余人次。",
            reference_file_name="",
            reference_content="",
        ),
        row(
            profile_id=1,
            organization="院学生会宣传部",
            role="干事",
            start_date="2020.09",
            end_date="2021.06",
            description="- 负责公众号推文排版与数据周报整理。",
            reference_file_name="",
            reference_content="",
        ),
    ],
)

ins(
    "project",
    [
        row(
            profile_id=1,
            name="校内二手书流转平台数据分析",
            role="数据分析",
            start_date="2024.03",
            end_date="2024.06",
            tech_stack="SQL,Excel,Python",
            description="- 对平台半年的成交数据做描述性分析与供需匹配建议。",
            highlights="- 给出的定价建议使滞销书目占比下降约 12%。",
            reference_file_name="",
            reference_content="",
        ),
        row(
            profile_id=1,
            name="统计建模竞赛：城市通勤流量预测",
            role="队长",
            start_date="2025.03",
            end_date="2025.06",
            tech_stack="Python,sklearn",
            description="- 用公开交通数据做短时流量预测，省赛二等奖。",
            highlights="- 完成特征工程与三个基线模型的对比报告。",
            reference_file_name="",
            reference_content="",
        ),
        row(
            profile_id=1,
            name="课程大作业：问卷数据的信效度检验",
            role="成员",
            start_date="2023.11",
            end_date="2024.01",
            tech_stack="SPSS",
            description="- 对 300 份问卷做信效度检验与因子分析。",
            highlights="",
            reference_file_name="",
            reference_content="",
        ),
    ],
)

ins(
    "skill",
    [
        row(profile_id=1, name="SQL", level="熟练"),
        row(profile_id=1, name="Excel", level="熟练"),
        row(profile_id=1, name="Python", level="掌握"),
        row(profile_id=1, name="SPSS", level="掌握"),
        row(profile_id=1, name="数据可视化", level="掌握"),
        row(profile_id=1, name="商务英语", level="了解"),
    ],
)

ins(
    "award",
    [
        row(profile_id=1, name="全国大学生统计建模大赛省二等奖", date="2025.06", description=""),
        row(profile_id=1, name="校三等奖学金", date="2022.10", description=""),
        row(profile_id=1, name="校优秀学生干部", date="2022.05", description=""),
    ],
)


# 一张 64×64 的灰度渐变小图：给 profile_photo 与个别 base64 字段用，控制在几 KB。
def tiny_png_data_url() -> str:
    width, height = 64, 64
    raw = bytearray()
    for _ in range(height):
        raw.append(0)
        raw += bytes((x * 4) % 256 for x in range(width * 3))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", ihdr),
            chunk(b"IDAT", zlib.compress(bytes(raw), 9)),
            chunk(b"IEND", b""),
        ]
    )
    return "data:image/png;base64," + base64.b64encode(png).decode()


ins(
    "profile_photo",
    [
        row(
            profile_id=1,
            name="证件照-虚构.png",
            image=tiny_png_data_url(),
            is_primary=True,
            created_at=NOW,
        ),
        row(
            profile_id=1,
            name="生活照-虚构.png",
            image=tiny_png_data_url(),
            is_primary=False,
            created_at=NOW,
        ),
    ],
)

# ══ 岗位（≥1200，含 20 条 10KB+ 超长 JD）══════════════════════════════════
JOB_COUNT = 1250


def job_description(long_mode: bool, index: int) -> str:
    area = JD_AREAS[index % len(JD_AREAS)]
    if long_mode:
        return long_text(JD_DUTY_BLOCKS, JD_AREAS, target_kb=10.5)
    return "\n".join(
        JD_DUTY_BLOCKS[i % len(JD_DUTY_BLOCKS)].format(area=area, n=i) for i in range(4)
    )


def job_requirements(index: int) -> str:
    area = JD_AREAS[index % len(JD_AREAS)]
    major = JD_MAJORS[index % len(JD_MAJORS)]
    years = ["1", "2", "3", "5"][index % 4]
    return "\n".join(block.format(area=area, major=major, years=years) for block in JD_REQ_BLOCKS)


JOB_ROWS: list[dict] = []
for i in range(JOB_COUNT):
    source = JOB_SOURCES[i % len(JOB_SOURCES)]
    job_type = JOB_TYPES[i % len(JOB_TYPES)]
    # 状态分布：约 50% 开放中 / 40% 已截止 / 10% 已投递
    if i % 10 < 5:
        status = JOB_STATUSES[0]
    elif i % 10 < 9:
        status = JOB_STATUSES[1]
    else:
        status = JOB_STATUSES[2]
    created_at = NOW - timedelta(hours=i * 2)
    job = row(
        id=i + 1,
        title=TITLES[i % len(TITLES)],
        company=COMPANIES[i % len(COMPANIES)],
        location=CITY_AREAS[i % len(CITY_AREAS)],
        salary=SALARIES[i % len(SALARIES)],
        job_type=job_type,
        description=job_description(i < 20, i),
        requirements=job_requirements(i),
        additional_info="五险一金、弹性上班、年度体检" if i % 3 == 0 else "",
        keywords=[SKILL_TAG_POOL[(i + k) % len(SKILL_TAG_POOL)] for k in range(3)],
        source=source,
        source_url=""
        if source in {"手动录入", "招聘网站"}
        else f"https://www.example.com/job/stress{i + 1}",
        posted_at=date_str(created_at - timedelta(days=3)),
        status=status,
        note="压力测试虚构岗位" if i % 9 == 0 else "",
        note_images=[],
        favorite=i % 7 == 0,
        recognition_source=recognition_source_of(source),
        origin_source=source,
        created_at=created_at,
        updated_at=created_at,
        deleted_at=NOW - timedelta(days=i % 29) if i % 16 == 5 else None,
    )
    JOB_ROWS.append(job)

ins("job", JOB_ROWS, chunk=250)

# ══ 备选岗位（≥400）═══════════════════════════════════════════════════════
CANDIDATE_COUNT = 420
ins(
    "candidate_job",
    [
        row(
            id=i + 1,
            title=TITLES[(i * 3) % len(TITLES)],
            company=COMPANIES[(i * 7) % len(COMPANIES)],
            raw_text=f"{TITLES[(i * 3) % len(TITLES)]} / {COMPANIES[(i * 7) % len(COMPANIES)]} / 上海 / 13-18K",
            images=[],
            note="招聘信息截图待核对" if i % 5 == 0 else "",
            source="manual" if i % 4 else "collect",
            job_type=JOB_TYPES[i % len(JOB_TYPES)],
            location=CITY_AREAS[i % len(CITY_AREAS)].split("·")[0],
            salary=SALARIES[i % len(SALARIES)],
            source_url="",
            description="",
            requirements="",
            additional_info="",
            collect_task_id=None,
            status="imported" if i % 3 == 0 else "pending",
            imported_job_id=(i % JOB_COUNT) + 1 if i % 3 == 0 else None,
            created_at=NOW - timedelta(hours=i * 3),
            updated_at=NOW - timedelta(hours=i * 3),
        )
        for i in range(CANDIDATE_COUNT)
    ],
)

# ══ 简历（≥600）═══════════════════════════════════════════════════════════
RESUME_COUNT = 620
base_content = sample_resume_content().model_dump()
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


def make_resume_content(index: int) -> dict:
    data = json.loads(json.dumps(base_content, ensure_ascii=False))
    data["job_intent"] = TITLES[index % len(TITLES)]
    data["summary"] = RESUME_SUMMARIES[index % len(RESUME_SUMMARIES)]
    return data


RESUME_ROWS: list[dict] = []
RESUME_CONTENTS: dict[int, dict] = {}
for i in range(RESUME_COUNT):
    job = JOB_ROWS[i % JOB_COUNT]
    content = make_resume_content(i)
    RESUME_CONTENTS[i + 1] = content
    parent = i + 1 - 50 if (i >= 50 and i % 12 == 0) else None
    RESUME_ROWS.append(
        row(
            id=i + 1,
            title=f"{job['title']} - {job['company']}（第{i + 1}版）",
            job_id=job["id"],
            job_title=job["title"],
            company=job["company"],
            content=content,
            warnings=[],
            source="manual" if i % 5 == 0 else "ai",
            favorite=i % 9 == 0,
            model="" if i % 5 == 0 else "deepseek-v4-flash",
            tone="standard",
            enhancement_enabled=i % 3 == 0,
            enhancement_level="strong" if i % 3 == 0 else "balanced",
            template=TEMPLATE_NAMES[i % len(TEMPLATE_NAMES)],
            format_name="standard" if i % 4 == 0 else "",
            format_config={"accent": "#16365c"} if i % 4 == 0 else {},
            page_limit=1 if i % 2 == 0 else 2,
            font_scale="standard",
            custom_instruction="突出量化结果" if i % 6 == 0 else "",
            note="压力测试虚构简历" if i % 11 == 0 else "",
            parse_error="",
            coverage_notes=[],
            fact_annotations=[],
            rationale="",
            created_at=NOW - timedelta(hours=i),
            deleted_at=NOW - timedelta(days=i % 21) if i % 21 == 3 else None,
            parent_revision_id=parent,
        )
    )

ins("resume_record", RESUME_ROWS, chunk=100)

# ══ 简历生成任务（≥300，覆盖全部状态）═════════════════════════════════════
GENERATE_STATUSES_ALL = ("pending", "running", "completed", "cancelled", "failed")
GENERATE_COUNT = 320
ins(
    "resume_generate_task",
    [
        row(
            id=i + 1,
            status=GENERATE_STATUSES_ALL[i % len(GENERATE_STATUSES_ALL)],
            resume_id=(i % RESUME_COUNT) + 1 if i % 5 == 2 else None,
            error="模型输出超时" if i % 5 == 4 else "",
            message="已完成" if i % 5 == 2 else ("正在生成" if i % 5 == 1 else ""),
            received_chars=rng.randint(0, 12000),
            job_id=(i % JOB_COUNT) + 1,
            title=f"{TITLES[i % len(TITLES)]} 简历生成任务 #{i + 1}",
            options={"tone": "standard", "page_limit": 1},
            created_at=NOW - timedelta(hours=i * 4),
            started_at=NOW - timedelta(hours=i * 4) + timedelta(minutes=1) if i % 5 != 0 else None,
            finished_at=NOW - timedelta(hours=i * 4) + timedelta(minutes=3)
            if i % 5 in (2, 3, 4)
            else None,
        )
        for i in range(GENERATE_COUNT)
    ],
)

# ══ 投递快照 resume_delivery_record（≥2500）═══════════════════════════════
DELIVERY_COUNT = 2560
DELIVERY_SOURCES_ALL = ("apply", "track", "export")
delivery_rows: list[dict] = []
for i in range(DELIVERY_COUNT):
    source = DELIVERY_SOURCES_ALL[i % 3]
    resume = RESUME_ROWS[i % RESUME_COUNT]
    job = JOB_ROWS[(i * 7) % JOB_COUNT]
    content = RESUME_CONTENTS[(i % RESUME_COUNT) + 1]
    is_export = source == "export"
    content_sha = hashlib.sha256(
        json.dumps(content, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    render_ctx = {
        "template": resume["template"],
        "template_html": "",
        "style_config": {},
        "format_config": resume["format_config"],
        "page_limit": resume["page_limit"],
        "font_scale": resume["font_scale"],
    }
    delivery_rows.append(
        row(
            resume_id=resume["id"],
            job_id=job["id"],
            track_id=((i * 11) % 1440) + 1 if source != "export" else None,
            source=source,
            resume_title=resume["title"],
            job_title=job["title"],
            company=job["company"],
            content=content,
            render_context=render_ctx,
            content_sha256=content_sha,
            rendered_config_sha256=hashlib.sha256(
                json.dumps(render_ctx, ensure_ascii=False, sort_keys=True).encode("utf-8")
            ).hexdigest(),
            export_format=("docx" if i % 2 else "html") if is_export else "",
            filename=f"{job['title']}-压力测试-{i + 1}." + ("docx" if i % 2 else "html")
            if is_export
            else "",
            pages=rng.randint(1, 2) if is_export else None,
            model="deepseek-v4-flash",
            created_at=NOW - timedelta(hours=int(i * 1.5)),
        )
    )
ins("resume_delivery_record", delivery_rows, chunk=100)

# ══ 投递批次 + 批次条目（任务 ≥300、条目 ≥2500）═══════════════════════════
TASK_STATUSES_ALL = (
    "pending",
    "running",
    "paused",
    "breaker_paused",
    "completed",
    "stopped",
    "failed",
)
TASK_COUNT = 320
ins(
    "apply_task",
    [
        row(
            id=i + 1,
            kind="apply" if i % 3 else "collect",
            status=TASK_STATUSES_ALL[i % len(TASK_STATUSES_ALL)],
            total=8,
            processed=8 if i % 7 != 0 else 3,
            succeeded=5,
            failed=2,
            skipped=1,
            current_step="idle" if i % 7 != 0 else "submitting",
            stop_reason={0: "done", 1: "user", 2: "breaker", 3: "error"}.get(i % 4, ""),
            config={"limit_per_task": 5, "interval_seconds": 45},
            message="已完成" if i % 4 == 0 else "",
            started_at=NOW - timedelta(hours=i * 6),
            finished_at=NOW - timedelta(hours=i * 6) + timedelta(minutes=20),
            created_at=NOW - timedelta(hours=i * 6),
        )
        for i in range(TASK_COUNT)
    ],
)

ITEM_STATUSES_ALL = ("pending", "running", "success", "failed", "skipped")
FAILURE_POOL = (
    "selector_invalid",
    "login_required",
    "captcha_required",
    "greeting_missing",
    "network_timeout",
    "file_upload_failed",
    "site_unsupported",
    "profile_insufficient",
    "unconfirmed",
    "unknown",
)
ITEM_COUNT = 2560
ins(
    "apply_task_item",
    [
        row(
            id=i + 1,
            task_id=(i % TASK_COUNT) + 1,
            job_id=(i * 13 % JOB_COUNT) + 1,
            job_title=JOB_ROWS[(i * 13) % JOB_COUNT]["title"],
            company=JOB_ROWS[(i * 13) % JOB_COUNT]["company"],
            resume_id=(i % RESUME_COUNT) + 1,
            resume_title=RESUME_ROWS[i % RESUME_COUNT]["title"],
            greeting="您好，我对这个岗位很感兴趣，方便聊聊吗？" if i % 4 else "",
            status=ITEM_STATUSES_ALL[i % len(ITEM_STATUSES_ALL)],
            failure_category=FAILURE_POOL[i % len(FAILURE_POOL)] if i % 5 == 3 else "",
            failure_detail="页面结构变化，控件未找到" if i % 5 == 3 else "",
            attempt=1 if i % 5 == 3 else 0,
            sort_order=i % 8,
            started_at=NOW - timedelta(hours=i * 2),
            finished_at=NOW - timedelta(hours=i * 2) + timedelta(minutes=2),
            created_at=NOW - timedelta(hours=i * 2),
            deleted_at=NOW - timedelta(days=i % 31) if i % 64 == 7 else None,
        )
        for i in range(ITEM_COUNT)
    ],
)

# ══ 投递队列（job_id 唯一）════════════════════════════════════════════════
ins(
    "apply_queue_item",
    [
        row(
            id=i + 1,
            job_id=(JOB_COUNT - 40 + i),
            job_title=JOB_ROWS[JOB_COUNT - 40 + i]["title"],
            company=JOB_ROWS[JOB_COUNT - 40 + i]["company"],
            resume_id=(i % RESUME_COUNT) + 1,
            greeting="您好，我在相关方向有实习经验，方便聊聊这个岗位吗？",
            sort_order=i,
            status=("pending", "skipped", "done")[i % 3],
            created_at=NOW - timedelta(hours=6 + i),
            updated_at=NOW - timedelta(hours=6 + i),
        )
        for i in range(40)
    ],
)

# ══ 岗位匹配分析（job_id 唯一）与批量匹配批次 ═════════════════════════════
MATCH_STATUSES_ALL = (
    "matched",
    "expression_gap",
    "evidence_insufficient",
    "real_gap",
    "to_confirm",
)
HARD_GATES_ALL = ("met", "unmet", "unknown")
# result 必须能通过 schemas/job_match.py 的 JobMatchResult 校验（extra=forbid），
# 否则 GET /api/jobs/{id}/match-analysis 会在响应序列化时 500（自检抓到的真实坑）。
ADMISSION_BY_STATUS = {
    "matched": "allow",
    "expression_gap": "allow",
    "evidence_insufficient": "needs_confirm",
    "real_gap": "block",
    "to_confirm": "needs_confirm",
}


def match_result(index: int) -> dict:
    status = MATCH_STATUSES_ALL[index % len(MATCH_STATUSES_ALL)]
    hard_gate = (
        "met"
        if status in ("matched", "expression_gap")
        else ("unmet" if status == "real_gap" else "unknown")
    )
    condition = {
        "label": "本科及以上",
        "jd_quote": "本科及以上学历，统计学相关专业优先",
        "status": status,
        "evidence": "示例大学 本科（虚构）" if status != "real_gap" else "资料中未提供",
    }
    return {
        "hard_conditions": [condition],
        "core_abilities": [
            {
                "label": "SQL 与数据分析",
                "jd_quote": "熟练使用 SQL 与 Excel",
                "status": "matched" if status != "real_gap" else "expression_gap",
                "evidence": "技能：SQL（熟练）",
            }
        ],
        "bonus_items": [],
        "hard_gate": hard_gate,
        "admission": ADMISSION_BY_STATUS[status],
        "advice": "压力测试虚构建议：补充量化结果并核对口径。",
        "notes": [],
    }


ins(
    "job_match_analysis",
    [
        row(
            id=i + 1,
            job_id=i + 1,
            job_title=JOB_ROWS[i]["title"],
            company=JOB_ROWS[i]["company"],
            result=match_result(i),
            hard_gate=match_result(i)["hard_gate"],
            requires_confirm=i % 5 in (2, 3),
            model="deepseek-v4-flash",
            created_at=NOW - timedelta(hours=i * 5),
            updated_at=NOW - timedelta(hours=i * 5),
        )
        for i in range(400)
    ],
)

ins(
    "job_match_batch",
    [
        row(
            id=i + 1,
            requested_count=20,
            completed_count=18,
            failed_count=2,
            items=[
                {
                    "job_id": (i * 20 + k) % JOB_COUNT + 1,
                    "title": TITLES[k % len(TITLES)],
                    "company": COMPANIES[k % len(COMPANIES)],
                    "conclusion": MATCH_STATUSES_ALL[k % len(MATCH_STATUSES_ALL)],
                }
                for k in range(20)
            ],
            model="deepseek-v4-flash",
            created_at=NOW - timedelta(days=i * 2),
            updated_at=NOW - timedelta(days=i * 2),
        )
        for i in range(6)
    ],
)

# ══ 事实台账 ══════════════════════════════════════════════════════════════
CLAIM_CATEGORIES_ALL = (
    "教育经历",
    "实习/工作",
    "项目经历",
    "校园经历",
    "专业技能",
    "荣誉奖项",
    "其他",
)
RESPONSIBILITY_ALL = ("参与", "负责模块", "主导方案或交付", "项目负责人")
VERIFICATION_ALL = ("已确认", "待确认", "已过期", "不采用")
ins(
    "claim_record",
    [
        row(
            id=i + 1,
            title=f"虚构主张 #{i + 1}：{CLAIM_CATEGORIES_ALL[i % len(CLAIM_CATEGORIES_ALL)]}",
            category=CLAIM_CATEGORIES_ALL[i % len(CLAIM_CATEGORIES_ALL)],
            subject=COMPANIES[i % len(COMPANIES)],
            source_fact="压力测试虚构事实：来自某次虚构项目的内部数据。",
            candidate_wording="把该虚构事实写成一句可放进简历的表述。",
            sources=[
                {"type": "pull_request", "location": "example/repo#1", "public": True, "note": ""}
            ],
            responsibility_level=RESPONSIBILITY_ALL[i % len(RESPONSIBILITY_ALL)],
            verification_status=VERIFICATION_ALL[i % len(VERIFICATION_ALL)],
            allowed_uses=["resume"] if i % 2 else ["resume", "interview"],
            interview_details={
                "decisions": ["口径怎么定"],
                "difficulties": [],
                "verification": [],
                "result": None,
            },
            boundary="只覆盖本人负责的部分。",
            risk_notes=[],
            last_verified=date_str(NOW - timedelta(days=i % 30)) if i % 4 == 0 else "",
            created_at=NOW - timedelta(days=i),
            updated_at=NOW - timedelta(days=i),
            deleted_at=NOW - timedelta(days=i % 17) if i % 17 == 5 else None,
        )
        for i in range(40)
    ],
)

# ══ 求职进度 + 轨迹事件 ═══════════════════════════════════════════════════
TRACK_COUNT = 1440  # 120 家公司 × 12 个岗位名，满足 (company_key, title_key) 唯一约束
TRACK_STATUSES_ALL = (
    "applied",
    "screening",
    "assessment",
    "interview",
    "offer",
    "rejected",
    "unknown",
)
CHANNELS_ALL = ("unknown", "referral", "official_website", "job_platform", "headhunter", "other")
TRACK_SOURCE_ALL = ("apply", "manual", "recognized")

track_rows: list[dict] = []
for i in range(TRACK_COUNT):
    company = COMPANIES[i // 12]
    title = TITLES[i % 12]
    status = TRACK_STATUSES_ALL[i % len(TRACK_STATUSES_ALL)]
    applied = rand_dt(EVENT_RANGE_START, NOW)
    track_rows.append(
        row(
            id=i + 1,
            company=company,
            title=title,
            company_key=company.casefold(),
            title_key=title.casefold(),
            status=status,
            stage_note={"interview": "二面", "assessment": "笔试", "offer": "意向已发"}.get(
                status, ""
            ),
            applied_at=date_str(applied),
            status_date=date_str(applied + timedelta(days=rng.randint(1, 20))),
            next_action="等通知" if status in ("applied", "screening") else "",
            next_action_date="",
            note="压力测试虚构进度" if i % 13 == 0 else "",
            evidence="收到通知邮件（虚构）" if i % 2 else "",
            job_id=(i % JOB_COUNT) + 1,
            resume_id=(i % RESUME_COUNT) + 1,
            resume_title=RESUME_ROWS[i % RESUME_COUNT]["title"],
            channel=CHANNELS_ALL[i % len(CHANNELS_ALL)],
            source=TRACK_SOURCE_ALL[i % len(TRACK_SOURCE_ALL)],
            created_at=applied,
            updated_at=applied + timedelta(days=rng.randint(1, 30)),
            deleted_at=NOW - timedelta(days=i % 23) if i % 73 == 9 else None,
        )
    )
ins("application_track", track_rows, chunk=250)

# 事件 ≥10000：每条 track 7 次基础推进 + 前 320 条各补 1 次。
# from/to 覆盖全部状态（含空起点），时间分布在 2025-08 ~ 2026-10-12。
STAGE_LADDER = [
    ("", "applied"),
    ("applied", "screening"),
    ("screening", "assessment"),
    ("assessment", "interview"),
    ("interview", "offer"),
]
event_rows: list[dict] = []
event_id = 0
for i in range(TRACK_COUNT):
    n_events = 8 if i < 320 else 7
    base_time = rand_dt(EVENT_RANGE_START, NOW)
    for k in range(n_events):
        event_id += 1
        if k < len(STAGE_LADDER):
            from_status, to_status = STAGE_LADDER[k]
        elif k == len(STAGE_LADDER):
            from_status, to_status = "interview", "rejected"
        else:
            from_status, to_status = ("screening", "screening") if k % 2 else ("applied", "applied")
        event_at = base_time + timedelta(days=k * rng.randint(3, 15))
        if event_at > NOW:
            event_at = NOW - timedelta(hours=event_id % 72)
        event_rows.append(
            row(
                track_id=i + 1,
                event_at=event_at,
                status_date=date_str(event_at),
                source=("user", "system")[k % 2],
                user_confirmed=bool(k % 2),
                from_status=from_status,
                to_status=to_status,
            )
        )
ins("application_track_event", event_rows, chunk=500)

# ══ 知识库（≥900，50 条 20KB+）════════════════════════════════════════════
KNOWLEDGE_CATEGORIES = ("面试问答", "简历技巧", "求职策略", "行业认知", "谈薪技巧", "其他")
KNOWLEDGE_COUNT = 920
knowledge_rows: list[dict] = []
for i in range(KNOWLEDGE_COUNT):
    category = KNOWLEDGE_CATEGORIES[i % len(KNOWLEDGE_CATEGORIES)]
    content = (
        long_text(
            ["知识条目 {n}：关于{area}的虚构方法与注意事项，供压力测试读取。"],
            KNOWLEDGE_CATEGORIES,
            target_kb=21.0,
        )
        if i < 50
        else "\n".join(
            f"{category}要点 {k}：这是压力测试用的虚构要点，编号 {i}-{k}。" for k in range(8)
        )
    )
    knowledge_rows.append(
        row(
            title=f"{category}笔记（{i + 1}）",
            category=category,
            tags=[category, "压力测试"] if i % 3 else [category],
            content=content,
            source="手动录入" if i % 4 else "面经导入",
            created_at=NOW - timedelta(hours=i * 2),
            updated_at=NOW - timedelta(hours=i * 2),
            deleted_at=NOW - timedelta(days=i % 19) if i % 19 == 4 else None,
        )
    )
ins("knowledge_entry", knowledge_rows, chunk=200)

# ══ 资料箱 material（≥320）════════════════════════════════════════════════
MATERIAL_COUNT = 320
ins(
    "material",
    [
        row(
            title=f"虚构资料（{i + 1}）：{MATERIAL_CATEGORIES[i % len(MATERIAL_CATEGORIES)]}",
            category=MATERIAL_CATEGORIES[i % len(MATERIAL_CATEGORIES)],
            content="压力测试用虚构资料正文，描述某次虚构活动或作品的要点。",
            url=f"https://example.com/stress-material/{i + 1}" if i % 3 == 0 else "",
            files=[
                {
                    "name": f"附件-{i + 1}.pdf",
                    "mime_type": "application/pdf",
                    "size_bytes": 102400 + i * 7,
                    "text": "附件提取文字（虚构）",
                }
            ]
            if i % 4 == 0
            else [],
            note="压力测试虚构资料" if i % 7 == 0 else "",
            created_at=NOW - timedelta(hours=i * 2),
            updated_at=NOW - timedelta(hours=i * 2),
            deleted_at=NOW - timedelta(days=i % 13) if i % 13 == 6 else None,
        )
        for i in range(MATERIAL_COUNT)
    ],
)

# ══ 提醒（≥120）═══════════════════════════════════════════════════════════
REMINDER_KINDS_ALL = ("interview", "assessment_deadline", "hr_reply", "other")
REMINDER_STATUSES_ALL = ("pending", "done", "dismissed")
ins(
    "reminder",
    [
        row(
            title=f"虚构提醒（{i + 1}）：{REMINDER_KINDS_ALL[i % len(REMINDER_KINDS_ALL)]}",
            remind_at=NOW + timedelta(days=rng.randint(-20, 30)),
            kind=REMINDER_KINDS_ALL[i % len(REMINDER_KINDS_ALL)],
            status=REMINDER_STATUSES_ALL[i % len(REMINDER_STATUSES_ALL)],
            track_id=(i % TRACK_COUNT) + 1,
            job_id=(i % JOB_COUNT) + 1,
            resume_id=(i % RESUME_COUNT) + 1,
            note="压力测试虚构提醒",
            created_at=NOW - timedelta(days=1),
            updated_at=NOW - timedelta(days=1),
            deleted_at=NOW - timedelta(days=i % 11) if i % 40 == 8 else None,
        )
        for i in range(120)
    ],
)

# ══ 内推（≥60）════════════════════════════════════════════════════════════
REFERRAL_STATUSES_ALL = ("active", "submitted", "closed", "invalid")
ins(
    "referral",
    [
        row(
            job_id=(i % JOB_COUNT) + 1,
            job_title=JOB_ROWS[i % JOB_COUNT]["title"],
            company=JOB_ROWS[i % JOB_COUNT]["company"],
            referrer_name=fake_name(i),
            referrer_contact=f"referral{i + 1}@example.com",
            relation=("前同事", "校友", "朋友", "网友")[i % 4],
            position=TITLES[i % len(TITLES)],
            channel=("同事", "校友", "官网内推码", "牛客")[i % 4],
            status=REFERRAL_STATUSES_ALL[i % len(REFERRAL_STATUSES_ALL)],
            track_id=(i % TRACK_COUNT) + 1,
            converted=False,
            submitted_at=date_str(NOW - timedelta(days=i)) if i % 2 else "",
            note="压力测试虚构内推",
            referral_code=f"REF-STRESS-{i + 1:04d}" if i % 2 else "",
            note_images=[],
            created_at=NOW - timedelta(days=i),
            updated_at=NOW - timedelta(days=i),
            deleted_at=NOW - timedelta(days=i % 15) if i % 30 == 3 else None,
        )
        for i in range(60)
    ],
)

# ══ 模拟面试（会话 ≥70 + 消息）════════════════════════════════════════════
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
INTERVIEW_SESSION_COUNT = 70
ins(
    "interview_session",
    [
        row(
            id=i + 1,
            title=f"虚构模拟面试（{i + 1}）：{TITLES[i % len(TITLES)]}",
            job_id=(i % JOB_COUNT) + 1,
            job_title=TITLES[i % len(TITLES)],
            company=COMPANIES[i % len(COMPANIES)],
            interview_type=INTERVIEW_TYPES_ALL[i % len(INTERVIEW_TYPES_ALL)],
            difficulty=DIFFICULTIES_ALL[i % len(DIFFICULTIES_ALL)],
            interviewer_style=STYLES_ALL[i % len(STYLES_ALL)],
            rounds=6,
            rounds_min=None,
            persona="严格但讲道理的虚构面试官",
            focus="量化结果与口径",
            status=("active", "finished")[i % 2],
            report=(
                {
                    "score": 70 + i % 20,
                    "dimensions": [],
                    "strengths": [],
                    "improvements": [],
                    "summary": "虚构报告",
                }
                if i % 2
                else {}
            ),
            model="deepseek-v4-flash",
            created_at=NOW - timedelta(hours=i * 5),
            updated_at=NOW - timedelta(hours=i * 5),
        )
        for i in range(INTERVIEW_SESSION_COUNT)
    ],
)

interview_message_rows: list[dict] = []
msg_time = NOW - timedelta(days=3)
for i in range(INTERVIEW_SESSION_COUNT):
    for k in range(6):
        msg_time += timedelta(minutes=2)
        interview_message_rows.append(
            row(
                session_id=i + 1,
                role=("interviewer", "user", "note")[k % 3],
                content=f"模拟面试第 {k + 1} 轮的虚构问答内容（会话 {i + 1}）。",
                context={},
                status="complete",
                error="",
                created_at=msg_time,
            )
        )
ins("interview_message", interview_message_rows)

# ══ 面经（≥40）════════════════════════════════════════════════════════════
EXPERIENCE_SOURCE_ALL = ("self", "peer", "public")
ROUND_TYPES_ALL = ("一面", "二面", "三面", "HR面", "笔试", "其他")
ins(
    "interview_experience",
    [
        row(
            title=f"虚构面经（{i + 1}）：{COMPANIES[i % len(COMPANIES)]} {TITLES[i % len(TITLES)]}",
            company=COMPANIES[i % len(COMPANIES)],
            position=TITLES[i % len(TITLES)],
            job_id=(i % JOB_COUNT) + 1,
            content="这是一条压力测试用的虚构面经正文，描述流程与被追问的要点。",
            questions=[
                "介绍一下你主导过的虚构项目？",
                "这个数字的口径是什么？",
                "如果预算减半你会怎么调整？",
            ],
            tags=["行为面", "压力测试"],
            source=EXPERIENCE_SOURCE_ALL[i % len(EXPERIENCE_SOURCE_ALL)],
            difficulty=DIFFICULTIES_ALL[i % len(DIFFICULTIES_ALL)],
            round_type=ROUND_TYPES_ALL[i % len(ROUND_TYPES_ALL)],
            interview_date=date_str(NOW - timedelta(days=i * 3)),
            created_at=NOW - timedelta(days=i * 3),
            updated_at=NOW - timedelta(days=i * 3),
            deleted_at=NOW - timedelta(days=i % 13) if i % 26 == 5 else None,
        )
        for i in range(40)
    ],
)

# ══ 面试复盘历史（≥30）════════════════════════════════════════════════════
ins(
    "interview_review_record",
    [
        row(
            job_id=(i % JOB_COUNT) + 1,
            job_title=TITLES[i % len(TITLES)],
            company=COMPANIES[i % len(COMPANIES)],
            resume_id=(i % RESUME_COUNT) + 1,
            resume_title=RESUME_ROWS[i % RESUME_COUNT]["title"],
            questions=["被追问的虚构问题一", "被追问的虚构问题二"],
            analysis={
                "framework": "STAR",
                "key_points": ["口径", "贡献"],
                "follow_up": [],
                "pitfalls": [],
            },
            suggestions=[
                {
                    "priority": "高",
                    "section": "经历",
                    "issue": "缺量化",
                    "suggestion": "补数字",
                    "evidence": "",
                }
            ],
            model="deepseek-v4-flash",
            created_at=NOW - timedelta(days=i * 2),
            updated_at=NOW - timedelta(days=i * 2),
            deleted_at=NOW - timedelta(days=i % 9) if i % 15 == 4 else None,
        )
        for i in range(30)
    ],
)

# ══ 个性化题库历史（≥30）══════════════════════════════════════════════════
ins(
    "question_bank_record",
    [
        row(
            job_id=(i % JOB_COUNT) + 1,
            job_title=TITLES[i % len(TITLES)],
            company=COMPANIES[i % len(COMPANIES)],
            resume_id=(i % RESUME_COUNT) + 1,
            resume_title=RESUME_ROWS[i % RESUME_COUNT]["title"],
            groups=[
                {
                    "type": "基础题",
                    "questions": [{"question": "虚构基础题", "purpose": "热身", "answer_hint": ""}],
                },
                {
                    "type": "深挖题",
                    "questions": [
                        {"question": "虚构深挖题", "purpose": "验证深度", "answer_hint": ""}
                    ],
                },
            ],
            model="deepseek-v4-flash",
            created_at=NOW - timedelta(days=i * 2),
            updated_at=NOW - timedelta(days=i * 2),
            deleted_at=NOW - timedelta(days=i % 9) if i % 15 == 7 else None,
        )
        for i in range(30)
    ],
)

# ══ 台账深挖（会话/契约/轮次）═════════════════════════════════════════════
EVIDENCE_ALL = ("verified", "partial", "unverified", "contradictory", "not_covered")
ins(
    "drill_session",
    [
        row(
            id=i + 1,
            title=f"虚构深挖会话（{i + 1}）",
            job_id=(i % JOB_COUNT) + 1,
            job_title=TITLES[i % len(TITLES)],
            company=COMPANIES[i % len(COMPANIES)],
            status=("active", "finished")[i % 2],
            feedback_policy=("deferred", "immediate")[i % 2],
            claim_ids=[(i % 40) + 1],
            max_questions=6,
            current_index=3,
            review={"summary": "虚构复盘"} if i % 2 else {},
            created_at=NOW - timedelta(days=i * 2),
            updated_at=NOW - timedelta(days=i * 2),
        )
        for i in range(20)
    ],
)
ins(
    "drill_contract",
    [
        row(
            id=i + 1,
            session_id=(i % 20) + 1,
            claim_id=(i % 40) + 1,
            claim_title=f"虚构主张 #{(i % 40) + 1}",
            question="这道题要验证的虚构主张是什么？",
            intent="验证口径与本人贡献",
            required_evidence=["数据来源", "本人分工"],
            followup_triggers=["口径含糊"],
            stop_condition="证据齐备或确认讲不清",
            status=EVIDENCE_ALL[i % len(EVIDENCE_ALL)],
            evidence_found=["内部台账"],
            missing=["外部佐证"],
            contradictions=[],
            followup_depth=i % 3,
            next_followup_kind=("metric", "decision")[i % 2],
            created_at=NOW - timedelta(days=i),
            updated_at=NOW - timedelta(days=i),
        )
        for i in range(60)
    ],
)
ins(
    "drill_turn",
    [
        row(
            session_id=(i % 20) + 1,
            contract_id=(i % 60) + 1,
            question="虚构追问：这个数字是怎么统计的？",
            answer="虚构回答：按周汇总去重后的报名数。",
            status=EVIDENCE_ALL[i % len(EVIDENCE_ALL)],
            feedback="继续追问口径" if i % 2 else "",
            next_question="" if i % 3 == 0 else "虚构追问：你的分工是？",
            created_at=NOW - timedelta(days=i % 20),
        )
        for i in range(120)
    ],
)

# ══ 求职助手（会话 ≥60、消息 ≥2400）═══════════════════════════════════════
CHAT_CONVERSATION_COUNT = 64
CHAT_MESSAGE_COUNT = 2560
ins(
    "chat_conversation",
    [
        row(
            id=i + 1,
            title=f"虚构助手对话（{i + 1}）：{TITLES[i % len(TITLES)]}怎么准备",
            # 会话 1 必须是 page：详情端点按 surface=page 过滤（自检钉住这一点）。
            surface="ball" if i % 8 == 7 else "page",
            pinned=i % 16 == 0,
            favorite=i % 8 == 0,
            archived=i % 20 == 0,
            group_name=("简历", "面试", "")[i % 3],
            created_at=NOW - timedelta(hours=i * 4),
            updated_at=NOW - timedelta(hours=i * 4),
            deleted_at=NOW - timedelta(days=i % 17) if i % 60 == 6 else None,
        )
        for i in range(CHAT_CONVERSATION_COUNT)
    ],
)

chat_message_rows: list[dict] = []
msg_time = NOW - timedelta(days=10)
for i in range(CHAT_MESSAGE_COUNT):
    msg_time += timedelta(minutes=1)
    role = "user" if i % 2 == 0 else "assistant"
    content = (
        f"虚构提问 {i}：请帮我看看这条经历怎么改？"
        if role == "user"
        else f"虚构回答 {i}：建议先把口径写清楚，再补一个量化结果，最后说明你的分工。"
    )
    chat_message_rows.append(
        row(
            conversation_id=(i % CHAT_CONVERSATION_COUNT) + 1,
            role=role,
            content=content,
            quoted_message_id=None,
            attachments=[],
            context={"job_ids": [(i % JOB_COUNT) + 1]} if i % 10 == 0 else {},
            status="complete",
            error="",
            model="" if role == "user" else "deepseek-v4-flash",
            created_at=msg_time,
        )
    )
ins("chat_message", chat_message_rows, chunk=250)

# ══ 助手技能 ══════════════════════════════════════════════════════════════
ins(
    "assistant_skill",
    [
        row(
            id=i + 1,
            name=f"虚构技能（{i + 1}）",
            description="压力测试用的虚构技能描述",
            prompt="请针对我给出的材料逐条提问，优先追问口径与本人贡献。",
            enabled=i % 4 != 0,
            source_name="",
            created_at=NOW - timedelta(days=i * 3),
            updated_at=NOW - timedelta(days=i * 3),
        )
        for i in range(8)
    ],
)
ins(
    "assistant_skill_file",
    [
        row(
            skill_id=(i % 8) + 1,
            path=f"docs/虚构资料-{i + 1}.md",
            content="技能包里的虚构知识文件内容。" * 20,
            size_bytes=15 * 20,
        )
        for i in range(16)
    ],
)

# ══ 用户自制的简历模板 ════════════════════════════════════════════════════
ins(
    "resume_template",
    [
        row(
            name=f"虚构样式模板（{i + 1}）",
            kind="style",
            description="压力测试虚构模板",
            html="<div class='resume'>{{ summary }}</div>",
            config={},
            source_name=f"template-{i + 1}.html",
            enabled=True,
            created_at=NOW - timedelta(days=i * 5),
            updated_at=NOW - timedelta(days=i * 5),
        )
        for i in range(2)
    ]
    + [
        row(
            name=f"虚构版式模板（{i + 1}）",
            kind="format",
            description="压力测试虚构版式",
            html="",
            config={"font_base": 14, "margin": 18},
            source_name="",
            enabled=True,
            created_at=NOW - timedelta(days=i * 5),
            updated_at=NOW - timedelta(days=i * 5),
        )
        for i in range(2)
    ],
)

# ══ 设置与模型配置 ════════════════════════════════════════════════════════
ins(
    "app_setting",
    [
        row(
            key="llm_config",
            value=json.dumps(
                {
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com/v1",
                    "api_key": "",
                    "model": "deepseek-v4-flash",
                    "temperature": 0.1,
                    "timeout_seconds": 120,
                    "max_tokens": 0,
                    "api_style": "openai",
                    "top_p": None,
                    "frequency_penalty": None,
                    "presence_penalty": None,
                    "seed": None,
                    "top_k": None,
                    "repetition_penalty": None,
                    "stop": [],
                    "thinking_budget": None,
                    "extra_body": {},
                },
                ensure_ascii=False,
            ),
        ),
        row(key="reminder_popup_on_start", value=json.dumps(False)),
    ],
)
ins(
    "llm_config_record",
    [
        row(
            name="压力测试配置一",
            provider="deepseek",
            base_url="https://api.deepseek.com/v1",
            api_key="",
            model="deepseek-v4-flash",
            temperature=0.1,
            timeout_seconds=120,
            max_tokens=0,
            api_style="openai",
            top_p=None,
            frequency_penalty=None,
            presence_penalty=None,
            seed=None,
            top_k=None,
            repetition_penalty=None,
            stop=[],
            thinking_budget=None,
            thinking_enabled=False,
            thinking_effort="",
            thinking_style="auto",
            extra_body={},
            created_at=NOW - timedelta(days=5),
            updated_at=NOW - timedelta(days=5),
        ),
        row(
            name="压力测试配置二",
            provider="custom",
            base_url="https://llm.example.com/v1",
            api_key="",
            model="fictional-model",
            temperature=0.2,
            timeout_seconds=60,
            max_tokens=0,
            api_style="openai",
            top_p=None,
            frequency_penalty=None,
            presence_penalty=None,
            seed=None,
            top_k=None,
            repetition_penalty=None,
            stop=[],
            thinking_budget=None,
            thinking_enabled=False,
            thinking_effort="",
            thinking_style="auto",
            extra_body={},
            created_at=NOW - timedelta(days=3),
            updated_at=NOW - timedelta(days=3),
        ),
    ],
)

# ══ 离线分享包（≥12）══════════════════════════════════════════════════════
ins(
    "share_package",
    [
        row(
            title=f"虚构分享包（{i + 1}）",
            resume_id=(i % RESUME_COUNT) + 1,
            job_id=(i % JOB_COUNT) + 1,
            files=[
                {
                    "name": f"share-{i + 1}.html",
                    "path": f"runtime/stress/share-{i + 1}.html",
                    "format": "html",
                    "size": 20480,
                    "sha256": hashlib.sha256(f"share-{i + 1}".encode()).hexdigest(),
                }
            ],
            permission=("read_only", "comment")[i % 2],
            snapshot=RESUME_CONTENTS[(i % RESUME_COUNT) + 1],
            comments_file="",
            share_token=f"SP-STRESS-{i + 1:08d}",
            redaction_config={"redact_phone": True},
            created_at=NOW - timedelta(days=i),
            updated_at=NOW - timedelta(days=i),
            deleted_at=NOW - timedelta(days=i % 13) if i % 24 == 2 else None,
        )
        for i in range(12)
    ],
)

# ══ 网申资料：字段键值 + 分组记录（大量组与字段）══════════════════════════
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
ins(
    "web_form_profile_entry",
    [
        row(
            field_key=WEBFORM_KEYS[i % len(WEBFORM_KEYS)],
            value=f"虚构值-{i + 1}",
            label=WEBFORM_KEYS[i % len(WEBFORM_KEYS)].removeprefix("CUSTOM_"),
            source=("manual", "learned")[i % 2],
            reuse=("general", "scenario", "once")[i % 3],
            created_at=NOW - timedelta(days=i % 40),
            updated_at=NOW - timedelta(days=i % 40),
        )
        for i in range(60)
    ],
)

WEBFORM_GROUPS = ("education", "family", "internship", "award", "project", "skill", "certificate")
ins(
    "web_form_profile_record",
    [
        row(
            group_key=WEBFORM_GROUPS[i % len(WEBFORM_GROUPS)],
            sort_order=i % 40,
            values={
                "name": fake_name(i),
                "school": "示例大学" if i % 2 else "示例财经大学",
                "major": JD_MAJORS[i % len(JD_MAJORS)],
                "start": "2019.09",
                "end": "2023.06",
                "detail": f"压力测试虚构分组记录 {i + 1}",
            },
            created_at=NOW - timedelta(hours=i * 6),
            updated_at=NOW - timedelta(hours=i * 6),
        )
        for i in range(240)
    ],
)

ins(
    "web_form_fill_record",
    [
        row(
            url=f"https://careers.example.com/apply/{i + 1}",
            page_title=f"虚构招聘表单（{i + 1}）",
            items=[
                {
                    "index": k,
                    "field": "full_name" if k == 0 else f"field_{k}",
                    "field_label": "姓名" if k == 0 else f"字段 {k}",
                    "control_label": f"控件 {k}",
                    "value": "张虚构" if k == 0 else f"值{k}",
                    "status": "filled" if k % 4 else ("unverified" if k % 4 == 1 else "failed"),
                    "detail": "",
                    "source": "profile",
                }
                for k in range(10)
            ],
            filled=7,
            unverified=2,
            failed=1,
            page_snapshot=[
                {"index": k, "label": f"字段 {k}", "value": f"值{k}", "filled": k % 4 != 1}
                for k in range(10)
            ],
            source=("batch", "live")[i % 2],
            created_at=NOW - timedelta(hours=i * 8),
            updated_at=NOW - timedelta(hours=i * 8),
            deleted_at=NOW - timedelta(days=i % 21) if i % 35 == 6 else None,
        )
        for i in range(80)
    ],
)

ins(
    "web_form_url_history",
    [
        row(
            url=f"https://careers.example.com/apply/history/{i + 1}",
            title=f"虚构网申页（{i + 1}）",
            created_at=NOW - timedelta(days=i),
            last_used_at=NOW - timedelta(days=i),
        )
        for i in range(40)
    ],
)


# ══ 用户文件副本（≥300：图片 120 / PDF 50 / docx 50 / md+txt 90）═══════════
def png_chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def make_png_bytes(target: int) -> bytes:
    """噪声 PNG（压缩率≈1，体积可预测），用 tEXt 块补齐到目标体积附近。"""
    height = 320
    width = max(64, int(target * 0.75) // (3 * height + 1))
    raw = bytearray()
    for _ in range(height):
        raw.append(0)
        raw += rng.randbytes(3 * width)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    body = b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            png_chunk(b"IHDR", ihdr),
            png_chunk(b"IDAT", zlib.compress(bytes(raw), 6)),
        ]
    )
    for _ in range(2):
        pad_needed = target - len(body) - 24
        if pad_needed <= 0:
            break
        payload = b"Comment\x00" + base64.b64encode(rng.randbytes(max(pad_needed * 3 // 4, 16)))
        body += png_chunk(b"tEXt", payload[: max(pad_needed - 12, 16)])
    return body + png_chunk(b"IEND", b"")


def make_pdf_bytes(title: str, pad_kb: float) -> bytes:
    """最小合法 PDF（含 xref），内容流里用注释行补齐体积。"""
    filler = "\n".join(f"% pad {rng.randrange(10**9):09d}" for _ in range(int(pad_kb * 1024 / 16)))
    stream = f"BT /F1 12 Tf 72 770 Td ({title}) Tj ET\n{filler}\n"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        "/Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(stream.encode())} >>\nstream\n{stream}endstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for number, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{obj}\nendobj\n".encode()
    xref_pos = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode()
    return bytes(out)


def make_docx_bytes(paragraphs: int) -> bytes:
    """用 zipfile 造最小合法 docx。"""
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-'
        'officedocument.wordprocessingml.document.main+xml"/></Types>'
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
        'relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    )
    body = "".join(
        f"<w:p><w:r><w:t>压力测试虚构段落 {index}</w:t></w:r></w:p>" for index in range(paragraphs)
    )
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body></w:document>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("word/document.xml", document)
    return buffer.getvalue()


user_file_rows: list[dict] = []


def register_user_file(original_name: str, mime: str, payload: bytes, source_type: str) -> None:
    sha = hashlib.sha256(payload).hexdigest()
    safe = original_name
    disk_name = f"{sha[:16]}-{safe}"[:160]
    (USER_FILES_DIR / disk_name).write_bytes(payload)
    user_file_rows.append(
        row(
            sha256=sha,
            disk_name=disk_name,
            original_name=original_name,
            mime=mime,
            size=len(payload),
            source_type=source_type,
            source_ref=f"{source_type}:{len(user_file_rows) + 1}",
            sources_json=json.dumps([{"source_type": source_type, "source_ref": source_type}]),
            created_at=NOW - timedelta(hours=len(user_file_rows)),
        )
    )


for i in range(120):
    target = int(rng.uniform(0.3 * 1024 * 1024, 2.0 * 1024 * 1024))
    register_user_file(
        f"压力测试截图-{i + 1}.png",
        "image/png",
        make_png_bytes(target),
        ("material", "photo", "job_note", "candidate_image")[i % 4],
    )
for i in range(50):
    register_user_file(
        f"压力测试文档-{i + 1}.pdf",
        "application/pdf",
        make_pdf_bytes(f"ResumeForge stress placeholder {i + 1}", pad_kb=rng.uniform(30, 120)),
        "material",
    )
for i in range(50):
    register_user_file(
        f"压力测试简历-{i + 1}.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        make_docx_bytes(200 + i * 10),
        "material",
    )
for i in range(50):
    register_user_file(
        f"压力测试笔记-{i + 1}.md",
        "text/markdown",
        (
            "\n\n".join(
                f"# 虚构笔记 {i + 1}-{k}\n\n{PLACEHOLDER_PARA.format(n=k)}" for k in range(30)
            )
        ).encode(),
        "chat_attachment" if i % 2 else "material",
    )
for i in range(40):
    register_user_file(
        f"压力测试记录-{i + 1}.txt",
        "text/plain",
        (
            "\n".join(f"虚构记录行 {i + 1}-{k} {PLACEHOLDER_PARA.format(n=k)}" for k in range(200))
        ).encode(),
        "job_note" if i % 2 else "chat_attachment",
    )
ins("user_file", user_file_rows)


# ══ 自检 + 导入报告 ═══════════════════════════════════════════════════════
def table_counts() -> dict[str, int]:
    counts: dict[str, int] = {}
    with engine.begin() as conn:
        for name, table in sorted(T.items()):
            counts[name] = int(conn.execute(select(func.count()).select_from(table)).scalar() or 0)
    return counts


CHECKS = [
    "/api/health",
    "/api/profile",
    "/api/profile/photos",
    "/api/jobs?page=1&page_size=10",
    "/api/jobs/1",
    "/api/candidate-jobs",
    "/api/candidate-jobs/1",
    "/api/resumes?page=1&page_size=10",
    "/api/resumes/1",
    "/api/resumes/templates",
    "/api/resume-templates",
    "/api/claims",
    "/api/claims/1",
    "/api/materials",
    "/api/materials/1",
    "/api/knowledge?page_size=10",
    "/api/knowledge/categories",
    "/api/tracker",
    "/api/tracker/export?format=csv",
    "/api/reminders",
    "/api/referrals",
    "/api/referrals/stats",
    "/api/interview",
    "/api/interview-experiences",
    "/api/interview/question-banks",
    "/api/interview/reviews",
    "/api/drill",
    "/api/assistant/conversations?limit=100",
    "/api/assistant/conversations/1",
    "/api/assistant/skills",
    "/api/apply/queue",
    "/api/apply/records?page=1&page_size=10",
    "/api/apply/records/grouped?page=1&page_size=10",
    "/api/apply/tasks",
    "/api/apply/tasks/current",
    "/api/apply/config",
    "/api/share-packages",
    "/api/trash",
    "/api/settings/llm",
    "/api/settings/llm/records",
    "/api/stats",
    "/api/stats/storage",
    "/api/analytics/dashboard?trend_months=6",
    "/api/search?q=%E8%99%9A%E6%9E%84",
    "/api/user-files?page=1&page_size=10",
    "/api/webform/fields",
    "/api/webform/extra-profile",
    "/api/webform/records",
    "/api/webform/url-history",
]


def run_checks() -> int:
    from app.main import app  # noqa: E402,PLC0415
    from fastapi.testclient import TestClient  # noqa: E402,PLC0415

    client = TestClient(app, raise_server_exceptions=False)
    failures: list[str] = []
    for path in CHECKS:
        response = client.get(path)
        if response.status_code >= 400:
            failures.append(f"{response.status_code} {path} :: {response.text[:200]}")
    if failures:
        print("压力数据自检未通过：")
        for item in failures:
            print("  " + item.replace("\n", " "))
        return len(failures)
    print(f"压力数据自检通过：{len(CHECKS)} 个只读接口全部正常。")
    return 0


def write_import_report(counts: dict[str, int], elapsed: float) -> list[str]:
    db_size = DB_PATH.stat().st_size
    user_files_files = list(USER_FILES_DIR.iterdir())
    user_files_size = sum(p.stat().st_size for p in user_files_files)
    lines = [
        "# 压力测试数据集导入报告",
        "",
        f"- 生成时间：{NOW.isoformat()}（固定锚点，非真实运行时刻）",
        f"- 数据库：`{DB_PATH}`，体积 {db_size / 1024 / 1024:.1f} MB",
        f"- 用户文件副本：`{USER_FILES_DIR}`，共 {len(user_files_files)} 个文件，"
        f"合计 {user_files_size / 1024 / 1024:.1f} MB",
        f"- 导入总耗时：{elapsed:.1f} 秒",
        "",
        "| 表 | 行数 |",
        "| --- | ---: |",
    ]
    empty_tables = [name for name, count in counts.items() if count == 0]
    for name in sorted(counts):
        lines.append(f"| {name} | {counts[name]} |")
    lines.append("")
    lines.append(f"全部 {len(counts)} 张表均有数据，空表：{empty_tables or '无'}。")
    report_path = DB_PATH.parent / "import_report.md"
    report_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"导入报告已写入 {report_path}")
    return empty_tables


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="生成纯虚构的大数据量压力测试数据集")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="压力库的输出路径")
    parser.add_argument("--check", action="store_true", help="写完后把只读接口跑一遍自检")
    arguments = parser.parse_args()

    elapsed = time.perf_counter() - START_TS
    counts = table_counts()
    print(f"压力数据集已写入 {DB_PATH}")
    write_import_report(counts, elapsed)
    print(f"导入总耗时：{elapsed:.1f} 秒")
    if Path(arguments.out).expanduser().resolve() != DB_PATH:
        print(f"警告：实际写入路径 {DB_PATH} 与 --out {arguments.out} 不一致。", file=sys.stderr)
        raise SystemExit(2)
    if arguments.check:
        raise SystemExit(run_checks())
