# SPDX-License-Identifier: Apache-2.0
"""T28 Batch A 续：jobs 域 3 对（list/create/update）的奇偶校验与行为保持。

每个用例都对着**真实路由 + 真实工具**跑同一份输入，断言：
- 合法输入两侧写出的数据库行逐字段相同（或"路由不做、工具默认"这类已记录的差异）；
- 非法输入两侧错误来自同一张映射表（路由 detail.code == 工具 error token）；
- input_model 的 required 与 as_tool 生成的 schema 逐项一致；
- 工具默认值 / 路由忽略未知字段等历史行为保持；
- 只读动作不写库。
"""

from __future__ import annotations

import json

import pytest
from app.models.job import Job
from app.services.actions.domains.jobs import job_actions
from app.services.assistant_tools import execute_tool, get_tool
from app.services.assistant_tools.authorization import WriteProposalError

DIRECT_PATHS = {
    "list_jobs": ("GET", "/api/jobs"),
    "create_job": ("POST", "/api/jobs"),
    "update_job": ("PUT", "/api/jobs/{job_id}"),
}


def _make_job(db_session, title: str = "后端开发", **fields) -> Job:
    job = Job(title=title, **fields)
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)
    return job


def _route_error_code(response) -> str:
    detail = response.json().get("detail")
    assert isinstance(detail, dict), detail
    return str(detail.get("code"))


def _tool_error_code(tool: str, arguments: dict, db_session) -> str:
    with pytest.raises(ValueError) as info:
        execute_tool(db_session, tool, arguments)
    error = info.value
    code = getattr(error, "tool_error", None)
    assert code, error
    return str(code)


def test_jobs_actions_are_registered_as_route_tool_pairs():
    actions = job_actions()
    assert set(actions) == {"list_jobs", "create_job", "update_job"}
    for name, (method, path) in DIRECT_PATHS.items():
        spec = actions[name]
        assert (spec.http.method, spec.http.path) == (method, path)
        tool = get_tool(name)
        assert tool is not None, name
        assert tool.permission is spec.permission
        assert tool.parameters["type"] == "object"


def test_schema_required_matches_input_model():
    actions = job_actions()
    assert actions["list_jobs"].input_model.model_json_schema().get("required", []) == []
    assert "title" in actions["create_job"].input_model.model_json_schema()["required"]
    assert "job_id" in actions["update_job"].input_model.model_json_schema()["required"]
    for name in DIRECT_PATHS:
        schema = get_tool(name).parameters
        assert "$ref" not in json.dumps(schema)
        assert schema["required"] == actions[name].input_model.model_json_schema().get(
            "required", []
        )


def test_list_jobs_route_and_tool_agree_on_the_same_filtered_total(client, db_session):
    _make_job(db_session, "Python 后端", company="示例科技", status="开放中")
    _make_job(db_session, "运营专员", company="示例文化", status="已关闭")
    route = client.get("/api/jobs", params={"keyword": "示例", "status": "开放中"})
    assert route.status_code == 200
    body = route.json()
    tool_payload = json.loads(
        execute_tool(db_session, "list_jobs", {"keyword": "示例", "status": "开放中"}).text
    )
    assert body["total"] == tool_payload["总数"] == 1
    assert [item["title"] for item in body["items"]] == ["Python 后端"]
    assert [item["title"] for item in tool_payload["岗位"]] == ["Python 后端"]


def test_list_jobs_tool_keeps_its_limit_behavior(client, db_session):
    first = _make_job(db_session, "先创建的")
    _make_job(db_session, "后创建的")
    first.company = "改过公司"
    db_session.commit()
    tool_payload = json.loads(execute_tool(db_session, "list_jobs", {}).text)
    assert tool_payload["返回"] == 2
    limited = json.loads(execute_tool(db_session, "list_jobs", {"limit": 1}).text)
    assert limited["总数"] == 2 and limited["返回"] == 1  # 工具侧 limit 仍截断
    assert first.id in {item["id"] for item in tool_payload["岗位"]}
    # 路由仍是分页列表（默认 page_size=20，两条都返回）
    route = client.get("/api/jobs").json()
    assert route["total"] == 2 and len(route["items"]) == 2


def test_route_still_validates_declared_query_parameters(client, db_session):
    """R06 的另一半：剥离只针对未声明键，已声明字段照常严格校验。

    ``page`` 的约束来自 input_model（``ge=1``），路由边界不会因为"顺手宽容"而丢约束；
    这里只断言 422 与错误码，具体文案由错误语义表决定（不钉中文措辞）。
    """
    response = client.get("/api/jobs", params={"page": 0})
    assert response.status_code == 422, response.text
    assert _route_error_code(response) == "invalid_input"
    # 对照：同一份分页参数在合法范围内仍是 200（没有把分页参数误伤成未知键）。
    assert client.get("/api/jobs", params={"page": 1, "page_size": 20}).status_code == 200


