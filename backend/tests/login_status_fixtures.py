# SPDX-License-Identifier: Apache-2.0
"""登录状态用例的共享脚手架：造一条"填过"记录 / "打开过"记录 / 桩掉浏览器读取。

单独成文件而不是留在 `test_login_status.py`：那份用例已经按 500 行预算拆成
`test_login_status.py`（面板状态 / `unknown` 原因）、`test_login_status_sites.py`
（网申逐站点与受限页）、`test_login_account_note.py`（账号备注），三份都要用这三个
helper。命名沿用仓库既有约定（`resume_render_fixtures.py` 也是同一种角色）。

它们只写数据库 / 打 monkeypatch，不做断言——断言留在各自用例里，失败点才清楚。
"""

from __future__ import annotations

from app.services import login_status_sites


def _fill(db, url: str, title: str, *, minutes: int) -> None:
    """造一条网申填充记录（`page_title` 是"真的填过"的证据，也是显示名来源）。"""
    from datetime import datetime, timedelta

    from app.models.web_form_record import WebFormFillRecord

    db.add(
        WebFormFillRecord(
            url=url,
            page_title=title,
            items=[],
            page_snapshot=[],
            filled=1,
            created_at=datetime(2026, 11, 13, 12, 0) - timedelta(minutes=minutes),
        )
    )
    db.commit()


def _visit(db, url: str, title: str, *, minutes: int) -> None:
    """造一条网址历史（"打开过"，显示名与探测 URL 的次选来源）。"""
    from datetime import datetime, timedelta

    from app.models.web_form_url_history import WebFormUrlHistory

    stamp = datetime(2026, 11, 13, 12, 0) - timedelta(minutes=minutes)
    db.add(WebFormUrlHistory(url=url, title=title, created_at=stamp, last_used_at=stamp))
    db.commit()


def _stub_state(monkeypatch, state: dict, opened: list[str]) -> None:
    """把"浏览器读到什么"桩掉；判定仍走真实的 `_judge`。`opened` 记录真正打开的地址。"""

    def fake_read(_db, url: str) -> dict:
        opened.append(url)
        return state

    monkeypatch.setattr(login_status_sites, "_read_state", fake_read)
