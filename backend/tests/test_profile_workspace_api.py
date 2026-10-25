# SPDX-License-Identifier: Apache-2.0
"""资料工作区与条目的 HTTP 级验收测试（F1-D1；验收 A / R-01～R-03 / R-08 / R-15 / R-46）。

覆盖四组性质：
1. GET /api/profile/workspace 一次返回 13 个大字段定义（顺序见需求 §3）、全局唯一顺序、
   当前组参与清单（基本信息恒首位）、服务端上限与 workspace_revision（R-01/R-02/R-08/R-20/R-21）；
2. bootstrap 幂等：连续两次读取的 workspace_revision 不变，且读取不创建旧 user_profile 行、
   不改旧资料子表行数（R-46：旧数据不迁移、新界面不读旧表）；
3. 条目：新增、局部 PATCH（未提交键保留、显式空串清空）、软删后 workspace 不再返回、
   显式序号重排、200 条上限（R-02/R-03/R-06、§6 铁律 10）；
4. 批量保存：单事务原子性（一项非法则整体不写）与 workspace revision 过期 409（R-15）。

断言全部走 HTTP；错误契约固定 {detail, code}，revision 冲突额外带 revision（契约 §5）。
每个用例只通过 conftest 的临时测试库夹具隔离，不写固定路径、不读真实库。
"""

from __future__ import annotations

from app.models.profile import Education, UserProfile
from app.models.profile_entry import ProfileEntry

WORKSPACE_API = "/api/profile/workspace"
BULK_ENTRIES_API = "/api/profile/workspace/entries"
SECTION_ORDER_API = "/api/profile/section-order"
ENTRIES_API = "/api/profile/sections/{section_key}/entries"
ENTRY_API = "/api/profile/sections/{section_key}/entries/{entry_id}"
REORDER_API = "/api/profile/sections/{section_key}/entries/reorder"

# 需求 §3 / R-65 的 13 个大字段（顺序即全局顺序）。这里写死期望值而不是 import 被测目录：
# 目录被改错时本文件要跟着变红，而不是跟着目录一起"正确地"错。
BUILTIN_ORDER = (
    "basic_info",
    "educations",
    "experiences",
    "projects",
    "skills",
    "campus_experiences",
    "awards",
    "summary",
    "publications",
    "research_projects",
    "patents",
    "credentials",
    "languages",
)
BUILTIN_NAMES = (
    "基本信息",
    "教育经历",
    "实习/工作经历",
    "项目经历",
    "专业技能",
    "校园经历",
    "荣誉奖项",
    "个人总结/自我评价",
    "学术成果",
    "科研项目",
    "知识产权",
    "证书资质",
    "语言能力",
)
# 服务端真实上限（R-03/R-11/R-18）：由 workspace.limits 下发，前端只做提示、不自行裁断。
LIMITS = {
    "max_entries_per_section": 200,
    "max_custom_fields_per_section": 20,
    "max_groups": 20,
    "single_line_chars": 200,
    "multi_line_chars": 2000,
}


def _workspace(client) -> dict:
    response = client.get(WORKSPACE_API)
    assert response.status_code == 200, response.text
    return response.json()


def _entries_of(workspace: dict, section_key: str) -> list[dict]:
    return [item for item in workspace["entries"] if item["section_key"] == section_key]


def _create_entry(client, section_key: str, values: dict, sort_order: int | None = None) -> dict:
    body: dict = {"values": values}
    if sort_order is not None:
        body["sort_order"] = sort_order
    response = client.post(ENTRIES_API.format(section_key=section_key), json=body)
    assert response.status_code == 201, response.text
    return response.json()


def _assert_error(response, status_code: int, *, code: str | None = None) -> dict:
    """错误契约（契约 §5）：400/404/409 固定带 detail 与 code，且不得出现堆栈。"""
    assert response.status_code == status_code, response.text
    body = response.json()
    assert isinstance(body.get("detail"), str) and body["detail"].strip()
    assert isinstance(body.get("code"), str) and body["code"]
    if code is not None:
        assert body["code"] == code
    assert "Traceback" not in response.text
    return body


def _count(db_session, model) -> int:
    """先结束本地事务再数：HTTP 写入发生在另一个 session，避免读到旧快照。"""
    db_session.rollback()
    return db_session.query(model).count()


