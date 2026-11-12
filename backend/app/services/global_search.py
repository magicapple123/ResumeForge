# SPDX-License-Identifier: Apache-2.0
"""全局搜索的取数层：岗位、简历记录，以及内推/提醒/面经/台账/资料/我的资料。

从 ``api/search.py`` 搬下来的（读路径第二批）。路由只保留参数声明与 ``response_model``，
查询、FTS 回退与可见性判据全在这里——按"路由不写业务"的约定。

旧的 ``jobs`` / ``resumes`` 字段保持不变；六个新数据域统一放进 ``more``（``SearchHit``），
旧调用方完全无感。扩展域只在 ``scope in ("all", "more")`` 时查询，``scope="jobs"`` 或
``"resumes"`` 时仍只查单一域，语义不变。

检索路径（2026-10 万级数据优化批）：各域优先走迁移 ``0046_search_fts`` 建的
FTS5 trigram 全文索引（见 ``services/search_fts``），子串语义与原 LIKE 一致；
FTS 表不存在（历史库/旧 SQLite）或关键词不足 3 字符时回退原 ``LIKE '%kw%'``。
两路结果一致由 ``tests/test_search_fts.py`` 的对照测试钉住。「我的资料」域刻意保留
LIKE（个人资料条目带软删、量级几十~几百/库，为 JSON 列建 FTS 的维护成本远大于收益——
理由见 search_fts 模块注释）。

**技能域已下线**（2026-11）：旧六表里的 ``Skill`` 在迁移 0064 之后没有任何写入方
（``PUT /api/profile`` 已无生产调用点），继续搜它只会与 ``profile_entry`` 里的同名技能
产生重复命中。同一件事只保留一个来源。

排序：全部按 ``created_at DESC, id DESC``。``id`` 决胜是 FTS 化批引入的——
批量导入的行常常共享同一秒的 ``created_at``，平局时 SQLite 的返回顺序取决于
查询计划（LIKE 扫描与 FTS ``id IN (MATCH)`` 的计划不同），不加决胜两路就会
在平局上给出不同顺序；决胜后任何计划下顺序都确定。
"""

from urllib.parse import quote

from sqlalchemy import String, and_, cast, func, or_, select, true
from sqlalchemy.orm import Session

from ..models.claim import ClaimRecord
from ..models.interview_experience import InterviewExperience
from ..models.job import Job
from ..models.material import Material
from ..models.profile_definition import ProfileCustomSection
from ..models.profile_entry import ProfileEntry
from ..models.referral import Referral
from ..models.reminder import Reminder
from ..models.resume import ResumeRecord, saved_only
from ..schemas.job import JobListOut
from ..schemas.resume import ResumeBrief
from ..schemas.search import SearchHit, SearchResult
from . import search_fts, trash
from .profile import field_preferences
from .search_matching import LIKE_ESCAPE, like_pattern, normalized_term

# 关键词的 LIKE 形态与各域被检索的字段。字段清单必须与
# ``search_fts.SEARCH_FTS_SPECS`` 里同一张表的 FTS 列一一对应。
_JOBS_COLUMNS = (
    Job.title,
    Job.company,
    Job.location,
    Job.description,
    Job.additional_info,
    Job.note,
)
_RESUMES_COLUMNS = (
    ResumeRecord.title,
    ResumeRecord.job_title,
    ResumeRecord.company,
    cast(ResumeRecord.content, String),
)


def _keyword_filter(db: Session, model: type, base_table: str, term: str, columns):
    """关键词过滤：FTS 可用走 ``MATCH``（按 id 关联），否则回退多列 ``LIKE``。

    两路语义由 ``services/search_matching`` 统一（RR-07）：用户输入一律当**字面子串**，
    ``%``/``_`` 在 LIKE 侧显式转义、在 FTS 侧本来就是字面量；前后空白不丢。软删除过滤
    不在这里——它由调用方的 ``trash.live_only`` 承担（FTS 索引里保留软删行，靠查询侧
    排除，见 search_fts 注释）。纯空白关键词不加过滤（与知识库检索同一口径）。
    """
    if not normalized_term(term):
        return true()
    fts_filter = search_fts.id_match_filter(db, model, base_table, term)
    like = like_pattern(term)
    exact = or_(*(column.like(like, escape=LIKE_ESCAPE) for column in columns))
    # Trigram Unicode folding can differ even for ASCII queries. FTS only supplies candidates.
    return and_(fts_filter, exact) if fts_filter is not None else exact


