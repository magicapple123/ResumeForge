# SPDX-License-Identifier: Apache-2.0
"""5.3：照片的「位置」恒为 ``"photo"``——读侧归一、幂等、下一次保存自然落库。

背景：前端的照片「位置」下拉已删掉，但存量文档里还留着 ``hidden`` / ``name_meta`` 这些
值。后端有二十多处 ``placement == "hidden"`` 的消费方（document_html / document_plan_rows /
document_analysis / document_view / bilingual_variants …），导出又是服务端从库里的文档
重渲——前端"假装它是 photo"只会得到"预览有照片、导出没有"。

归一的落点是 ``document_converter.ensure_document_version_with_report``：读侧
``document_io.document_for_record`` / ``document_or_422`` 与写侧
``prepare_document_for_save*`` 都经过它，是上下游唯一共同的入口。
"""

from __future__ import annotations

import pytest
from app.models.resume import ResumeRecord
from app.services.resume.document_io import document_or_422

#: 判据只看前缀，够短即可（与 test_header_photo_placement.py 同一口径）。
PHOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


def _document(placement: str) -> dict:
    """一份最小 v2 文档：姓名 + 一张照片，照片的位置由参数决定。"""
    return {
        "version": 2,
        "language": "zh-CN",
        "header": {
            "items": [
                {
                    "kind": "field",
                    "id": "hd_00000001",
                    "key": "name",
                    "value": "陈可",
                    "placement": "name",
                },
                {
                    "kind": "field",
                    "id": "hd_0000photo",
                    "key": "photo",
                    "value": PHOTO,
                    "placement": placement,
                },
            ],
            "contact_breaks": [],
        },
        "sections": [],
    }


def _photo_item(document: dict) -> dict:
    return next(item for item in document["header"]["items"] if item["key"] == "photo")


def _stored_record(db_session, content: dict) -> ResumeRecord:
    """直接写一条库内 v2 记录——绕开保存侧，模拟"本批之前存进去的旧简历"。"""
    record = ResumeRecord(
        title="存量隐藏照片",
        job_title="",
        company="",
        content=content,
        warnings=[],
        source="manual",
        model="",
        enhancement_enabled=False,
        enhancement_level="balanced",
        parse_error="",
        template="classic",
        format_config={},
        page_limit=1,
        font_scale="standard",
        language="zh-CN",
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record


@pytest.mark.parametrize("stale", ["hidden", "name_meta", "subtitle", "name"])
def test_read_entry_normalizes_a_stale_photo_placement(stale):
    """四种"位置下拉"留下的死值都收敛成 ``photo``（幂等：跑两次结果一样）。"""
    first = document_or_422(_document(stale))
    assert _photo_item(first)["placement"] == "photo"

    second = document_or_422(first)
    assert _photo_item(second)["placement"] == "photo"
    assert second == first


def test_read_entry_keeps_the_other_header_placements():
    """只动照片：姓名行 / 姓名旁小字 / 意向 / 联系方式各有语义，不能一起扫平。"""
    document = _document("hidden")
    document["header"]["items"].append(
        {
            "kind": "field",
            "id": "hd_00000002",
            "key": "phone",
            "value": "13800000000",
            "placement": "contact",
        }
    )
    normalized = document_or_422(document)

    placements = {item["key"]: item["placement"] for item in normalized["header"]["items"]}
    assert placements == {"name": "name", "photo": "photo", "phone": "contact"}


def test_read_entry_leaves_a_contact_photo_alone():
    """回归守卫（I-02）：`contact` 不在归一范围内。

    I-02 那条缺陷（hide→show 把照片位置写死成 contact）靠"已有照片时不抢占"的
    状态机处理，判据正是这个 contact 值；一起扫成 photo 会让两张照片同时
    placement=photo，planner 的"最后一个赢"就顶掉了用户真正那张。
    """
    normalized = document_or_422(_document("contact"))

    assert _photo_item(normalized)["placement"] == "contact"


def test_stored_hidden_photo_reads_back_as_photo_without_touching_the_row(client, db_session):
    """存量记录：详情读出是 ``photo``，但读路径**不写库**（库里仍是 hidden）。"""
    record = _stored_record(db_session, _document("hidden"))

    detail = client.get(f"/api/resumes/{record.id}").json()
    assert _photo_item(detail["content"])["placement"] == "photo"

    db_session.refresh(record)
    assert _photo_item(record.content)["placement"] == "hidden"

    # 幂等：再读一次还是 photo。
    again = client.get(f"/api/resumes/{record.id}").json()
    assert _photo_item(again["content"])["placement"] == "photo"


def test_one_save_persists_the_normalized_placement(client, db_session):
    """归一后的形状随下一次保存落库（保存是整份覆盖），之后再读不再变化。"""
    record = _stored_record(db_session, _document("hidden"))
    detail = client.get(f"/api/resumes/{record.id}").json()

    saved = client.put(
        f"/api/resumes/{record.id}/content",
        json={"content": detail["content"], "expected_revision": detail["revision"]},
    )
    assert saved.status_code == 200, saved.text
    assert _photo_item(saved.json()["content"])["placement"] == "photo"

    db_session.refresh(record)
    assert _photo_item(record.content)["placement"] == "photo"

    # 落库之后再读、再存，都是同一个形状（幂等）。
    reread = client.get(f"/api/resumes/{record.id}").json()
    assert _photo_item(reread["content"])["placement"] == "photo"
