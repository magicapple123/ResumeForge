"""「网申填表放宽模式」守卫测试。

放宽模式（默认关）把「只填不点」的一部分选择权交回用户：开启后程序尝试代点自定义
下拉等弹层控件，并把同意/声明类勾选变成"逐条显式确认"项。这里的守卫按维护者定下
的验收清单组织：

- 开关关闭：既有语义一条不变（block 回 blocked、文案不动）——全量 webform 家族都在
  验证它，这里再钉两条最容易被悄悄改掉的；
- 开关开启：弹层代选进预览行且默认勾选；选项/字段对不上仍 blocked；声明类只以
  「需确认」出现且默认不勾；填充执行真点选并回读；实时面板的「帮我勾选」点按即执行；
  日期选择器与文件上传在任何情况下都不放宽；开关持久化（保存后重读）。
"""
import json

import pytest
from app.services.settings_service import get_webform_relaxed_mode, save_webform_relaxed_mode
from app.services.webform import FormEngine, get_snapshot_store
from app.services.webform.engine import relaxed_kind
from app.services.webform.live import LiveSession
from app.services.webform.service import (
    STATUS_NEEDS_CONFIRM,
    STATUS_RELAXED_READY,
    FillSelection,
    apply_fill,
    build_preview,
    default_selections,
)
from app.services.webform.service.fill import _rebuild_mapping
from app.services.webform.session import Snapshot
from test_webform_api import browser_port  # noqa: F401 - pytest fixture，经本模块解析
from test_webform_live import FakeLiveClient, raw_control

__all__ = ["browser_port"]


def _snapshot(raw: list[dict]) -> Snapshot:
    return Snapshot(id="snap", controls=FormEngine().snapshot_controls(raw))


def _popup(**overrides) -> dict:
    """自定义下拉的输入框形态：只读 + 声明了弹层。"""
    base = {
        "index": 0,
        "type": "text",
        "label": "意向城市",
        "nearby_text": "意向城市*",
        "readonly": True,
        "has_popup": True,
        "selector": '[data-rf-index="0"]',
        "options": [],
        "value": "",
        "display": "",
        "checked": False,
    }
    base.update(overrides)
    return base


def _consent(index: int = 0) -> dict:
    return {
        "index": index,
        "type": "checkbox",
        "label": "我已阅读并同意隐私政策",
        "nearby_text": "我已阅读并同意隐私政策",
        "selector": f'[data-rf-index="{index}"]',
    }


# ===== 判类（relaxed_kind） =====


def test_relaxed_kind_never_widens_beyond_skip_reason():
    """放宽只会在 blocked 集合**内部**放行：relaxed_kind 认可的控件必然被 skip_reason 挡过。"""
    controls = [
        _popup(),
        {"index": 1, "type": "select", "label": "学历", "selector": '[data-rf-index="1"]'},
        _consent(2),
        {
            "index": 3,
            "type": "radio",
            "label": "女",
            "nearby_text": "性别* 男 女",
            "selector": '[data-rf-index="3"]',
        },
    ]
    for control in FormEngine().snapshot_controls(controls):
        if relaxed_kind(control) is not None:
            assert FormEngine.skip_reason(control) is not None, control.type


@pytest.mark.parametrize(
    "raw",
    [
        {"index": 0, "type": "file", "label": "简历附件", "selector": '[data-rf-index="0"]'},
        {"index": 0, "type": "date", "label": "出生日期", "selector": '[data-rf-index="0"]'},
        {"index": 0, "type": "month", "label": "入职月份", "selector": '[data-rf-index="0"]'},
        {
            "index": 0,
            "type": "text",
            "label": "",
            "autocomplete": "new-password",
            "selector": '[data-rf-index="0"]',
        },
        {"index": 0, "type": "text", "label": "姓名", "selector": '[data-rf-index="0"]'},
    ],
)
def test_file_date_password_and_plain_text_are_never_relaxed(raw):
    """日期（含日历弹层）、文件上传、密码与普通文本框：放宽模式不碰。"""
    assert relaxed_kind(FormEngine().snapshot_controls([raw])[0]) is None