def _profile_title(entry: ProfileEntry, excluded: frozenset[str] = frozenset()) -> str:
    """条目标题：``values`` 里第一个**可搜索**的非空文本（条目没有固定标题列）。

    与回收站 ``trash._profile_entry_title`` 同一口径：按保存顺序取第一项，用户填的第一项
    通常最能认出这是哪一条；全空时如实显示无标题，不猜内容。

    7-B 的差别只有一处：跳过 ``excluded``（``hidden ∪ private``）里字段 id。否则"隐藏了
    字段、标题却把隐藏值显示出来"——开关的承诺当场失真。``excluded`` 默认空集合是为了
    让本函数仍可被单独调用（回收站/调试）。
    """
    values = entry.values if isinstance(entry.values, dict) else {}
    for field_id, value in values.items():
        if str(field_id) in excluded:
            continue
        text = str(value or "").strip()
        if text:
            # 结果行只放一行摘要：多行字段的第一段可能上千字，整段塞进标题会让弹层爆版。
            return text[:60]
    return "（无标题）"


def _profile_values_filter(excluded: frozenset[str], term: str):
    """「我的资料」条目的**可搜索值**条件（7-B）：至少存在一个可见值满足匹配语义。

    ``excluded`` 来自 ``field_preferences.search_excluded_field_ids``（``hidden ∪ private``，
    不含 ``material_only``）——判据只有那一份，本模块不再写查询。

    三件事一次做完（此前只做了第二件）：
    1. ``json_each`` 的 ``key`` 必须不在 ``excluded`` 里（隐藏/私密字段的值不参与匹配）；
    2. 有关键词 → 值按 LIKE 字面子串匹配；无关键词（纯空白）→ 只要求值非空；
    3. 两条分支都要求"存在这样一个值"，于是**全部值都被隐藏**的条目连空关键词搜索都不
       出现——与 ``profile_reader._consume_entries`` 把空壳条目按"没数据"处理同口径。

    ``type = 'text'`` 一并限定：``values`` 是 ``dict[str, str]``，历史行若混进嵌套结构，
    对它做 LIKE 只会产生无意义的命中（取值语义也是文本）。
    """
    values = func.json_each(ProfileEntry.values).table_valued("key", "value", "type")
    conditions = [values.c["type"] == "text"]
    if excluded:
        conditions.append(values.c.key.notin_(sorted(excluded)))
    if normalized_term(term):
        conditions.append(values.c.value.like(like_pattern(term), escape=LIKE_ESCAPE))
    else:
        conditions.append(func.trim(values.c.value) != "")
    return select(1).select_from(values).where(and_(*conditions)).exists()


def _custom_section_names(db: Session, section_keys: list[str]) -> dict[str, str]:
    """自建板块 key → 用户起的板块名（只查本批命中用到的 key，避免逐条查询）。"""
    custom_keys = [key for key in section_keys if key.startswith("custom:")]
    if not custom_keys:
        return {}
    rows = (
        db.query(ProfileCustomSection.key, ProfileCustomSection.name)
        .filter(
            ProfileCustomSection.key.in_(custom_keys),
            ProfileCustomSection.deleted_at.is_(None),
        )
        .all()
    )
    return {key: name for key, name in rows}


