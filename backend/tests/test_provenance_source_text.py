# SPDX-License-Identifier: Apache-2.0
"""W12 来源正文只读解析：GET /api/provenance/sources/{id}/revision-text。

覆盖：claim/material/profile 解析、manual/未知引用不可解析、不存在/未知修订、历史修订
不可回溯、删除条目、只读不写库，以及"可解析来源 → 采纳写正文"的真实闭环（含指纹不一致时
按来源当前正文做等价校验、粘贴任意文本仍被 stale 拒绝）。
"""

from __future__ import annotations

from app.models.claim import ClaimRecord
from app.models.material import Material
from app.models.profile import UserProfile
from app.models.provenance import ResumeSource, ResumeSourceRevision
from tests.document_test_support import body_texts


def _content() -> dict:
    return {
        "name": "张示例",
        "summary": "负责示例模块",
        "experience": [
            {
                "id": "expobj0001",
                "company": "示例科技有限公司",
                "role": "后端实习生",
                "description": ["负责合成数据接口"],
                "point_ids": {"description": ["pnt0000001"]},
            }
        ],
    }


def _create_resume(client, title: str = "来源正文测试") -> int:
    response = client.post("/api/resumes/manual", json={"title": title, "content": _content()})
    assert response.status_code in (200, 201), response.text
    return int(response.json()["id"])


