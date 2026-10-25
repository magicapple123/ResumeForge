# SPDX-License-Identifier: Apache-2.0
"""补充事实（A3）的本地 CRUD、旧资料兼容、回收站与备份 round trip。

这组用例守住四条契约性质：

1. 六类事实都能严格校验、保存、重开、排序、软删、恢复与彻底删除；
2. **旧 Profile PUT 不影响新事实**（G21）：条数、fact_id、revision 都不变；
3. 删除进回收站（可恢复），彻底删除只接受回收站里的记录；
4. 备份导出/导入后 profile_fact 的行数与内容一致。
"""

from __future__ import annotations

import copy
import json
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from app.database import SessionLocal, engine
from app.models.profile import UserProfile
from app.models.profile_fact import ProfileFact
from app.schemas.profile_facts import PROFILE_FACT_SCHEMA_VERSION
from app.services.data_backup import MANIFEST_MEMBER, create_backup_archive
from app.services.data_backup.import_archive import extract_database

FACTS_API = "/api/profile/facts"
PROFILE_API = "/api/profile"
CONFLICT_CODE = "profile_fact_revision_conflict"

SAMPLE_PAYLOADS: dict[str, dict] = {
    "publication": {
        "title": "跨行业简历事实建模",
        "authors": [
            {"name": "张三", "is_self": True},
            {"name": "李四", "corresponding": True},
        ],
        "venue": "软件工程学报",
        "year": "2024",
        "status": "published",
        "doi": "10.1000/rf.2024",
        "url": "https://example.com/paper",
        "volume_pages": "12-20",
        "note": "第一作者",
    },
    "research_project": {
        "name": "跨行业人才匹配研究",
        "role": "负责人",
        "organization": "示例大学",
        "start_date": "2023年3月",
        "end_date": "至今",
        "funding": "国家自然科学基金 10 万元",
        "description": ["负责研究设计与实验"],
        "outcomes": ["形成两份行业报告"],
    },
    "patent": {
        "title": "一种简历事实抽取方法",
        "inventors": [{"name": "张三", "is_self": True}],
        "patent_number": "CN2024000001",
        "country": "CN",
        "status": "granted",
        "filed_date": "2023.05",
        "granted_date": "2024/1/2",
        "url": "https://example.com/patent",
    },
    "credential": {
        "name": "项目管理专业人士（PMP）",
        "issuer": "PMI",
        "issue_date": "2020/3",
        "expiry_date": "2026年12月",
        "status": "active",
        "credential_number": "SECRET-CRED-0001",
        "verify_url": "https://example.com/verify",
        "note": "需按周期续证",
    },
    "work_project": {
        "name": "开源简历工具",
        "role": "主要维护者",
        "start_date": "2022-01",
        "end_date": "至今",
        "tech_stack": ["Python", "FastAPI"],
        "description": ["实现事实校验链路"],
        "highlights": ["一周内接入两类新事实"],
        "public_url": "https://example.com/repo",
        "artifact_type": "开源软件",
    },
    "practice": {
        "organization": "社区志愿服务中心",
        "role": "志愿者",
        "experience_kind": "volunteer",
        "start_date": "2021.09",
        "end_date": "2022.06",
        "description": ["每周参与社区服务两小时"],
    },
}


def _body(kind: str, payload: dict | None = None, sort_order: int | None = None) -> dict:
    body = {"kind": kind, "payload": copy.deepcopy(payload or SAMPLE_PAYLOADS[kind])}
    if sort_order is not None:
        body["sort_order"] = sort_order
    return body


def _create(client, kind: str, payload: dict | None = None, sort_order: int | None = None):
    response = client.post(FACTS_API, json=_body(kind, payload, sort_order))
    assert response.status_code == 201, response.text
    return response.json()