def test_popup_select_consent_and_fact_choices_are_classified():
    controls = FormEngine().snapshot_controls(
        [
            _popup(),
            {"index": 1, "type": "select", "label": "学历", "selector": '[data-rf-index="1"]'},
            _consent(2),
            {
                "index": 3,
                "type": "checkbox",
                "label": "无实习经历",
                "nearby_text": "无实习经历",
                "selector": '[data-rf-index="3"]',
            },
            {
                "index": 4,
                "type": "radio",
                "label": "女",
                "nearby_text": "性别* 男 女",
                "selector": '[data-rf-index="4"]',
            },
        ]
    )
    assert relaxed_kind(controls[0]) == "popup"
    assert relaxed_kind(controls[1]) == "select"
    assert relaxed_kind(controls[2]) == "confirm"
    assert relaxed_kind(controls[3]) == "confirm"
    assert relaxed_kind(controls[4]) == "choice"


# ===== 预览 =====


def test_a_matched_popup_becomes_a_relaxed_row_instead_of_blocked():
    snapshot = _snapshot([_popup()])

    report = build_preview(snapshot, {"target_city": "天津"}, relaxed=True)

    assert report.blocked == []
    assert len(report.items) == 1
    item = report.items[0]
    assert item.status == STATUS_RELAXED_READY
    assert item.field == "target_city"
    assert item.value == "天津"
    assert "放宽" in item.note


def test_the_same_popup_stays_blocked_when_relaxed_mode_is_off():
    """开关关闭：一条语义都不许变——弹层控件仍是「需要你自己点选」。"""
    snapshot = _snapshot([_popup()])

    report = build_preview(snapshot, {"city": "天津"})

    assert report.items == []
    assert len(report.blocked) == 1
    assert "点选" in report.blocked[0].field_label


def test_a_popup_without_a_matching_field_stays_blocked():
    """「神秘代号」压根认不出：留在 blocked（放宽三路分流见 test_webform_relaxed_round2）。"""
    snapshot = _snapshot([_popup(index=1, label="神秘代号", nearby_text="神秘代号*")])

    report = build_preview(snapshot, {}, relaxed=True)

    assert report.items == [] and report.missing_data == []
    assert len(report.blocked) == 1
    assert report.relaxed_ai_candidates == [1]


def test_a_native_select_is_matched_through_the_strict_option_resolver():
    snapshot = _snapshot(
        [
            {
                "index": 0,
                "type": "select",
                "label": "学历",
                "nearby_text": "学历*",
                "selector": '[data-rf-index="0"]',
                "options": [
                    {"v": "1", "t": "高中"},
                    {"v": "2", "t": "本科"},
                ],
            }
        ]
    )

    report = build_preview(snapshot, {"degree": "本科"}, relaxed=True)

    assert len(report.items) == 1
    assert report.items[0].status == STATUS_RELAXED_READY
    # 写入值落到选项的 value 上（回读校验认的也是它）；展示文本在 options 里。
    assert report.items[0].value == "2"
    # 选项列表原样带进预览行，用户可以手改成页面上真正存在的一项。
    assert [option["text"] for option in report.items[0].options] == ["高中", "本科"]


