# SPDX-License-Identifier: Apache-2.0
"""制作台「行内格式预览」设置：默认关、可开、脏数据回落。

这条设置决定失焦字段是否切成静态富文本块（见 `features/resume/editor/InlineMarkStatic.tsx`）。
默认必须是 **false**：打开后每次点进字段都会多一拍，不能替用户默认打开。
"""

from __future__ import annotations

from app.models.setting import AppSetting

URL = "/api/settings/inline-format-preview"
KEY = "editor_inline_format_preview"


def _put(client, enabled: bool) -> dict:
    response = client.put(URL, json={"enabled": enabled})
    assert response.status_code == 200, response.text
    return response.json()


def _get(client) -> dict:
    response = client.get(URL)
    assert response.status_code == 200, response.text
    return response.json()


def test_defaults_to_off(client):
    """没写过这一行时读到的必须是关（出厂值来自注册表，不是内联字面量）。"""
    assert _get(client) == {"enabled": False}


def test_round_trip(client):
    """PUT true → GET true；PUT false → GET false（不是只写不读）。"""
    assert _put(client, True) == {"enabled": True}
    assert _get(client) == {"enabled": True}
    assert _put(client, False) == {"enabled": False}
    assert _get(client) == {"enabled": False}


def test_corrupt_value_falls_back_to_off(client, db_session):
    """脏数据（非 JSON / 非布尔）一律回落 false，不把 "1" 当成开。"""
    for dirty in ("not json", '"1"', "1", "null"):
        row = db_session.get(AppSetting, KEY)
        if row is None:
            db_session.add(AppSetting(key=KEY, value=dirty))
        else:
            row.value = dirty
        db_session.commit()
        assert _get(client) == {"enabled": False}, dirty
