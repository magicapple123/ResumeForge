# SPDX-License-Identifier: Apache-2.0
"""资料组与当前组的 HTTP 级验收测试（F1-D1；验收 I / R-17～R-25）。

覆盖六组性质：
1. 组 = 名称 + 参与清单：新建/改名/切换当前组/删除；默认组恒存在、可改名但不可删除
   （R-18/R-19/R-20/R-21/R-24）；
2. 删当前组：响应带 switched_to + notice_id，workspace.pending_notice 可见，ack 后消失
   （R-25）；删组只删清单，条目与自建定义原样保留（验收 I / R-19 / §6 铁律 2）；
3. 名称判重：去首尾空白 + 仅 ASCII 大小写不敏感；活动组上限 20，第 21 个被拒（R-18）；
4. 参与清单整份替换只增删关系行，基本信息恒参与且排首位，没有组内顺序（R-17/R-21/R-22）；
5. 过期 expected_revision → 409 带当前 revision（契约 §5）；
6. 错误契约：400/404/409 响应体带 detail+code，不泄露资料内容或堆栈。

每个用例只通过 conftest 的临时测试库夹具隔离，不写固定路径、不读真实库。
"""

from __future__ import annotations

GROUPS_API = "/api/profile/groups"
CURRENT_GROUP_API = "/api/profile/current-group"
WORKSPACE_API = "/api/profile/workspace"
SECTIONS_API = "/api/profile/sections"
ENTRIES_API = "/api/profile/sections/{section_key}/entries"
NOTICE_ACK_API = "/api/profile/notices/{notice_id}/ack"

# 需求 §3 / R-65 的 13 个大字段全局顺序（默认组参与清单必须逐项一致）。
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


def _groups(client) -> dict:
    response = client.get(GROUPS_API)
    assert response.status_code == 200, response.text
    return response.json()


def _workspace(client) -> dict:
    response = client.get(WORKSPACE_API)
    assert response.status_code == 200, response.text
    return response.json()


def _create_group(client, name: str) -> dict:
    response = client.post(GROUPS_API, json={"name": name})
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


