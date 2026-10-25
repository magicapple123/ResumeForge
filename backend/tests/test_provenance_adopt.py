# SPDX-License-Identifier: Apache-2.0
"""W12 可达性补充：来源列表/手工来源/修订列表/已有来源关联/采纳写正文。

从 test_provenance.py 拆出（测试文件 500 行预算）：本文件聚焦"来源面板挑选已有来源 →
关联 → 来源更新后采纳进正文"这条真实用户路径，含条件写/指纹/事实锁/正文锁的拒绝路径。
所有来源都是合成数据，不涉及真实用户资料。
"""

from __future__ import annotations


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
        "education": [{"id": "eduobj0001", "school": "示例大学"}],
    }


def _create_resume(client, title: str = "来源采纳测试") -> int:
    response = client.post("/api/resumes/manual", json={"title": title, "content": _content()})
    assert response.status_code in (200, 201), response.text
    return int(response.json()["id"])


def _source_payload(fact: str = "负责合成数据接口") -> dict:
    return {
        "kind": "claim",
        "external_ref": "claim_record:12",
        "title": "示例主张",
        "payload": {"subject": "示例科技有限公司", "source_fact": fact},
        "metadata": {"category": "实习/工作"},
    }


def _text_source_payload(text: str) -> dict:
    """payload 用纯文本：来源指纹 = canonical_fingerprint(text)，采纳时能逐字校验。"""
    return {
        "kind": "claim",
        "external_ref": "claim_record:12",
        "title": "示例主张",
        "payload": text,
    }


def _link(client, resume_id: int, *, object_id: str = "expobj0001", payload: dict | None = None):
    response = client.post(
        f"/api/provenance/resumes/{resume_id}/links",
        json={"source": payload or _source_payload(), "object_id": object_id},
    )
    assert response.status_code == 201, response.text
    return response


