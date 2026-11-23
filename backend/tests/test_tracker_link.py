# SPDX-License-Identifier: Apache-2.0
"""求职进度的「关联链接」（``application_track.link``）。

这条字段是**被删掉的「状态回读」的替代品**：不再由程序去门户页猜进度，而是把用户需要的
那个入口链接留在记录上。因为它会被渲染成 ``<a href target="_blank">``，校验是安全边界而
不是格式洁癖——放行 ``javascript:`` 等于把用户输入变成可执行脚本。

钉四件事：

1. 创建 / 更新 / 列表都真的带回 ``link``（漏一处就是"保存后链接消失"）；
2. 提交前 ``trim``，空串合法（两个字段都是选填，"清空"是正常动作）；
3. 只放行 http/https 且有 host；``javascript:`` / ``file:`` / ``ftp:`` / 无 host 一律 422；
4. **识别导入的更新保留已有 link**：导入走 ``_merge_into``（只改通知带来的字段），
   不经过 ``_apply_payload``，所以不会把用户手填的链接抹掉。
"""

from __future__ import annotations

import pytest
from app.schemas.common import validate_http_url
from app.schemas.tracker import TrackCreate, TrackUpdate
from app.services.tracker_merge import _apply_payload

VALID = {
    "company": "示例科技",
    "title": "后端开发实习生",
    "status": "applied",
    "applied_at": "2026-09-18",
}


# ===== 契约：创建 / 更新 / 列表 =====


def test_link_survives_create_read_and_list(client):
    created = client.post("/api/tracker", json={**VALID, "link": "https://jobs.example.com/a/1"})
    assert created.status_code == 201
    assert created.json()["link"] == "https://jobs.example.com/a/1"
    track_id = created.json()["id"]

    assert client.get(f"/api/tracker/{track_id}").json()["link"] == "https://jobs.example.com/a/1"

    page = client.get("/api/tracker/page").json()
    assert [item["link"] for item in page["items"]] == ["https://jobs.example.com/a/1"]

    # 不带 link 的历史客户端仍然能建记录：默认空串，不是 422。
    legacy = client.post("/api/tracker", json={**VALID, "title": "另一个岗位"})
    assert legacy.status_code == 201
    assert legacy.json()["link"] == ""


def test_update_replaces_the_link_and_an_empty_string_clears_it(client):
    track_id = client.post(
        "/api/tracker", json={**VALID, "link": "https://a.example.com/1"}
    ).json()["id"]

    updated = client.put(
        f"/api/tracker/{track_id}", json={**VALID, "link": "https://b.example.com/2"}
    )
    assert updated.status_code == 200 and updated.json()["link"] == "https://b.example.com/2"

    # PUT 是整体替换语义：空串 = 用户清空了链接，必须尊重这个动作。
    cleared = client.put(f"/api/tracker/{track_id}", json={**VALID, "link": ""})
    assert cleared.status_code == 200 and cleared.json()["link"] == ""


def test_link_is_trimmed_before_it_is_stored(client):
    """粘贴来的链接常带首尾空格/换行；留着会让 ``href`` 指向一个相对路径。"""
    created = client.post(
        "/api/tracker", json={**VALID, "link": "  https://jobs.example.com/a/1\n "}
    )
    assert created.status_code == 201
    assert created.json()["link"] == "https://jobs.example.com/a/1"


# ===== 校验：安全边界 =====


@pytest.mark.parametrize(
    "bad",
    [
        "javascript:alert(1)",
        "file:///C:/secret.txt",
        "ftp://example.com/resume.pdf",
        # 没有 host 的 http 地址：前端拼不出可点的链接，点了也是死链。
        "https://",
        "https:///路径",
    ],
)
def test_dangerous_or_hostless_links_are_rejected(bad):
    with pytest.raises(ValueError):
        TrackCreate(**VALID, link=bad)


def test_http_and_https_are_both_accepted():
    assert TrackCreate(**VALID, link="http://a.example.com/x").link == "http://a.example.com/x"
    assert TrackCreate(**VALID, link="HTTPS://A.example.com/x").link == "HTTPS://A.example.com/x"


def test_link_length_is_capped_at_the_column_width():
    """2048 是列宽；超一格就该 422，而不是等 SQLite 截断成半条 URL。"""
    ok = "https://example.com/" + "a" * (2048 - len("https://example.com/"))
    assert len(ok) == 2048
    assert TrackCreate(**VALID, link=ok).link == ok

    with pytest.raises(ValueError):
        TrackCreate(**VALID, link=ok + "a")


def test_the_shared_validator_word_for_word_errors():
    """错误文案按字段参数化：岗位「投递链接」/ 进度「关联链接」同一份实现。"""
    with pytest.raises(ValueError, match="关联链接只支持 HTTP 或 HTTPS 地址"):
        validate_http_url("javascript:alert(1)", "关联链接")
    with pytest.raises(ValueError, match="投递链接只支持 HTTP 或 HTTPS 地址"):
        validate_http_url("file:///c:/x", "投递链接")
    assert validate_http_url("   ", "关联链接") == ""


# ===== 写入落点：_apply_payload =====


def test_apply_payload_writes_the_link_onto_the_record(db_session):
    """``_apply_payload`` 是 track 字段写入的唯一实现：漏这一行 = 保存后链接永远是空串。"""
    from app.models.tracker import ApplicationTrack

    record = ApplicationTrack()
    _apply_payload(record, TrackUpdate(**VALID, link="https://jobs.example.com/a/1"))
    assert record.link == "https://jobs.example.com/a/1"

    # 再写一次空串（用户清空）：必须跟着变空，不能"只写非空"。
    _apply_payload(record, TrackUpdate(**VALID, link=""))
    assert record.link == ""


# ===== 识别导入不吞掉手填的链接 =====


def test_recognized_import_update_keeps_the_link_the_user_typed(client):
    """导入的更新走 ``_merge_into``，只改通知带来的字段——手填的链接不该被抹掉。"""
    track_id = client.post(
        "/api/tracker", json={**VALID, "link": "https://jobs.example.com/a/1"}
    ).json()["id"]

    applied = client.post(
        "/api/tracker/apply",
        json={
            "items": [
                {"company": "示例科技", "title": "后端开发实习生", "status": "interview"},
            ],
            "source": "recognized",
        },
    )
    assert applied.status_code == 200
    assert applied.json()["updated"] == 1

    assert client.get(f"/api/tracker/{track_id}").json()["link"] == "https://jobs.example.com/a/1"
