# SPDX-License-Identifier: Apache-2.0
"""桌面版「托盘图标跟随系统主题」设置（WF-20 兜底开关）。

三件事必须成立：默认关（缺失即出厂值）、能持久化、恢复默认后回到关。
默认关本身是产品决定——托盘默认跟应用内主题，浅色任务栏配暗色界面时才需要打开。
"""

from __future__ import annotations


def test_tray_icon_follow_system_default_and_toggle(client):
    # 缺失时默认关闭（注册表出厂值 False）。
    assert client.get("/api/settings/tray-icon-follow-system").json() == {"enabled": False}

    # 打开后持久化。
    assert client.put("/api/settings/tray-icon-follow-system", json={"enabled": True}).json() == {
        "enabled": True
    }
    assert client.get("/api/settings/tray-icon-follow-system").json() == {"enabled": True}

    # 关回去同样持久化（不是"只能打开一次"）。
    assert client.put("/api/settings/tray-icon-follow-system", json={"enabled": False}).json() == {
        "enabled": False
    }
    assert client.get("/api/settings/tray-icon-follow-system").json() == {"enabled": False}


def test_tray_icon_follow_system_is_resettable(client):
    """恢复默认（删行）之后必须回到"关"——否则这张卡的恢复默认按钮是假的。"""
    assert client.put("/api/settings/tray-icon-follow-system", json={"enabled": True}).json() == {
        "enabled": True
    }
    reset = client.post("/api/settings/reset", json={"keys": ["tray_icon_follow_system"]})
    assert reset.status_code == 200, reset.text
    assert client.get("/api/settings/tray-icon-follow-system").json() == {"enabled": False}
