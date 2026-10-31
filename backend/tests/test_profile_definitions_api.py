# SPDX-License-Identifier: Apache-2.0
"""自建大字段/小字段、条目与字段偏好的 HTTP 级验收测试（F1-D1；验收 J/P/Q / R-04～R-14/R-66/R-67）。

覆盖：① 自建大字段创建即加入当前组、排在内置之后，内置定义只读（R-04/R-05/R-08/R-12）；
② 删定义只隐藏不丢值：deletion-impact → 删除 → 条目/值保留，同名重建是新定义（R-06/R-07，
验收 J / §6 铁律 4）；③ 自建字段可建/改/删，内置分区也能加（R-11/R-16），默认字段只能隐藏
（400 builtin_field_protected），每分区 ≤20，含值删除需二次确认；④ 偏好 hidden 与
collapsed_override 独立、null 恢复跟随默认、跨分区被拒、409 冲突（R-66/R-67，验收 Q）。
条目 CRUD 的 HTTP 验收见 workspace 测试文件；用例只通过 conftest 临时测试库隔离、不读真实库。
"""

from __future__ import annotations

from app.models.profile_definition import ProfileCustomField
from app.models.profile_entry import ProfileEntry

WORKSPACE_API = "/api/profile/workspace"
SECTIONS_API = "/api/profile/sections"
FIELDS_API = "/api/profile/sections/{section_key}/fields"
FIELD_API = "/api/profile/sections/{section_key}/fields/{field_id}"
FIELD_IMPACT_API = "/api/profile/sections/{section_key}/fields/{field_id}/deletion-impact"
ENTRIES_API = "/api/profile/sections/{section_key}/entries"
PREFERENCES_API = "/api/profile/field-preferences/{field_id}"


def _workspace(client) -> dict:
    response = client.get(WORKSPACE_API)
    assert response.status_code == 200, response.text
    return response.json()


def _section(workspace: dict, section_key: str) -> dict | None:
    return next((item for item in workspace["sections"] if item["key"] == section_key), None)


def _field(workspace: dict, section_key: str, field_id: str) -> dict | None:
    section = _section(workspace, section_key)
    if section is None:
        return None
    return next((item for item in section["fields"] if item["field_id"] == field_id), None)


def _entries_of(workspace: dict, section_key: str) -> list[dict]:
    return [item for item in workspace["entries"] if item["section_key"] == section_key]


