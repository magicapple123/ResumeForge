# SPDX-License-Identifier: Apache-2.0
"""「投投悬浮球」设置的契约用例（自 `test_api_settings.py` 拆出）。

拆出来的理由很实际：那个文件本来 500 行，Q9 加了 `selection_enabled` 之后断言变长、
越过了测试文件的行数闸门（`test_file_size_budget` 对测试文件同样计 500 行）。
这两条用例只依赖 `client` / `db_session` 两个 conftest 夹具，搬出来不改变任何约束。

**三条口径必须钉住**（老数据兼容是这里唯一会退化的事）：
1. 存量裸 bool 读回时，新字段落默认 `True`，老用户的划词体验与升级前一致；
2. 损坏 JSON / 非法对象不 500，回默认值；
3. 整份返回是**三个字段**，少一个前端就静默丢开关。
"""

from app.models.setting import AppSetting


def test_assistant_orb_setting_defaults_and_roundtrips(client):
    # Q9 起多一个 selection_enabled（划词动作条的独立开关），默认开。
    assert client.get("/api/settings/assistant-orb").json() == {
        "enabled": True,
        "tips_enabled": True,
        "selection_enabled": True,
    }

    response = client.put(
        "/api/settings/assistant-orb",
        json={"enabled": False, "tips_enabled": False, "selection_enabled": False},
    )
    assert response.status_code == 200
    assert response.json() == {
        "enabled": False,
        "tips_enabled": False,
        "selection_enabled": False,
    }
    assert client.get("/api/settings/assistant-orb").json() == {
        "enabled": False,
        "tips_enabled": False,
        "selection_enabled": False,
    }

    response = client.put("/api/settings/assistant-orb", json={"enabled": True})
    assert response.status_code == 200
    # 旧客户端只发 enabled：新字段落默认值，不丢字段、不 500。
    assert response.json() == {
        "enabled": True,
        "tips_enabled": True,
        "selection_enabled": True,
    }


def test_assistant_orb_setting_keeps_legacy_bare_boolean_and_corrupt_values(client, db_session):
    """存量三种形态：裸 bool（老格式原样兼容）、损坏 JSON、非法对象——都不 500。"""

    # 老格式：裸 bool。入口开关读同值，标语保持默认开（老用户体验不变）。
    db_session.add(AppSetting(key="assistant_orb_enabled", value="false"))
    db_session.commit()
    assert client.get("/api/settings/assistant-orb").json() == {
        "enabled": False,
        "tips_enabled": True,
        "selection_enabled": True,
    }

    db_session.get(AppSetting, "assistant_orb_enabled").value = '"not-a-boolean"'
    db_session.commit()
    assert client.get("/api/settings/assistant-orb").json() == {
        "enabled": True,
        "tips_enabled": True,
        "selection_enabled": True,
    }

    # 对象形态但字段非法（enabled 不是 bool）：校验不过也回默认，不抛异常。
    db_session.get(AppSetting, "assistant_orb_enabled").value = '{"enabled": "yes"}'
    db_session.commit()
    assert client.get("/api/settings/assistant-orb").json() == {
        "enabled": True,
        "tips_enabled": True,
        "selection_enabled": True,
    }

    # 新格式对象：三个开关都原样读回。
    db_session.get(
        AppSetting, "assistant_orb_enabled"
    ).value = '{"enabled": false, "tips_enabled": false, "selection_enabled": false}'
    db_session.commit()
    assert client.get("/api/settings/assistant-orb").json() == {
        "enabled": False,
        "tips_enabled": False,
        "selection_enabled": False,
    }
