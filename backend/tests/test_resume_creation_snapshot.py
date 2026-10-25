# SPDX-License-Identifier: Apache-2.0
"""F4-BE 创建态快照测试：POST /api/resumes/manual 的 profile_context（F4 §1/§6）。

覆盖五组性质：
1. 带当前投影 token 创建 → 同事务写 profile_usage_snapshot（resume_id 关联、participating
   与 layout 冻结、group 元数据与投影一致）；
2. token 与当前投影不一致（资料在用户操作期间变了）→ 409 code=profile_snapshot_stale，
   且**一行都不写**（简历与快照都不落库）；
3. 不带 profile_context 的旧客户端 → 响应/行为不变、不写快照（兼容）；
4. 权威 layout 由服务端按 token 对应的投影重新冻结（不信任客户端计数）；
5. 创建不按当前组裁剪已保存正文（R-34/E：切组只影响此后新建，已保存内容不被过滤）。
"""

from __future__ import annotations

import base64

from app.models.profile_usage_snapshot import ProfileUsageSnapshot
from app.models.resume import ResumeRecord

PROJECTION_API = "/api/profile/current/projection"
MANUAL_API = "/api/resumes/manual"
ENTRIES_API = "/api/profile/sections/{section_key}/entries"
GROUPS_API = "/api/profile/groups"
CURRENT_GROUP_API = "/api/profile/current-group"

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


def _content(**overrides) -> dict:
    base = {"name": "张三", "summary": "后端工程师"}
    base.update(overrides)
    return base


def _projection(client) -> dict:
    response = client.get(PROJECTION_API)
    assert response.status_code == 200, response.text
    return response.json()


def _profile_context(projection: dict) -> dict:
    """按前端实际会发的内容构造（source_layout → layout 展示字段）。"""
    return {
        "snapshot_token": projection["snapshot_token"],
        "participating_keys": projection["scope"]["participating_keys"],
        "layout": [
            {
                "section_key": item["section_key"],
                "section_name": item["section_name"],
                "entry_count": item["entry_count"],
            }
            for item in projection["source_layout"]
        ],
    }


def _create(client, *, content: dict | None = None, context: dict | None = None, title="新建测试"):
    payload: dict = {"title": title, "content": content or _content()}
    if context is not None:
        payload["profile_context"] = context
    return client.post(MANUAL_API, json=payload)


def _snapshot_rows(db_session) -> list[ProfileUsageSnapshot]:
    db_session.rollback()
    return db_session.query(ProfileUsageSnapshot).all()


def _resume_rows(db_session) -> list[ResumeRecord]:
    db_session.rollback()
    return db_session.query(ResumeRecord).all()


def _assert_error(response, status_code: int, *, code: str | None = None) -> dict:
    assert response.status_code == status_code, response.text
    body = response.json()
    assert isinstance(body.get("detail"), str) and body["detail"].strip()
    assert isinstance(body.get("code"), str) and body["code"]
    if code is not None:
        assert body["code"] == code
    assert "Traceback" not in response.text
    return body


def test_create_without_profile_context_keeps_old_behavior(client, db_session) -> None:
    """旧客户端（不带 profile_context）→ 201、响应形状不变、不写快照。"""
    response = _create(client)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["source"] == "manual" and body["content"]["name"] == "张三"
    assert body["id"] > 0
    assert _snapshot_rows(db_session) == []
    # 同一份简历仍可被列表读到（旧流程的提交点没变）
    listing = client.get("/api/resumes")
    assert listing.status_code == 200
    assert listing.json()["total"] == 1


def test_create_with_current_token_writes_creation_snapshot(client, db_session) -> None:
    projection = _projection(client)
    response = _create(client, context=_profile_context(projection))
    assert response.status_code == 201, response.text
    resume_id = response.json()["id"]

    rows = _snapshot_rows(db_session)
    assert len(rows) == 1
    snapshot = rows[0]
    assert snapshot.resume_id == resume_id  # 与简历关联（同事务）
    assert snapshot.task_id is None  # 创建态快照不是生成任务快照
    scope = projection["scope"]
    assert snapshot.group_id == scope["group_id"]
    assert snapshot.group_name == scope["group_name"]
    assert snapshot.definition_revision == scope["workspace_revision"]
    # participating 按全局顺序、含 13 个内置分区（默认组）
    assert [item["key"] for item in snapshot.participating] == list(BUILTIN_ORDER)
    assert snapshot.section_order == list(BUILTIN_ORDER)
    # layout 是服务端冻结的来源布局（F3 同一形状：key/name/form/entry_count/material_only）
    layout = snapshot.layout
    assert layout["group_id"] == scope["group_id"]
    assert [item["key"] for item in layout["participating"]] == list(BUILTIN_ORDER)
    assert layout["participating"][0]["name"] == "基本信息"
    assert "entry_count" in layout["participating"][0]
    assert snapshot.created_at is not None


def test_snapshot_layout_is_frozen_and_not_rewritten_later(client, db_session) -> None:
    projection = _projection(client)
    response = _create(client, context=_profile_context(projection))
    assert response.status_code == 201, response.text
    resume_id = response.json()["id"]
    before = _snapshot_rows(db_session)[0]
    frozen_layout = dict(before.layout)

    # 创建之后继续改资料（新增一条项目经历）：快照是不可变的（R-33/R-34）
    added = client.post(
        ENTRIES_API.format(section_key="projects"),
        json={"values": {"projects.name": "新项目"}},
    )
    assert added.status_code == 201, added.text
    after = _snapshot_rows(db_session)[0]
    assert after.id == before.id and after.layout == frozen_layout
    # 简历本身也不因之后的资料变化而改变
    detail = client.get(f"/api/resumes/{resume_id}")
    assert detail.status_code == 200
    assert detail.json()["content"]["projects"] == []


