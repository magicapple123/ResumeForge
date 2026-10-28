# SPDX-License-Identifier: Apache-2.0
"""旧 /api/profile 协议适配（F2-D）：读投影、写新条目、三链外全量读取。

钉住四件事（F2 契约 §5.1/§5.2）：
1. GET 从新模型全量投影出旧 ProfileOut（形状等价），**不读旧六表**；
2. PUT/PATCH 映射到新条目（软删多余、保留新模型独有字段），不再重建旧子表；
3. 新模型没有位置的旧字段写日志告警而不是静默丢；
4. 助手/岗位匹配/AI 建议统一读 `load_ai_profile`（当前组 + hidden 不进 AI，2026-10-28）。
"""

from __future__ import annotations

import contextlib
import json
import logging
import re

from app import database
from app.models.job import Job
from app.models.profile import Education, Project, UserProfile
from app.models.profile_entry import ProfileEntry
from app.schemas.profile import ProfileOut
from app.services.assistant_tools import execute_tool
from app.services.job.job_match_context import match_source_texts, profile_is_empty
from app.services.profile import entry_store, field_preferences, group_store
from app.services.profile.profile_service import project_legacy_profile
from sqlalchemy import event

PHOTO = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
_LEGACY_TABLES_RE = re.compile(
    r"\b(user_profile|education|experience|campus_experience|project|skill|award)\b",
    re.IGNORECASE,
)
_FULL_PAYLOAD = {
    "name": "张三",
    "gender": "男",
    "birth_date": "1995-06-01",
    "phone": "13800000000",
    "email": "zhangsan@example.com",
    "city": "天津",
    "target_city": "北京",
    "job_intent": "后端开发",
    "personal_website": "https://example.com",
    "github": "https://github.com/example",
    "political_status": "共青团员",
    "summary": "三年后端经验",
    "educations": [
        {"school": "天津工业大学", "major": "软件工程", "degree": "学士", "start_date": "2018-09"}
    ],
    "experiences": [{"company": "A公司", "role": "后端开发", "start_date": "2022-07"}],
    "projects": [{"name": "简历工具", "role": "独立开发", "description": "FastAPI"}],
    "skills": [{"name": "Python", "level": "熟练"}],
    "awards": [{"name": "一等奖学金", "date": "2021-06"}],
}


def _seed_new_model(db) -> None:
    entry_store.upsert_entry(
        db,
        "basic_info",
        values={
            "basic_info.name": "新姓名",
            "basic_info.phone": "13900000000",
            "basic_info.birth_month": "1995-06",
            "basic_info.job_intention": "后端开发",
            "basic_info.portfolio_url": "https://portfolio.example",
        },
    )
    entry_store.upsert_entry(
        db, "educations", values={"educations.school": "新大学", "educations.rank": "第 1 名"}
    )
    entry_store.upsert_entry(db, "projects", values={"projects.name": "新项目"})
    entry_store.upsert_entry(db, "summary", values={"summary.content": "新总结"})


def _seed_old_tables(db) -> None:
    profile = UserProfile(name="旧姓名", phone="111", summary="旧总结")
    db.add(profile)
    db.flush()
    db.add(Education(profile_id=profile.id, school="旧学校"))
    db.add(Project(profile_id=profile.id, name="旧项目"))
    db.commit()


@contextlib.contextmanager
def _captured_sql():
    statements: list[str] = []

    def capture(_conn, _cursor, statement, _params, _context, _executemany):
        statements.append(statement)

    event.listen(database.engine, "before_cursor_execute", capture)
    try:
        yield statements
    finally:
        event.remove(database.engine, "before_cursor_execute", capture)


def _refresh(db) -> None:
    db.rollback()  # 结束只读事务，看到 client 刚提交的写入（SQLite 快照隔离）


def _entries(db, section_key: str) -> list[ProfileEntry]:
    return (
        db.query(ProfileEntry)
        .filter(ProfileEntry.section_key == section_key, ProfileEntry.deleted_at.is_(None))
        .order_by(ProfileEntry.sort_order)
        .all()
    )


def test_legacy_get_projects_new_model_without_reading_old_tables(client, db_session):
    """GET 必须来自新模型；旧六表一行都不查（数据是旧的就暴露成旧值）。"""
    _seed_old_tables(db_session)
    _seed_new_model(db_session)

    with _captured_sql() as statements:
        response = client.get("/api/profile")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name"] == "新姓名"
    assert body["phone"] == "13900000000"
    assert body["job_intent"] == "后端开发"
    assert body["birth_date"] == "1995-06" and body["birth_year"] == "1995"
    assert [item["school"] for item in body["educations"]] == ["新大学"]
    assert [item["name"] for item in body["projects"]] == ["新项目"]
    assert body["summary"] == "新总结"
    assert not [sql for sql in statements if _LEGACY_TABLES_RE.search(sql)], (
        "GET /api/profile 读了旧资料表"
    )


