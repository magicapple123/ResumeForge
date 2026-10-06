"""逐框记忆的浏览器内联编辑与实时自定义字段识别回归。"""

from app.services.webform.live import LiveSession
from test_webform_live import FakeLiveClient, raw_control


def test_browser_editor_receives_existing_targets_and_reinstalls_after_navigation():
    client = FakeLiveClient()
    targets = [{"target_id": "extra:height", "source": "extra", "group": "身体情况",
                "label": "身高(cm)", "value": "178", "field_key": "height"}]
    session = LiveSession(client, {"height": "178"}, memory_targets=targets)
    session.start()
    try:
        scripts = "\n".join(client.expressions)
        assert "rf:live-memory-targets" in scripts
        assert "rf:live-memory-editor" in scripts
        assert "extra:height" in scripts

        client.expressions.clear()
        client.installed = False
        session._tick()
        scripts = "\n".join(client.expressions)
        assert "rf:live-memory-targets" in scripts
        assert "rf:live-memory-editor" in scripts
    finally:
        session.stop()


def test_editor_choice_uses_custom_label_and_can_override_a_recognized_target():
    client = FakeLiveClient()
    saved = []
    session = LiveSession(client, {"name": "原值"}, store=lambda entry: saved.append(entry.copy()) or True)
    session.start()
    try:
        control = raw_control(label="姓名")
        client.focus_on(control)
        session._tick()
        client.remember_on(control, "新值")
        client.remember["target_id"] = "custom"
        client.remember["label"] = "自定义测试代号"
        session._tick()
        assert saved == [{"key": "name", "target_id": "custom", "label": "自定义测试代号", "value": "新值"}]
        assert client.panels[-1]["status"] == "matched"
    finally:
        session.stop()


def test_unknown_field_defaults_to_original_form_label_even_when_ai_guesses_wrong():
    client = FakeLiveClient()
    saved = []
    session = LiveSession(client, {}, store=lambda entry: saved.append(entry.copy()) or True)
    session.start()
    try:
        control = raw_control(label="测评流水号")
        client.focus_on(control)
        session._tick()
        client.remember_on(control, "智能系统实验室", label="AI 错认的字段")
        session._tick()
        assert saved[0]["key"] == "CUSTOM_测评流水号"
        assert saved[0]["label"] == "测评流水号"
    finally:
        session.stop()


def test_renamed_custom_field_is_suggested_on_exact_label_and_deleted_one_is_not():
    client = FakeLiveClient()
    custom_key = "CUSTOM_新实验室"
    current_catalog = [{"group": "自定义", "label": "旧实验室", "value": "旧值", "key": "CUSTOM_旧实验室"}]

    def load_data():
        return {item["key"]: item["value"] for item in current_catalog}, list(current_catalog)

    session = LiveSession(client, {}, data_loader=load_data)
    session.start()
    try:
        current_catalog[:] = [{"group": "自定义", "label": "新实验室", "value": "新值", "key": custom_key}]
        client.focus_on(raw_control(label="新实验室"))
        session._tick()
        assert client.panels[-1]["value"] == "新值"

        client.focus_on(raw_control(label="旧实验室"))
        session._tick()
        assert client.panels[-1]["status"] == "unmatched"

        current_catalog.clear()
        client.focus_on(raw_control(label="新实验室"))
        session._tick()
        assert client.panels[-1]["status"] == "unmatched"
    finally:
        session.stop()


def test_ambiguous_custom_labels_are_not_suggested():
    client = FakeLiveClient()
    catalog = [
        {"group": "自定义", "label": "实验室", "value": "A", "key": "CUSTOM_A"},
        {"group": "自定义", "label": "实 验 室", "value": "B", "key": "CUSTOM_B"},
    ]
    session = LiveSession(client, {"CUSTOM_A": "A", "CUSTOM_B": "B"}, catalog)
    session.start()
    try:
        client.focus_on(raw_control(label="实验室"))
        session._tick()
        assert client.panels[-1]["status"] == "unmatched"
    finally:
        session.stop()