def test_declaration_checkboxes_become_needs_confirm_and_are_not_checked_by_default():
    """同意类与「无…经历」声明类都归「需确认」：代勾等于替用户表态，默认不勾。"""
    snapshot = _snapshot(
        [
            _consent(0),
            {
                "index": 1,
                "type": "checkbox",
                "label": "无实习经历",
                "nearby_text": "无实习经历",
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    report = build_preview(snapshot, {}, relaxed=True)

    assert report.blocked == []
    assert [item.status for item in report.items] == [
        STATUS_NEEDS_CONFIRM,
        STATUS_NEEDS_CONFIRM,
    ]
    assert default_selections(report) == []


def test_relaxed_ready_rows_are_checked_by_default_and_confirm_rows_are_not():
    snapshot = _snapshot([_popup(), _consent(1)])

    report = build_preview(snapshot, {"target_city": "天津"}, relaxed=True)

    selections = default_selections(report)
    assert [item.index for item in selections] == [0]
    assert selections[0].value == "天津"


def test_a_fact_radio_is_only_relaxed_when_the_value_matches_its_own_text():
    """事实类单选/复选只在"资料值与这个勾选框自述对得上"时代点——否则就是猜。"""
    snapshot = _snapshot(
        [
            {
                "index": 0,
                "type": "radio",
                "name": "g",
                "value": "男",
                "label": "男",
                "nearby_text": "性别* 男 女",
                "selector": '[data-rf-index="0"]',
            },
            {
                "index": 1,
                "type": "radio",
                "name": "g",
                "value": "女",
                "label": "女",
                "nearby_text": "性别* 男 女",
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    report = build_preview(snapshot, {"gender": "女"}, relaxed=True)

    assert [item.index for item in report.items] == [1]
    assert report.items[0].status == STATUS_RELAXED_READY
    # 没被代点的那个仍留在 blocked，理由不变。
    assert [item.index for item in report.blocked] == [0]


def test_file_and_date_controls_stay_blocked_even_when_relaxed():
    snapshot = _snapshot(
        [
            {"index": 0, "type": "file", "label": "简历附件", "selector": '[data-rf-index="0"]'},
            {"index": 1, "type": "date", "label": "出生日期", "selector": '[data-rf-index="1"]'},
        ]
    )

    report = build_preview(snapshot, {}, relaxed=True)

    assert report.items == []
    assert len(report.blocked) == 2
    assert any("文件" in item.field_label for item in report.blocked)
    assert any("日期" in item.field_label for item in report.blocked)


# ===== 填充 =====


class ClickableFakeClient(FakeLiveClient):
    """替身点击：rf:click-rect 给出坐标，回读永远已勾选。"""

    def evaluate(self, expression, *, timeout=None):
        if "rf:click-rect" in expression:
            self.expressions.append(expression)
            return json.dumps({"ok": True, "x": 10, "y": 10})
        if "rf:read-back" in expression:
            self.expressions.append(expression)
            return json.dumps({"ok": True, "checked": True})
        return super().evaluate(expression, timeout=timeout)


def test_a_confirmed_declaration_checkbox_is_clicked_on_fill():
    """用户在预览里勾了「需确认」行 → fill 阶段执行代点（点击而非写值），回读已勾选。"""
    client = ClickableFakeClient()
    snapshot = _snapshot([_consent()])

    outcomes = apply_fill(
        client,
        snapshot,
        [FillSelection(index=0, field="", value="我已阅读并同意隐私政策")],
    )

    assert outcomes[0].status == "filled"
    assert any("rf:click-rect" in expression for expression in client.expressions)
    assert not any("rf:set-value" in expression for expression in client.expressions)


def test_fill_writes_in_dom_order_so_parent_selects_resolve_first():
    """依赖顺序：写入按 DOM 序（省份先于城市）。这与放宽代选的准确率直接相关。"""
    client = FakeLiveClient()
    snapshot = _snapshot(
        [
            {"index": 0, "type": "text", "label": "姓名", "selector": '[data-rf-index="0"]'},
            {
                "index": 1,
                "type": "text",
                "label": "意向城市",
                "nearby_text": "意向城市*",
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    apply_fill(
        client,
        snapshot,
        [
            FillSelection(index=1, field="city", value="天津"),
            FillSelection(index=0, field="name", value="张三"),
        ],
    )

    write_order = [expression for expression in client.expressions if "rf:set-value" in expression]
    assert 'data-rf-index=\\"0\\"' in write_order[0]
    assert 'data-rf-index=\\"1\\"' in write_order[1]


# ===== 实时面板 =====


def test_live_panel_offers_click_for_me_for_a_declaration_checkbox_when_relaxed():
    client = FakeLiveClient()
    session = LiveSession(client, {}, relaxed_mode_loader=lambda: True)
    session.start()
    try:
        client.focus_on(
            raw_control(
                type="checkbox",
                label="我已阅读并同意隐私政策",
                nearby_text="我已阅读并同意隐私政策",
            )
        )
        session._tick()

        panel = client.panels[-1]
        assert panel["status"] == "matched"
        assert panel["accept_label"] == "帮我勾选：我已阅读并同意隐私政策"
        assert "本人确认" in panel["note"]
    finally:
        session.stop()


def test_live_accept_of_the_confirm_button_clicks_the_checkbox():
    """点按「帮我勾选」即视为用户确认：执行代点并回读验证，成功如实回报。"""
    client = ClickableFakeClient()
    session = LiveSession(client, {}, relaxed_mode_loader=lambda: True)
    session.start()
    try:
        client.focus_on(
            raw_control(
                type="checkbox",
                label="我已阅读并同意隐私政策",
                nearby_text="我已阅读并同意隐私政策",
            )
        )
        session._tick()
        client.accept = {"value": client.panels[-1]["value"]}
        session._tick()

        assert any("rf:click-rect" in expression for expression in client.expressions)
        assert client.panels[-1]["status"] == "filled"
    finally:
        session.stop()


def test_live_panel_keeps_the_blocked_wording_when_relaxed_mode_is_off():
    client = FakeLiveClient()
    session = LiveSession(client, {})
    session.start()
    try:
        client.focus_on(
            raw_control(
                type="checkbox",
                label="我已阅读并同意隐私政策",
                nearby_text="我已阅读并同意隐私政策",
            )
        )
        session._tick()

        assert client.panels[-1]["status"] == "blocked"
    finally:
        session.stop()


def test_live_panel_offers_the_value_for_a_popup_control_when_relaxed():
    client = FakeLiveClient()
    session = LiveSession(client, {"target_city": "天津"}, relaxed_mode_loader=lambda: True)
    session.start()
    try:
        client.focus_on(
            raw_control(label="意向城市", nearby_text="意向城市*", readonly=True, has_popup=True)
        )
        session._tick()

        panel = client.panels[-1]
        assert panel["status"] == "matched"
        assert panel["value"] == "天津"
        assert "放宽" in panel["note"]
        assert panel["accept_label"] == ""
    finally:
        session.stop()


def test_a_date_picker_stays_blocked_in_live_mode_even_when_relaxed():
    client = FakeLiveClient()
    session = LiveSession(client, {}, relaxed_mode_loader=lambda: True)
    session.start()
    try:
        client.focus_on(raw_control(type="date", label="出生日期", nearby_text="出生日期*"))
        session._tick()

        assert client.panels[-1]["status"] == "blocked"
    finally:
        session.stop()


# ===== 开关本身 =====


def test_relaxed_mode_setting_defaults_to_off_and_survives_a_save(client, db_session):
    """默认关；保存后重读一致（脏数据也回落到关）。"""
    assert client.get("/api/settings/webform-relaxed-mode").json() == {"enabled": False}
    assert get_webform_relaxed_mode(db_session) is False

    response = client.put("/api/settings/webform-relaxed-mode", json={"enabled": True})
    assert response.status_code == 200
    assert response.json() == {"enabled": True}
    db_session.expire_all()
    assert get_webform_relaxed_mode(db_session) is True
    assert client.get("/api/settings/webform-relaxed-mode").json() == {"enabled": True}

    save_webform_relaxed_mode(db_session, False)
    db_session.expire_all()
    assert get_webform_relaxed_mode(db_session) is False


def test_the_preview_route_reads_the_setting(client, browser_port, db_session):
    from app.models.profile import UserProfile

    db_session.add(UserProfile(target_city="天津"))
    db_session.commit()
    snapshot = get_snapshot_store().save(
        FormEngine().snapshot_controls([_popup()]), url="https://x/apply", title="网申"
    )

    # 默认关：弹层控件仍在 blocked。
    body = client.post("/api/webform/preview", json={"snapshot_id": snapshot.id}).json()
    assert body["items"] == []
    assert len(body["blocked"]) == 1

    # 开启后进预览行，且默认勾选列表里带上它。
    client.put("/api/settings/webform-relaxed-mode", json={"enabled": True})
    body = client.post("/api/webform/preview", json={"snapshot_id": snapshot.id}).json()
    assert body["blocked"] == []
    assert [item["status"] for item in body["items"]] == [STATUS_RELAXED_READY]
    assert body["default_indexes"] == [0]


def test_rebuild_mapping_accepts_the_confirm_selection():
    """「帮我勾选」走到 apply_fill 的入口（_rebuild_mapping）不返回 None
    ——否则用户点了按钮却被静默丢掉，比失败更糟。"""
    control = FormEngine().snapshot_controls([_consent()])[0]
    assert _rebuild_mapping(control, "", "我已阅读并同意隐私政策") is not None