def test_stale_token_returns_409_and_writes_nothing(client, db_session) -> None:
    """资料在用户操作期间变了：旧 token → 409，且简历/快照一行都不写。"""
    projection = _projection(client)
    context = _profile_context(projection)
    added = client.post(
        ENTRIES_API.format(section_key="basic_info"),
        json={"values": {"basic_info.name": "李四"}},
    )
    assert added.status_code in (200, 201), added.text

    response = _create(client, context=context)
    body = _assert_error(response, 409, code="profile_snapshot_stale")
    assert "重新打开" in body["detail"]  # 文案给出路（AGENTS 错误提示要求）
    assert _resume_rows(db_session) == []
    assert _snapshot_rows(db_session) == []


def test_missing_token_is_422(client) -> None:
    response = _create(client, context={"participating_keys": [], "layout": []})
    assert response.status_code == 422


def test_unknown_token_shape_is_422(client) -> None:
    response = _create(client, context={"snapshot_token": "", "layout": []})
    assert response.status_code == 422
    response = _create(client, context={"snapshot_token": "x" * 200})
    assert response.status_code == 422


def test_snapshot_participating_follows_current_group_and_content_is_not_filtered(
    client, db_session
) -> None:
    """7 项组：快照只冻结参与项；已提交正文不按组裁剪（R-34/E）。"""
    groups = client.get(GROUPS_API).json()
    created = client.post(GROUPS_API, json={"name": "应届生"})
    assert created.status_code == 201, created.text
    group = created.json()
    members = client.put(
        f"{GROUPS_API}/{group['group_id']}/members",
        json={
            "section_keys": ["basic_info", "educations", "projects"],
            "expected_revision": group["revision"],
        },
    )
    assert members.status_code == 200, members.text
    switched = client.put(
        CURRENT_GROUP_API,
        json={"group_id": group["group_id"], "expected_revision": groups["workspace_revision"]},
    )
    assert switched.status_code == 200, switched.text

    projection = _projection(client)
    assert projection["scope"]["group_name"] == "应届生"
    context = _profile_context(projection)
    content = _content(
        experience=[{"company": "某公司", "role": "实习", "description": ["做过事"]}],
        projects=[{"name": "项目", "description": ["正文"]}],
        skills=[{"name": "Python", "level": "熟练"}],
    )
    response = _create(client, content=content, context=context)
    assert response.status_code == 201, response.text
    saved = response.json()["content"]
    # 创建不按当前组裁剪正文：不参与分区的条目原样保存（R-34）
    assert saved["experience"][0]["company"] == "某公司"
    assert saved["projects"][0]["name"] == "项目"
    assert saved["skills"][0]["name"] == "Python"

    snapshot = _snapshot_rows(db_session)[0]
    assert [item["key"] for item in snapshot.participating] == [
        "basic_info",
        "educations",
        "projects",
    ]
    assert [item["key"] for item in snapshot.layout["participating"]] == [
        "basic_info",
        "educations",
        "projects",
    ]
    assert snapshot.group_name == "应届生"


def test_server_freezes_layout_instead_of_client_claims(client, db_session) -> None:
    """客户端 layout 只做展示输入：服务端按当前投影重新冻结，不照抄错误计数。"""
    projection = _projection(client)
    context = _profile_context(projection)
    for item in context["layout"]:
        item["entry_count"] = 42  # 伪造的计数（在长度上限内）
        item["section_name"] = "错误名称"
    response = _create(client, context=context)
    assert response.status_code == 201, response.text
    snapshot = _snapshot_rows(db_session)[0]
    layout = snapshot.layout
    assert layout["participating"][0]["entry_count"] == 0
    assert layout["participating"][0]["name"] == "基本信息"
    assert all(item["entry_count"] == 0 for item in layout["participating"])


def test_token_matches_projection_endpoint_exactly(client) -> None:
    """创建接口接受的 token 就是 GET /current/projection 返回的那一枚（64 hex）。"""
    projection = _projection(client)
    token = projection["snapshot_token"]
    assert len(token) == 64 and all(char in "0123456789abcdef" for char in token)
    response = _create(client, context=_profile_context(projection))
    assert response.status_code == 201, response.text
    # 创建之后投影快照未变（创建不写资料）
    again = _projection(client)
    assert again["snapshot_token"] == token


def _png_data_url() -> str:
    payload = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
    return "data:image/png;base64," + base64.b64encode(payload).decode("ascii")


def test_snapshot_token_accounts_for_resolved_photo(client) -> None:
    """投影端点会解析照片引用；创建接口必须用同一解析器重算 token，否则永远 409。"""
    photo = client.post(
        "/api/profile/photos",
        json={"name": "主照片", "image": _png_data_url()},
    )
    assert photo.status_code == 201, photo.text
    photo_id = photo.json()["id"]
    saved = client.post(
        ENTRIES_API.format(section_key="basic_info"),
        json={
            "values": {
                "basic_info.name": "张三",
                "basic_info.photo": f"profile_photo:{photo_id}",
            }
        },
    )
    assert saved.status_code in (200, 201), saved.text

    projection = _projection(client)
    assert projection["content"]["photo"] == _png_data_url()  # 端点已解析成 data URL
    content = {**_content(), "photo": _png_data_url()}
    response = _create(client, content=content, context=_profile_context(projection))
    assert response.status_code == 201, response.text
    assert response.json()["content"]["photo"] == _png_data_url()
