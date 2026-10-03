import json

from app.services.webform.custom_select import select_combobox_option


class FakePopupClient:
    def __init__(self, options):
        self.options = options
        self.clicked_selectors: list[str] = []
        self.sent: list[tuple[str, dict]] = []

    def evaluate(self, expression, *, timeout=None):
        if "rf:click-rect" in expression:
            self.clicked_selectors.append(expression)
            return json.dumps({"ok": True, "x": 10, "y": 10})
        if "rf:combobox-options" in expression:
            return json.dumps({"ok": True, "options": self.options})
        if "rf:combobox-cleanup" in expression:
            return "1"
        return None

    def send(self, method, params=None, *, timeout=None):
        self.sent.append((method, dict(params or {})))
        return {}


def test_custom_combobox_clicks_the_unique_matching_option():
    client = FakePopupClient(
        [
            {"value": "male", "text": "男", "selector": "[data-rf-option-token=\"a-0\"]"},
            {"value": "female", "text": "女", "selector": "[data-rf-option-token=\"a-1\"]"},
        ]
    )

    result = select_combobox_option(client, "#gender", "男")

    assert result.status == "matched"
    assert result.option is not None and result.option.value == "male"
    assert any("Input.dispatchMouseEvent" == method for method, _params in client.sent)


def test_custom_combobox_refuses_ambiguous_options():
    client = FakePopupClient(
        [
            {"value": "1", "text": "本科及以上"},
            {"value": "2", "text": "本科以下"},
        ]
    )

    result = select_combobox_option(client, "#degree", "本科")

    assert result.status == "ambiguous"
    assert result.option is None
