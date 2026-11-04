# SPDX-License-Identifier: Apache-2.0
"""3-A 验收：资料条目「确定性补进简历」的接口、去重、覆盖度清单修剪与四类失败。

为什么单独一个文件：这条链路**完全不经过模型**（修订协议做不到"新增条目"），所以它的
行为必须由确定性断言钉住，而不是靠"模型没报错"来判断。

四类覆盖（对应问题清单 3-A「必带改动 / 测试」）：
- 成功：分区不存在时自动创建，内容与资料原文逐字一致；
- 重复：同一 entry 再补一次 → ``skipped``，正文不推进版本；
- 失败：entry 已删除 / 分区不在当前组 / 空 entry_ids 各自有业务码，正文一个字节不动；
- 兼容：``coverage_notes`` 是生成时的快照（可能没有 ``entry_ids``、资料可能已改），
  修剪只按名字、不依赖新字段。
"""

from __future__ import annotations

import pytest
from app.models.resume import ResumeRecord
from app.services.profile import definition_store, entry_store, workspace_bootstrap
from app.services.resume.resume_profile_append import prune_coverage_notes

APPEND_API = "/api/resumes/{resume_id}/append-profile-entries"

OPS_NAME = "运营数据分析师（中级）"
OPS_TEXT = "活动策划、用户研究、数据复盘、Excel"
BACKEND_NAME = "后端接口开发认证"
BACKEND_TEXT = "Python、FastAPI、MySQL、RESTful API"


# ===== 夹具：一份自建板块资料 + 一份空正文的 v2 简历记录 =====


def _seed_custom_section(db) -> tuple[str, list[str]]:
    """写一条自建板块（两个字段、两条条目），返回 (section_key, [entry_id, ...])。"""
    workspace_bootstrap.ensure_workspace(db)
    section = definition_store.create_custom_section(db, "证书与作品")
    name_field = definition_store.create_custom_field(db, section.key, "名称", "multi_line")
    desc_field = definition_store.create_custom_field(db, section.key, "说明", "multi_line")
    first = entry_store.upsert_entry(
        db, section.key, values={name_field.field_id: OPS_NAME, desc_field.field_id: OPS_TEXT}
    )
    second = entry_store.upsert_entry(
        db,
        section.key,
        values={name_field.field_id: BACKEND_NAME, desc_field.field_id: BACKEND_TEXT},
    )
    entry_ids = [str(first.entry_id), str(second.entry_id)]
    assert all(entry_ids)
    return section.key, entry_ids