def _list(client, **params):
    response = client.get(FACTS_API, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _db_rows() -> list[ProfileFact]:
    with SessionLocal() as db:
        return (
            db.query(ProfileFact).order_by(ProfileFact.sort_order.asc(), ProfileFact.id.asc()).all()
        )


def _profile_put_body() -> dict:
    return {
        "name": "张三",
        "phone": "13800000000",
        "email": "zhangsan@example.com",
        "job_intent": "后端工程师",
        "educations": [{"school": "示例大学", "major": "软件工程", "degree": "本科"}],
        "experiences": [{"company": "示例科技", "role": "实习生"}],
    }


# ===== 创建 / 列表 / 排序 =====


def test_create_all_six_kinds_and_list_in_sort_order(client):
    created = [_create(client, kind) for kind in SAMPLE_PAYLOADS]

    assert [item["kind"] for item in created] == list(SAMPLE_PAYLOADS)
    for fact in created:
        assert len(fact["fact_id"]) == 24
        assert fact["fact_id"].isalnum()
        assert fact["revision"] == 1
        assert fact["schema_version"] == PROFILE_FACT_SCHEMA_VERSION
        assert fact["deleted_at"] is None
        assert fact["created_at"]
        assert fact["sort_order"] == created.index(fact)

    listing = _list(client)
    assert listing["total"] == 6
    assert [item["fact_id"] for item in listing["items"]] == [item["fact_id"] for item in created]
    # 规范化落在存储上：日期是短横线格式，作者标记原样保留。
    publication = listing["items"][0]["payload"]
    assert publication["status"] == "published"
    assert [author["name"] for author in publication["authors"]] == ["张三", "李四"]
    research = listing["items"][1]["payload"]
    assert (research["start_date"], research["end_date"]) == ("2023-03", "至今")
    credential = listing["items"][3]["payload"]
    assert (credential["issue_date"], credential["expiry_date"]) == ("2020-03", "2026-12")
    # 本地 CRUD 会原样返回证号（用户自己的库），生成候选才剔除（见 fact_context 测试）。
    assert credential["credential_number"] == "SECRET-CRED-0001"


def test_default_sort_order_appends_and_explicit_order_is_kept(client):
    first = _create(client, "publication")
    second = _create(client, "patent", sort_order=50)
    third = _create(client, "practice")

    # 缺省"追加到末尾"= 当前未删事实的最大 sort_order +1；显式值原样保存。
    assert [first["sort_order"], second["sort_order"], third["sort_order"]] == [0, 50, 51]
    listing = _list(client)
    assert [item["fact_id"] for item in listing["items"]] == [
        first["fact_id"],
        second["fact_id"],
        third["fact_id"],
    ]


def test_kind_filter_and_pagination(client):
    publication_ids = {
        _create(client, "publication", {"title": f"论文 {index}"})["fact_id"] for index in range(3)
    }
    _create(client, "patent")

    filtered = _list(client, kind="publication")
    assert filtered["total"] == 3
    assert {item["fact_id"] for item in filtered["items"]} == publication_ids

    page = _list(client, limit=2, offset=1)
    assert page["total"] == 4
    assert len(page["items"]) == 2
    assert client.get(FACTS_API, params={"kind": "unknown"}).status_code == 422
    assert client.get(FACTS_API, params={"limit": 0}).status_code == 422


# ===== 更新 / 条件写 =====


def test_patch_replaces_payload_bumps_revision_and_normalizes_dates(client):
    fact = _create(client, "credential")

    updated_payload = {
        "name": "信息系统项目管理师",
        "issuer": "工信部",
        "issue_date": "2021年7月3日",
        "expiry_date": "至今",
        "status": "active",
        "credential_number": "SECRET-CRED-0002",
    }
    response = client.patch(
        f"{FACTS_API}/{fact['fact_id']}",
        json={"payload": updated_payload, "expected_revision": 1},
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["revision"] == 2
    assert updated["fact_id"] == fact["fact_id"]
    assert updated["payload"]["issue_date"] == "2021-07-03"

    reloaded = _list(client, kind="credential")["items"][0]
    assert reloaded["revision"] == 2
    assert reloaded["payload"]["name"] == "信息系统项目管理师"


def test_patch_sort_order_only_keeps_payload_and_identity(client):
    fact = _create(client, "publication")

    response = client.patch(
        f"{FACTS_API}/{fact['fact_id']}",
        json={"sort_order": 9},
    )
    assert response.status_code == 200
    moved = response.json()
    assert moved["sort_order"] == 9
    assert moved["fact_id"] == fact["fact_id"]
    assert moved["payload"] == fact["payload"]
    assert moved["revision"] == 2


def test_patch_conflict_returns_409_with_current_revision(client):
    fact = _create(client, "publication")

    response = client.patch(
        f"{FACTS_API}/{fact['fact_id']}",
        json={"payload": {"title": "新标题"}, "expected_revision": 99},
    )
    assert response.status_code == 409
    body = response.json()
    assert body["code"] == CONFLICT_CODE
    assert body["revision"] == 1
    assert body["detail"]

    # 冲突不写库：旧值原样保留。
    stored = _list(client)["items"][0]
    assert stored["payload"]["title"] == SAMPLE_PAYLOADS["publication"]["title"]
    assert stored["revision"] == 1


def test_patch_invalid_payload_returns_422_without_modifying(client):
    fact = _create(client, "patent")

    response = client.patch(
        f"{FACTS_API}/{fact['fact_id']}",
        json={"payload": {"title": "T", "unknown_field": 1}},
    )
    assert response.status_code == 422

    stored = _list(client)["items"][0]
    assert stored["revision"] == 1
    assert stored["payload"]["title"] == SAMPLE_PAYLOADS["patent"]["title"]


def test_update_missing_fact_returns_404(client):
    assert client.patch(f"{FACTS_API}/does-not-exist", json={}).status_code == 404
    assert client.delete(f"{FACTS_API}/does-not-exist").status_code == 404


# ===== 校验上限 =====


@pytest.mark.parametrize(
    ("kind", "payload"),
    [
        ("publication", {"title": "T", "url": "javascript:alert(1)"}),
        ("credential", {"name": "证", "verify_url": "ftp://example.com/a"}),
        ("work_project", {"name": "作品", "public_url": "file:///etc/passwd"}),
        ("publication", {"title": "T", "status": "fabricated"}),
        ("patent", {"title": "T", "inventors": [{"name": str(index)} for index in range(51)]}),
        (
            "research_project",
            {"name": "项目", "description": ["一行"] * 201},
        ),
        ("practice", {"organization": "机构", "experience_kind": "guessed"}),
    ],
)
def test_create_rejects_invalid_payload(client, kind, payload):
    response = client.post(FACTS_API, json=_body(kind, payload))
    assert response.status_code == 422, response.text
    assert _list(client)["total"] == 0


def test_create_rejects_unknown_kind_and_unknown_field(client):
    assert client.post(FACTS_API, json={"kind": "hobby", "payload": {}}).status_code == 422
    body = _body("publication", {"title": "T", "payload_typo": 1})
    assert client.post(FACTS_API, json=body).status_code == 422
    extra = {**_body("publication"), "unexpected": 1}
    assert client.post(FACTS_API, json=extra).status_code == 422


# ===== 软删 / 回收站 =====


def test_soft_delete_hides_from_list_and_is_idempotent(client):
    fact = _create(client, "research_project")

    first = client.delete(f"{FACTS_API}/{fact['fact_id']}")
    assert first.status_code == 200
    assert first.json() == {"deleted": True}
    first_deleted_at = _db_rows()[0].deleted_at
    assert first_deleted_at is not None

    assert _list(client)["total"] == 0
    page = _list(client, include_deleted=True)
    assert page["total"] == 1
    assert page["items"][0]["deleted_at"]

    # 幂等：重复删除成功，且不刷新删除时间（否则回收站里会不断上浮）。
    second = client.delete(f"{FACTS_API}/{fact['fact_id']}")
    assert second.status_code == 200
    assert _db_rows()[0].deleted_at == first_deleted_at

    # 已删除的事实不能再被 PATCH（否则等于绕过回收站）。
    assert client.patch(f"{FACTS_API}/{fact['fact_id']}", json={}).status_code == 404


def test_trash_restore_then_permanent_delete(client):
    fact = _create(client, "credential")
    local_id = _db_rows()[0].id
    assert client.delete(f"{FACTS_API}/{fact['fact_id']}").status_code == 200

    trash = client.get("/api/trash", params={"type": "profile_fact"}).json()
    assert trash["counts"]["profile_fact"] == 1
    assert trash["labels"]["profile_fact"] == "补充事实"
    assert trash["items"][0]["id"] == local_id
    assert trash["items"][0]["title"] == SAMPLE_PAYLOADS["credential"]["name"]

    restored = client.post(f"/api/trash/profile_fact/{local_id}/restore")
    assert restored.status_code == 204
    assert _list(client)["total"] == 1
    assert _list(client)["items"][0]["revision"] == 1

    # 彻底删除只接受回收站里的记录：先删一次再 purge，之后行真的消失。
    assert client.delete(f"{FACTS_API}/{fact['fact_id']}").status_code == 200
    assert client.delete(f"/api/trash/profile_fact/{local_id}").status_code == 204
    assert _list(client, include_deleted=True)["total"] == 0
    assert _db_rows() == []


# ===== 旧资料兼容（G21） =====


def test_old_profile_put_keeps_new_facts(client):
    facts = [_create(client, kind) for kind in SAMPLE_PAYLOADS]
    before = [
        (fact["fact_id"], fact["revision"], json.dumps(fact["payload"], sort_keys=True))
        for fact in facts
    ]

    assert client.put(PROFILE_API, json=_profile_put_body()).status_code == 200
    after_first = _list(client)
    assert after_first["total"] == len(facts)
    assert [
        (fact["fact_id"], fact["revision"], json.dumps(fact["payload"], sort_keys=True))
        for fact in after_first["items"]
    ] == before

    # 再保存一次（旧客户端反复保存旧字段）仍然不动新事实。
    assert (
        client.put(PROFILE_API, json={**_profile_put_body(), "phone": "13900000000"}).status_code
        == 200
    )
    after_second = _list(client)
    assert [fact["fact_id"] for fact in after_second["items"]] == [
        fact["fact_id"] for fact in facts
    ]
    assert [fact["revision"] for fact in after_second["items"]] == [1] * len(facts)
    # 旧资料本身照常保存。
    profile = client.get(PROFILE_API).json()
    assert profile["phone"] == "13900000000"


def test_read_endpoints_do_not_create_profile_row(client):
    assert _list(client) == {"items": [], "total": 0}
    with SessionLocal() as db:
        assert db.query(UserProfile).count() == 0

    _create(client, "publication")
    with SessionLocal() as db:
        assert db.query(UserProfile).count() == 1


# ===== 备份 round trip =====


def test_backup_round_trip_preserves_profile_fact_rows(client, tmp_path: Path):
    _create(client, "publication")
    _create(client, "credential")
    deleted = _create(client, "practice")
    assert client.delete(f"{FACTS_API}/{deleted['fact_id']}").status_code == 200
    expected = [
        {
            "fact_id": row.fact_id,
            "kind": row.kind,
            "revision": row.revision,
            "sort_order": row.sort_order,
            "payload": row.payload,
            "deleted": row.deleted_at is not None,
        }
        for row in _db_rows()
    ]
    assert len(expected) == 3

    archive = create_backup_archive(engine, tmp_path / "staging")
    restored_db = extract_database(archive, tmp_path / "restored.db")
    assert restored_db.exists()

    import zipfile

    with zipfile.ZipFile(archive) as package:
        manifest = json.loads(package.read(MANIFEST_MEMBER))
    assert manifest["tables"]["profile_fact"] == 3

    actual = []
    with closing(sqlite3.connect(restored_db)) as connection:
        rows = connection.execute(
            "SELECT fact_id, kind, revision, sort_order, payload, deleted_at "
            "FROM profile_fact ORDER BY sort_order, id"
        ).fetchall()
    for fact_id, kind, revision, sort_order, payload_json, deleted_at in rows:
        actual.append(
            {
                "fact_id": fact_id,
                "kind": kind,
                "revision": revision,
                "sort_order": sort_order,
                "payload": json.loads(payload_json),
                "deleted": deleted_at is not None,
            }
        )
    assert actual == expected


def test_legacy_payload_without_custom_fields_is_normalized_on_read(client, db_session):
    """灵活字段上线前的旧 payload 没有 custom_fields：读取必须补 []，前端才能安全渲染。"""
    created = client.post(
        "/api/profile/facts",
        json={"kind": "publication", "payload": {"title": "旧记录论文"}},
    )
    assert created.status_code == 201, created.text
    fact_id = created.json()["fact_id"]

    row = db_session.query(ProfileFact).filter(ProfileFact.fact_id == fact_id).one()
    legacy_payload = copy.deepcopy(row.payload)
    legacy_payload.pop("custom_fields", None)
    row.payload = legacy_payload
    db_session.commit()

    listing = client.get("/api/profile/facts").json()
    item = next(entry for entry in listing["items"] if entry["fact_id"] == fact_id)
    assert item["payload"]["custom_fields"] == []
