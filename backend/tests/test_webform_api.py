"""网申填表接口的 HTTP 面测试。

浏览器用与投递台同一套桩（``FakeBrowserPort``）：把"调试端口上有没有人在答"变成可控的，
否则开发机上真有一个浏览器占着端口时，用例会连上它。
"""
import httpx
import pytest

from app.models.profile import UserProfile
from app.services import webform as webform_service
from app.services.apply import _site_browser, apply_service
from app.services.webform import FormEngine, get_snapshot_store
from app.services.webform import browser as webform_browser


class FakeBrowserPort:
    """``listening=False``（默认）＝端口上没人，等价于"没启动过浏览器"。"""

    def __init__(self) -> None:
        self.listening = False

    def transport(self) -> httpx.MockTransport:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path != "/json/version":
                return httpx.Response(404)
            return httpx.Response(200 if self.listening else 503, json={"Browser": "Chrome"})

        return httpx.MockTransport(handler)


@pytest.fixture
def browser_port(monkeypatch) -> FakeBrowserPort:
    port = FakeBrowserPort()
    real_manager = _site_browser.BrowserManager

    def build(**kwargs):
        kwargs.setdefault("http_transport", port.transport())
        return real_manager(**kwargs)

    monkeypatch.setattr(_site_browser, "BrowserManager", build)
    monkeypatch.setattr(webform_browser, "BrowserManager", build)
    apply_service.reset_browser_manager()
    webform_browser.reset_for_tests()
    get_snapshot_store().clear()
    yield port
    apply_service.reset_browser_manager()
    webform_browser.reset_for_tests()
    get_snapshot_store().clear()


RAW_CONTROLS = [
    {
        "index": 0,
        "type": "text",
        "name": "realName",
        "label": "姓名",
        "required": True,
        "selector": '[data-rf-index="0"]',
    },
    {
        "index": 1,
        "type": "text",
        "name": "mobile",
        "label": "手机号",
        "required": True,
        "selector": '[data-rf-index="1"]',
    },
]


# 一个「身高」框。**要提案它，得先在库里给它一个值**——见下面两条用例的说明：
# 规则认得出「身高」，但库里没值时那一行落在 ``missing_data``（不是 ``items``），
# 而学习只看 ``items``。这个边界是刻意的，用例里写清楚了。
HEIGHT_CONTROLS = [
    {
        "index": 0,
        "type": "text",
        "name": "height",
        "label": "身高",
        "required": True,
        "selector": '[data-rf-index="0"]',
    },
]


# ===== 字段目录 =====


def test_fields_endpoint_returns_the_catalog_with_groups(client, browser_port):
    body = client.get("/api/webform/fields").json()

    keys = [item["key"] for item in body["fields"]]
    assert "name" in keys and "id_number" in keys
    assert body["groups"][0] == "身份信息"
    # 高敏感字段要被标出来，界面据此提示"只存本机、不进简历导出"。
    sensitive = {item["key"] for item in body["fields"] if item["sensitive"]}
    assert {"id_number", "political_status", "birth_date"} <= sensitive


def test_the_catalog_is_rendered_from_the_backend_constant_table(client, browser_port):
    """界面由目录驱动——加字段只改后端常量表。这条钉住"目录真的来自那份常量"。"""
    from app.services.webform.fields import FORM_FIELDS

    body = client.get("/api/webform/fields").json()

    assert [item["key"] for item in body["fields"]] == [item.key for item in FORM_FIELDS]


# ===== 读取表单 =====


def test_snapshot_without_a_running_browser_is_a_conflict(client, browser_port):
    response = client.post("/api/webform/snapshot")

    assert response.status_code == 409
    assert "浏览器" in response.json()["detail"]


def test_browser_status_is_shared_with_the_apply_console(client, browser_port):
    """同一个受控窗口、同一份登录态——两条链路不该各记各的状态。"""
    assert client.get("/api/webform/browser/status").status_code == 200

    browser_port.listening = True
    body = client.get("/api/webform/browser/status").json()

    assert body["state"] != "stopped"


