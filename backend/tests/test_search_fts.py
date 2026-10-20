# SPDX-License-Identifier: Apache-2.0
"""全局搜索 FTS 化的对照测试：FTS 路径与 LIKE 路径**逐条一致**。

迁移 ``0046_search_fts`` 给 ``/api/search`` 覆盖的七个数据域建了 FTS5 trigram
索引。这里的判定方式：**同一个端点跑两遍**——先在没建索引的库上跑（原 LIKE
路径，行为基准），再用 alembic 把库升到 0046（索引 rebuild 会把既有行全部入
索引），逐关键词比对两次响应的 JSON 是否完全相等。相等即"子串语义、排序、
分页、软删除过滤全部保持"——这比逐字段断言更严格。

另钉：FTS 路径确实被走到（对照不可空转）、短关键词回退 LIKE、注入面关键词
（FTS5 操作符）两路一致、``limit`` 分页一致。
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime

from alembic import command
from app import database
from app.database_migrations import build_alembic_config
from app.models.claim import ClaimRecord
from app.models.interview_experience import InterviewExperience
from app.models.job import Job
from app.models.material import Material
from app.models.profile import Skill, UserProfile
from app.models.referral import Referral
from app.models.reminder import Reminder
from app.models.resume import ResumeRecord
from app.services import search_fts, trash
from sqlalchemy import text

PREVIOUS_REVISION = "0045_delivery_ledger"
HEAD_REVISION = "0048_job_analysis_cache"

# 对照关键词：中文 ≥3 字（trigram 主场）、ASCII 大小写折叠、2 字（回退 LIKE）、
# FTS5 操作符（AND/OR/NOT/引号——作为字面量匹配才与 LIKE 等价）、无命中，
# 以及 RR-07 钉住的特殊字符：``%`` / ``_``（LIKE 通配符 vs FTS 字面量）、
# 前后空白、带变音符号（trigram 会折叠，必须回退 LIKE）。
QUERIES = (
    "字节跳动",
    "算法",
    "算法工程师",
    "Python",
    "python",
    "面试",
    "面试技巧",
    "证书",
    "内推人老李",
    "简历通",
    "AND",
    '或"算法"',
    "完全不存在的关键词",
    "foo%bar",
    "fooblahbar",
    "100%",
    "snake_case",
    "snake",
    " leading-space",
    "leading-space ",
    '引号"岗位"',
    "café",
    "cafe",
    "CAFÉ",
)


@contextmanager
def _fts_tables_enabled():
    """把共享测试库升到 0046（建七张 FTS 表并 rebuild 既有行），结束时还原。

    conftest 的 ``clean_db`` 会在用例前后删派生表，这里只需额外清掉 stamp 写入的
    ``alembic_version``，避免污染同进程的后续用例。
    """
    config = build_alembic_config(database.engine)
    command.stamp(config, PREVIOUS_REVISION)
    command.upgrade(config, HEAD_REVISION)
    search_fts.reset_cache()
    try:
        yield
    finally:
        with database.engine.begin() as connection:
            connection.execute(text("DROP TABLE IF EXISTS alembic_version"))
        search_fts.reset_cache()


def _seed(db_session) -> None:
    """七个数据域各放带关键词的行；``content``（JSON 列）放 ASCII 值对照。"""
    db_session.add_all(
        [
            Job(title="算法工程师", company="字节跳动", description="负责机器学习平台"),
            Job(title="前端开发", company="示例公司", note="要求熟悉 Python"),
            Job(title="Python 后端", company="爬虫团队"),
            Referral(
                job_title="后端内推",
                company="字节跳动",
                referrer_name="内推人老李",
                position="后端开发",
            ),
            Reminder(
                title="催HR回复",
                note="算法面试后一周",
                remind_at=datetime(2026, 9, 20, 9, 0),
            ),
            InterviewExperience(
                title="后端一面",
                company="字节跳动",
                position="后端",
                content="问了一道算法题与面试技巧",
            ),
            ClaimRecord(
                title="负责服务端开发",
                subject="简历通",
                category="项目经历",
                source_fact="带队开发检索平台",
                candidate_wording="主导服务端开发",
            ),
            Material(title="获奖证书", category="证书", content="算法竞赛一等奖"),
            # RR-07 特殊字符对照样本：% 与 _ 的字面量、前后空白、变音符号。
            Job(title="foo%bar 岗位", company="字面量公司"),
            Job(title="fooblahbar 岗位", company="通配符公司"),
            Job(title="命中率 100% 的岗位", company="百分比公司"),
            Job(title="snake_case 命名岗位", company="下划线公司"),
            Job(title=" leading-space 岗位", company="空白公司"),
            Job(title='引号"岗位"的一条', company="引号公司"),
            Job(title="café 咖啡师岗位", company="变音符号公司"),
        ]
    )
    db_session.add(
        ResumeRecord(
            title="算法岗简历",
            job_title="算法工程师",
            company="字节跳动",
            content={"summary": "python backend engineer"},
        )
    )
    profile = UserProfile(name="张三", job_intent="后端开发")
    db_session.add(profile)
    db_session.flush()
    db_session.add(Skill(profile_id=profile.id, name="Python", level="熟练"))
    db_session.commit()


def _search_all(client, queries=QUERIES) -> dict:
    return {q: client.get("/api/search", params={"q": q}).json() for q in queries}


def test_fts_results_are_identical_to_like_results(client, db_session):
    """七个数据域、多类关键词：FTS 路径响应 == LIKE 路径响应（逐条、逐字段）。"""
    _seed(db_session)

    like_results = _search_all(client)

    with _fts_tables_enabled():
        # 对照不可空转：索引确实存在且被走到。
        for base in search_fts.SEARCH_FTS_SPECS:
            assert search_fts.fts_available(db_session, base) is True
        fts_results = _search_all(client)

    assert fts_results == like_results
    # 基线本身非空：关键词确实命中了数据（否则对照是两个空集的等号）。
    assert like_results["算法工程师"]["jobs"], "基线岗位命中不应为空"
    assert like_results["证书"]["more"], "基线资料命中不应为空"
    assert like_results["python"]["resumes"], "基线简历命中不应为空"
    # RR-07：特殊字符在两路下同语义，且基线本身非空（对照不是两个空集的等号）。
    assert like_results["foo%bar"]["jobs"], "字面量 % 必须命中含 % 的岗位"
    assert like_results["snake_case"]["jobs"], "字面量 _ 必须命中含 _ 的岗位"
    assert like_results[" leading-space"]["jobs"], "前导空白是子串的一部分"
    assert like_results["café"]["jobs"], "带变音符号的查询仍要命中"


def test_wildcards_are_literal_not_sql_wildcards(client, db_session):
    """``%``/``_`` 是用户输入的字面量：升级前 LIKE 把 ``foo%bar`` 当通配符，
    ``fooblahbar`` 也会被命中——迁移前后（走不走 FTS）给出不同结果。"""
    _seed(db_session)

    def _titles(query: str) -> list[str]:
        body = client.get("/api/search", params={"q": query, "scope": "jobs"}).json()
        return sorted(job["title"] for job in body["jobs"])

    assert _titles("foo%bar") == ["foo%bar 岗位"]
    assert _titles("snake_case") == ["snake_case 命名岗位"]
    # 通配符解释下这里会命中两条（foo%bar 与 fooblahbar），现在只命中字面那一份。
    assert _titles("fooblahbar") == ["fooblahbar 岗位"]


def test_leading_space_query_is_not_stripped(client, db_session):
    """前后空白是子串的一部分：多一个空格就是另一个关键词，不该被 strip 掉。"""
    _seed(db_session)

    spaced = client.get("/api/search", params={"q": " 岗位", "scope": "jobs"}).json()["jobs"]
    assert spaced, "「空格 + 岗位」应当命中标题里带这个片段的岗位"
    assert all(" 岗位" in job["title"] for job in spaced)

    two_spaces = client.get("/api/search", params={"q": "  岗位", "scope": "jobs"}).json()["jobs"]
    assert two_spaces == [], "双空格被 strip 掉就会退化成「岗位」查询，命中一大片"


def test_fts_results_identical_under_limit_pagination(client, db_session):
    """``limit`` 分页在两路下一致：同样的行、同样的顺序被截断。"""
    for index in range(6):
        db_session.add(Job(title=f"算法工程师{index}", company=f"公司{index}"))
    db_session.commit()

    like_pages = [
        client.get("/api/search", params={"q": "算法", "limit": size}).json()
        for size in (1, 2, 20, 50)
    ]

    with _fts_tables_enabled():
        fts_pages = [
            client.get("/api/search", params={"q": "算法", "limit": size}).json()
            for size in (1, 2, 20, 50)
        ]

    assert fts_pages == like_pages
    # 顺序抽查：6 条按创建时间倒序，limit=2 取最近两条。
    titles = [job["title"] for job in like_pages[1]["jobs"]]
    assert titles == ["算法工程师5", "算法工程师4"]


def test_fts_path_excludes_soft_deleted(client, db_session):
    """软删除红线在 FTS 路径下同样成立：回收站里的行不出现在结果里。"""
    _seed(db_session)
    doomed_job = db_session.query(Job).filter_by(company="字节跳动").first()
    doomed_material = db_session.query(Material).filter_by(title="获奖证书").one()
    trash.soft_delete(db_session, "job", doomed_job)
    trash.soft_delete(db_session, "material", doomed_material)
    db_session.commit()

    with _fts_tables_enabled():
        body = client.get("/api/search", params={"q": "字节跳动"}).json()
        assert all(job["company"] != "字节跳动" for job in body["jobs"])
        # 岗位没了，但同关键词的内推/面经（也在字节跳动）还在。
        types = {hit["type"] for hit in body["more"]}
        assert "referral" in types and "experience" in types
        assert client.get("/api/search", params={"q": "获奖证书"}).json()["more"] == []


def test_fts_scope_semantics_unchanged(client, db_session):
    """``scope`` 收窄语义在 FTS 路径下不变（与 LIKE 路径一致）。"""
    _seed(db_session)

    like_scoped = client.get("/api/search", params={"q": "字节跳动", "scope": "jobs"}).json()
    with _fts_tables_enabled():
        fts_scoped = client.get("/api/search", params={"q": "字节跳动", "scope": "jobs"}).json()
    assert fts_scoped == like_scoped
    assert fts_scoped["more"] == []


# ===== RR-08：首页与搜索的岗位只返回摘要，不携带 JD 全文 =====


def test_search_and_stats_jobs_are_slim_but_detail_keeps_full_text(client, db_session):
    """首页/搜索两次高频请求不再携带 JD 全文；要全文按 id 单取（详情仍是完整模型）。"""
    long_jd = "岗位描述正文。" * 2000  # ~14KB，足以让"带了全文"一眼可见
    db_session.add(Job(title="摘要瘦身岗", company="示例公司", description=long_jd))
    db_session.commit()

    search_body = client.get("/api/search", params={"q": "摘要瘦身岗"}).json()
    assert search_body["jobs"], "基线命中不应为空"
    job = search_body["jobs"][0]
    assert "description" not in job, "搜索结果不许再带 JD 全文"
    assert job["has_description"] is True, "摘要里要给出「有没有 JD」的判据"
    assert {"id", "title", "company", "location", "salary"} <= set(job)

    stats_body = client.get("/api/stats").json()
    latest = [item for item in stats_body["latest_jobs"] if item["title"] == "摘要瘦身岗"]
    assert latest, "最近岗位里应当有这条"
    assert "description" not in latest[0]
    assert latest[0]["has_description"] is True

    # 详情链路保持完整：按 id 单取仍然给全文。
    detail = client.get(f"/api/jobs/{job['id']}").json()
    assert detail["description"] == long_jd