def _link_point(client, resume_id: int, payload: dict | None = None) -> dict:
    response = client.post(
        f"/api/provenance/resumes/{resume_id}/links",
        json={
            "source": payload or _source_payload(),
            "object_id": "expobj0001",
            "point_id": "pnt0000001",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _resume_record(client, resume_id: int) -> dict:
    response = client.get(f"/api/resumes/{resume_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _create_manual_source(client, title: str = "手工资料") -> dict:
    response = client.post("/api/provenance/sources", json={"title": title})
    assert response.status_code == 201, response.text
    return response.json()


def _source_detail(client, source_id: int) -> dict:
    response = client.get(f"/api/provenance/sources/{source_id}")
    assert response.status_code == 200, response.text
    return response.json()


# ===== W12 可达性补充：来源列表 / 手工来源 / 修订 / 已有来源关联 / 采纳写正文 =====


def _resume_record(client, resume_id: int) -> dict:
    response = client.get(f"/api/resumes/{resume_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _create_manual_source(client, title: str = "手工资料") -> dict:
    response = client.post("/api/provenance/sources", json={"title": title})
    assert response.status_code == 201, response.text
    return response.json()


def _link_point(client, resume_id: int, payload: dict | None = None) -> dict:
    response = client.post(
        f"/api/provenance/resumes/{resume_id}/links",
        json={
            "source": payload or _source_payload(),
            "object_id": "expobj0001",
            "point_id": "pnt0000001",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _source_detail(client, source_id: int) -> dict:
    response = client.get(f"/api/provenance/sources/{source_id}")
    assert response.status_code == 200, response.text
    return response.json()


def test_source_list_create_and_revisions(client):
    resume_id = _create_resume(client)
    _link(client, resume_id)  # claim 来源
    manual = _create_manual_source(client, "外部资料 A")
    assert manual["kind"] == "manual"
    assert manual["title"] == "外部资料 A"
    assert manual["revision"]["revision_no"] == 1

    listed = client.get("/api/provenance/sources").json()
    assert listed["total"] == 2
    kinds = {item["kind"] for item in listed["items"]}
    assert kinds == {"claim", "manual"}
    claim_item = next(item for item in listed["items"] if item["kind"] == "claim")
    assert claim_item["external_ref"] == "claim_record:12"
    assert claim_item["latest_revision_no"] == 1
    assert "payload" not in claim_item  # 列表不返回任何正文
    filtered = client.get("/api/provenance/sources", params={"kind": "manual"}).json()
    assert [item["id"] for item in filtered["items"]] == [manual["id"]]
    keyword = client.get("/api/provenance/sources", params={"keyword": "外部"}).json()
    assert [item["id"] for item in keyword["items"]] == [manual["id"]]
    assert client.get("/api/provenance/sources", params={"limit": 1}).json()["total"] == 2

    revisions = client.get(f"/api/provenance/sources/{manual['id']}/revisions").json()
    assert revisions["source_id"] == manual["id"]
    assert [item["revision_no"] for item in revisions["revisions"]] == [1]
    assert revisions["revisions"][0]["id"] == manual["revision"]["id"]

    # 形状校验：空标题 422、纯空白 400、过长 422、非 manual 类型 422。
    assert client.post("/api/provenance/sources", json={"title": ""}).status_code == 422
    assert client.post("/api/provenance/sources", json={"title": "   "}).status_code == 400
    assert client.post("/api/provenance/sources", json={"title": "x" * 257}).status_code == 422
    assert (
        client.post("/api/provenance/sources", json={"title": "x", "kind": "claim"}).status_code
        == 422
    )
    assert client.get("/api/provenance/sources/9999/revisions").status_code == 404


def test_link_existing_source_dedupes_and_validates(client):
    resume_id = _create_resume(client)
    manual = _create_manual_source(client, "可关联来源")

    first = client.post(
        "/api/provenance/links",
        json={"resume_id": resume_id, "source_id": manual["id"], "object_id": "expobj0001"},
    )
    assert first.status_code == 201, first.text
    link = first.json()
    assert link["path"] == "experience.0"
    assert link["status"] == "linked"
    # 重复关联 = 去重刷新同一行，不是第二条关联。
    second = client.post(
        "/api/provenance/links",
        json={
            "resume_id": resume_id,
            "source_id": manual["id"],
            "object_id": "expobj0001",
            "field": "experience",
        },
    ).json()
    assert second["link_id"] == link["link_id"]
    view = client.get(f"/api/provenance/resumes/{resume_id}").json()
    assert view["coverage"]["linked"] == 1

    # 路径兜底关联（旧块没有 object_id 时同样可用）。
    by_path = client.post(
        "/api/provenance/links",
        json={"resume_id": resume_id, "source_id": manual["id"], "path": "education.0"},
    )
    assert by_path.status_code == 201, by_path.text
    assert by_path.json()["path"] == "education.0"

    # 错误语义：简历/来源/修订不存在 → 404；块解析不到 → 400。
    assert (
        client.post(
            "/api/provenance/links", json={"resume_id": 9999, "source_id": manual["id"]}
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/provenance/links", json={"resume_id": resume_id, "source_id": 9999}
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/provenance/links",
            json={"resume_id": resume_id, "source_id": manual["id"], "object_id": "missing0001"},
        ).status_code
        == 400
    )
    other = _create_manual_source(client, "另一条来源")
    assert (
        client.post(
            "/api/provenance/links",
            json={
                "resume_id": resume_id,
                "source_id": manual["id"],
                "source_revision_id": other["revision"]["id"],
                "object_id": "expobj0001",
            },
        ).status_code
        == 404
    )


def test_link_existing_source_to_an_older_revision_is_stale(client):
    resume_id = _create_resume(client)
    first_link = _link(client, resume_id).json()
    source_id = first_link["source_id"]
    first_revision = _source_detail(client, source_id)["revisions"][0]
    # 来源内容更新到第 2 版（在另一个块上建立关联会刷新来源修订）。
    _link(client, resume_id, object_id="eduobj0001", payload=_source_payload("已更新的表述"))

    linked_old = client.post(
        "/api/provenance/links",
        json={
            "resume_id": resume_id,
            "source_id": source_id,
            "source_revision_id": first_revision["id"],
            "path": "summary",
        },
    )
    assert linked_old.status_code == 201, linked_old.text
    assert linked_old.json()["status"] == "stale"
    assert linked_old.json()["source_fingerprint"] == first_revision["fingerprint"]


def test_adopt_source_text_writes_content_and_refreshes_link(client):
    resume_id = _create_resume(client)
    old_text = "负责合成数据接口"
    link = _link_point(client, resume_id, _text_source_payload(old_text))
    before = _resume_record(client, resume_id)

    # 来源更新到第 2 版：采用「采纳来源更新」时必须把**新文本**写进要点。
    new_text = "主导合成数据接口的设计与实现"
    client.post(
        f"/api/provenance/resumes/{resume_id}/links",
        json={
            "source": _text_source_payload(new_text),
            "object_id": "expobj0001",
            "point_id": "pnt0000001",
        },
    )
    latest = _source_detail(client, link["source_id"])["revisions"][-1]
    assert latest["revision_no"] == 2

    adopted = client.post(
        f"/api/provenance/links/{link['link_id']}/adopt",
        json={
            "text": new_text,
            "expected_revision": before["revision"],
            "source_revision_id": latest["id"],
        },
    )
    assert adopted.status_code == 200, adopted.text
    body = adopted.json()
    assert body["applied_path"] == "experience.0.description.0"
    assert body["revision"] == before["revision"] + 1
    assert body["content"]["experience"][0]["description"] == [new_text]
    assert body["link"]["status"] == "linked"
    assert body["source_revision_no"] == 2

    after = _resume_record(client, resume_id)
    assert after["content"]["experience"][0]["description"] == [new_text]
    assert after["revision"] == before["revision"] + 1
    # 反查影响：采纳后这个块不再 stale。
    impact = client.get(f"/api/provenance/sources/{link['source_id']}/impact").json()
    target = next(item for item in impact["affected"] if item["link_id"] == link["link_id"])
    assert target["stale"] is False
    assert impact["stale_count"] == 0

    # 采纳成功不改变其它字段（只动那一个要点）。
    assert after["content"]["experience"][0]["company"] == "示例科技有限公司"


def test_adopt_source_text_rejects_conflicts_and_stale_source(client):
    resume_id = _create_resume(client)
    link = _link_point(client, resume_id, _text_source_payload("负责合成数据接口"))
    before = _resume_record(client, resume_id)
    new_text = "更具体的新表述"
    # 来源更新到第 2 版（换一个块建立关联会追加修订，不改变已有链接的指纹）。
    client.post(
        f"/api/provenance/resumes/{resume_id}/links",
        json={
            "source": _text_source_payload(new_text),
            "object_id": "expobj0001",
            "point_id": "pnt0000001",
        },
    )

    # 1) 迟到：expected_revision 已过期 → 409 resume_revision_conflict，不写。
    moved = _resume_record(client, resume_id)
    moved_content = moved["content"]
    moved_content["summary"] = "另一个窗口刚保存的总结"
    saved = client.put(
        f"/api/resumes/{resume_id}/content",
        json={"content": moved_content, "expected_revision": moved["revision"]},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == before["revision"] + 1
    late = client.post(
        f"/api/provenance/links/{link['link_id']}/adopt",
        json={"text": new_text, "expected_revision": before["revision"]},
    )
    assert late.status_code == 409, late.text
    assert late.json()["code"] == "resume_revision_conflict"

    # 2) 来源在查看后又变了：文本指纹对不上最新修订 → 409 source_revision_stale。
    stale = client.post(
        f"/api/provenance/links/{link['link_id']}/adopt",
        json={"text": "用户手里那份旧文本", "expected_revision": None},
    )
    assert stale.status_code == 409, stale.text
    assert stale.json()["code"] == "source_revision_stale"
    # 两次拒绝都没有改动正文（description 仍是原句）。
    assert _resume_record(client, resume_id)["content"]["experience"][0]["description"] == [
        "负责合成数据接口"
    ]

    # 3) 关联不存在 → 404；目标块被删 → 400。
    assert (
        client.post("/api/provenance/links/9999/adopt", json={"text": new_text}).status_code == 404
    )
    removed = _resume_record(client, resume_id)["content"]
    removed["experience"] = []
    saved = client.put(
        f"/api/resumes/{resume_id}/content",
        json={
            "content": removed,
            "expected_revision": _resume_record(client, resume_id)["revision"],
        },
    )
    assert saved.status_code == 200, saved.text
    gone = client.post(
        f"/api/provenance/links/{link['link_id']}/adopt",
        json={"text": new_text, "expected_revision": saved.json()["revision"]},
    )
    assert gone.status_code == 400


def test_adopt_into_entry_level_link_requires_explicit_path(client):
    resume_id = _create_resume(client)
    text = "改写成一句新的成果表述"
    entry_link = client.post(
        f"/api/provenance/resumes/{resume_id}/links",
        json={"source": _text_source_payload(text), "object_id": "expobj0001"},
    ).json()
    no_path = client.post(
        f"/api/provenance/links/{entry_link['link_id']}/adopt", json={"text": text}
    )
    assert no_path.status_code == 400
    assert "路径" in no_path.json()["detail"]

    with_path = client.post(
        f"/api/provenance/links/{entry_link['link_id']}/adopt",
        json={"text": text, "path": "experience.0.description.0"},
    )
    assert with_path.status_code == 200, with_path.text
    assert with_path.json()["content"]["experience"][0]["description"] == [text]