def _make_record(db, *, section_key: str, entry_ids: list[str], names: list[str]) -> ResumeRecord:
    """一份**正文里没有该自建板块**的 v2 简历 + 一条指向它的覆盖度 note。"""
    record = ResumeRecord(
        title="补入测试",
        content={"version": 2, "language": "zh-CN", "sections": []},
        coverage_notes=[
            {
                "section": section_key,
                "section_label": "证书与作品",
                "names": list(names),
                "filtered": list(names),
                "model_omitted": [],
                "total": len(names),
                "entry_ids": list(entry_ids),
            }
        ],
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def _section_keys(record: ResumeRecord, section_key: str) -> dict:
    for section in (record.content or {}).get("sections") or []:
        if section.get("key") == section_key:
            return section
    raise AssertionError(f"正文里没有分区 {section_key}")


def _entry_names(section: dict) -> list[str]:
    """每个条目的**身份名**，口径与后端 ``_document_entry_name`` 一致。

    v2 自建条目并不总是"一个 text item + 若干「标签：值」行"：只有资料侧显式指定了主文本
    字段（``primary_field_id``）时投影才产出 text item；没指定时**每个字段都是 field
    item**（「名称：X」「说明：Y」），一条 text item 都没有。所以只读 ``kind == "text"``
    会把"条目已经写进去了"读成"空分区"——那是读法不对，不是条目没写。
    与后端同口径：先找 text item 的正文，找不到取首个有值的 item（text 取 ``text``，
    field 取 ``value``）。
    """
    names: list[str] = []
    for entry in section.get("entries") or []:
        items = [item for item in entry.get("items") or [] if isinstance(item, dict)]
        name = next(
            (item["text"] for item in items if item.get("kind") == "text" and item.get("text")),
            "",
        )
        if not name:
            name = next((item["value"] for item in items if item.get("value")), "")
        names.append(name)
    return names


def _entry_item_texts(section: dict) -> list[str]:
    """分区里**逐字**落库的文本（text item 取正文、field item 取值），按条目顺序展开。

    "内容与资料原文逐字一致"用它断言：既覆盖主文本，也覆盖「标签：值」行里的值。
    """
    texts: list[str] = []
    for entry in section.get("entries") or []:
        for item in entry.get("items") or []:
            if not isinstance(item, dict):
                continue
            value = item.get("text") if item.get("kind") == "text" else item.get("value")
            if value:
                texts.append(value)
    return texts


# ===== ① 成功：分区不存在时自动创建 =====


def test_append_creates_section_and_writes_verbatim_text(client, db_session):
    section_key, entry_ids = _seed_custom_section(db_session)
    record = _make_record(
        db_session, section_key=section_key, entry_ids=entry_ids, names=[OPS_NAME, BACKEND_NAME]
    )

    response = client.post(
        APPEND_API.format(resume_id=record.id),
        json={"section_key": section_key, "entry_ids": entry_ids},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["appended"] == [OPS_NAME, BACKEND_NAME]
    assert body["skipped"] == []
    # 响应里的 resume 就是最新正文：分区已建、条目内容与资料原文逐字一致。
    section = next(
        item for item in body["resume"]["content"]["sections"] if item["key"] == section_key
    )
    assert section["title"] == "证书与作品"
    assert _entry_names(section) == [OPS_NAME, BACKEND_NAME]
    # 逐字：两个字段的值都原样落库（名称 + 说明），一个字符都不改写。
    assert _entry_item_texts(section) == [OPS_NAME, OPS_TEXT, BACKEND_NAME, BACKEND_TEXT]
    # 覆盖度清单：整条 note 被摘掉（两条都补进去了，没有"没写进简历"可说了）。
    assert body["resume"]["coverage_notes"] == []
    # 正文真的落库了（不是只改了响应）。
    db_session.expire_all()
    stored = db_session.get(ResumeRecord, record.id)
    assert stored is not None
    assert _entry_names(_section_keys(stored, section_key)) == [OPS_NAME, BACKEND_NAME]
    assert _entry_item_texts(_section_keys(stored, section_key)) == [
        OPS_NAME,
        OPS_TEXT,
        BACKEND_NAME,
        BACKEND_TEXT,
    ]
    assert stored.coverage_notes == []


def test_append_keeps_other_sections_and_clears_warnings(client, db_session):
    """补入不是"重写正文"：原有分区原样保留，warnings 与 fact_annotations 的语义不变。"""
    section_key, entry_ids = _seed_custom_section(db_session)
    record = _seed_project_resume(db_session, section_key=section_key, entry_ids=entry_ids)

    response = client.post(
        APPEND_API.format(resume_id=record.id),
        json={"section_key": section_key, "entry_ids": entry_ids[:1]},
    )

    assert response.status_code == 200, response.text
    sections = {item["key"]: item for item in response.json()["resume"]["content"]["sections"]}
    assert "projects" in sections
    assert _entry_names(sections["projects"]) == ["会员增长系统"]
    assert _entry_names(sections[section_key]) == [OPS_NAME]
    # 只补了第一条：说明字段只出现一次，第二条资料一个字都没进来。
    assert _entry_item_texts(sections[section_key]) == [OPS_NAME, OPS_TEXT]


def _seed_project_resume(db, *, section_key: str, entry_ids: list[str]) -> ResumeRecord:
    """正文里已有一个系统分区的简历（验证"追加"不会动别的分区）。"""
    record = ResumeRecord(
        title="已有项目",
        content={
            "version": 2,
            "language": "zh-CN",
            "sections": [
                {
                    "key": "projects",
                    "title": "",
                    "kind": "entries",
                    "entries": [
                        {
                            "id": "ob_proj0000000001",
                            "items": [
                                {"kind": "text", "id": "pt_proj0000000001", "text": "会员增长系统"}
                            ],
                        }
                    ],
                }
            ],
        },
        coverage_notes=[
            {
                "section": section_key,
                "section_label": "证书与作品",
                "names": [OPS_NAME, BACKEND_NAME],
                "filtered": [OPS_NAME, BACKEND_NAME],
                "model_omitted": [],
                "total": 2,
                "entry_ids": list(entry_ids),
            }
        ],
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


# ===== ② 重复：按身份名去重，不产生第二条 =====


def test_append_twice_skips_and_does_not_bump_revision(client, db_session):
    section_key, entry_ids = _seed_custom_section(db_session)
    record = _make_record(
        db_session, section_key=section_key, entry_ids=entry_ids, names=[OPS_NAME, BACKEND_NAME]
    )

    first = client.post(
        APPEND_API.format(resume_id=record.id),
        json={"section_key": section_key, "entry_ids": entry_ids},
    )
    assert first.status_code == 200, first.text
    revision_after_first = first.json()["resume"]["revision"]

    second = client.post(
        APPEND_API.format(resume_id=record.id),
        json={"section_key": section_key, "entry_ids": entry_ids},
    )
    assert second.status_code == 200, second.text
    body = second.json()
    assert body["appended"] == []
    assert body["skipped"] == [OPS_NAME, BACKEND_NAME]
    # 正文没变 → 不推进版本（重复点不该把别的窗口打成 409）。
    assert body["resume"]["revision"] == revision_after_first
    section = next(
        item for item in body["resume"]["content"]["sections"] if item["key"] == section_key
    )
    assert len(section["entries"]) == 2
    assert _entry_names(section) == [OPS_NAME, BACKEND_NAME]


def test_append_skips_entry_already_written_by_generation(client, db_session):
    """生成时已经写进去的条目（名字相同）→ 跳过，不重复追加。"""
    section_key, entry_ids = _seed_custom_section(db_session)
    record = ResumeRecord(
        title="生成过的",
        content={
            "version": 2,
            "language": "zh-CN",
            "sections": [
                {
                    "key": section_key,
                    "title": "证书与作品",
                    "kind": "entries",
                    "entries": [
                        {
                            "id": "ob_certs000000001",
                            "items": [
                                {"kind": "text", "id": "pt_certs000000001", "text": OPS_NAME}
                            ],
                        }
                    ],
                }
            ],
        },
        coverage_notes=[
            {
                "section": section_key,
                "section_label": "证书与作品",
                "names": [OPS_NAME, BACKEND_NAME],
                "filtered": [OPS_NAME, BACKEND_NAME],
                "model_omitted": [],
                "total": 2,
            }
        ],
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)

    response = client.post(
        APPEND_API.format(resume_id=record.id),
        json={"section_key": section_key, "entry_ids": entry_ids},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["appended"] == [BACKEND_NAME]
    assert body["skipped"] == [OPS_NAME]
    section = next(
        item for item in body["resume"]["content"]["sections"] if item["key"] == section_key
    )
    assert _entry_names(section) == [OPS_NAME, BACKEND_NAME]
    # 生成时写进去的那条原样不动，只有后补的那条多出「说明」字段。
    assert _entry_item_texts(section) == [OPS_NAME, BACKEND_NAME, BACKEND_TEXT]
    # 这条 note 没有 entry_ids（旧记录），仍按名字被修剪干净。
    assert body["resume"]["coverage_notes"] == []


# ===== ③ 失败：资料已删除 / 分区不在当前组 / 空选择 =====


def test_deleted_entry_is_reported_not_silently_skipped(client, db_session):
    section_key, entry_ids = _seed_custom_section(db_session)
    record = _make_record(
        db_session, section_key=section_key, entry_ids=entry_ids, names=[OPS_NAME, BACKEND_NAME]
    )
    before = (db_session.get(ResumeRecord, record.id) or record).content

    response = client.post(
        APPEND_API.format(resume_id=record.id),
        json={"section_key": section_key, "entry_ids": [entry_ids[0], "entry-does-not-exist"]},
    )

    assert response.status_code == 409, response.text
    body = response.json()
    assert body["code"] == "profile_entry_missing"
    assert "已删除" in body["detail"]
    # 一条都不写（全无或全有）：正文与清单与调用前逐字一致。
    db_session.expire_all()
    stored = db_session.get(ResumeRecord, record.id)
    assert stored is not None
    assert stored.content == before
    assert stored.coverage_notes and stored.coverage_notes[0]["names"] == [OPS_NAME, BACKEND_NAME]


def test_unknown_section_is_reported(client, db_session):
    _seed_custom_section(db_session)
    record = _make_record(
        db_session, section_key="custom:not-in-group", entry_ids=["x"], names=["x"]
    )

    response = client.post(
        APPEND_API.format(resume_id=record.id),
        json={"section_key": "custom:not-in-group", "entry_ids": ["x"]},
    )

    assert response.status_code == 409, response.text
    assert response.json()["code"] == "profile_section_missing"


def test_empty_entry_ids_is_rejected(client, db_session):
    section_key, _entry_ids = _seed_custom_section(db_session)
    record = _make_record(db_session, section_key=section_key, entry_ids=[], names=[])

    response = client.post(
        APPEND_API.format(resume_id=record.id), json={"section_key": section_key, "entry_ids": []}
    )

    assert response.status_code == 400, response.text
    assert response.json()["code"] == "profile_entries_required"


def test_missing_resume_is_404(client, db_session):
    section_key, entry_ids = _seed_custom_section(db_session)

    response = client.post(
        APPEND_API.format(resume_id=999999),
        json={"section_key": section_key, "entry_ids": entry_ids},
    )

    assert response.status_code == 404, response.text


def test_stale_base_revision_is_a_conflict(client, db_session):
    section_key, entry_ids = _seed_custom_section(db_session)
    record = _make_record(
        db_session, section_key=section_key, entry_ids=entry_ids, names=[OPS_NAME, BACKEND_NAME]
    )

    response = client.post(
        APPEND_API.format(resume_id=record.id),
        json={"section_key": section_key, "entry_ids": entry_ids, "base_revision": 99},
    )

    assert response.status_code == 409, response.text
    assert response.json()["code"] == "resume_revision_conflict"


# ===== ④ 边界：清单修剪的纯函数（不依赖接口）=====


def test_prune_only_touches_the_target_section_and_keeps_reasons_in_sync():
    notes = [
        {
            "section": "custom:sec-a",
            "section_label": "证书与作品",
            "names": [OPS_NAME, BACKEND_NAME],
            "filtered": [OPS_NAME],
            "model_omitted": [BACKEND_NAME],
            "reasons": {OPS_NAME: "filtered", BACKEND_NAME: "model"},
            "total": 2,
        },
        {
            "section": "projects",
            "section_label": "项目经历",
            "names": ["会员增长系统"],
            "filtered": [],
            "model_omitted": ["会员增长系统"],
            "total": 1,
        },
    ]

    pruned = prune_coverage_notes(notes, "custom:sec-a", [OPS_NAME])

    assert [note["section"] for note in pruned] == ["custom:sec-a", "projects"]
    kept = pruned[0]
    assert kept["names"] == [BACKEND_NAME]
    assert kept["filtered"] == []
    assert kept["model_omitted"] == [BACKEND_NAME]
    assert kept["reasons"] == {BACKEND_NAME: "model"}
    # total 递减而不是"等于剩下的条数"（清单可能被截断过，两者本来就不等）。
    assert kept["total"] == 1
    # 别的分区原样不动。
    assert pruned[1] == notes[1]


def test_prune_deletes_the_note_when_every_name_is_gone():
    notes = [
        {
            "section": "custom:sec-a",
            "section_label": "证书与作品",
            "names": [OPS_NAME],
            "filtered": [OPS_NAME],
            "model_omitted": [],
            "total": 1,
        }
    ]

    assert prune_coverage_notes(notes, "custom:sec-a", [OPS_NAME]) == []


def test_prune_keeps_total_monotonic_when_names_were_truncated():
    """names 被截断（total=9，只列 2 条）时，摘掉 1 条：total 9→8，不会掉到 1。"""
    notes = [
        {
            "section": "projects",
            "section_label": "项目经历",
            "names": ["A", "B"],
            "filtered": ["A", "B"],
            "model_omitted": [],
            "total": 9,
        }
    ]

    pruned = prune_coverage_notes(notes, "projects", ["A"])

    assert pruned[0]["names"] == ["B"]
    assert pruned[0]["total"] == 8


@pytest.mark.parametrize("names", [[], [""]])
def test_prune_ignores_empty_names(names):
    """空 names 的 note 不因为 drop 集合为空就被误删（边界：全隐藏 / 空清单）。"""
    notes = [
        {
            "section": "projects",
            "section_label": "项目经历",
            "names": ["A"],
            "filtered": [],
            "model_omitted": ["A"],
            "total": 1,
        }
    ]

    assert prune_coverage_notes(notes, "projects", names) == notes
