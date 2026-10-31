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
from app.schemas.resume_document import OBJECT_ID_PATTERN
from app.services.resume.document_identity import (
    DocumentIdentityError,
    sanitize_document_ids,
)
from tests.document_test_support import entries_of, make_document, stored_document

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
    """读旧记录只是看：响应是 v2（id 在响应里现补），但库里的 content / updated_at 不动。"""
    resume_id = _create(client, {"name": "张三", "experience": [{"company": "甲公司"}]})
    record = db_session.get(ResumeRecord, resume_id)
    before_updated_at = record.updated_at
    before_content = dict(record.content)
    db_session.expire_all()

    detail = client.get(f"/api/resumes/{resume_id}")
    assert detail.status_code == 200
    content = detail.json()["content"]
    assert content["version"] == 2
    # 旧记录没有身份：读路径补出的 id 必须符合 W01 口径（8-32 位字母/数字/_/-）。
    assert OBJECT_ID_PATTERN.fullmatch(entries_of(content, "experience")[0]["id"])

    db_session.expire_all()
    after = db_session.get(ResumeRecord, resume_id)
    assert after.content == before_content  # 读不写库：库里仍是旧 v1 内容
    assert after.updated_at == before_updated_at


def test_save_persists_the_ids_sent_by_the_client(client, db_session):
    """客户端带的 id 完整往返：条目 id 落在 entry 上，v1 要点 id 沿用到 TextItem.id。"""
    resume_id = _create(client, {"name": "张三"})

    response = client.put(
        f"/api/resumes/{resume_id}/content",
        json={"content": {"name": "张三", "experience": _two_experiences()}},
    )
    assert response.status_code == 200, response.text
    content = stored_document(client, resume_id)
    entries = entries_of(content, "experience")
    assert [entry["id"] for entry in entries] == [ID_A, ID_B]
    # v2 没有 point_ids 伴随映射：要点 id 就是 TextItem.id（模板沿用原 point id）。
    assert [item["id"] for item in entries[0]["items"] if item["kind"] == "text"] == [
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
    content = stored_document(client, resume_id)
    entries = entries_of(content, "experience")
    assert [entry["id"] for entry in entries] == [ID_B, ID_A]
    # 顺序变了，甲条目与它的要点 id 仍绑定在一起；v2 不保存绝对路径，路径按当前文档现算。
    assert [item["id"] for item in entries[1]["items"] if item["kind"] == "text"] == [
        POINT_A1,
        "pt_00000002",
    ]


def test_invalid_id_characters_are_rejected(client, db_session):
    resume_id = _create(client, {"name": "张三"})
    content = make_document(
        sections=[
            {
                "key": "experience",
                "kind": "entries",
                "entries": [
                    {
                        "items": [
                            {
                                "kind": "field",
                                "key": "company",
                                "value": "甲",
                                "placement": "title",
                            }
                        ]
                    }
                ],
            }
        ]
    )
    content["sections"][0]["entries"][0]["id"] = "has space"
    response = client.put(f"/api/resumes/{resume_id}/content", json={"content": content})
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
    """v2 写侧严格：同一份文档里对象 id 重复 → 422（不静默重生成）。"""
    resume_id = _create(client, {"name": "张三"})
    content = {
        "version": 2,
        "language": "zh-CN",
        "header": {"items": []},
        "sections": [
            {
                "key": "experience",
                "kind": "entries",
                "entries": [
                    {
                        "id": ID_A,
                        "items": [
                            {"kind": "field", "key": "company", "value": "甲", "placement": "title"}
                        ],
                    },
                    {
                        "id": ID_A,
                        "items": [
                            {"kind": "field", "key": "company", "value": "乙", "placement": "title"}
                        ],
                    },
                ],
            }
        ],
    }
    response = client.put(f"/api/resumes/{resume_id}/content", json={"content": content})
    assert response.status_code == 422, response.text
    assert "重复" in response.text


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
