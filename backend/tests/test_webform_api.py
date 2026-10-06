"""网申填表接口的 HTTP 面测试。

浏览器用与投递台同一套桩（``FakeBrowserPort``）：把"调试端口上有没有人在答"变成可控的，
否则开发机上真有一个浏览器占着端口时，用例会连上它。

本文件是主文件（字段目录、读取表单、浏览器启动联动，以及 architecture.md 钉住的
``test_extra_profile_is_invisible_to_the_resume_generation_path``）；live remember 在
``test_webform_api_live_remember.py``，预览/填充/记录在
``test_webform_api_fill_records.py``，网申资料接口在
``test_webform_api_extra_profile.py``。
"""
import httpx
import pytest
from app.services import webform as webform_service
from app.services.apply import _site_browser, apply_service
from app.services.webform import browser as webform_browser
from app.services.webform import get_snapshot_store


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