def test_create_rename_and_switch_current_group(client):
    """R-18/R-19/R-20/R-24：组的建/改/切/删闭环，默认组恒在列表首位。"""
    listing = _groups(client)
    default_id = listing["default_group_id"]
    assert [group["group_id"] for group in listing["items"]] == [default_id]  # R-20：默认组恒存在
    assert listing["items"][0]["is_default"] is True
    assert listing["items"][0]["participating_keys"] == list(BUILTIN_ORDER)  # R-20：默认参与 13 项

    group = _create_group(client, "社招")
    assert group["is_default"] is False
    assert group["participating_keys"] == ["basic_info"]  # R-21：落库时也补回基本信息
    assert group["member_count"] == 1

    renamed = client.patch(
        f"{GROUPS_API}/{group['group_id']}",
        json={"name": " 社招组 ", "expected_revision": group["revision"]},
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "社招组"  # R-19：名称去首尾空白后保存
    assert renamed.json()["revision"] == group["revision"] + 1

    switched = client.put(
        CURRENT_GROUP_API,
        json={
            "group_id": group["group_id"],
            "expected_revision": _workspace(client)["workspace_revision"],
        },
    )
    assert switched.status_code == 200, switched.text
    assert switched.json()["current_group_id"] == group["group_id"]  # R-24：唯一切换入口
    workspace = _workspace(client)
    assert workspace["current_group"]["group_id"] == group["group_id"]  # R-24：其它读取一致
    assert _groups(client)["current_group_id"] == group["group_id"]

    # 删非当前组：没有降级告知，列表恰少一项（R-19；验收 I 的"组列表少一项"）。
    another = _create_group(client, "科研岗")
    deleted = client.request(
        "DELETE",
        f"{GROUPS_API}/{another['group_id']}",
        json={"expected_revision": another["revision"]},
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["switched_to"] is None
    assert deleted.json()["notice_id"] is None
    remaining_ids = [group["group_id"] for group in _groups(client)["items"]]
    assert remaining_ids == [default_id, group["group_id"]]


def test_delete_current_group_falls_back_to_default_and_notifies(client):
    """R-25 / 验收 I：删当前组只能降级到默认组并明确告知；且不丢任何资料。"""
    listing = _groups(client)
    default_id = listing["default_group_id"]

    # 先造一个自建大字段 + 一条条目，作为"删组不改资料"的旁证（验收 I / R-19）。
    section = client.post(SECTIONS_API, json={"name": "开源贡献"})
    assert section.status_code == 201, section.text
    section_key = section.json()["key"]
    entry = client.post(ENTRIES_API.format(section_key=section_key), json={"values": {}})
    assert entry.status_code == 201, entry.text
    before = _workspace(client)

    group = _create_group(client, "社招")
    switched = client.put(
        CURRENT_GROUP_API,
        json={
            "group_id": group["group_id"],
            # 切组是 state 的条件写，expected_revision 取写入时刻的 workspace revision。
            "expected_revision": _workspace(client)["workspace_revision"],
        },
    )
    assert switched.status_code == 200, switched.text

    deleted = client.request(
        "DELETE",
        f"{GROUPS_API}/{group['group_id']}",
        json={"expected_revision": group["revision"]},
    )
    assert deleted.status_code == 200, deleted.text
    body = deleted.json()
    assert body["deleted_group_id"] == group["group_id"]
    assert body["switched_to"] == default_id  # R-25：降级只有一条路径
    assert body["notice_id"]
    assert body["current_group"]["group_id"] == default_id

    # R-25：下次进入资料页必须能明确告知"当前组已不可用，已切换到默认组"。
    workspace = _workspace(client)
    notice = workspace["pending_notice"]
    assert notice is not None
    assert notice["notice_id"] == body["notice_id"]
    assert notice["kind"] == "current_group_deleted"
    assert notice["group_name"] == "社招"
    assert workspace["current_group"]["group_id"] == default_id
    # 验收 I / R-19：删除组只删清单；新模型条目与自建定义原样保留。
    assert workspace["entries"] == before["entries"]
    assert any(item["key"] == section_key for item in workspace["sections"])

    # R-25：确认后告知消失；重复确认返回 acknowledged=False。
    acked = client.post(NOTICE_ACK_API.format(notice_id=notice["notice_id"]))
    assert acked.status_code == 200
    assert acked.json()["acknowledged"] is True
    assert _workspace(client)["pending_notice"] is None
    again = client.post(NOTICE_ACK_API.format(notice_id=notice["notice_id"]))
    assert again.json()["acknowledged"] is False


def test_default_group_can_be_renamed_but_not_deleted(client):
    """R-20：默认组恒存在、可改名、不可删除（错误码 default_group_protected）。"""
    default = _groups(client)["items"][0]
    # 还没改名时，界面可以把这个名字翻成当前语言（`name_is_default` 是唯一判据）。
    assert default["is_default"] is True
    assert default["name_is_default"] is True
    renamed = client.patch(
        f"{GROUPS_API}/{default['group_id']}",
        json={"name": "我的默认组", "expected_revision": default["revision"]},
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["is_default"] is True
    assert renamed.json()["name"] == "我的默认组"
    # 改名之后名字是用户数据：不再标记为默认名，界面原样显示，不再翻译。
    assert renamed.json()["name_is_default"] is False

    deleted = client.request(
        "DELETE",
        f"{GROUPS_API}/{default['group_id']}",
        json={"expected_revision": renamed.json()["revision"]},
    )
    _assert_error(deleted, 400, code="default_group_protected")
    assert [group["group_id"] for group in _groups(client)["items"]] == [default["group_id"]]


def test_group_names_are_unique_after_trim_and_ascii_case_fold(client):
    """R-18：' 应届生 ' 与 '应届生' 判重；仅 ASCII 大小写折叠，展示名保留用户输入。"""
    first = _create_group(client, " 应届生 ")
    assert first["name"] == "应届生"

    duplicate = client.post(GROUPS_API, json={"name": "应届生"})
    _assert_error(duplicate, 400)
    assert _groups(client)["items"][-1]["group_id"] == first["group_id"]

    ascii_name = _create_group(client, "YingJie")
    assert ascii_name["name"] == "YingJie"
    case_duplicate = client.post(GROUPS_API, json={"name": "yingjie"})
    _assert_error(case_duplicate, 400)  # R-18：ASCII 不区分大小写；中文不做 Unicode 折叠
    assert len(_groups(client)["items"]) == 3


def test_active_group_limit_is_20(client):
    """R-18：活动组上限 20（含默认组），第 21 个被拒并提示上限。"""
    for index in range(19):
        _create_group(client, f"组{index}")
    assert len(_groups(client)["items"]) == 20

    response = client.post(GROUPS_API, json={"name": "第21个组"})
    _assert_error(response, 400, code="limit_reached")
    assert len(_groups(client)["items"]) == 20  # 被拒不落库


def test_set_group_members_keeps_basic_info_first(client):
    """R-21/R-22：参与清单整份替换后基本信息仍恒在首位；过期 revision → 409。"""
    group = _create_group(client, "应届生")
    url = f"{GROUPS_API}/{group['group_id']}/members"

    response = client.put(
        url,
        json={"section_keys": ["projects", "educations"], "expected_revision": group["revision"]},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    # 组内没有顺序：参与清单按全局顺序解析，基本信息恒首位（R-22/R-21）。
    assert body["participating_keys"] == ["basic_info", "educations", "projects"]
    assert body["member_count"] == 3

    emptied = client.put(
        url,
        json={"section_keys": [], "expected_revision": body["revision"]},
    )
    assert emptied.status_code == 200, emptied.text
    assert emptied.json()["participating_keys"] == ["basic_info"]  # R-21/R-23

    rejected = client.put(
        url,
        json={"section_keys": ["不存在"], "expected_revision": emptied.json()["revision"]},
    )
    _assert_error(rejected, 400)  # R-17：只能引用已知大字段
    assert _groups(client)["items"][-1]["participating_keys"] == ["basic_info"]  # 非法请求不写库

    stale = client.put(
        url,
        json={"section_keys": ["educations"], "expected_revision": group["revision"]},
    )
    conflict = _assert_error(stale, 409, code="revision_conflict")
    assert conflict["revision"] == emptied.json()["revision"]  # 409 带当前 revision


def test_error_contract_does_not_leak_profile_or_stack(client):
    """错误契约（契约 §5）：400/404/409 都带 detail+code；409 带 revision；不泄露资料。"""
    marker = "仅本地可见的敏感值-MARKER"
    entry = client.post(
        ENTRIES_API.format(section_key="projects"),
        json={"values": {"projects.description": marker}},
    )
    assert entry.status_code == 201, entry.text
    default = _groups(client)["items"][0]

    not_found = client.patch(
        f"{GROUPS_API}/unknown-group-id", json={"name": "改个名", "expected_revision": 1}
    )
    protected = client.request(
        "DELETE",
        f"{GROUPS_API}/{default['group_id']}",
        json={"expected_revision": default["revision"]},
    )
    conflict = client.patch(
        f"{GROUPS_API}/{default['group_id']}",
        json={"name": "新名字", "expected_revision": 99},
    )

    _assert_error(not_found, 404, code="not_found")
    _assert_error(protected, 400, code="default_group_protected")
    conflict_body = _assert_error(conflict, 409, code="revision_conflict")
    assert conflict_body["revision"] == default["revision"]  # 409 额外带当前 revision
    # 错误体只能是 {detail, code, ...少量 extra}：不得带完整资料、堆栈或内部实现细节。
    for response in (not_found, protected, conflict):
        assert marker not in response.text
        assert "profile_entry" not in response.text