def test_list_jobs_rejects_page_above_the_upper_bound(client, db_session):
    """R13：超大页码必须在参数校验层变成 422，而不是 offset 溢出 SQLite INTEGER 的 500。

    上限写进 input_model（``page: le=100000``）后，越界值与 ``page=0`` 走同一条
    ``validate_input``：422 + ``invalid_input`` + 中文文案，且文案**点名 page 与上限**——
    只说「参数格式不正确」等于没说（用户不知道改成多少）。
    """
    overflow = client.get("/api/jobs", params={"page": 99999999999999999999})
    assert overflow.status_code == 422, overflow.text
    detail = overflow.json()["detail"]
    assert detail["code"] == "invalid_input", detail
    message = str(detail["message"])
    assert "page" in message, message
    assert "≤100000" in message, message
    assert any("\u4e00" <= char <= "\u9fff" for char in message), message

    # 上限 + 1 也要拒（边界值本身合法，见下面的 200 对照）。
    above = client.get("/api/jobs", params={"page": 100001})
    assert above.status_code == 422, above.text
    assert above.json()["detail"]["code"] == "invalid_input"
    assert "≤100000" in str(above.json()["detail"]["message"])

    # 边界内不受影响：默认不传、page=2、恰好等于上限都应 200（空页也是 200）。
    assert client.get("/api/jobs").status_code == 200
    assert client.get("/api/jobs", params={"page": 2}).status_code == 200
    assert client.get("/api/jobs", params={"page": 100000}).status_code == 200

    # 工具侧同一份输入走同一条 validate_input：错误码与文案必须一致（奇偶校验）。
    with pytest.raises(ValueError) as info:
        execute_tool(db_session, "list_jobs", {"page": 100001})
    assert getattr(info.value, "tool_error", None) == "invalid_input", info.value
    assert "≤100000" in str(info.value), info.value


@pytest.mark.parametrize(
    ("path", "domain"),
    [
        ("/api/jobs", "jobs"),
        ("/api/apply/records/grouped", "apply"),
        ("/api/resumes", "resumes_read"),
        ("/api/user-files", "user_files"),
    ],
)
def test_every_migrated_paginated_get_rejects_the_same_overflow(client, path, domain):
    """R13 覆盖面：同批加上限的 4 个契约层分页 GET 行为一致（缺一个就漏一个 500）。"""
    response = client.get(path, params={"page": 99999999999999999999})
    assert response.status_code == 422, f"{domain}: {response.text}"
    assert response.json()["detail"]["code"] == "invalid_input", domain
    assert "page" in str(response.json()["detail"]["message"]), domain


def test_create_job_route_and_tool_write_the_same_row(client, db_session):
    payload = {
        "title": "数据分析师",
        "company": "示例数据",
        "location": "上海",
        "status": "开放中",
        "recognition_source": "AI 助手录入",
    }
    route = client.post("/api/jobs", json=payload)
    assert route.status_code == 201, route.text
    tool_result = execute_tool(db_session, "create_job", dict(payload))
    assert tool_result.changed is True
    rows = db_session.query(Job).order_by(Job.id).all()
    assert len(rows) == 2
    cols = ["title", "company", "location", "status", "recognition_source"]
    assert [getattr(rows[0], c) for c in cols] == [getattr(rows[1], c) for c in cols]


def test_create_job_tool_default_keeps_recognition_source(client, db_session):
    tool_result = execute_tool(db_session, "create_job", {"title": "工具新增岗位"})
    assert "新增岗位" in tool_result.summary
    job = db_session.query(Job).filter(Job.title == "工具新增岗位").one()
    assert job.recognition_source == "AI 助手录入"
    route = client.post("/api/jobs", json={"title": "路由新增岗位"})
    assert route.status_code == 201
    route_job = db_session.query(Job).filter(Job.title == "路由新增岗位").one()
    assert route_job.recognition_source == ""  # 路由侧保持"未提供就是空串"


def test_create_job_route_still_accepts_parse_draft_extra_fields(client):
    """前端"解析→确认→创建"会整份草稿回传（含 skill_tags 等 JobCreate 之外的字段）。"""
    route = client.post(
        "/api/jobs",
        json={"title": "草稿岗位", "skill_tags": [{"name": "Python", "category": "技能"}]},
    )
    assert route.status_code == 201, route.text


