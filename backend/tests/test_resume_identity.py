# SPDX-License-Identifier: Apache-2.0
"""W01：条目/要点的稳定对象身份（可选 ``id`` + ``point_ids`` 伴随映射）。

四条不能退让的性质：

1. **读不物化**：打开一份旧简历只是看，不该在数据库里凭空长出 id，也不该刷新
   ``updated_at``（那会让"最近修改"排序说谎）。
2. **保存原样落库**：客户端带的 id 必须完整往返，否则加粗覆盖/来源标注/批注下次
   打开就全部失联。
3. **写侧严格**：非法 id、同数组重复、``point_ids`` 与内容不等长、未知要点字段一律
   422，**不静默重生成**——重生成等于把用户设备上的标识换掉。
4. **排序不换 id**：反序保存后 id 集合不变、顺序变；按 id 解析路径拿到的是新下标。
"""

from __future__ import annotations

from app.models.resume import ResumeRecord
from app.services.resume.document_identity import (
    DocumentIdentityError,
    resolve_object_path,
    resolve_point_path,
    sanitize_document_ids,
)

ID_A = "exp_00000001"
ID_B = "exp_00000002"
POINT_A1 = "pt_00000001"


def _create(client, content: dict) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={"title": "身份用例", "content": content, "job_id": None, "draft": False},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _two_experiences() -> list[dict]:
    return [
        {
            "company": "甲公司",
            "role": "工程师",
            "description": ["做了甲", "做了乙"],
            "id": ID_A,
            "point_ids": {"description": [POINT_A1, "pt_00000002"]},
        },
        {"company": "乙公司", "role": "工程师", "description": ["做了丙"], "id": ID_B},
    ]


def test_legacy_content_is_read_back_without_materializing_ids(client, db_session):
    resume_id = _create(client, {"name": "张三", "experience": [{"company": "甲公司"}]})
    record = db_session.get(ResumeRecord, resume_id)
    before_updated_at = record.updated_at
    before_content = dict(record.content)
    db_session.expire_all()

    detail = client.get(f"/api/resumes/{resume_id}")
    assert detail.status_code == 200
    # 没有身份时**连键都不出现**（不是 `"id": null`）：旧记录、旧客户端、内容指纹
    # 因此一个字节都不受影响（见 `schemas/resume_identity.py`）。
    assert "id" not in detail.json()["content"]["experience"][0]

    db_session.expire_all()
    after = db_session.get(ResumeRecord, resume_id)
    assert after.content == before_content
    assert after.updated_at == before_updated_at


def test_save_persists_the_ids_sent_by_the_client(client, db_session):
    resume_id = _create(client, {"name": "张三"})

    response = client.put(
        f"/api/resumes/{resume_id}/content",
        json={"content": {"name": "张三", "experience": _two_experiences()}},
    )
    assert response.status_code == 200, response.text
    detail = client.get(f"/api/resumes/{resume_id}").json()
    assert [item["id"] for item in detail["content"]["experience"]] == [ID_A, ID_B]
    assert detail["content"]["experience"][0]["point_ids"]["description"] == [
        POINT_A1,
        "pt_00000002",
    ]


def test_reorder_keeps_ids_and_resolves_to_the_new_index(client, db_session):
    resume_id = _create(client, {"name": "张三", "experience": _two_experiences()})
    reversed_entries = list(reversed(_two_experiences()))

    response = client.put(
        f"/api/resumes/{resume_id}/content",
        json={"content": {"name": "张三", "experience": reversed_entries}},
    )
    assert response.status_code == 200, response.text
    detail = client.get(f"/api/resumes/{resume_id}").json()
    assert [item["id"] for item in detail["content"]["experience"]] == [ID_B, ID_A]

    # 排序之后，同一个对象的路径由**当前下标**现算，不保存绝对位置。
    assert resolve_object_path(detail["content"], ID_A) == "experience.1"
    assert resolve_point_path(detail["content"], ID_A, POINT_A1) == "experience.1.description.0"


def test_invalid_id_characters_are_rejected(client, db_session):
    resume_id = _create(client, {"name": "张三"})
    response = client.put(
        f"/api/resumes/{resume_id}",
        json={"name": "张三", "experience": [{"company": "甲", "id": "has space"}]},
    )
    assert response.status_code == 422, response.text
    assert "对象标识" in response.text


def test_too_long_id_is_rejected_by_the_schema(client, db_session):
    resume_id = _create(client, {"name": "张三"})
    response = client.put(
        f"/api/resumes/{resume_id}",
        json={"name": "张三", "experience": [{"company": "甲", "id": "x" * 33}]},
    )
    assert response.status_code == 422, response.text


def test_duplicate_ids_in_one_array_are_rejected(client, db_session):
    resume_id = _create(client, {"name": "张三"})
    response = client.put(
        f"/api/resumes/{resume_id}",
        json={
            "name": "张三",
            "experience": [
                {"company": "甲", "id": ID_A},
                {"company": "乙", "id": ID_A},
            ],
        },
    )
    assert response.status_code == 422, response.text
    assert "重复" in response.text


def test_point_ids_length_must_match_its_field(client, db_session):
    resume_id = _create(client, {"name": "张三"})
    response = client.put(
        f"/api/resumes/{resume_id}",
        json={
            "name": "张三",
            "experience": [
                {
                    "company": "甲",
                    "description": ["做了甲", "做了乙"],
                    "point_ids": {"description": [POINT_A1]},
                }
            ],
        },
    )
    assert response.status_code == 422, response.text
    assert "数量" in response.text


def test_unknown_point_ids_key_is_rejected(client, db_session):
    resume_id = _create(client, {"name": "张三"})
    response = client.put(
        f"/api/resumes/{resume_id}",
        json={
            "name": "张三",
            "experience": [{"company": "甲", "point_ids": {"phone": [POINT_A1]}}],
        },
    )
    assert response.status_code == 422, response.text
    assert "未知要点字段" in response.text


def test_sanitize_drops_only_the_invalid_ids():
    """AI 路径不能 422，只能丢弃非法标识；其余内容一个字节都不动。"""
    payload = {
        "name": "张三",
        "experience": [
            {
                "company": "甲",
                "description": ["x"],
                "id": "bad id",
                "point_ids": {"description": ["x"]},
            },
            {"company": "乙", "description": ["y"], "id": ID_B},
        ],
    }
    cleaned = sanitize_document_ids(payload)
    assert cleaned["experience"][0]["company"] == "甲"
    assert "id" not in cleaned["experience"][0]
    assert "point_ids" not in cleaned["experience"][0]
    assert cleaned["experience"][1]["id"] == ID_B
    # 原对象不被就地改写（调用方可能还要用它做别的事）。
    assert payload["experience"][0]["id"] == "bad id"


def test_validate_rejects_a_non_object_content():
    from app.services.resume.document_identity import validate_document_ids

    try:
        validate_document_ids({"experience": "不是数组"})
    except DocumentIdentityError as exc:
        assert "数组" in str(exc)
    else:  # pragma: no cover - 明确失败比隐式通过好
        raise AssertionError("应当拒绝非数组的条目字段")
