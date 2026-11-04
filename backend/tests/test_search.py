# SPDX-License-Identifier: Apache-2.0
"""全局搜索扩域：六类新数据域命中 / 未命中 / 软删过滤 / scope 过滤 / 向后兼容。

六个新数据域统一放进 ``SearchResult.more``（``SearchHit``），旧的 ``jobs`` / ``resumes``
字段保持不变。这里钉住：每域能命中且 ``path`` 指向真实前端路由、软删除的不出现、
``scope`` 能按需收窄、旧字段依然在。``profile``（我的资料条目）域另钉深链参数与
"旧 ``Skill`` 行不再产生命中"。
"""
from datetime import datetime

import pytest
from app.models.claim import ClaimRecord
from app.models.interview_experience import InterviewExperience
from app.models.job import Job
from app.models.material import Material
from app.models.profile import Skill, UserProfile
from app.models.profile_definition import ProfileCustomSection
from app.models.profile_entry import ProfileEntry
from app.models.referral import Referral
from app.models.reminder import Reminder
from app.models.resume import ResumeRecord
from app.services import trash


def _add(db_session, row):
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def _make_referral(db_session):
    return _add(
        db_session,
        Referral(
            job_title="后端内推",
            company="字节跳动",
            referrer_name="内推人老李",
            position="后端开发",
        ),
    )


def _make_reminder(db_session):
    return _add(
        db_session,
        Reminder(title="催HR回复", note="面试后一周", remind_at=datetime(2026, 9, 20, 9, 0)),
    )


def _make_experience(db_session):
    return _add(
        db_session,
        InterviewExperience(
            title="后端一面", company="字节跳动", position="后端", content="问了一道算法题"
        ),
    )


def _make_claim(db_session):
    return _add(
        db_session,
        ClaimRecord(
            title="负责服务端开发",
            subject="简历通",
            category="项目经历",
            source_fact="带队开发",
            candidate_wording="主导服务端开发",
        ),
    )


def _make_material(db_session):
    return _add(db_session, Material(title="获奖证书", category="证书", content="一等奖"))


def _make_profile_entry(
    db_session,
    section_key: str = "skills",
    entry_id: str = "entry-skill-1",
    values: dict[str, str] | None = None,
):
    return _add(
        db_session,
        ProfileEntry(
            entry_id=entry_id,
            section_key=section_key,
            values=values or {"skills.name": "Python"},
        ),
    )


def _make_custom_section(db_session):
    return _add(
        db_session,
        ProfileCustomSection(
            section_id="sec1",
            key="custom:sec1",
            name="竞赛资料",
            name_key="竞赛资料",
        ),
    )


def _make_skill(db_session):
    profile = _add(db_session, UserProfile(name="张三", job_intent="后端开发"))
    return _add(db_session, Skill(profile_id=profile.id, name="Python", level="熟练"))


MAKERS = {
    "referral": _make_referral,
    "reminder": _make_reminder,
    "experience": _make_experience,
    "claim": _make_claim,
    "material": _make_material,
}

CASES = [
    ("referral", "内推人老李", "/apply"),
    ("reminder", "催HR回复", "/tracker"),
    ("experience", "后端一面", "/interview"),
    ("claim", "服务端开发", "/claims"),
    ("material", "获奖证书", "/materials"),
]


@pytest.mark.parametrize("type_key,keyword,path", CASES)
def test_more_search_hits_each_domain(client, db_session, type_key, keyword, path):
    row = MAKERS[type_key](db_session)

    data = client.get("/api/search", params={"q": keyword}).json()

    hits = [hit for hit in data["more"] if hit["type"] == type_key]
    assert [hit["id"] for hit in hits] == [row.id]
    assert hits[0]["path"] == path
    assert hits[0]["title"]
    # 扩展域命中不污染旧字段。
    assert data["jobs"] == []
    assert data["resumes"] == []


def test_more_search_returns_empty_for_no_match(client, db_session):
    _make_referral(db_session)

    data = client.get("/api/search", params={"q": "完全不存在的关键词"}).json()

    assert data == {"jobs": [], "resumes": [], "more": []}


def test_profile_domain_hits_entry_with_deep_link(client, db_session):
    """技能名能搜到「我的资料」的条目，并带出板块 key 与条目级深链。"""
    entry = _make_profile_entry(db_session)

    data = client.get("/api/search", params={"q": "Python"}).json()

    hits = [hit for hit in data["more"] if hit["type"] == "profile"]
    assert [hit["id"] for hit in hits] == [entry.id]
    assert hits[0]["title"] == "Python"
    assert hits[0]["section_key"] == "skills"
    assert hits[0]["path"] == "/profile?section=skills&entry=entry-skill-1"