def test_update_job_route_and_tool_write_the_same_fields(client, db_session):
    route_job = _make_job(db_session, "路由要改的")
    tool_job = _make_job(db_session, "工具要改的")
    changes = {"title": "改后标题", "company": "改后公司", "note": "改后备注"}
    response = client.put(f"/api/jobs/{route_job.id}", json=changes)
    assert response.status_code == 200, response.text
    execute_tool(db_session, "update_job", {"job_id": tool_job.id, **changes})
    db_session.expire_all()
    for field, value in changes.items():
        assert getattr(db_session.get(Job, route_job.id), field) == value
        assert getattr(db_session.get(Job, tool_job.id), field) == value
    # 未提供的字段不被改动
    assert db_session.get(Job, route_job.id).location == ""
    assert db_session.get(Job, tool_job.id).location == ""


def test_update_job_empty_body_is_a_noop_on_both_sides(client, db_session):
    job = _make_job(db_session, "空更新")
    response = client.put(f"/api/jobs/{job.id}", json={})
    assert response.status_code == 200
    result = execute_tool(db_session, "update_job", {"job_id": job.id})
    assert result.changed is False


def test_missing_job_uses_the_same_not_found_code(client, db_session):
    response = client.put("/api/jobs/999999", json={"title": "不存在"})
    assert response.status_code == 404
    assert _route_error_code(response) == "not_found"
    assert (
        _tool_error_code("update_job", {"job_id": 999999, "title": "不存在"}, db_session)
        == "not_found"
    )


def test_invalid_input_parity_across_route_and_tool(client, db_session):
    bad_sort = client.get("/api/jobs", params={"sort": "nope"})
    assert bad_sort.status_code == 422
    assert _route_error_code(bad_sort) == "invalid_input"
    assert _tool_error_code("list_jobs", {"sort": "nope"}, db_session) == "invalid_input"

    bad_create = client.post("/api/jobs", json={})
    assert bad_create.status_code == 422
    assert _route_error_code(bad_create) == "invalid_input"
    assert _tool_error_code("create_job", {}, db_session) == "invalid_input"

    job = _make_job(db_session, "状态校验")
    bad_update = client.put(f"/api/jobs/{job.id}", json={"status": "不存在的状态"})
    assert bad_update.status_code == 422
    assert _route_error_code(bad_update) == "invalid_input"
    assert (
        _tool_error_code("update_job", {"job_id": job.id, "status": "不存在的状态"}, db_session)
        == "invalid_input"
    )

    # R05 补口：`Field(ge=1)` 的越界必须点出限制值，不能落到兜底「参数格式不正确」——
    # pydantic v2 对 ge/le/gt/lt 报的 type 是 greater_than_equal 等，映射表漏了这几类，
    # 用户就只知道"参数不对"、不知道改成多少。
    bad_page = client.get("/api/jobs", params={"page": 0})
    assert bad_page.status_code == 422
    assert _route_error_code(bad_page) == "invalid_input"
    page_message = str(bad_page.json()["detail"]["message"])
    assert "page" in page_message, page_message
    assert "≥1" in page_message, page_message
    assert any("\u4e00" <= char <= "\u9fff" for char in page_message), page_message
    assert "Field required" not in page_message, page_message
    # 工具侧同一份输入走同一条 validate_input，文案必须逐字一致（奇偶校验）。
    assert _tool_error_code("list_jobs", {"page": 0}, db_session) == "invalid_input"


def test_migrated_route_error_shape_is_the_contract_shape(client):
    response = client.get("/api/jobs/999999")
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert set(detail) == {"code", "message"}
    assert detail["code"] == "not_found"


def test_job_previews_unchanged(db_session):
    from app.services.assistant_tools import previews

    job = _make_job(db_session, "预览岗位", company="示例科技")
    tool_create = get_tool("create_job")
    assert tool_create.preview is not None
    actual = tool_create.preview(db_session, {"title": "预览岗位", "company": "示例科技"})
    expected = previews.preview_create_job(db_session, {"title": "预览岗位", "company": "示例科技"})
    assert actual.model_dump() == expected.model_dump()
    tool_update = get_tool("update_job")
    assert tool_update.preview is not None
    actual_update = tool_update.preview(db_session, {"job_id": job.id, "title": "新标题"})
    expected_update = previews.preview_update_job(db_session, {"job_id": job.id, "title": "新标题"})
    assert actual_update.model_dump() == expected_update.model_dump()


def test_read_only_action_does_not_write(db_session):
    _make_job(db_session, "只读校验")
    before = db_session.query(Job).count()
    execute_tool(db_session, "list_jobs", {})
    db_session.expire_all()
    assert db_session.query(Job).count() == before


def test_preview_error_type_survives_the_migration():
    """WriteProposalError 是既有授权层异常类型；这里只钉它仍可导入（迁移没搬走它）。"""
    assert issubclass(WriteProposalError, Exception)
