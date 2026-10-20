# SPDX-License-Identifier: Apache-2.0
"""切页守卫（RF-19）：填充前比对当前页 URL 与快照 URL，已切换则 409 拒绝写入。

背景：快照没有 tab/URL 绑定时，切了标签页 / 页面跳转后旧快照仍能按索引写入——写进了
另一张表单，结果是一批 unverified。守卫在 ``apply_fill`` 入口（批量 /fill 与 live 逐项
同一条路），读取用与快照创建同一个 ``rf:page-info`` 探针。

不拦的两类（保持既有行为，见 ``ensure_same_page`` 文档）：旧快照无 URL；当前地址读不到。
"""
import pytest
from app.services.webform._base import WebFormConflict
from app.services.webform.engine import FormEngine
from app.services.webform.service import apply_fill
from app.services.webform.service.models import FillSelection
from app.services.webform.session import Snapshot
from test_webform_api import browser_port
from test_webform_service import FakeCdpClient

# browser_port 是 pytest fixture（定义在主文件），经本模块命名空间解析；显式 re-export。
__all__ = ["browser_port"]

RAW_CONTROLS = [
    {"index": 0, "type": "text", "label": "姓名", "selector": '[data-rf-index="0"]'},
]

SNAPSHOT_URL = "https://x.example.com/apply"


def _snapshot(url: str | None = SNAPSHOT_URL) -> Snapshot:
    return Snapshot(
        id="snap",
        controls=FormEngine().snapshot_controls(RAW_CONTROLS),
        url=url or "",
    )


def _client(current_url: str | None, **replies) -> FakeCdpClient:
    merged = {"rf:page-info": {"url": current_url, "title": "页面"}, **replies}
    return FakeCdpClient(replies=merged)


def test_fill_rejects_when_the_page_has_changed():
    fake = _client("https://x.example.com/apply/step2")

    with pytest.raises(WebFormConflict) as excinfo:
        apply_fill(fake, _snapshot(), [FillSelection(index=0, field="name", value="张三")])

    assert "页面已切换" in str(excinfo.value)
    # 守卫拒绝后不得往页面里写任何东西。
    assert not any("rf:set-value" in item for item in fake.expressions)


def test_fill_rejects_when_the_host_has_changed():
    fake = _client("https://evil.example.com/apply")

    with pytest.raises(WebFormConflict):
        apply_fill(fake, _snapshot(), [FillSelection(index=0, field="name", value="张三")])


def test_fill_proceeds_when_the_url_matches_modulo_scheme_and_fragment():
    """scheme 升级与页内锚点跳动不构成换页。"""
    fake = _client(
        "https://x.example.com/apply#form",
        **{"rf:read-back": '{"ok": true, "value": "张三"}'},
    )

    outcomes = apply_fill(fake, _snapshot(), [FillSelection(index=0, field="name", value="张三")])

    assert [outcome.status for outcome in outcomes] == ["filled"]


def test_a_snapshot_without_a_url_skips_the_guard():
    """live 逐项 / 测试替身直接构造的快照没有 URL：无从比对，不拦（既有行为）。"""
    fake = FakeCdpClient(
        replies={"rf:read-back": '{"ok": true, "value": "张三"}'},
    )

    outcomes = apply_fill(fake, _snapshot(url=None), [FillSelection(index=0, field="name", value="张三")])

    assert [outcome.status for outcome in outcomes] == ["filled"]
    assert not any("rf:page-info" in item for item in fake.expressions), "没有 URL 就不该去读页面"


def test_an_unreadable_current_url_skips_the_guard():
    """读不到当前地址（页面已死）不在这里拦：随后真正的写入会以同样原因失败。"""
    fake = FakeCdpClient(replies={"rf:read-back": '{"ok": true, "value": "张三"}'})

    outcomes = apply_fill(fake, _snapshot(), [FillSelection(index=0, field="name", value="张三")])

    assert [outcome.status for outcome in outcomes] == ["filled"]


# ===== 接口层：/fill 返回 409 =====


def test_fill_route_returns_409_when_the_page_has_changed(client, browser_port, db_session, monkeypatch):
    # 受控浏览器的真身是 WebsocketCdpClient（evaluate 在子类里重写），要打在子类上。
    from app.services.browser.cdp_client.websocket_client import WebsocketCdpClient
    from app.services.webform import get_snapshot_store

    browser_port.listening = True
    snapshot = get_snapshot_store().save(
        FormEngine().snapshot_controls(RAW_CONTROLS), url=SNAPSHOT_URL, title="网申"
    )

    def fake_evaluate(self, expression, *, timeout=None):
        assert "rf:page-info" in expression, "守卫拒绝后不应再有任何页面调用"
        return {"url": "https://x.example.com/apply/step2", "title": "下一步"}

    monkeypatch.setattr(WebsocketCdpClient, "evaluate", fake_evaluate)

    response = client.post(
        "/api/webform/fill",
        json={"snapshot_id": snapshot.id, "items": [{"index": 0, "field": "name", "value": "张三"}]},
    )

    assert response.status_code == 409
    assert "页面已切换" in response.json()["detail"]
