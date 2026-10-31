# SPDX-License-Identifier: Apache-2.0
"""W12 持久来源：关联建立/修订追加/反查/未关联不猜/级联（迁移 0053 的数据层证据）。

用真实 API（client fixture）验证契约形状，用 db_session 验证删除级联这类数据库行为。
所有来源都是合成数据，不涉及真实用户资料。
"""

from __future__ import annotations

from app.models.provenance import ResumeBlockSource, ResumeSource, ResumeSourceRevision
from app.services.resume.document_provenance import canonical_fingerprint


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


def _create_resume(client, title: str = "来源测试") -> int:
    response = client.post("/api/resumes/manual", json={"title": title, "content": _content()})
    assert response.status_code in (200, 201), response.text
    return int(response.json()["id"])


def _source_payload(fact: str = "负责合成数据接口") -> dict:
    return {
        "kind": "claim",
        "external_ref": "claim_record:12",
        "title": "示例主张",
        "payload": {"subject": "示例科技有限公司", "source_fact": fact},
        "metadata": {"category": "实习/工作", "subject": "示例科技有限公司"},
    }


def _link(client, resume_id: int, *, object_id: str = "expobj0001", payload: dict | None = None):
    response = client.post(
        f"/api/provenance/resumes/{resume_id}/links",
        json={"source": payload or _source_payload(), "object_id": object_id},
    )
    return response


def _object(view: dict, path: str) -> dict:
    return next(item for item in view["objects"] if item["path"] == path)


def test_link_creates_source_with_first_revision_and_coverage(client):
    resume_id = _create_resume(client)

    response = _link(client, resume_id)

    assert response.status_code == 201, response.text
    link = response.json()
    assert link["status"] == "linked"
    assert link["object_id"] == "expobj0001"
    assert link["path"] == "experience.expobj0001"
    assert len(link["source_fingerprint"]) == 64

    view = client.get(f"/api/provenance/resumes/{resume_id}").json()
    assert view["resume_id"] == resume_id
    assert len(view["sources"]) == 1
    source = view["sources"][0]
    assert source["kind"] == "claim"
    assert source["external_ref"] == "claim_record:12"
    assert source["latest_revision_no"] == 1
    assert len(source["revisions"]) == 1
    assert len(source["blocks"]) == 1
    # 共 3 个可关联块：实习条目 + 它的 1 个要点 + 教育条目。
    assert view["coverage"] == {"total": 3, "linked": 1, "unlinked": 2}
    experience_entry = _object(view, "experience.expobj0001")
    assert experience_entry["label"] == "示例科技有限公司"
    assert experience_entry["link"] is not None
    point = _object(view, "experience.expobj0001.pnt0000001")
    assert point["point_id"] == "pnt0000001"
    assert experience_entry["link"]["status"] == "linked"


def test_same_payload_reuses_source_and_does_not_add_revision(client):
    resume_id = _create_resume(client)
    first = _link(client, resume_id).json()
    second = _link(client, resume_id, object_id="eduobj0001").json()

    assert first["source_id"] == second["source_id"]
    view = client.get(f"/api/provenance/resumes/{resume_id}").json()
    source = view["sources"][0]
    assert source["latest_revision_no"] == 1
    assert len(source["revisions"]) == 1
    assert len(source["blocks"]) == 2
    assert view["coverage"]["linked"] == 2


def test_source_change_appends_revision_and_marks_impact_stale(client):
    resume_id = _create_resume(client)
    # 第一次关联到第 1 版来源；随后**在另一个块上**建立关联并把来源内容更新到第 2 版。
    # 第 1 个块不会被静默刷新——它必须仍指向第 1 版，界面据此显示"可能受影响"。
    first = _link(client, resume_id).json()
    changed = _link(
        client,
        resume_id,
        object_id="eduobj0001",
        payload=_source_payload("负责合成数据接口（更新）"),
    )
    assert changed.status_code == 201, changed.text
    source_id = changed.json()["source_id"]
    assert first["source_id"] == source_id

    view = client.get(f"/api/provenance/resumes/{resume_id}").json()
    source = view["sources"][0]
    assert source["latest_revision_no"] == 2
    assert [item["revision_no"] for item in source["revisions"]] == [1, 2]
    assert _object(view, "experience.expobj0001")["link"]["status"] == "stale"
    assert _object(view, "education.eduobj0001")["link"]["status"] == "linked"

    impact = client.get(f"/api/provenance/sources/{source_id}/impact")
    assert impact.status_code == 200
    body = impact.json()
    assert body["stale_count"] == 1
    assert len(body["affected"]) == 2
    stale = next(item for item in body["affected"] if item["stale"])
    assert stale["linked_fingerprint"] == first["source_fingerprint"]
    assert stale["current_fingerprint"] == changed.json()["source_fingerprint"]


def test_legacy_resume_without_links_is_reported_unlinked_without_guessing(client, db_session):
    resume_id = _create_resume(client)

    view = client.get(f"/api/provenance/resumes/{resume_id}").json()

    assert view["sources"] == []
    assert view["coverage"] == {"total": 3, "linked": 0, "unlinked": 3}
    assert all(item["link"] is None for item in view["objects"])
    # "不猜"是结构性的：旧记录阅读后库里不能凭空多出任何来源/关联行。
    assert db_session.query(ResumeSource).count() == 0
    assert db_session.query(ResumeBlockSource).count() == 0


