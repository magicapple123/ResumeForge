"""网申填表接口 · 预览、填充与填充记录。

预览的 404/默认勾选、填充的快照一致性校验、"不存在提交路由"的接口层守卫，以及
填充必须留下记录、落记录失败不拖垮填充。共享桩见 ``test_webform_api.py``。
"""
from app.models.profile import UserProfile
from app.services.webform import FormEngine, get_snapshot_store

from test_webform_api import RAW_CONTROLS, browser_port

# browser_port 是 pytest fixture（定义在主文件），经本模块命名空间解析；显式 re-export。
__all__ = ["browser_port"]


# ===== 预览 =====


def test_preview_of_an_unknown_snapshot_is_not_found(client, browser_port):
    response = client.post("/api/webform/preview", json={"snapshot_id": "nope"})

    assert response.status_code == 404
    assert "重新" in response.json()["detail"]


def test_preview_returns_items_and_the_default_checked_indexes(client, browser_port, db_session):
    db_session.add(UserProfile(name="张三", phone="13800000000"))
    db_session.commit()
    snapshot = get_snapshot_store().save(
        FormEngine().snapshot_controls(RAW_CONTROLS), url="https://x/apply", title="网申"
    )

    body = client.post("/api/webform/preview", json={"snapshot_id": snapshot.id}).json()

    assert body["page"]["url"] == "https://x/apply"
    assert {item["field"] for item in body["items"]} == {"name", "phone"}
    assert sorted(body["default_indexes"]) == [0, 1]


def test_preview_lists_a_required_field_without_data(client, browser_port, db_session):
    db_session.add(UserProfile(name="张三"))
    db_session.commit()
    snapshot = get_snapshot_store().save(FormEngine().snapshot_controls(RAW_CONTROLS))

    body = client.post("/api/webform/preview", json={"snapshot_id": snapshot.id}).json()

    assert [(item["index"], item["field"]) for item in body["missing_data"]] == [(1, "phone")]


# ===== 填充 =====


def test_fill_without_a_running_browser_is_a_conflict(client, browser_port, db_session):
    snapshot = get_snapshot_store().save(FormEngine().snapshot_controls(RAW_CONTROLS))

    response = client.post(
        "/api/webform/fill",
        json={"snapshot_id": snapshot.id, "items": [{"index": 0, "field": "name", "value": "张三"}]},
    )

    assert response.status_code == 409


def test_fill_rejects_an_index_that_is_not_in_the_snapshot(client, browser_port, db_session):
    """前端与后端这份快照对不上时，继续写就是往未知的框里填值。"""
    snapshot = get_snapshot_store().save(FormEngine().snapshot_controls(RAW_CONTROLS))
    browser_port.listening = True

    response = client.post(
        "/api/webform/fill",
        json={"snapshot_id": snapshot.id, "items": [{"index": 42, "field": "name", "value": "张三"}]},
    )

    assert response.status_code == 400
    assert "重新读取" in response.json()["detail"]


def test_fill_of_an_unknown_snapshot_is_not_found(client, browser_port):
    browser_port.listening = True

    response = client.post(
        "/api/webform/fill",
        json={"snapshot_id": "nope", "items": []},
    )

    assert response.status_code == 404


def test_there_is_no_submit_endpoint():
    """「只填不交」在接口层面的体现：**不存在**任何提交路由。"""
    from app.application import create_app

    paths = {
        path
        for path in create_app().openapi()["paths"]
        if path.startswith("/api/webform")
    }
    assert not any("submit" in path or "apply-form" in path for path in paths), paths


# ===== 填充记录 =====


def test_records_start_empty(client, browser_port):
    assert client.get("/api/webform/records").json() == []


def test_a_record_can_be_read_and_deleted(client, browser_port, db_session):
    from app.services.webform import history

    record = history.create_record(
        db_session,
        url="https://x/apply",
        page_title="某公司网申",
        items=[{"index": 0, "field": "name", "value": "张三", "status": "filled"}],
    )

    listed = client.get("/api/webform/records").json()
    assert [item["id"] for item in listed] == [record.id]
    assert listed[0]["filled"] == 1
    assert listed[0]["page_title"] == "某公司网申"

    detail = client.get(f"/api/webform/records/{record.id}").json()
    assert detail["items"][0]["value"] == "张三"

    assert client.delete(f"/api/webform/records/{record.id}").status_code == 204
    assert client.get("/api/webform/records").json() == []
    # 软删：接口层面看是"没了"，但回收站里还能找回来。
    assert client.get(f"/api/webform/records/{record.id}").status_code == 404


def test_records_endpoints_report_not_found_for_unknown_ids(client, browser_port):
    assert client.get("/api/webform/records/999999").status_code == 404
    assert client.delete("/api/webform/records/999999").status_code == 404


def test_filling_writes_a_record(client, browser_port, db_session, monkeypatch):
    """批量填充之后必须留下一条记录——用户要的就是"每次填写之后能留下记录"。"""
    browser_port.listening = True
    snapshot = get_snapshot_store().save(
        FormEngine().snapshot_controls(RAW_CONTROLS), url="https://x/apply", title="网申"
    )

    # 让写入真的"成功"，但不必碰真浏览器：桩掉 apply_fill 的结果与回读。
    # **打在 api 模块解析的那个名字上**（``app.api.webform.webform_service``）——它是包对象，
    # 打在 ``app.services.webform.service`` 上不会影响已经取到包属性的调用方。
    from app.services.webform import service as webform_service

    monkeypatch.setattr(
        "app.api.webform.webform_service.apply_fill",
        lambda *args, **kwargs: [
            webform_service.ApplyOutcome(index=0, field="name", status="filled", detail="")
        ],
    )
    monkeypatch.setattr(FormEngine, "read_controls", lambda self, client, **kw: [])

    response = client.post(
        "/api/webform/fill",
        json={"snapshot_id": snapshot.id, "items": [{"index": 0, "field": "name", "value": "张三"}]},
    )
    assert response.status_code == 200

    records = client.get("/api/webform/records").json()
    assert len(records) == 1
    assert records[0]["source"] == "batch"
    assert records[0]["url"] == "https://x/apply"
    assert records[0]["filled"] == 1
    assert records[0]["items"][0]["value"] == "张三"


def test_a_record_failure_never_fails_the_fill(client, browser_port, db_session, monkeypatch):
    """**落记录失败绝不能让填充看起来失败**——值已经写进页面了，那是既成事实。

    用户宁可少一条历史，也不要"填好了却报错"这种自相矛盾的提示。
    """
    browser_port.listening = True
    snapshot = get_snapshot_store().save(
        FormEngine().snapshot_controls(RAW_CONTROLS), url="https://x/apply", title="网申"
    )
    from app.services.webform import service as webform_service

    monkeypatch.setattr(
        "app.api.webform.webform_service.apply_fill",
        lambda *args, **kwargs: [
            webform_service.ApplyOutcome(index=0, field="name", status="filled", detail="")
        ],
    )
    monkeypatch.setattr(FormEngine, "read_controls", lambda self, client, **kw: [])

    def boom(*args, **kwargs):
        raise RuntimeError("数据库炸了")

    monkeypatch.setattr("app.api.webform.history.create_record", boom)

    response = client.post(
        "/api/webform/fill",
        json={"snapshot_id": snapshot.id, "items": [{"index": 0, "field": "name", "value": "张三"}]},
    )

    assert response.status_code == 200
    assert response.json()["filled"] == 1
