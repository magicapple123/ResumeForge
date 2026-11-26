# SPDX-License-Identifier: Apache-2.0
"""T32：统计口径含外部简历。

守四件事：

1. **按行计数的指标把外部简历投的一起算**（投递总量 / 漏斗 / 面试数……它们本来就不看
   关联字段，这里用断言把它钉死，避免以后有人"顺手"加一个 ``resume_id IS NOT NULL``）；
2. **按简历分组的两块永不混算**：``resume_effects`` 只有内部，``external_resume_effects``
   只有外部——两张表 id 空间独立、会撞号；
3. 「关联了简历的投递数」= 内部 + 外部，并给出两个拆分数，缺口说明不再虚报；
4. 空库时两个列表都是 ``[]``（约定：零/空列表，不是 None）。
"""

from app.models.resume import ResumeRecord
from app.models.tracker import (
    STATUS_APPLIED,
    STATUS_INTERVIEW,
    STATUS_REJECTED,
    ApplicationTrack,
    normalize_key,
)
from app.services.analytics import dashboard_brief


def _external_resume(client, name: str = "外部-后端版.txt") -> dict:
    """走应用自己的上传接口建一份外部简历（BRIEF §2：造数据只用 HTTP 接口）。"""
    response = client.post(
        "/api/external-resumes",
        files={"file": (name, "外部简历正文".encode(), "text/plain")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _track(db_session, company, title, status, **kwargs) -> ApplicationTrack:
    track = ApplicationTrack(
        company=company,
        title=title,
        company_key=normalize_key(company),
        title_key=normalize_key(title),
        status=status,
        **kwargs,
    )
    db_session.add(track)
    db_session.commit()
    db_session.refresh(track)
    return track


def test_row_metrics_include_external_linked_applications(client, db_session):
    """外部简历投的那条要算进投递总量、漏斗与面试数（按行计数不看关联字段）。"""
    external = _external_resume(client)
    _track(
        db_session,
        "甲",
        "后端",
        STATUS_INTERVIEW,
        external_resume_id=external["id"],
        resume_title=external["name"],
    )
    _track(db_session, "乙", "后端", STATUS_APPLIED)

    data = client.get("/api/analytics/dashboard").json()

    assert data["total_applications"] == 2
    assert data["valid_applications"] == 2
    assert data["interview_count"] == 1
    assert data["active_count"] == 2
    funnel = {item["status"]: item["count"] for item in data["funnel"]}
    assert funnel[STATUS_INTERVIEW] == 1
    assert funnel[STATUS_APPLIED] == 1


def test_external_effects_are_a_separate_list_from_internal(client, db_session):
    """内部那份只数 resume_id，外部那份只数 external_resume_id：**同一行不会两边都出现**。"""
    internal = ResumeRecord(title="内部-后端版", content={})
    db_session.add(internal)
    db_session.commit()
    db_session.refresh(internal)
    external = _external_resume(client, name="外部-后端版.txt")
    _track(
        db_session,
        "甲",
        "后端",
        STATUS_INTERVIEW,
        resume_id=internal.id,
        resume_title=internal.title,
    )
    _track(
        db_session,
        "乙",
        "后端",
        STATUS_REJECTED,
        resume_id=internal.id,
        resume_title=internal.title,
    )
    _track(
        db_session,
        "丙",
        "后端",
        STATUS_REJECTED,
        external_resume_id=external["id"],
        resume_title=external["name"],
    )

    data = client.get("/api/analytics/dashboard").json()

    # 内部那份：2 条、1 次进面。
    assert len(data["resume_effects"]) == 1
    internal_item = data["resume_effects"][0]
    assert internal_item["kind"] == "internal"
    assert internal_item["resume_id"] == internal.id
    assert (internal_item["total"], internal_item["interview_count"]) == (2, 1)

    # 外部那份：1 条、0 次进面，标题取关联时冻结的快照。
    assert len(data["external_resume_effects"]) == 1
    external_item = data["external_resume_effects"][0]
    assert external_item["kind"] == "external"
    assert external_item["resume_id"] == external["id"]
    assert external_item["resume_title"] == external["name"]
    assert (external_item["total"], external_item["interview_count"]) == (1, 0)
    assert external_item["small_sample"] is True

    # 两份列表的 id 分别来自两张表、**天然会撞号**（这里 internal.id 与 external["id"]
    # 都是 1）——所以"两边 id 不重叠"不能当断言，真正的证据是**条数各自对得上**：
    # 内部那份 2 条、外部那份 1 条，谁也没有把对方的那条算进来。
    assert sum(item["total"] for item in data["resume_effects"]) == 2
    assert sum(item["total"] for item in data["external_resume_effects"]) == 1


def test_linked_count_includes_external_and_reports_both_splits(client, db_session):
    """「关联了简历的投递数」= 内部 + 外部；未关联 = 总量 - 这个数，缺口不再虚报。"""
    internal = ResumeRecord(title="内部版", content={})
    db_session.add(internal)
    db_session.commit()
    db_session.refresh(internal)
    first = _external_resume(client, name="外部-A.txt")
    second = _external_resume(client, name="外部-B.txt")
    _track(db_session, "甲", "后端", STATUS_APPLIED, resume_id=internal.id)
    _track(db_session, "乙", "后端", STATUS_APPLIED, external_resume_id=first["id"])
    _track(db_session, "丙", "后端", STATUS_INTERVIEW, external_resume_id=second["id"])
    _track(db_session, "丁", "后端", STATUS_APPLIED)
    _track(db_session, "戊", "后端", STATUS_REJECTED)

    data = client.get("/api/analytics/dashboard").json()

    assert data["total_applications"] == 5
    assert data["track_internal_resume_linked_count"] == 1
    assert data["track_external_resume_linked_count"] == 2
    assert data["track_resume_linked_count"] == 3
    # 两个拆分恒等于总数——前端图例直接拿这三个数说话。
    assert data["track_resume_linked_count"] == (
        data["track_internal_resume_linked_count"] + data["track_external_resume_linked_count"]
    )
    assert data["total_applications"] - data["track_resume_linked_count"] == 2


def test_empty_database_returns_empty_lists_not_none(client):
    """空库：两个分组都是 []，两个拆分数都是 0（前端不必到处判空）。"""
    data = client.get("/api/analytics/dashboard").json()

    assert data["resume_effects"] == []
    assert data["external_resume_effects"] == []
    assert data["track_internal_resume_linked_count"] == 0
    assert data["track_external_resume_linked_count"] == 0
    assert data["track_resume_linked_count"] == 0


def test_assistant_brief_drops_external_effects_array(client, db_session):
    """助手摘要只保留标量：外部简历分组是"给人逐行看"的明细数组，不进上下文。"""
    external = _external_resume(client)
    _track(
        db_session,
        "甲",
        "后端",
        STATUS_APPLIED,
        external_resume_id=external["id"],
        resume_title=external["name"],
    )

    dashboard = client.get("/api/analytics/dashboard").json()
    brief = dashboard_brief(dashboard)

    assert "external_resume_effects" not in brief
    # 标量拆分数保留：助手回答"关联覆盖率"时要能说清内外各几条。
    assert brief["track_external_resume_linked_count"] == 1