def test_legacy_get_shape_matches_old_profile_out(client, db_session):
    _seed_new_model(db_session)
    body = client.get("/api/profile").json()

    assert set(body) == set(ProfileOut.model_fields)
    assert isinstance(body["id"], int)
    assert [item["id"] for item in body["educations"]] == [1]
    # 旧界面依赖的 section_order 是 8 个旧 key，保持旧协议形状。
    assert body["section_order"][0] == "basic_info"
    assert set(body["section_order"]) == {
        "basic_info",
        "educations",
        "experiences",
        "projects",
        "skills",
        "campus_experiences",
        "awards",
        "summary",
    }


def test_legacy_put_patch_write_new_entries_and_soft_delete(client, db_session):
    saved = client.put("/api/profile", json=_FULL_PAYLOAD)
    assert saved.status_code == 200, saved.text
    assert saved.json()["name"] == "张三"

    _refresh(db_session)
    # 旧六表一行都没写；新模型里出现了映射后的稳定 field_id。
    assert db_session.query(UserProfile).count() == 0
    assert db_session.query(Education).count() == 0
    basic = _entries(db_session, "basic_info")[0].values
    assert basic["basic_info.name"] == "张三"
    assert basic["basic_info.birth_month"] == "1995-06-01"
    assert basic["basic_info.job_intention"] == "后端开发"
    education = _entries(db_session, "educations")[0].values
    assert education["educations.school"] == "天津工业大学"
    assert education["educations.major"] == "软件工程"
    assert education["educations.degree"] == "学士"
    assert education["educations.start_date"] == "2018-09"
    assert not [key for key in education if key.endswith(("cet4_score", "reference_content"))]
    assert _entries(db_session, "summary")[0].values == {"summary.content": "三年后端经验"}

    # PATCH 只动出现的键；未出现的数组原样保留。
    patched = client.patch("/api/profile", json={"phone": "13700000000"})
    assert patched.status_code == 200, patched.text
    assert patched.json()["phone"] == "13700000000"
    assert [item["school"] for item in patched.json()["educations"]] == ["天津工业大学"]
    assert [item["company"] for item in patched.json()["experiences"]] == ["A公司"]

    # 显式 [] = 清空（软删而非物理删除，可在回收站恢复）。
    cleared = client.patch("/api/profile", json={"educations": []})
    assert cleared.json()["educations"] == []
    _refresh(db_session)
    assert [row for row in _entries(db_session, "educations")] == []
    assert (
        db_session.query(ProfileEntry)
        .filter(ProfileEntry.section_key == "educations", ProfileEntry.deleted_at.isnot(None))
        .count()
        == 1
    )

    # PUT 仍是整体替换：没传的数组清空、传了的写回。
    replaced = client.put("/api/profile", json={"name": "李四"})
    body = replaced.json()
    assert body["name"] == "李四" and body["phone"] == "" and body["educations"] == []
    assert body["summary"] == "" and body["experiences"] == []


def test_legacy_write_preserves_new_only_and_hidden_values(client, db_session):
    assert client.put("/api/profile", json=_FULL_PAYLOAD).status_code == 200
    _refresh(db_session)
    education = _entries(db_session, "educations")[0]
    # 新模型独有的字段由新界面写入；旧协议整体替换不能把它们清掉。
    entry_store.upsert_entry(
        db_session,
        "educations",
        entry_id=education.entry_id,
        values={"educations.rank": "第 1 名", "educations.advisor": "张伟"},
    )
    field_preferences.patch_preference(
        db_session, "basic_info.phone", section_key="basic_info", hidden=True
    )

    # 旧协议是编辑视图：hidden 值仍要回显，否则旧界面保存一次就清空了它。
    current = client.get("/api/profile").json()
    assert current["phone"] == "13800000000"
    payload = {key: current[key] for key in ("name", "phone", "educations")}
    payload["name"] = "王五"
    assert client.put("/api/profile", json=payload).status_code == 200

    _refresh(db_session)
    saved = _entries(db_session, "educations")[0].values
    assert saved["educations.school"] == "天津工业大学"
    assert saved["educations.rank"] == "第 1 名"
    assert saved["educations.advisor"] == "张伟"
    assert _entries(db_session, "basic_info")[0].values["basic_info.phone"] == "13800000000"


def test_legacy_write_warns_when_new_model_has_no_place(client, db_session, caplog):
    payload = dict(_FULL_PAYLOAD)
    payload.update({"wechat": "wx-123", "id_number": "110101199501010000", "qq": "12345"})
    payload["educations"] = [
        {"school": "天津工业大学", "cet4_score": "550", "reference_content": "旧参考全文"}
    ]
    payload["projects"] = [{"name": "简历工具", "reference_content": "旧项目参考"}]

    with caplog.at_level(logging.WARNING, logger="app.services.profile.profile_service"):
        response = client.put("/api/profile", json=payload)

    assert response.status_code == 200, response.text
    warnings = "\n".join(record.getMessage() for record in caplog.records)
    assert "旧协议写入丢弃了新模型不支持的内容字段" in warnings
    for field in (
        "wechat",
        "id_number",
        "qq",
        "educations.cet4_score",
        "projects.reference_content",
    ):
        assert field in warnings

    _refresh(db_session)
    dumped = json.dumps(
        [row.values for row in db_session.query(ProfileEntry).all()], ensure_ascii=False
    )
    for value in ("wx-123", "110101199501010000", "旧参考全文", "旧项目参考", "550"):
        assert value not in dumped, f"新模型不支持的内容被静默写入了：{value}"


