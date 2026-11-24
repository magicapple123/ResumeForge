# SPDX-License-Identifier: Apache-2.0
"""原条目 8 A1：账号备注（`AppSetting` KV `login_account.<host>`，**不建表、不迁移**）。

四条契约：
1. 读写 / 去首尾空白；空串 = **清除**（删行，不留空值）；
2. 上限 64 字符，超长按前缀截断（不报错、也不整段丢掉）；
3. 备注跟着 host 走：站点行与「投递浏览器」行用同一条，汇总行**没有**自己的账号；
4. host 会拼进 KV 的键名：非法 host 一律拒绝，不给任意写键留口子。

从 `test_login_status.py` 按 500 行预算拆出（纯搬迁，用例数与断言逐条不变）。
"""

from __future__ import annotations

import pytest
from app.services import login_status, login_status_sites
from tests.login_status_fixtures import _visit

# ===== 原条目 8 A1：账号备注（AppSetting KV，不建表）=====


def test_account_note_roundtrip_strips_and_clears(db_session):
    """读写 / 去首尾空白 / 空串 = 清除；清除必须**删行**，不能留一条空值。"""
    from app.models.setting import AppSetting

    assert login_status.read_account_note(db_session, "app.mokahr.com") == ""

    login_status.write_account_note(db_session, "app.mokahr.com", "  张三 zhangsan@example.com  ")
    assert login_status.read_account_note(db_session, "mokahr.com") == ""
    assert (
        login_status.read_account_note(db_session, "app.mokahr.com") == "张三 zhangsan@example.com"
    )

    assert login_status.write_account_note(db_session, "app.mokahr.com", "   ") == ""
    assert login_status.read_account_note(db_session, "app.mokahr.com") == ""
    assert db_session.get(AppSetting, "login_account.app.mokahr.com") is None


def test_account_note_is_truncated_to_64_chars(db_session):
    """上限 64 字符：超长按前缀截断（不报错、也不整段丢掉）。"""
    saved = login_status.write_account_note(db_session, "app.mokahr.com", "x" * 65)

    assert saved == "x" * login_status.MAX_ACCOUNT_NOTE
    assert login_status.read_account_note(db_session, "app.mokahr.com") == "x" * 64


def test_account_note_requires_a_host(db_session):
    with pytest.raises(ValueError):
        login_status.write_account_note(db_session, "", "x")
    assert login_status.read_account_note(db_session, "") == ""


def test_empty_host_has_no_account_note_key(db_session):
    """没有 host（探测地址为空）时不能写出 `login_account.` 这种无名键。"""
    from app.models.setting import AppSetting

    assert login_status.read_account_note(db_session, "") == ""
    assert db_session.query(AppSetting).filter(AppSetting.key.like("login_account.%")).count() == 0


def test_sites_and_source_rows_carry_the_account_note(db_session):
    """备注跟着 host 走：站点行与「投递浏览器」行用同一条。"""
    _visit(db_session, "https://app.mokahr.com/jobs", "Moka", minutes=1)
    login_status.write_account_note(db_session, "app.mokahr.com", "张三")
    login_status.set_probe_url(db_session, "apply_browser", "https://www.zhipin.com/jobs")
    login_status.write_account_note(db_session, "www.zhipin.com", "BOSS 号")

    sites = login_status_sites.webform_sites(db_session)
    rows = {row["id"]: row for row in login_status.list_statuses(db_session)}

    assert sites[0]["host"] == "app.mokahr.com"
    assert sites[0]["account"] == "张三"
    assert rows["apply_browser"]["host"] == "www.zhipin.com"
    assert rows["apply_browser"]["account"] == "BOSS 号"


def test_aggregate_parent_row_does_not_borrow_a_site_account(db_session):
    """汇总行没有"自己的"账号：备注按 host，逐站点各自带着。"""
    _visit(db_session, "https://app.mokahr.com/jobs", "Moka", minutes=1)
    login_status.write_account_note(db_session, "app.mokahr.com", "张三")

    row = next(
        item for item in login_status.list_statuses(db_session) if item["id"] == "webform_browser"
    )

    assert row["sites"][0]["account"] == "张三"
    assert (row["host"], row["account"]) == ("", "")


def test_account_note_api_roundtrip_and_truncation(client):
    host = "app.mokahr.com"

    assert client.get(f"/api/login-status/accounts/{host}").json() == {"host": host, "note": ""}

    saved = client.put(f"/api/login-status/accounts/{host}", json={"note": "y" * 65})
    assert saved.status_code == 200
    assert saved.json() == {"host": host, "note": "y" * 64}
    assert client.get(f"/api/login-status/accounts/{host}").json()["note"] == "y" * 64

    cleared = client.put(f"/api/login-status/accounts/{host}", json={"note": ""})
    assert cleared.json() == {"host": host, "note": ""}
    assert client.get(f"/api/login-status/accounts/{host}").json()["note"] == ""


def test_account_note_api_normalises_the_host(client):
    response = client.put("/api/login-status/accounts/APP.MokaHR.com", json={"note": "张三"})

    assert response.status_code == 200
    assert response.json()["host"] == "app.mokahr.com"


@pytest.mark.parametrize("host", ["bad_host!", "a b.com", "-a.com", "a..com", "127.0.0.1:8080"])
def test_account_note_api_rejects_bad_host(client, host):
    """host 会拼进 KV 的键名：斜杠 / 空白 / 端口一律拒绝，不给任意写键留口子。"""
    response = client.put(f"/api/login-status/accounts/{host}", json={"note": "x"})

    assert response.status_code in (400, 404, 422)