def _search_more(db: Session, term: str, limit: int) -> list[SearchHit]:
    """检索六个扩展数据域，返回按域分组的 ``SearchHit`` 列表。

    每域只取 ``limit`` 条、按创建时间倒序；全部套 ``trash.live_only`` 过滤软删除
    （包括「我的资料」的条目——回收站里的条目不该出现在搜索结果里）。
    """
    hits: list[SearchHit] = []

    referral_rows = (
        db.query(Referral)
        .filter(trash.live_only(Referral))
        .filter(
            _keyword_filter(
                db,
                Referral,
                "referral",
                term,
                (
                    Referral.job_title,
                    Referral.company,
                    Referral.referrer_name,
                    Referral.position,
                    Referral.note,
                ),
            )
        )
        .order_by(Referral.created_at.desc(), Referral.id.desc())
        .limit(limit)
        .all()
    )
    hits.extend(
        SearchHit(
            type="referral",
            id=row.id,
            title=row.job_title or row.position or "未命名内推",
            subtitle=row.company or row.referrer_name or "",
            path="/apply",
        )
        for row in referral_rows
    )

    reminder_rows = (
        db.query(Reminder)
        .filter(trash.live_only(Reminder))
        .filter(_keyword_filter(db, Reminder, "reminder", term, (Reminder.title, Reminder.note)))
        .order_by(Reminder.created_at.desc(), Reminder.id.desc())
        .limit(limit)
        .all()
    )
    hits.extend(
        SearchHit(
            type="reminder",
            id=row.id,
            title=row.title or "未命名提醒",
            subtitle=(row.note or "")[:50],
            path="/tracker",
        )
        for row in reminder_rows
    )

    experience_rows = (
        db.query(InterviewExperience)
        .filter(trash.live_only(InterviewExperience))
        .filter(
            _keyword_filter(
                db,
                InterviewExperience,
                "interview_experience",
                term,
                (
                    InterviewExperience.title,
                    InterviewExperience.company,
                    InterviewExperience.position,
                    InterviewExperience.content,
                ),
            )
        )
        .order_by(InterviewExperience.created_at.desc(), InterviewExperience.id.desc())
        .limit(limit)
        .all()
    )
    hits.extend(
        SearchHit(
            type="experience",
            id=row.id,
            title=row.title or row.position or "未命名面经",
            subtitle=row.company or "",
            path="/interview",
        )
        for row in experience_rows
    )

    claim_rows = (
        db.query(ClaimRecord)
        .filter(trash.live_only(ClaimRecord))
        .filter(
            _keyword_filter(
                db,
                ClaimRecord,
                "claim_record",
                term,
                (
                    ClaimRecord.title,
                    ClaimRecord.category,
                    ClaimRecord.subject,
                    ClaimRecord.source_fact,
                    ClaimRecord.candidate_wording,
                ),
            )
        )
        .order_by(ClaimRecord.created_at.desc(), ClaimRecord.id.desc())
        .limit(limit)
        .all()
    )
    hits.extend(
        SearchHit(
            type="claim",
            id=row.id,
            title=row.title or row.subject or "未命名事实",
            subtitle=row.category or "",
            path="/claims",
        )
        for row in claim_rows
    )

    material_rows = (
        db.query(Material)
        .filter(trash.live_only(Material))
        .filter(
            _keyword_filter(
                db,
                Material,
                "material",
                term,
                (
                    Material.title,
                    Material.category,
                    Material.content,
                    Material.note,
                    Material.url,
                ),
            )
        )
        .order_by(Material.created_at.desc(), Material.id.desc())
        .limit(limit)
        .all()
    )
    hits.extend(
        SearchHit(
            type="material",
            id=row.id,
            title=row.title or "未命名资料",
            subtitle=row.category or "",
            path="/materials",
        )
        for row in material_rows
    )

    # 「我的资料」域：values 是 JSON 列，逐值做子串匹配。
    # **不能**用 ``cast(values, String).like``：SQLAlchemy 写库时用 ``json.dumps`` 默认
    # ``ensure_ascii=True``，中文在列里是 ``"\u6e05\u534e"`` 这样的转义文本，直接 LIKE
    # 「清华」永远不命中。``json_each`` 会把每个值解成真实正文，匹配语义仍是 LIKE 子串。
    # 刻意不做 FTS：条目量级小，且 trigram 虚拟表 + 触发器的维护成本远大于收益。
    # 纯空白关键词不加过滤——与其余各域（``_keyword_filter``）同一口径。
    #
    # 7-B：本域是唯一"直接读存储层原始行"的出口，因此必须自己接上可见性判据
    # （``hidden ∪ private``），否则隐藏字段仍能被搜到、标题也会把它显示出来。
    excluded = field_preferences.search_excluded_field_ids(db)
    profile_rows = (
        db.query(ProfileEntry)
        .filter(trash.live_only(ProfileEntry), _profile_values_filter(excluded, term))
        .order_by(ProfileEntry.created_at.desc(), ProfileEntry.id.desc())
        .limit(limit)
        .all()
    )
    custom_names = _custom_section_names(db, [row.section_key for row in profile_rows])
    hits.extend(
        SearchHit(
            type="profile",
            id=row.id,
            title=_profile_title(row, excluded),
            # 内置板块名由前端按 section_key 取语言包；自建板块用用户自己起的名字。
            subtitle=custom_names.get(row.section_key, ""),
            section_key=row.section_key,
            path=(
                f"/profile?section={quote(row.section_key, safe='')}"
                f"&entry={quote(row.entry_id, safe='')}"
            ),
        )
        for row in profile_rows
    )

    return hits


def global_search(db: Session, term: str, *, scope: str, limit: int) -> SearchResult:
    """按 ``scope`` 组装全局搜索结果（``all`` / ``jobs`` / ``resumes`` / ``more``）。"""
    jobs: list[JobListOut] = []
    resumes: list[ResumeBrief] = []
    more: list[SearchHit] = []
    if scope in ("all", "jobs"):
        rows = (
            db.query(Job)
            .filter(trash.live_only(Job))
            .filter(_keyword_filter(db, Job, "job", term, _JOBS_COLUMNS))
            .order_by(Job.created_at.desc(), Job.id.desc())
            .limit(limit)
            .all()
        )
        # 瘦身模型：搜索结果卡片不读 JD 全文（RR-08），要全文按 id 单取。
        jobs = [JobListOut.model_validate(row) for row in rows]
    if scope in ("all", "resumes"):
        rows = (
            db.query(ResumeRecord)
            # 制作台草稿不进搜索结果：用户没保存过它（0051）。
            .filter(trash.live_only(ResumeRecord), saved_only())
            .filter(_keyword_filter(db, ResumeRecord, "resume_record", term, _RESUMES_COLUMNS))
            .order_by(ResumeRecord.created_at.desc(), ResumeRecord.id.desc())
            .limit(limit)
            .all()
        )
        resumes = [ResumeBrief.model_validate(row) for row in rows]
    if scope in ("all", "more"):
        more = _search_more(db, term, limit)
    return SearchResult(jobs=jobs, resumes=resumes, more=more)


__all__ = ["global_search"]
