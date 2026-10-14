"""全局搜索：同时检索岗位、简历记录，以及内推/提醒/面经/台账/资料/技能。

旧的 ``jobs`` / ``resumes`` 字段保持不变；六个新数据域统一放进 ``more``（``SearchHit``），
旧调用方完全无感。扩展域只在 ``scope in ("all", "more")`` 时查询，``scope="jobs"`` 或
``"resumes"`` 时仍只查单一域，语义不变。

检索路径（2026-10 万级数据优化批）：各域优先走迁移 ``0046_search_fts`` 建的
FTS5 trigram 全文索引（见 ``services/search_fts``），子串语义与原 LIKE 一致；
FTS 表不存在（历史库/旧 SQLite）或关键词不足 3 字符时回退原 ``LIKE '%kw%'``。
两路结果一致由 ``tests/test_search_fts.py`` 的对照测试钉住。技能域保留 LIKE
（个人资料硬删子表，至多几十行，FTS 化是负优化——理由见 search_fts 模块注释）。

排序：全部按 ``created_at DESC, id DESC``。``id`` 决胜是 FTS 化批引入的——
批量导入的行常常共享同一秒的 ``created_at``，平局时 SQLite 的返回顺序取决于
查询计划（LIKE 扫描与 FTS ``id IN (MATCH)`` 的计划不同），不加决胜两路就会
在平局上给出不同顺序；决胜后任何计划下顺序都确定。
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import String, and_, cast, or_, true
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.claim import ClaimRecord
from ..models.interview_experience import InterviewExperience
from ..models.job import Job
from ..models.material import Material
from ..models.profile import Skill
from ..models.referral import Referral
from ..models.reminder import Reminder
from ..models.resume import ResumeRecord
from ..schemas.job import JobListOut
from ..schemas.resume import ResumeBrief
from ..schemas.search import SearchHit, SearchResult
from ..services import search_fts, trash
from ..services.search_matching import LIKE_ESCAPE, like_pattern, normalized_term

router = APIRouter(prefix="/api/search", tags=["search"])

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


def _search_more(db: Session, term: str, limit: int) -> list[SearchHit]:
    """检索六个扩展数据域，返回按域分组的 ``SearchHit`` 列表。

    每域只取 ``limit`` 条、按创建时间倒序；技能表没有 ``deleted_at``（它是个人资料里的
    硬删子表），因此不套 ``live_only``，其余五类都过滤软删除。
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

    # 技能域刻意保留 LIKE：个人资料硬删子表，至多几十行（见 search_fts 模块注释）。
    skill_rows = (
        db.query(Skill)
        .filter(
            or_(
                Skill.name.like(like_pattern(term), escape=LIKE_ESCAPE),
                Skill.level.like(like_pattern(term), escape=LIKE_ESCAPE),
            )
        )
        .order_by(Skill.id.desc())
        .limit(limit)
        .all()
    )
    hits.extend(
        SearchHit(
            type="skill",
            id=row.id,
            title=row.name or "未命名技能",
            subtitle=row.level or "",
            path="/skills",
        )
        for row in skill_rows
    )

    return hits


@router.get("", response_model=SearchResult)
def search(
    q: str = Query(min_length=1, description="搜索关键词"),
    scope: str = Query(default="all", pattern="^(all|jobs|resumes|more)$"),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
):
    jobs, resumes, more = [], [], []
    if scope in ("all", "jobs"):
        rows = (
            db.query(Job)
            .filter(trash.live_only(Job))
            .filter(_keyword_filter(db, Job, "job", q, _JOBS_COLUMNS))
            .order_by(Job.created_at.desc(), Job.id.desc())
            .limit(limit)
            .all()
        )
        # 瘦身模型：搜索结果卡片不读 JD 全文（RR-08），要全文按 id 单取。
        jobs = [JobListOut.model_validate(row) for row in rows]
    if scope in ("all", "resumes"):
        rows = (
            db.query(ResumeRecord)
            .filter(trash.live_only(ResumeRecord))
            .filter(_keyword_filter(db, ResumeRecord, "resume_record", q, _RESUMES_COLUMNS))
            .order_by(ResumeRecord.created_at.desc(), ResumeRecord.id.desc())
            .limit(limit)
            .all()
        )
        resumes = [ResumeBrief.model_validate(row) for row in rows]
    if scope in ("all", "more"):
        more = _search_more(db, q, limit)
    return SearchResult(jobs=jobs, resumes=resumes, more=more)