def test_starting_the_browser_also_opens_the_click_to_fill_session(
    client, browser_port, monkeypatch
):
    """打开浏览器就顺手把「智能逐项填表」开上。

    这是"点开浏览器 → 历历球随页面出现"那条链路的入口：路由自己调一次 `start_live`，
    前端不必等浏览器状态轮询翻牌、也不必再补发一次（那正是用户反馈的"要等一会儿"）。
    """
    browser_port.listening = True
    calls: list[dict] = []

    def fake_start_live(*args, **kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(webform_service, "start_live", fake_start_live)

    response = client.post("/api/webform/browser/start")

    assert response.status_code == 200
    assert calls, "打开浏览器时必须顺手开启实时填表"


def test_a_failed_auto_start_does_not_break_the_browser_response(
    client, browser_port, monkeypatch
):
    """自动开启失败（页面还没就绪）不能让"打开浏览器"本身失败——会话内的轮询会自愈重装。"""
    browser_port.listening = True

    def boom(*args, **kwargs):
        raise RuntimeError("页面还没就绪")

    monkeypatch.setattr(webform_service, "start_live", boom)

    response = client.post("/api/webform/browser/start")

    assert response.status_code == 200
    assert response.json()["state"] != "stopped"


def test_memory_targets_endpoint_returns_only_the_web_form_profile(
    client, browser_port, db_session
):
    """**只剩「网申资料」**——简历资料里的字段（姓名、教育）一个都不在里面。

    这几条目标以前是有的：按一下「记住这条」就能改简历资料里的值。2026-09-28 收掉了，
    理由见 ``services/webform/profile_targets.py`` 的模块说明。这里从**接口**这一层
    再确认一次，防止有人只改了服务层却漏了这条出口。
    """
    from app.models.profile import Education
    from app.services.webform import extra_profile

    profile = UserProfile(name="张三")
    profile.educations.append(Education(school="天津工业大学", courses="操作系统"))
    db_session.add(profile)
    db_session.commit()
    extra_profile.remember(
        db_session, key="CUSTOM_导师姓名", value="王教授", label="导师姓名", source="manual"
    )

    response = client.get("/api/webform/memory-targets")

    assert response.status_code == 200
    targets = {item["target_id"]: item for item in response.json()["targets"]}
    assert targets["extra:CUSTOM_导师姓名"]["label"] == "导师姓名"
    assert all(key.startswith("extra:") for key in targets), targets
    assert "profile:name" not in targets
    assert not [key for key in targets if key.startswith("educations:")]


def test_live_remember_endpoint_forwards_the_user_selected_target(
    client, browser_port, monkeypatch
):
    received: dict[str, str] = {}

    def remember_live_choice(**payload):
        received.update(payload)
        return True

    monkeypatch.setattr(webform_service, "remember_live_choice", remember_live_choice)
    monkeypatch.setattr(webform_service, "live_status", lambda: {"running": True})

    response = client.post(
        "/api/webform/live/remember",
        json={
            "target_id": "extra:height",
            "value": "180",
            "label": "身高",
            "reuse": "general",
        },
    )

    assert response.status_code == 200
    assert response.json()["saved"] is True
    assert received == {
        "target_id": "extra:height",
        "value": "180",
        "label": "身高",
        "reuse": "general",
    }


def test_live_start_remember_defaults_to_the_web_form_profile_never_the_resume(
    client, browser_port, db_session, monkeypatch
):
    """默认落点**只在网申资料**——哪怕这个字段在「我的资料」里已经有值。

    这条断言以前是 ``target_id == "profile:name"``，也就是把值写进简历资料。
    2026-09-28 收紧了：简历资料会被生成进简历正文，按一下「记住这条」顺手改掉它，
    代价比放进网申资料大得多。**这里连"简历资料一个字都没变"一起断言**。
    """
    from app.services.webform import extra_profile

    browser_port.listening = True
    db_session.add(UserProfile(name="张三"))
    db_session.commit()
    captured: dict[str, object] = {}

    def fake_start_live(*args, **kwargs):
        captured.update(kwargs)
        return None

    monkeypatch.setattr(webform_service, "start_live", fake_start_live)
    monkeypatch.setattr(webform_service, "live_status", lambda: {"running": True})

    response = client.post("/api/webform/live/start", json={"ai": False})

    assert response.status_code == 200
    assert captured["require_memory_choice"] is False
    store = captured["store"]
    assert callable(store)

    entry = {"key": "name", "label": "姓名", "value": "李四"}
    assert store(entry) is True
    assert entry["target_id"] == "custom", "默认落点不该指向简历资料里的字段"
    assert entry["destination"].startswith("网申资料")
    assert db_session.query(UserProfile).one().name == "张三", "简历资料被改动了"
    assert extra_profile.list_entries(db_session)["CUSTOM_姓名"] == "李四"


def test_live_start_remember_adds_an_unknown_field_to_extra_profile(
    client, browser_port, db_session, monkeypatch
):
    from app.services.webform import extra_profile

    browser_port.listening = True
    db_session.add(UserProfile(name="张三"))
    db_session.commit()
    captured: dict[str, object] = {}

    def fake_start_live(*args, **kwargs):
        captured.update(kwargs)
        return None

    monkeypatch.setattr(webform_service, "start_live", fake_start_live)
    monkeypatch.setattr(webform_service, "live_status", lambda: {"running": True})

    response = client.post("/api/webform/live/start", json={"ai": False})

    assert response.status_code == 200
    store = captured["store"]
    assert callable(store)

    entry = {"key": "CUSTOM_导师姓名", "label": "导师姓名", "value": "王教授"}
    assert store(entry) is True
    assert entry["target_id"] == "custom"
    assert entry["destination"].startswith("网申资料")
    assert extra_profile.list_entries(db_session)["CUSTOM_导师姓名"] == "王教授"


def test_live_enabled_toggles_only_the_feature_and_keeps_the_session(client, monkeypatch):
    calls: list[bool] = []
    monkeypatch.setattr(webform_service, "set_live_enabled", calls.append)
    monkeypatch.setattr(
        webform_service,
        "live_status",
        lambda: {"running": True, "enabled": False},
    )

    response = client.post("/api/webform/live/enabled", json={"enabled": False})

    assert response.status_code == 200
    assert calls == [False]
    assert response.json()["running"] is True
    assert response.json()["enabled"] is False


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


# ===== 「网申资料」=====
#
# 用户专门为网申表单录的补充资料。**只给网申填表用**——简历生成读的是 UserProfile，
# 不经过这两个接口（边界见 tests/test_webform_extra_profile.py）。


def test_extra_profile_starts_empty_with_the_catalog(client, browser_port):
    body = client.get("/api/webform/extra-profile").json()

    keys = [item["key"] for item in body["fields"]]
    # 清单只含"要用户自己录"的那批，**不含**从简历资料取值的字段（否则界面会把
    # "学校""专业"也渲染成网申资料的输入框）。
    assert "student_id" in keys
    assert "name" not in keys and "school" not in keys
    # 四六级分数已挪进**教育经历**（简历资料），所以它不该再出现在这一区——
    # 同一个值有两个来源，改哪边都不对。
    assert "cet4_score" not in keys and "cet6_score" not in keys
    assert body["values"] == {}
    # 分区标题来自后端，界面不写死。
    assert "语言与证书" in body["groups"]


def test_extra_profile_round_trips(client, browser_port):
    put = client.put(
        "/api/webform/extra-profile",
        json={"values": {"student_id": "2022012345", "height": "178"}},
    )
    assert put.status_code == 200
    assert put.json()["values"] == {"student_id": "2022012345", "height": "178"}

    # 重新读一次也还在（真的落库了，不是只回显）。
    body = client.get("/api/webform/extra-profile").json()
    assert body["values"] == {"student_id": "2022012345", "height": "178"}


def test_extra_profile_put_is_a_full_overwrite(client, browser_port):
    """整份覆盖：没提到的 key 被删除——用户清空某一格时"删除"才是他要的语义。"""
    client.put("/api/webform/extra-profile", json={"values": {"student_id": "2022012345", "height": "178"}})
    client.put("/api/webform/extra-profile", json={"values": {"student_id": "2022012345"}})

    assert client.get("/api/webform/extra-profile").json()["values"] == {"student_id": "2022012345"}


def test_extra_profile_put_rolls_back_single_value_changes_when_repeated_save_fails(
    client, browser_port, monkeypatch
):
    """单值资料与多条资料必须一起提交，后半段失败时不能只保存前半段。"""
    client.put(
        "/api/webform/extra-profile",
        json={"values": {"student_id": "旧学号"}, "repeated": {}},
    )

    from app.api import webform as webform_api

    def fail(*_args, **_kwargs):
        raise ValueError("重复资料无效")

    monkeypatch.setattr(webform_api.repeated_profile, "save_groups", fail)
    response = client.put(
        "/api/webform/extra-profile",
        json={"values": {"student_id": "新学号"}, "repeated": {}},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "重复资料无效"
    assert client.get("/api/webform/extra-profile").json()["values"] == {
        "student_id": "旧学号"
    }


def test_extra_profile_drops_keys_outside_the_catalog(client, browser_port):
    """目录外的键丢弃但不报错——前端多传一个键不该让整次保存失败。"""
    put = client.put(
        "/api/webform/extra-profile",
        json={"values": {"student_id": "2022012345", "definitely_not_a_field": "x"}},
    )

    assert put.status_code == 200
    assert put.json()["values"] == {"student_id": "2022012345"}


def test_extra_profile_values_reach_the_webform_fill_data(client, browser_port, db_session):
    """录进去的资料要能被网申填表读到——不然录了也白录。"""
    from app.services.webform.data import build_form_data

    client.put("/api/webform/extra-profile", json={"values": {"student_id": "2022012345"}})

    assert build_form_data(db_session)["student_id"] == "2022012345"


def test_extra_profile_is_invisible_to_the_resume_generation_path(client, browser_port, db_session):
    """**用户要求的那条边界**：生成简历读不到「网申资料」。

    走简历生成那条链路的取数入口（``to_profile_out(get_profile_detail(...))``）并断言
    看不到录入的值。失败方式是静默的——简历正文里会多出四六级分数、身高、父母工作单位。
    """
    from app.services.profile.profile_service import get_profile_detail, to_profile_out

    client.put(
        "/api/webform/extra-profile",
        json={"values": {"student_id": "2022012345", "emergency_contact_phone": "13900000000"}},
    )

    flat = str(to_profile_out(get_profile_detail(db_session)).model_dump())

    assert "2022012345" not in flat
    assert "13900000000" not in flat


# ===== 学到的（2026-09-27）=====


def test_extra_profile_reports_source_and_level(client, browser_port):
    """``details`` 要带上来源与档位——界面靠它区分"手录的/学到的"并显示档位。

    默认（不传 details）落成 ``manual`` + ``general``：那是「我的资料」那一屏的语义。
    """
    client.put("/api/webform/extra-profile", json={"values": {"height": "178"}})

    body = client.get("/api/webform/extra-profile").json()

    assert body["details"]["height"] == {
        "value": "178",
        "source": "manual",
        "reuse": "general",
        # 显式给出来，前端就不必自己判断"这个 key 是自定义的还是目录的"。
        "label": "身高(cm)",
    }


def test_extra_profile_accepts_learned_details(client, browser_port):
    """学到的那些要能把 ``source="learned"`` 与档位一起写进去。"""
    put = client.put(
        "/api/webform/extra-profile",
        json={
            "values": {"height": "178", "referral_code": "ABC123"},
            "details": {
                "height": {"value": "178", "source": "learned", "reuse": "general"},
                "referral_code": {"value": "ABC123", "source": "learned", "reuse": "once"},
            },
        },
    )

    assert put.status_code == 200
    details = put.json()["details"]
    assert details["height"]["source"] == "learned"
    assert details["referral_code"]["reuse"] == "general"


def test_all_saved_profile_values_are_offered_to_the_fill_engine(client, browser_port, db_session):
    """网申资料统一按通用资料参与填表，历史档位只保留兼容显示。"""
    from app.services.webform.data import build_form_data

    client.put(
        "/api/webform/extra-profile",
        json={
            "values": {"referral_code": "ABC123", "height": "178"},
            "details": {
                "referral_code": {"value": "ABC123", "source": "learned", "reuse": "once"},
                "height": {"value": "178", "source": "learned", "reuse": "general"},
            },
        },
    )

    data = build_form_data(db_session)
    assert data["referral_code"] == "ABC123"
    assert data["height"] == "178"
    # 但读得回来——"只记不填"不是"不记"。
    assert client.get("/api/webform/extra-profile").json()["values"]["referral_code"] == "ABC123"


def test_preview_proposes_nothing_for_a_recognized_but_empty_field(
    client, browser_port, db_session
):
    """**边界用例**：规则认得出这个框、但资料里没这一项 → **不提案**。

    这一行落在 ``missing_data``（"我们知道有这个字段、只是你没填"），不在 ``items`` 里。
    那不是"学一条新东西"的场合——用户该去「网申资料」把它补上。学习只看 ``items``，
    所以这条边界是**结构上**成立的，不是靠额外判断。

    钉住它是因为反过来做（把 ``missing_data`` 也拿去学）看起来更"贴心"，实际会把
    "目录里已有的字段"变成一堆学来的条目，而它们下次仍会走规则匹配、根本用不上。
    """
    snapshot = get_snapshot_store().save(
        FormEngine().snapshot_controls(HEIGHT_CONTROLS), url="https://x/apply", title="网申"
    )

    body = client.post("/api/webform/preview", json={"snapshot_id": snapshot.id}).json()

    assert body["learning"]["candidates"] == []
    # 前提：它确实被认出来了，只是没值——所以这不是"没认出来"的另一种说法。
    assert [item["field"] for item in body["missing_data"]] == ["height"]


def test_preview_proposes_a_value_already_known_to_the_webform_profile(
    client, browser_port, db_session
):
    """已经被「网申资料」收录的值**不提案**——否则这条提示会变成每次填表都弹的骚扰。"""
    client.put("/api/webform/extra-profile", json={"values": {"height": "178"}})
    snapshot = get_snapshot_store().save(
        FormEngine().snapshot_controls(HEIGHT_CONTROLS), url="https://x/apply", title="网申"
    )

    body = client.post("/api/webform/preview", json={"snapshot_id": snapshot.id}).json()

    assert body["learning"]["candidates"] == []
    # 前提：它这次真的会填进去（在 items 里），所以"不提案"是因为值已在库里。
    assert [(item["field"], item["value"]) for item in body["items"]] == [("height", "178")]





def test_preview_proposes_a_field_the_profile_has_no_value_for(
    client, browser_port, db_session
):
    """**正面用例**：规则认出来、这次也填了一个值，而这个字段在库里没有 → 提案。

    要凑出这个场景必须让"值有来源、字段又不在库里"同时成立，所以这里模拟的是**AI 兜底
    认出字段**那条路：``source="ai"`` 的行其值来自候选，而字段本身可以是新的。

    断言的是提案的形状——前端弹提示、以及"记住"之后写回 ``/extra-profile`` 全靠它。
    """
    from app.services.webform import extra_profile
    from app.services.webform.fields import FIELD_LABELS
    from app.services.webform.service import PreviewItem

    item = PreviewItem(
        index=0,
        field="height",
        field_label=FIELD_LABELS["height"],
        value="178",
        control_label="身高",
        control_type="text",
        source="ai",
    )
    proposals = extra_profile.learnable(db_session, [item], {})

    assert [p["key"] for p in proposals] == ["height"]
    assert proposals[0]["value"] == "178"
    assert proposals[0]["from"] == "ai"
