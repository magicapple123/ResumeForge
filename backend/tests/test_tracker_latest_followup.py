# SPDX-License-Identifier: Apache-2.0
"""CR-19：进度行上的「已联系 · 11-25」（``TrackOut.latest_followup``）。

跟进决策（``application_follow_up``）本来只在巡检卡里用；首页任务卡把"这张卡指向的
岗位"接到求职进度之后，进度行要回答"我最近一次联系它是什么时候"——否则用户点进
``/tracker?job_id=`` 只看到一堆状态，看不出跟进的痕迹。

口径（刻意收窄）：

- 只认 ``contacted``：`replied` / `stopped` 是"对方回了 / 不跟了"，把它们显示成
  「已联系」是在替用户说没发生过的事；
- 只取**最近**一条：一行只放得下一个日期；
- 一次批查询补齐，不逐行查库（列表最多 100 行）。
"""

from __future__ import annotations

from datetime import datetime

from app.models.followup import ApplicationFollowUp
from app.models.tracker import ApplicationTrack, normalize_key


def _make_track(company: str) -> ApplicationTrack:
    return ApplicationTrack(
        company=company,
        title="后端开发",
        company_key=normalize_key(company),
        title_key=normalize_key("后端开发"),
        status="applied",
    )


def _rows_by_company(client) -> dict[str, dict]:
    response = client.get("/api/tracker/page")
    assert response.status_code == 200, response.text
    return {item["company"]: item for item in response.json()["items"]}


def test_latest_followup_is_the_most_recent_contacted_decision(client, db_session):
    track = _make_track("甲公司")
    db_session.add(track)
    db_session.commit()
    db_session.add_all(
        [
            ApplicationFollowUp(
                track_id=track.id,
                decision="contacted",
                decided_at=datetime(2026, 11, 10, 9, 0, 0),
            ),
            ApplicationFollowUp(
                track_id=track.id,
                decision="contacted",
                decided_at=datetime(2026, 11, 25, 9, 0, 0),
            ),
            ApplicationFollowUp(
                track_id=track.id,
                decision="replied",
                decided_at=datetime(2026, 11, 26, 9, 0, 0),
            ),
        ]
    )
    db_session.commit()

    rows = _rows_by_company(client)
    assert rows["甲公司"]["latest_followup"] == "2026-11-25T09:00:00"


def test_latest_followup_null_without_contacted_decision(client, db_session):
    """只有 replied / stopped 的进度不算「已联系」。"""
    track = _make_track("乙公司")
    db_session.add(track)
    db_session.commit()
    db_session.add(
        ApplicationFollowUp(
            track_id=track.id,
            decision="stopped",
            decided_at=datetime(2026, 11, 20, 9, 0, 0),
        )
    )
    db_session.commit()

    rows = _rows_by_company(client)
    assert rows["乙公司"]["latest_followup"] is None


def test_latest_followup_absent_for_untouched_track(client, db_session):
    db_session.add(_make_track("丙公司"))
    db_session.commit()

    rows = _rows_by_company(client)
    assert rows["丙公司"]["latest_followup"] is None