def _resume(client, resume_id: int) -> dict:
    response = client.get(f"/api/resumes/{resume_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _link(
    client, resume_id: int, *, kind: str, external_ref: str, payload, path: str = "summary"
) -> dict:
    response = client.post(
        f"/api/provenance/resumes/{resume_id}/links",
        json={
            "source": {
                "kind": kind,
                "external_ref": external_ref,
                "title": "示例来源",
                "payload": payload,
            },
            "path": path,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _revision_text(client, source_id: int, revision_no: int | None = None) -> dict:
    params = {} if revision_no is None else {"revision_no": revision_no}
    response = client.get(f"/api/provenance/sources/{source_id}/revision-text", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _revisions(client, source_id: int) -> list[dict]:
    # 详情接口带 fingerprint（revisions 列表只给展示字段）。
    response = client.get(f"/api/provenance/sources/{source_id}")
    assert response.status_code == 200, response.text
    return response.json()["revisions"]


def _claim(db_session, *, candidate: str, fact: str = "原始事实") -> int:
    record = ClaimRecord(title="示例主张", candidate_wording=candidate, source_fact=fact)
    db_session.add(record)
    db_session.commit()
    return int(record.id)


def _material(db_session, content: str) -> int:
    record = Material(title="资料", content=content)
    db_session.add(record)
    db_session.commit()
    return int(record.id)


def test_claim_source_text_resolves_and_adopt_closes_the_loop(client, db_session):
    claim_id = _claim(db_session, candidate="主导合成数据接口的设计与实现")
    resume_id = _create_resume(client)
    link = _link(
        client,
        resume_id,
        kind="claim",
        external_ref=f"claim_record:{claim_id}",
        payload={"subject": "示例科技有限公司"},  # 结构化 payload：与正文指纹不同
    )
    before_revision = _resume(client, resume_id)["revision"]

    resolved = _revision_text(client, link["source_id"])
    revisions = _revisions(client, link["source_id"])
    assert resolved["resolvable"] is True
    assert resolved["is_latest"] is True
    assert resolved["text"] == "主导合成数据接口的设计与实现"
    assert resolved["fingerprint"] == revisions[-1]["fingerprint"]
    # 建立关联时的 payload 是结构化对象 → 与"简历表述"文本指纹不一致，如实标记。
    assert resolved["fingerprint_matched"] is False

    adopted = client.post(
        f"/api/provenance/links/{link['link_id']}/adopt",
        json={"text": resolved["text"], "expected_revision": before_revision},
    )
    assert adopted.status_code == 200, adopted.text
    body = adopted.json()
    assert body_texts(body["content"], "summary") == ["主导合成数据接口的设计与实现"]
    assert body["revision"] == before_revision + 1
    assert body["link"]["status"] == "linked"


def test_claim_source_text_matching_fingerprint_is_marked_matched(client, db_session):
    candidate = "把复盘写成可复用方法"
    claim_id = _claim(db_session, candidate=candidate)
    resume_id = _create_resume(client, "指纹吻合")
    link = _link(
        client,
        resume_id,
        kind="claim",
        external_ref=f"claim_record:{claim_id}",
        payload=candidate,  # 直接用正文建来源：指纹应吻合
    )
    resolved = _revision_text(client, link["source_id"])
    assert resolved["resolvable"] is True
    assert resolved["fingerprint_matched"] is True
    assert resolved["text"] == candidate


def test_material_and_profile_sources_resolve_their_body(client, db_session):
    material_id = _material(db_session, "一段可采纳的资料正文")
    resume_id = _create_resume(client)
    material_link = _link(
        client,
        resume_id,
        kind="material",
        external_ref=f"material:{material_id}",
        payload={"note": "结构化引用"},
    )
    material_text = _revision_text(client, material_link["source_id"])
    assert material_text["resolvable"] is True
    assert material_text["text"] == "一段可采纳的资料正文"
    adopted = client.post(
        f"/api/provenance/links/{material_link['link_id']}/adopt",
        json={"text": material_text["text"]},
    )
    assert adopted.status_code == 200, adopted.text
    assert body_texts(adopted.json()["content"], "summary") == ["一段可采纳的资料正文"]

    profile = db_session.query(UserProfile).first()
    if profile is None:
        profile = UserProfile()
        db_session.add(profile)
    profile.summary = "个人总结正文"
    db_session.commit()
    profile_link = _link(
        client,
        resume_id,
        kind="profile",
        external_ref="profile:summary",
        payload={"field": "summary"},
        path="summary",
    )
    profile_text = _revision_text(client, profile_link["source_id"])
    assert profile_text["resolvable"] is True
    assert profile_text["text"] == "个人总结正文"


def test_manual_source_is_not_resolvable_and_point_edit_unchanged(client):
    resume_id = _create_resume(client)
    manual = client.post("/api/provenance/sources", json={"title": "手工资料"}).json()
    assert _revision_text(client, manual["id"]) == {
        "source_id": manual["id"],
        "kind": "manual",
        "external_ref": None,
        "revision_no": None,
        "text": "",
        "fingerprint": "",
        "resolvable": False,
        "fingerprint_matched": False,
        "is_latest": True,  # 来源有修订，但内容不可解析
        "reason": "manual_source_has_no_body",
    }
    # 不存在的来源 / 不存在的修订 → 404。
    assert client.get("/api/provenance/sources/9999/revision-text").status_code == 404
    assert (
        client.get(
            f"/api/provenance/sources/{manual['id']}/revision-text",
            params={"revision_no": 99},
        ).status_code
        == 404
    )
    assert _resume(client, resume_id)["revision"] == 0


def test_read_endpoint_does_not_write_rows(client, db_session):
    claim_id = _claim(db_session, candidate="只读测试")
    resume_id = _create_resume(client)
    link = _link(
        client, resume_id, kind="claim", external_ref=f"claim_record:{claim_id}", payload="v1"
    )
    before = (
        db_session.query(ResumeSource).count(),
        db_session.query(ResumeSourceRevision).count(),
    )
    _revision_text(client, link["source_id"])
    after = (
        db_session.query(ResumeSource).count(),
        db_session.query(ResumeSourceRevision).count(),
    )
    assert before == after


def test_historical_revision_cannot_be_resolved(client, db_session):
    claim_id = _claim(db_session, candidate="第一版正文")
    resume_id = _create_resume(client)
    link = _link(
        client,
        resume_id,
        kind="claim",
        external_ref=f"claim_record:{claim_id}",
        payload="v1",
    )
    # 来源内容更新到第 2 版（另一块新关联会 upsert 同一来源、追加修订）。
    client.post(
        f"/api/provenance/resumes/{resume_id}/links",
        json={
            "source": {
                "kind": "claim",
                "external_ref": f"claim_record:{claim_id}",
                "title": "示例来源",
                "payload": "v2",
            },
            "path": "experience.0",
        },
    )
    revisions = _revisions(client, link["source_id"])
    assert [item["revision_no"] for item in revisions] == [1, 2]
    old = _revision_text(client, link["source_id"], revision_no=1)
    assert old["resolvable"] is False
    assert old["is_latest"] is False
    assert old["reason"] == "historical_revision_not_stored"
    assert old["fingerprint"] == revisions[0]["fingerprint"]
    # 最新修订仍可解析（正文是业务表当前值）。
    latest = _revision_text(client, link["source_id"], revision_no=2)
    assert latest["resolvable"] is True
    assert latest["is_latest"] is True


def test_deleted_or_unresolvable_source_body(client, db_session):
    claim_id = _claim(db_session, candidate="即将删除")
    resume_id = _create_resume(client)
    link = _link(
        client, resume_id, kind="claim", external_ref=f"claim_record:{claim_id}", payload="x"
    )
    from datetime import UTC, datetime

    claim = db_session.get(ClaimRecord, claim_id)
    claim.deleted_at = datetime.now(UTC).replace(tzinfo=None)
    db_session.commit()
    text = _revision_text(client, link["source_id"])
    assert text["resolvable"] is False
    assert text["reason"] == "source_body_not_found"

    weird = _link(
        client,
        resume_id,
        kind="claim",
        external_ref="unknown_ref:1",
        payload="x",
        path="experience.0",
    )
    unresolved = _revision_text(client, weird["source_id"])
    assert unresolved["resolvable"] is False
    assert unresolved["reason"] == "external_ref_unresolvable"


def test_adopt_rejects_arbitrary_pasted_text_even_for_resolvable_source(client, db_session):
    claim_id = _claim(db_session, candidate="来源当前正文")
    resume_id = _create_resume(client)
    link = _link(
        client,
        resume_id,
        kind="claim",
        external_ref=f"claim_record:{claim_id}",
        payload={"structured": True},
    )
    rejected = client.post(
        f"/api/provenance/links/{link['link_id']}/adopt",
        json={"text": "用户随口粘贴的别的内容"},
    )
    assert rejected.status_code == 409, rejected.text
    assert rejected.json()["code"] == "source_revision_stale"
    assert body_texts(_resume(client, resume_id)["content"], "summary") == ["负责示例模块"]