def test_workspace_returns_13_definitions_in_global_order(client):
    """A / R-01/R-02/R-08/R-20/R-21：编辑视图一次给齐定义、顺序、当前组与上限。"""
    data = _workspace(client)

    assert [section["key"] for section in data["sections"]] == list(BUILTIN_ORDER)  # R-01/R-65
    assert [section["name"] for section in data["sections"]] == list(BUILTIN_NAMES)  # R-65
    assert data["section_order"] == list(BUILTIN_ORDER)  # R-08：全局只有一套顺序
    assert data["sections"][0]["key"] == "basic_info"  # R-08：基本信息恒首位
    assert all(section["fields"] for section in data["sections"])  # R-09：每个分区都有默认小字段
    # R-02：形态只有单例/多条，单例恰为基本信息与个人总结/自我评价。
    singleton_keys = {s["key"] for s in data["sections"] if s["form"] == "singleton"}
    assert singleton_keys == {"basic_info", "summary"}

    current = data["current_group"]  # R-20/R-21：默认组参与全部 13 项且基本信息首位
    assert current is not None
    assert current["participating_keys"] == list(BUILTIN_ORDER)
    assert current["member_count"] == 13
    assert [group["group_id"] for group in data["groups"]] == [current["group_id"]]
    assert data["groups"][0]["is_default"] is True

    assert data["limits"] == LIMITS  # R-03/R-11/R-18
    assert isinstance(data["workspace_revision"], int) and data["workspace_revision"] >= 1
    assert data["pending_notice"] is None  # 干净数据集没有降级告知（R-25）
    assert data["entries"] == []


def test_workspace_read_is_idempotent_and_never_touches_legacy_tables(client, db_session):
    """R-24/R-46：读取幂等，不创建旧资料行、不迁移也不改写旧表数据。"""
    profile = UserProfile(name="旧资料张三", phone="13800000000")
    db_session.add(profile)
    db_session.commit()
    db_session.add(Education(profile_id=profile.id, school="旧资料大学"))
    db_session.commit()
    before = {
        "user_profile": _count(db_session, UserProfile),
        "education": _count(db_session, Education),
    }

    first = _workspace(client)
    second = _workspace(client)

    # bootstrap 幂等：连续读取不推进 workspace_revision、不重建当前组。
    assert second["workspace_revision"] == first["workspace_revision"]
    assert second["current_group"]["group_id"] == first["current_group"]["group_id"]
    assert second["section_order"] == first["section_order"]
    # R-46 旁证：旧表行数不变，且新模型没有从旧表复制任何条目。
    after = {
        "user_profile": _count(db_session, UserProfile),
        "education": _count(db_session, Education),
    }
    assert after == before == {"user_profile": 1, "education": 1}
    assert first["entries"] == [] and second["entries"] == []