def test_legacy_photo_roundtrip_is_stored_in_new_model(client, db_session):
    response = client.put("/api/profile", json={"name": "张三", "photo": PHOTO})
    assert response.json()["photo"] == PHOTO
    assert client.get("/api/profile").json()["photo"] == PHOTO

    _refresh(db_session)
    assert db_session.query(UserProfile).count() == 0
    assert _entries(db_session, "basic_info")[0].values["basic_info.photo"] == PHOTO


def test_legacy_section_order_roundtrip_keeps_new_keys_in_place(client, db_session):
    assert client.put("/api/profile", json=_FULL_PAYLOAD).status_code == 200
    order = [
        "basic_info",
        "skills",
        "projects",
        "educations",
        "experiences",
        "summary",
        "campus_experiences",
        "awards",
    ]
    response = client.patch("/api/profile", json={"section_order": order})
    assert response.status_code == 200, response.text
    assert response.json()["section_order"] == order

    _refresh(db_session)
    from app.services.profile.workspace_bootstrap import section_order

    stored = section_order(db_session)
    positions = [stored.index(key) for key in order]
    assert positions == sorted(positions), "旧协议写入的 8 个 key 顺序没有落到全局顺序"


def test_ai_consumers_follow_current_group_and_hidden(db_session):
    """AI 取数唯一口径：当前组 + 去隐藏（2026-10-28 用户要求统一）。

    助手上下文与岗位匹配都必须只看到「我的资料」当前选中组里未隐藏的内容；把当前组
    切回去之后，同一批消费者要立刻看到组外分区——这是"后续任务跟着组走"的判据。
    """
    entry_store.upsert_entry(
        db_session,
        "basic_info",
        values={"basic_info.name": "张三", "basic_info.phone": "13800000000"},
    )
    entry_store.upsert_entry(db_session, "projects", values={"projects.name": "简历工具"})
    group = group_store.create_group(db_session, "只有基本信息")
    current = group_store.get_group(db_session, group.group_id)
    group_store.set_group_members(
        db_session, group.group_id, ["basic_info"], expected_revision=int(current.revision or 1)
    )
    group_store.switch_current_group(
        db_session,
        group.group_id,
        expected_revision=int(group_store.read_state(db_session).revision or 1),
    )
    field_preferences.patch_preference(
        db_session, "basic_info.phone", section_key="basic_info", hidden=True
    )

    from app.api.assistant_context import profile_context
    from app.services.profile.ai_profile import load_ai_profile

    context = profile_context(db_session, relaxed=True)
    assert "张三" in context
    assert "简历工具" not in context, "助手读取了当前组之外的分区"
    assert "13800000000" not in context, "hidden 字段仍然进了助手上下文"

    job = Job(title="后端开发工程师", company="示例公司")
    db_session.add(job)
    db_session.commit()
    profile = load_ai_profile(db_session)
    assert profile.projects == [], "AI 资料快照包含了组外项目"
    assert profile_is_empty(profile) is False
    _profile, personal_text, _resume_text = match_source_texts(db_session, job)
    assert "简历工具" not in personal_text
    assert "13800000000" not in personal_text

    # 切回默认组：同一个消费者不需要任何缓存失效，下一次读取就应看到 projects。
    default_group = next(group for group in group_store.list_groups(db_session) if group.is_default)
    group_store.switch_current_group(
        db_session,
        default_group.group_id,
        expected_revision=int(group_store.read_state(db_session).revision or 1),
    )
    _profile, personal_text, _resume_text = match_source_texts(db_session, job)
    assert "简历工具" in personal_text, "切换当前组后，后续任务没有跟随"


def test_assistant_tools_read_and_write_the_new_model(db_session):
    entry_store.upsert_entry(
        db_session,
        "basic_info",
        values={
            "basic_info.name": "不应被清空的姓名",
            "basic_info.phone": "13800000000",
            "basic_info.city": "北京",
            "basic_info.photo": PHOTO,
        },
    )
    entry_store.upsert_entry(db_session, "summary", values={"summary.content": "原有总结"})
    entry_store.upsert_entry(db_session, "educations", values={"educations.school": "天津工业大学"})

    result = execute_tool(db_session, "update_profile", {"city": "天津"})
    assert result.changed is True
    snapshot = project_legacy_profile(db_session)
    assert snapshot.city == "天津"
    assert snapshot.name == "不应被清空的姓名"
    assert snapshot.summary == "原有总结"
    assert snapshot.photo == PHOTO
    assert [item.school for item in snapshot.educations] == ["天津工业大学"]

    overview = json.loads(execute_tool(db_session, "get_overview", {}).text)
    assert "city" in overview["个人资料已填写"]
    assert "educations(1)" in overview["个人资料已填写"]
    text = execute_tool(db_session, "get_profile", {}).text
    assert "不应被清空的姓名" not in text and "13800000000" not in text