def test_impact_lists_affected_resumes_across_resumes(client):
    first = _create_resume(client, "来源测试-A")
    second = _create_resume(client, "来源测试-B")
    link = _link(client, first).json()
    _link(client, second, object_id="eduobj0001")

    impact = client.get(f"/api/provenance/sources/{link['source_id']}/impact").json()
    assert {item["resume_id"] for item in impact["affected"]} == {first, second}
    assert impact["stale_count"] == 0


def test_chain_returns_sources_and_revisions(client):
    resume_id = _create_resume(client)
    _link(client, resume_id)

    response = client.get(
        f"/api/provenance/resumes/{resume_id}/chain", params={"object_id": "expobj0001"}
    )

    assert response.status_code == 200
    chain = response.json()
    assert chain["path"] == "experience.expobj0001"
    assert len(chain["sources"]) == 1
    assert len(chain["sources"][0]["revisions"]) == 1
    # 缺少目标定位参数：400（不是静默返回空链）。
    assert client.get(f"/api/provenance/resumes/{resume_id}/chain").status_code == 400


def test_unlink_removes_link_and_404_afterwards(client):
    resume_id = _create_resume(client)
    link_id = _link(client, resume_id).json()["link_id"]

    deleted = client.delete(f"/api/provenance/resumes/{resume_id}/links/{link_id}")
    assert deleted.status_code == 204
    view = client.get(f"/api/provenance/resumes/{resume_id}").json()
    assert view["coverage"]["linked"] == 0
    assert client.delete(f"/api/provenance/resumes/{resume_id}/links/{link_id}").status_code == 404


def test_link_rejects_unknown_object_and_bad_source_kind(client):
    resume_id = _create_resume(client)

    missing = _link(client, resume_id, object_id="missing0001")
    assert missing.status_code == 400
    bad_kind = client.post(
        f"/api/provenance/resumes/{resume_id}/links",
        json={"source": {"kind": "unknown", "title": "x"}, "object_id": "expobj0001"},
    )
    assert bad_kind.status_code == 422  # pydantic Literal 校验
    no_target = client.post(
        f"/api/provenance/resumes/{resume_id}/links", json={"source": _source_payload()}
    )
    assert no_target.status_code == 400


def test_source_detail_and_404(client):
    resume_id = _create_resume(client)
    source_id = _link(client, resume_id).json()["source_id"]

    detail = client.get(f"/api/provenance/sources/{source_id}")
    assert detail.status_code == 200
    assert detail.json()["blocks"][0]["path"] == "experience.expobj0001"
    assert client.get("/api/provenance/sources/999999").status_code == 404
    assert client.get("/api/provenance/sources/999999/impact").status_code == 404


def test_hard_deleting_resume_cascades_links(client, db_session):
    resume_id = _create_resume(client)
    _link(client, resume_id)
    assert db_session.query(ResumeBlockSource).count() == 1

    db_session.execute(
        __import__("sqlalchemy").text("DELETE FROM resume_record WHERE id = :id"),
        {"id": resume_id},
    )
    db_session.commit()

    assert db_session.query(ResumeBlockSource).count() == 0
    # 来源实体本身保留（它是资料侧的对象，不随某一份简历消失）。
    assert db_session.query(ResumeSource).count() == 1
    assert db_session.query(ResumeSourceRevision).count() == 1


def test_fingerprint_is_order_insensitive_but_content_sensitive():
    first = canonical_fingerprint({"a": 1, "b": 2})
    assert first == canonical_fingerprint({"b": 2, "a": 1})
    assert first != canonical_fingerprint({"a": 1, "b": 3})
    assert canonical_fingerprint("  text  ") == canonical_fingerprint("text")
    assert canonical_fingerprint(None) == canonical_fingerprint("")


def test_provenance_rows_are_scoped_to_the_active_dataset(client, db_session):
    """数据集隔离证据：行只写进当前数据集自己的库文件，其余数据集是干净的。

    每份数据集是一个独立 SQLite 库，因此隔离是**结构性**的；这里直接读两份库文件的
    行数来证明它，而不是断言"服务层会过滤 dataset_id"（根本没有这个字段）。
    """
    import sqlite3
    from contextlib import closing
    from pathlib import Path

    from app import database
    from app.database_migrations import application_tables
    from app.dataset_registry import dataset_database_file
    from app.services.datasets import create_dataset

    resume_id = _create_resume(client)
    _link(client, resume_id)

    def _count(database_file: Path, table: str) -> int:
        with closing(sqlite3.connect(str(database_file))) as connection:
            return connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]

    active_file = Path(database.engine.url.database)
    assert _count(active_file, "resume_source") == 1
    assert _count(active_file, "resume_block_source") == 1

    other = create_dataset("隔离检查数据集", database.engine)
    other_file = dataset_database_file(other["id"])
    # 另一份数据集跑过同一套迁移（表存在），但没有任何本数据集的行。
    assert _count(other_file, "resume_source") == 0
    assert _count(other_file, "resume_block_source") == 0
    assert _count(other_file, "resume_fact_lock") == 0
    assert _count(other_file, "llm_usage_record") == 0
    # 新表自动进入备份清单（从 Base.metadata 推导）：旧备份导入后这些表一定在。
    assert {
        "resume_source",
        "resume_source_revision",
        "resume_block_source",
        "resume_fact_lock",
        "llm_usage_record",
    } <= set(application_tables())