def _create_section(client, name: str) -> dict:
    response = client.post(SECTIONS_API, json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def _create_field(client, section_key: str, label: str, field_type: str) -> dict:
    response = client.post(
        FIELDS_API.format(section_key=section_key),
        json={"label": label, "field_type": field_type},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_entry(client, section_key: str, values: dict) -> dict:
    response = client.post(ENTRIES_API.format(section_key=section_key), json={"values": values})
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


def test_create_custom_section_joins_current_group_and_protects_builtins(client):
    """R-04/R-05/R-08/R-12：自建大字段创建即加入当前组；内置定义只读。"""
    workspace = _workspace(client)
    assert len(workspace["sections"]) == 13  # R-01：干净数据集只有 13 个内置大字段
    section = _create_section(client, "开源贡献")
    key = section["key"]
    assert section["is_builtin"] is False
    assert section["form"] == "multi" and section["fields"] == []  # R-04：形态固定多条

    after = _workspace(client)
    assert [item["key"] for item in after["sections"]][-1] == key  # R-08：自建排在 13 内置之后
    assert after["section_order"][-1] == key
    assert after["current_group"]["participating_keys"][-1] == key  # R-04：同事务加入当前组

    renamed = client.patch(
        f"{SECTIONS_API}/{key}",
        json={"name": "开源贡献集", "expected_revision": section["revision"]},
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "开源贡献集"  # R-05：改名不改变定义身份
    assert _section(_workspace(client), key)["name"] == "开源贡献集"
    duplicate = client.post(SECTIONS_API, json={"name": " 开源贡献集 "})
    _assert_error(duplicate, 400)  # R-04：trim 后同名判重

    for method, payload in (
        ("PATCH", {"name": "改名", "expected_revision": 0}),
        ("DELETE", {"expected_revision": 0}),
    ):
        response = client.request(method, f"{SECTIONS_API}/basic_info", json=payload)
        _assert_error(response, 400, code="builtin_protected")  # R-05/R-12：内置定义只读
    assert len(_workspace(client)["sections"]) == 14  # 内置定义没有被删


def test_section_deletion_impact_keeps_entries_and_recreate_is_new_definition(client, db_session):
    """R-06/R-07 / J：删定义只隐藏；条目与值保留；同名重建是新定义、旧值不自动关联。"""
    section = _create_section(client, "开源贡献")
    key = section["key"]
    field = _create_field(client, key, "仓库地址", "single_line")
    for _ in range(2):
        _create_entry(client, key, {field["field_id"]: "https://example.com/repo"})

    impact = client.get(f"{SECTIONS_API}/{key}/deletion-impact")
    assert impact.status_code == 200, impact.text
    impact_body = impact.json()
    # R-07：删前告知影响条数、是否可删与去哪恢复。
    assert (impact_body["entry_count"], impact_body["filled_entry_count"]) == (2, 2)
    assert impact_body["can_delete"] is True and impact_body["restore_path"] == "回收站"

    deleted = client.request(
        "DELETE",
        f"{SECTIONS_API}/{key}",
        json={"expected_revision": impact_body["revision"]},
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["entry_count"] == 2
    workspace = _workspace(client)
    assert _section(workspace, key) is None  # R-06：界面隐藏
    assert key not in workspace["section_order"]
    # 口径 3：workspace.entries 只含活动分区的条目——软删分区的历史条目不返回。
    assert _entries_of(workspace, key) == []
    db_session.rollback()
    kept = db_session.query(ProfileEntry).filter_by(section_key=key).count()
    assert kept == 2  # R-06/§6 铁律 4：条目与值不物理删除

    rebuilt = _create_section(client, "开源贡献")
    assert rebuilt["key"] != key  # R-06：同名重建是新定义
    assert rebuilt["fields"] == []
    assert _entries_of(_workspace(client), rebuilt["key"]) == []  # 旧条目不自动关联新定义
    missing = client.get(f"{SECTIONS_API}/does-not-exist/deletion-impact")
    _assert_error(missing, 404, code="not_found")


def test_custom_field_crud_and_default_fields_are_protected(client):
    """R-11/R-12/R-13 / J：自建字段可建/改/删；默认小字段不可改名、不可删除。"""
    section = _create_section(client, "开源贡献")
    key = section["key"]
    field = _create_field(client, key, "仓库地址", "single_line")
    assert field["is_builtin"] is False
    assert field["field_type"] == "single_line"  # R-10：自建字段只允许三种文本类型
    assert field["hidden"] is False and field["collapsed_override"] is None

    updated = client.patch(
        FIELD_API.format(section_key=key, field_id=field["field_id"]),
        json={"label": "代码仓库", "sort_order": 0, "expected_revision": field["revision"]},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["label"] == "代码仓库"  # R-13：可改名/排序
    assert _field(_workspace(client), key, field["field_id"])["label"] == "代码仓库"

    for method, payload in (
        ("PATCH", {"label": "改名", "expected_revision": 0}),
        ("DELETE", {"expected_revision": 0}),
    ):
        response = client.request(
            method,
            FIELD_API.format(section_key="basic_info", field_id="basic_info.name"),
            json=payload,
        )
        # R-12/口径 5：默认字段只能隐藏，改名/删除固定 400 + builtin_field_protected。
        _assert_error(response, 400, code="builtin_field_protected")
    assert _field(_workspace(client), "basic_info", "basic_info.name")["label"] == "姓名"

    impact = client.get(FIELD_IMPACT_API.format(section_key=key, field_id=field["field_id"]))
    assert impact.status_code == 200 and impact.json()["affected_entries"] == 0  # R-14
    removed = client.request(
        "DELETE",
        FIELD_API.format(section_key=key, field_id=field["field_id"]),
        json={"expected_revision": updated.json()["revision"]},
    )
    assert removed.status_code == 200, removed.text
    assert _field(_workspace(client), key, field["field_id"]) is None  # R-13：定义下线
    missing = client.patch(
        FIELD_API.format(section_key=key, field_id="not-a-real-field"),
        json={"label": "改名", "expected_revision": 1},
    )
    _assert_error(missing, 404, code="not_found")  # 口径 5：自定义字段不存在 = 404


def test_custom_field_on_builtin_section_and_value_survives_definition_delete(client):
    """R-11/R-16/R-13：内置分区也能加自定义字段；默认在前、自建在后；删定义不清空已录值。"""
    field = _create_field(client, "projects", "导师姓名", "single_line")
    assert field["is_builtin"] is False and field["section_key"] == "projects"

    fields = _section(_workspace(client), "projects")["fields"]
    # R-16：projects 的 10 个默认字段在前，且唯一一个自建字段排在最后。
    assert [item["field_id"] for item in fields if not item["is_builtin"]] == [field["field_id"]]
    assert fields[-1]["field_id"] == field["field_id"]

    entry = _create_entry(client, "projects", {field["field_id"]: "张伟"})
    assert entry["values"][field["field_id"]] == "张伟"  # R-15：自定义字段值随条目保存
    impact = client.get(
        FIELD_IMPACT_API.format(section_key="projects", field_id=field["field_id"])
    ).json()
    assert impact["affected_entries"] == 1  # R-14
    removed = client.request(
        "DELETE",
        FIELD_API.format(section_key="projects", field_id=field["field_id"]),
        json={"expected_revision": impact["revision"], "confirm_with_values": True},
    )
    assert removed.status_code == 200, removed.text
    workspace = _workspace(client)
    assert _field(workspace, "projects", field["field_id"]) is None  # R-13：定义下线
    # R-13/§6 铁律 4：已录值保留在条目里（只是不再展示）。
    assert _entries_of(workspace, "projects")[0]["values"][field["field_id"]] == "张伟"


def test_custom_field_limit_and_deletion_confirmation(client, db_session):
    """R-11/R-14 / J：每分区自建字段 ≤20；含值删除必须二次确认（409 field_has_values）。"""
    section = _create_section(client, "开源贡献")
    key = section["key"]
    # 预置 20 个活动自建字段（第 21 个走 API，验证上限门）。
    db_session.add_all(
        ProfileCustomField(
            field_id=f"field{index:019d}",
            section_key=key,
            label=f"自定义字段{index}",
            label_key=f"自定义字段{index}",
            field_type="single_line",
            sort_order=index,
        )
        for index in range(20)
    )
    db_session.commit()

    blocked = client.post(
        FIELDS_API.format(section_key=key),
        json={"label": "第21个字段", "field_type": "single_line"},
    )
    _assert_error(blocked, 400, code="limit_reached")  # R-11

    field_id = f"field{0:019d}"
    _create_entry(client, key, {field_id: "有值"})
    impact = client.get(FIELD_IMPACT_API.format(section_key=key, field_id=field_id)).json()
    assert impact["affected_entries"] == 1  # R-14：已填写该字段的条数
    blocked_delete = client.request(
        "DELETE",
        FIELD_API.format(section_key=key, field_id=field_id),
        json={"expected_revision": impact["revision"]},
    )
    body = _assert_error(blocked_delete, 409, code="field_has_values")
    assert body.get("affected_entries") == 1
    confirmed = client.request(
        "DELETE",
        FIELD_API.format(section_key=key, field_id=field_id),
        json={"expected_revision": impact["revision"], "confirm_with_values": True},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert _field(_workspace(client), key, field_id) is None


def test_preferences_hidden_and_collapsed_override_are_independent(client):
    """R-66/R-67 / Q：hidden 与 collapsed_override 是两个独立状态，互不覆盖。"""
    field_id = "projects.outcome_type"  # 目录里 default_collapsed=True（R-66）
    url = PREFERENCES_API.format(field_id=field_id)
    first = client.patch(url, json={"section_key": "projects", "hidden": True})
    assert first.status_code == 200, first.text
    body = first.json()
    # 只改 hidden 时，另一个状态（collapsed_override）保持默认值 NULL。
    assert body["hidden"] is True and body["collapsed_override"] is None
    assert body["default_collapsed"] is True  # 目录里的默认折叠不受隐藏影响

    second = client.patch(
        url,
        json={
            "section_key": "projects",
            "collapsed_override": False,
            "expected_revision": body["preference_revision"],
        },
    )
    assert second.status_code == 200, second.text
    assert (second.json()["hidden"], second.json()["collapsed_override"]) == (True, False)

    third = client.patch(
        url,
        json={
            "section_key": "projects",
            "hidden": False,
            "expected_revision": second.json()["preference_revision"],
        },
    )
    assert third.status_code == 200, third.text
    # 恢复 hidden 后折叠记忆仍在（R-67：两个状态独立）。
    assert (third.json()["hidden"], third.json()["collapsed_override"]) == (False, False)

    workspace_field = _field(_workspace(client), "projects", field_id)
    assert workspace_field["hidden"] is False
    assert workspace_field["collapsed_override"] is False


def test_preference_null_restores_default_and_rejects_foreign_field(client):
    """R-67 / Q：传 null=恢复跟随代码默认；跨分区字段被拒；过期 revision → 409。"""
    field_id = "projects.outcome_type"
    url = PREFERENCES_API.format(field_id=field_id)
    first = client.patch(url, json={"section_key": "projects", "collapsed_override": False})
    assert first.status_code == 200, first.text
    reset = client.patch(
        url,
        json={
            "section_key": "projects",
            "collapsed_override": None,
            "expected_revision": first.json()["preference_revision"],
        },
    )
    # 传 null = 恢复跟随代码默认（而不是"保持原值"）。
    assert reset.status_code == 200 and reset.json()["collapsed_override"] is None

    # "没传"与"传 null"必须区分：只改 hidden 时 collapsed_override 保持 None。
    kept = client.patch(
        url,
        json={
            "section_key": "projects",
            "hidden": True,
            "expected_revision": reset.json()["preference_revision"],
        },
    )
    assert kept.json()["collapsed_override"] is None

    foreign = client.patch(
        PREFERENCES_API.format(field_id="projects.name"),
        json={"section_key": "educations", "hidden": True},
    )
    _assert_error(foreign, 400, code="unknown_field")  # R-67：字段必须属于声明分区
    unknown = client.patch(
        PREFERENCES_API.format(field_id="does.not.exist"),
        json={"section_key": "projects", "hidden": True},
    )
    _assert_error(unknown, 400, code="unknown_field")

    stale = client.patch(
        url,
        json={"section_key": "projects", "hidden": False, "expected_revision": 99},
    )
    conflict = _assert_error(stale, 409, code="revision_conflict")
    assert conflict["revision"] == kept.json()["preference_revision"]  # 409 带当前 revision

def test_custom_field_paper_placement_attributes_roundtrip(client):
    """0069 / D6：自定义字段可设"纸面默认位置"与"仅素材"，并给出有效位置。

    旧客户端不传这两个属性 = 按类型自动、上纸面（行为逐字节不变）；仅素材字段的
    有效位置恒为 hidden（不上纸面）。
    """
    section = _create_section(client, "开源贡献")
    key = section["key"]
    legacy = _create_field(client, key, "仓库地址", "single_line")
    # 不传纸面属性：保留 NULL/False，有效位置按类型自动（单行 → trail）。
    assert legacy["default_placement"] is None
    assert legacy["material_only"] is False
    assert legacy["effective_placement"] == "trail"

    multi = client.post(
        FIELDS_API.format(section_key=key),
        json={
            "label": "项目说明",
            "field_type": "multi_line",
            "default_placement": "lead",
            "material_only": False,
        },
    )
    assert multi.status_code == 201, multi.text
    body = multi.json()
    assert body["default_placement"] == "lead"
    assert body["effective_placement"] == "lead"

    auto_multi = client.post(
        FIELDS_API.format(section_key=key),
        json={"label": "补充说明", "field_type": "multi_line"},
    )
    # 多行文本的自动位置是正文（D6），不是灰色短字段。
    assert auto_multi.json()["default_placement"] is None
    assert auto_multi.json()["effective_placement"] == "body"

    # 改成仅素材：有效位置恒 hidden（不上纸面），即便显式位置是 trail。
    hidden = client.patch(
        FIELD_API.format(section_key=key, field_id=legacy["field_id"]),
        json={"material_only": True, "expected_revision": legacy["revision"]},
    )
    assert hidden.status_code == 200, hidden.text
    assert hidden.json()["material_only"] is True
    assert hidden.json()["effective_placement"] == "hidden"
    assert _field(_workspace(client), key, legacy["field_id"])["material_only"] is True

    # 只改 material_only 时 default_placement 保持原值（没传 = 不改）。
    assert hidden.json()["default_placement"] is None
    # 传 null = 恢复"按类型自动"，传具体值 = 改到该位置。
    current = hidden.json()["revision"]
    reset = client.patch(
        FIELD_API.format(section_key=key, field_id=multi.json()["field_id"]),
        json={"default_placement": None, "expected_revision": multi.json()["revision"]},
    )
    assert reset.status_code == 200, reset.text
    assert reset.json()["default_placement"] is None
    assert reset.json()["effective_placement"] == "body"
    moved = client.patch(
        FIELD_API.format(section_key=key, field_id=legacy["field_id"]),
        json={"material_only": False, "expected_revision": current},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["effective_placement"] == "trail"


def test_custom_field_rejects_unknown_placement(client):
    """纸面位置只接受六个抽屉：未知值在校验层 422（不静默落成默认）。"""
    section = _create_section(client, "开源贡献")
    response = client.post(
        FIELDS_API.format(section_key=section["key"]),
        json={"label": "仓库地址", "field_type": "single_line", "default_placement": "sidebar"},
    )
    assert response.status_code == 422, response.text
    assert "Traceback" not in response.text