def test_profile_domain_covers_non_skill_sections(client, db_session):
    """不是只修了技能一个板块：教育经历里的学校名同样命中。"""
    _make_profile_entry(
        db_session,
        section_key="educations",
        entry_id="entry-edu-1",
        values={"educations.school": "清华大学", "educations.major": "计算机"},
    )

    data = client.get("/api/search", params={"q": "清华"}).json()

    hits = [hit for hit in data["more"] if hit["type"] == "profile"]
    assert len(hits) == 1
    assert hits[0]["section_key"] == "educations"
    assert hits[0]["title"] == "清华大学"


def test_profile_domain_uses_custom_section_name_as_subtitle(client, db_session):
    """自建板块用用户起的名字（后端下发 subtitle，前端不再拼一份翻译）。"""
    _make_custom_section(db_session)
    _make_profile_entry(
        db_session,
        section_key="custom:sec1",
        entry_id="entry-custom-1",
        values={"custom:sec1.text": "全国大学生数学建模竞赛"},
    )

    data = client.get("/api/search", params={"q": "数学建模"}).json()

    hits = [hit for hit in data["more"] if hit["type"] == "profile"]
    assert hits[0]["subtitle"] == "竞赛资料"
    assert hits[0]["section_key"] == "custom:sec1"


def test_profile_domain_filters_soft_deleted_entries(client, db_session):
    """软删条目搜不到：回收站里的内容不该出现在全局搜索里。"""
    entry = _make_profile_entry(db_session)
    trash.soft_delete(db_session, "profile_entry", entry)
    db_session.commit()

    assert client.get("/api/search", params={"q": "Python"}).json()["more"] == []


def test_legacy_skill_rows_no_longer_produce_hits(client, db_session):
    """老库里的旧 ``Skill`` 行不再命中（旧六表已无写入方，继续搜只会重复）。"""
    _make_skill(db_session)

    data = client.get("/api/search", params={"q": "Python"}).json()

    assert data["more"] == []


def test_same_name_entry_and_legacy_skill_only_produce_one_hit(client, db_session):
    """同名技能的新旧两条记录同时存在时，只出一条（新模型）。"""
    _make_skill(db_session)
    _make_profile_entry(db_session)

    hits = client.get("/api/search", params={"q": "Python"}).json()["more"]

    assert [hit["type"] for hit in hits] == ["profile"]


def test_more_search_filters_soft_deleted(client, db_session):
    referral = _make_referral(db_session)
    material = _make_material(db_session)

    trash.soft_delete(db_session, "referral", referral)
    trash.soft_delete(db_session, "material", material)
    db_session.commit()

    assert client.get("/api/search", params={"q": "内推人老李"}).json()["more"] == []
    assert client.get("/api/search", params={"q": "获奖证书"}).json()["more"] == []


def test_scope_filters_which_domains_are_searched(client, db_session):
    _make_referral(db_session)
    _make_reminder(db_session)

    # jobs 只查岗位，不碰扩展域。
    jobs_only = client.get("/api/search", params={"q": "内推人老李", "scope": "jobs"}).json()
    assert jobs_only["jobs"] == []
    assert jobs_only["more"] == []

    # more 只查扩展域，不碰岗位/简历。
    more_only = client.get("/api/search", params={"q": "内推人老李", "scope": "more"}).json()
    assert more_only["jobs"] == []
    assert more_only["resumes"] == []
    assert [hit["type"] for hit in more_only["more"]] == ["referral"]

    # all 同时查两处。
    all_scope = client.get("/api/search", params={"q": "内推人老李"}).json()
    assert [hit["type"] for hit in all_scope["more"]] == ["referral"]


def test_legacy_fields_still_present(client, db_session):
    _add(db_session, Job(title="后端开发", company="字节跳动"))
    _add(db_session, ResumeRecord(title="后端简历", job_title="后端开发"))

    data = client.get("/api/search", params={"q": "后端"}).json()

    assert data["jobs"]
    assert data["resumes"]
    # 新增字段始终存在（即使为空），旧字段原样保留。
    assert "more" in data
    assert data["more"] == []


def test_invalid_scope_rejected(client):
    response = client.get("/api/search", params={"q": "x", "scope": "bogus"})
    assert response.status_code == 422