def test_section_order_write_is_persisted_and_requires_basic_info_first(client):
    """R-08/§5.1：合法调整（2/3 位交换）持久化；基本信息移出首位 → 400 basic_info_first。"""
    data = _workspace(client)
    # 基本信息保持首位，交换第 2/3 位（教育经历 ↔ 实习/工作经历）是合法调整。
    swapped = [BUILTIN_ORDER[0], BUILTIN_ORDER[2], BUILTIN_ORDER[1], *BUILTIN_ORDER[3:]]
    response = client.put(
        SECTION_ORDER_API,
        json={"order": swapped, "expected_revision": data["workspace_revision"]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["section_order"] == swapped  # R-08：唯一的全局顺序
    assert _workspace(client)["section_order"] == swapped

    # 把基本信息移出首位 → 400 basic_info_first；非法请求不落库（R-08/§5.1）。
    invalid = [BUILTIN_ORDER[1], BUILTIN_ORDER[0], *BUILTIN_ORDER[2:]]
    rejected = client.put(
        SECTION_ORDER_API,
        json={
            "order": invalid,
            "expected_revision": response.json()["workspace_revision"],
        },
    )
    _assert_error(rejected, 400, code="basic_info_first")
    assert _workspace(client)["section_order"] == swapped


def test_entry_patch_merges_submitted_values_and_clears_with_empty_string(client):
    """R-15 / §6 铁律 10：局部提交只改提交的键，显式空串才是清空。"""
    created = _create_entry(
        client,
        "projects",
        {
            "projects.name": "项目A",
            "projects.description": "原描述",
            "projects.tech_stack": "Python",
        },
    )
    assert created["sort_order"] == 0 and created["revision"] == 1  # R-03：显式序号从 0 开始

    response = client.patch(
        ENTRY_API.format(section_key="projects", entry_id=created["entry_id"]),
        json={
            "values": {"projects.description": "新描述"},
            "expected_revision": created["revision"],
        },
    )
    assert response.status_code == 200, response.text
    merged = response.json()
    assert merged["revision"] == 2
    # 未提交的键（含隐藏/默认收起字段）一律保留旧值，不能被"未提交"当成删除。
    assert merged["values"] == {
        "projects.name": "项目A",
        "projects.description": "新描述",
        "projects.tech_stack": "Python",
    }

    cleared = client.patch(
        ENTRY_API.format(section_key="projects", entry_id=created["entry_id"]),
        json={"values": {"projects.description": ""}, "expected_revision": merged["revision"]},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["values"]["projects.description"] == ""  # 显式空串=清空，不复活旧值
    stored = _entries_of(_workspace(client), "projects")
    assert [item["entry_id"] for item in stored] == [created["entry_id"]]
    assert stored[0]["values"]["projects.description"] == ""
    assert stored[0]["values"]["projects.name"] == "项目A"


def test_singleton_section_never_gets_a_second_entry(client):
    """R-02 / §6 铁律 10：单例分区第二次写入必须更新同一条，绝不建第二条。"""
    first = _create_entry(client, "basic_info", {"basic_info.name": "张三"})
    second = _create_entry(client, "basic_info", {"basic_info.phone": "13800000000"})

    assert second["entry_id"] == first["entry_id"]
    assert second["sort_order"] == 0
    entries = _entries_of(_workspace(client), "basic_info")
    assert len(entries) == 1
    assert entries[0]["values"] == {
        "basic_info.name": "张三",
        "basic_info.phone": "13800000000",
    }


def test_delete_entry_hides_it_from_workspace_but_keeps_row(client, db_session):
    """R-06：删条目只写 deleted_at（可恢复）；workspace 不再返回它，其它条目不受影响。"""
    first = _create_entry(client, "awards", {"awards.title": "奖项A"})
    second = _create_entry(client, "awards", {"awards.title": "奖项B"})

    response = client.request(
        "DELETE",
        ENTRY_API.format(section_key="awards", entry_id=first["entry_id"]),
        json={"expected_revision": first["revision"]},
    )
    assert response.status_code == 204

    remaining = _entries_of(_workspace(client), "awards")
    assert [item["entry_id"] for item in remaining] == [second["entry_id"]]
    db_session.rollback()
    row = db_session.query(ProfileEntry).filter_by(entry_id=first["entry_id"]).one()
    assert row.deleted_at is not None


def test_entry_reorder_is_reflected_in_workspace_order(client):
    """R-03：重排后重新读取的顺序与提交一致，序号仍是 0..N 的显式序号。"""
    created = [_create_entry(client, "awards", {"awards.title": name}) for name in ("A", "B", "C")]
    entry_ids = [item["entry_id"] for item in created]
    workspace = _workspace(client)
    assert [item["entry_id"] for item in _entries_of(workspace, "awards")] == entry_ids

    target = [entry_ids[2], entry_ids[0], entry_ids[1]]
    response = client.put(
        REORDER_API.format(section_key="awards"),
        json={
            "entry_ids": target,
            "expected_revision": workspace["workspace_revision"],
        },
    )
    assert response.status_code == 200, response.text
    assert [item["entry_id"] for item in response.json()] == target
    reordered = _entries_of(_workspace(client), "awards")
    assert [item["entry_id"] for item in reordered] == target
    assert [item["sort_order"] for item in reordered] == [0, 1, 2]

    # 口径 2：reorder 的 expected_revision 是 workspace 级锁，过期 → 409 + 当前 state revision。
    stale = client.put(
        REORDER_API.format(section_key="awards"),
        json={"entry_ids": target, "expected_revision": workspace["workspace_revision"] + 99},
    )
    conflict = _assert_error(stale, 409, code="revision_conflict")
    assert conflict["revision"] == workspace["workspace_revision"]


def test_entry_limit_rejects_201st_entry(client, db_session):
    """R-03：多条分区上限 200 条，第 201 条被拒且提示上限。"""
    # 预置 199 条活动条目（第 200 条仍走 API 创建，避免 200 次 HTTP 请求拖慢套件）。
    db_session.add_all(
        ProfileEntry(
            entry_id=f"entry{index:019d}",
            section_key="projects",
            sort_order=index,
            values={},
            field_snapshot=[],
        )
        for index in range(199)
    )
    db_session.commit()

    created = _create_entry(client, "projects", {})
    assert created["sort_order"] == 199
    response = client.post(ENTRIES_API.format(section_key="projects"), json={"values": {}})
    _assert_error(response, 400, code="limit_reached")


def test_bulk_save_is_atomic_and_rejects_stale_workspace_revision(client):
    """R-15：批量保存单事务原子，一项非法则整体不写；版本过期 → 409 带 revision。"""
    entry = _create_entry(client, "projects", {"projects.name": "原项目"})
    workspace = _workspace(client)
    response = client.patch(
        BULK_ENTRIES_API,
        json={
            "entries": [
                {
                    "section_key": "projects",
                    "entry_id": entry["entry_id"],
                    "values": {"projects.name": "会被回滚的名字"},
                    "expected_revision": entry["revision"],
                },
                # 非法项：projects 分区不存在这个 field_id → 整批失败。
                {"section_key": "projects", "values": {"projects.不存在": "x"}},
            ]
        },
    )
    _assert_error(response, 400, code="unknown_field")

    after = _workspace(client)
    # 任一失败整体回滚：合法项也没写进去，revision 不动。
    assert _entries_of(after, "projects") == _entries_of(workspace, "projects")
    assert after["workspace_revision"] == workspace["workspace_revision"]

    stale = client.patch(
        BULK_ENTRIES_API,
        json={
            "entries": [],
            "expected_workspace_revision": workspace["workspace_revision"] + 99,
        },
    )
    conflict = _assert_error(stale, 409, code="revision_conflict")
    assert conflict["revision"] == workspace["workspace_revision"]  # 409 带当前 revision
