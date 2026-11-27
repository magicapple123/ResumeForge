# SPDX-License-Identifier: Apache-2.0
"""T30：投递台用**外部简历原件**投递（迁移 0032 / 0033 的消费端）。

守五件事（对应任务卡的五项验收）：

1. **队列行能选外部简历并存住**：``PATCH /api/apply/queue/{id}`` 写
   ``apply_queue_item.external_resume_id``，重新 ``GET /queue`` 仍回显（刷新不丢）。
2. **内外互斥是 422 不是 500**：两个 id 同时给 → 422 + 同一句中文文案；
   ``POST /queue`` 与 ``PATCH /queue/{id}`` 两条写路径都要挡。
3. **指向已失效的外部简历也 422**：软删过的 / 从来没存在过的 id，都不许落到执行期。
4. **附件取 ``file_id``，不复制字节**：记录里存 ``external_resume_id``，``file_id`` 由它
   1:1 推出；``GET /api/user-files/{file_id}/raw`` 能下到原件字节。
5. **只有 external_resume_id 时下游不崩**：投递记录列表、批次明细与"写入求职进度"
   都照常，且进度上也带着这份外部简历的关联（``application_track.external_resume_id``）。

造数据只用应用自己的 HTTP 接口（BRIEF §2）：外部简历走 ``POST /api/external-resumes``。
"""

import pytest
from app.models.tracker import ApplicationTrack
from test_apply_queue_and_api import (  # noqa: F401 - pytest 夹具复用（fake_runner 依赖 browser_port）
    _job,
    browser_port,
    fake_runner,
)

# 再导出（ruff）：被导入的夹具在用例参数里同名出现是 pytest 的正常用法，
# 写进 ``__all__`` 才不会把每个参数判成 F811（与 test_apply_api_config_browser 同做法）。
__all__ = ["browser_port", "fake_runner", "_job"]

#: 外部简历上传接口返回的原件正文（断言"能下到同一份字节"）。
EXTERNAL_BODY = "外部简历正文 · T30".encode()


def _external(client, name: str = "投出去的那版.txt") -> dict:
    """走上传接口建一份外部简历；返回 ``{id, file_id, name, ...}``。"""
    response = client.post(
        "/api/external-resumes",
        files={"file": (name, EXTERNAL_BODY, "text/plain")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _queued(client, job) -> dict:
    """把岗位加入队列（未分析 → 需要显式确认），返回那条队列条目。"""
    response = client.post(
        "/api/apply/queue",
        json={"items": [{"job_id": job.id, "confirm_unanalyzed": True}]},
    )
    assert response.status_code == 200, response.text
    return response.json()[0]


def _patch(client, item_id: int, body: dict):
    return client.patch(f"/api/apply/queue/{item_id}", json=body)


# ===== ① 队列行能选外部简历，且存得住 =====


def test_queue_item_remembers_external_resume(client, db_session, fake_runner):
    job = _job(db_session)
    item = _queued(client, job)
    external = _external(client)

    patched = _patch(client, item["id"], {"external_resume_id": external["id"]})

    assert patched.status_code == 200, patched.text
    body = patched.json()
    # 互斥的另一半：选了外部就必须把内部 id 清掉（否则库里留下"两个都指"）。
    assert body["resume_id"] is None
    assert body["external_resume_id"] == external["id"]
    # 队列行显示的就是「外部 · <文件名>」里的那个文件名（前缀由前端按语言加）。
    assert body["resume_title"] == "投出去的那版.txt"

    # 刷新之后还在：这是"队列行可选"的真正含义（不是只在提交那一刻临时生效）。
    listed = client.get("/api/apply/queue").json()
    row = next(entry for entry in listed["items"] if entry["id"] == item["id"])
    assert row["external_resume_id"] == external["id"]
    assert row["resume_title"] == "投出去的那版.txt"


def test_queue_item_switch_back_to_default_clears_both_links(client, db_session, fake_runner):
    """两键都给 null = 改回"按默认规则为该岗位找简历"，是合法的一次改选（不是 422）。"""
    job = _job(db_session)
    item = _queued(client, job)
    external = _external(client)
    assert _patch(client, item["id"], {"external_resume_id": external["id"]}).status_code == 200

    cleared = _patch(client, item["id"], {"resume_id": None, "external_resume_id": None})

    assert cleared.status_code == 200, cleared.text
    body = cleared.json()
    assert body["external_resume_id"] is None
    assert body["resume_id"] is None
    assert body["resume_title"] == ""


# ===== ② 内外互斥 = 422（不是 500）=====


@pytest.mark.parametrize("path", ["add", "patch"])
def test_both_resume_links_given_is_422(client, db_session, fake_runner, path):
    job = _job(db_session)
    external = _external(client)
    both = {"resume_id": 1, "external_resume_id": external["id"]}

    if path == "add":
        response = client.post(
            "/api/apply/queue",
            json={"items": [{"job_id": job.id, "confirm_unanalyzed": True, **both}]},
        )
    else:
        item = _queued(client, job)
        response = _patch(client, item["id"], both)

    assert response.status_code == 422, response.text
    # 同一句文案：schema 层与 service 层不能各说一套。
    assert "二选一" in response.text


def test_missing_external_resume_is_422_with_reason(client, db_session, fake_runner):
    """指向不存在的外部简历 → 422 + "请重新选择"，绝不留到执行期变成 500。"""
    job = _job(db_session)
    item = _queued(client, job)

    response = _patch(client, item["id"], {"external_resume_id": 987654})

    assert response.status_code == 422, response.text
    assert "不存在" in response.json()["detail"]


def test_soft_deleted_external_resume_is_422(client, db_session, fake_runner):
    """回收站里的外部简历等同于不存在：选它必须当场报错，而不是投的时候才发现。"""
    job = _job(db_session)
    item = _queued(client, job)
    external = _external(client)
    assert client.delete(f"/api/external-resumes/{external['id']}").status_code in (204, 200)

    response = _patch(client, item["id"], {"external_resume_id": external["id"]})

    assert response.status_code == 422, response.text
    assert "不存在" in response.json()["detail"]


# ===== ③④ 建批次：记录记 external_resume_id，附件取 file_id =====


def _task_with_external(client, db_session) -> tuple[dict, dict, dict]:
    """建一条"用外部简历投"的投递批次，返回 (队列条目, 外部简历, 批次详情)。"""
    job = _job(db_session)
    item = _queued(client, job)
    external = _external(client)
    assert _patch(client, item["id"], {"external_resume_id": external["id"]}).status_code == 200

    created = client.post("/api/apply/tasks", json={"use_queue": True})
    assert created.status_code == 200, created.text
    detail = client.get(f"/api/apply/tasks/{created.json()['id']}").json()
    return item, external, detail


def test_apply_task_item_uses_external_resume_file_id(client, db_session, fake_runner):
    _item, external, detail = _task_with_external(client, db_session)

    record = detail["items"][0]
    assert record["external_resume_id"] == external["id"]
    assert record["resume_id"] is None
    # 标题快照是那份外部简历的名字（前缀「外部 · 」由前端按语言加）。
    assert record["resume_title"] == "投出去的那版.txt"

    # 附件就是那份原件的 file_id：投递台不复制字节，直接指向同一份 user_file。
    raw = client.get(f"/api/user-files/{external['file_id']}/raw")
    assert raw.status_code == 200, raw.text
    assert raw.content == EXTERNAL_BODY


# ===== ⑤ 只有 external_resume_id 时下游不崩 =====


def test_records_and_track_work_with_external_only(client, db_session, fake_runner):
    _item, external, _detail = _task_with_external(client, db_session)

    grouped = client.get("/api/apply/records/grouped")
    assert grouped.status_code == 200, grouped.text
    rows = [row for batch in grouped.json()["items"] for row in batch["items"]]
    assert rows, "投递记录列表应当有这条外部简历投的记录"
    assert rows[0]["external_resume_id"] == external["id"]
    assert rows[0]["resume_title"] == "投出去的那版.txt"

    # 批量明细（展开某个批次时走的那个接口）同样不崩、同样带字段。
    items = client.get(f"/api/apply/records/batches/{_detail['id']}/items")
    assert items.status_code == 200, items.text
    assert items.json()["items"][0]["external_resume_id"] == external["id"]

    # 写进求职进度：只有外部简历关联时照常成功，并把关联带过去。
    link = client.post(f"/api/apply/records/{rows[0]['id']}/track")
    assert link.status_code == 200, link.text
    track = db_session.get(ApplicationTrack, link.json()["track_id"])
    assert track is not None
    assert track.external_resume_id == external["id"]
    assert track.resume_id is None


def test_queue_overview_counts_external_row(client, db_session, fake_runner):
    """队列总览（P2-2 的 total/truncated）也要把带外部简历的条目正常算进去。"""
    job = _job(db_session)
    item = _queued(client, job)
    external = _external(client)
    assert _patch(client, item["id"], {"external_resume_id": external["id"]}).status_code == 200

    overview = client.get("/api/apply/queue").json()

    assert overview["total"] == 1
    assert overview["truncated"] is False
    assert overview["items"][0]["external_resume_id"] == external["id"]


def test_preflight_does_not_block_on_missing_internal_resume(client, db_session, fake_runner):
    """体检与真实投递同一判据：选了外部简历原件就不再报「没有可用简历」。

    这个岗位**没有**任何内部简历；只配了外部简历的条目若被体检判死，用户会被假阻断。
    """
    job = _job(db_session)
    item = _queued(client, job)
    external = _external(client)
    assert _patch(client, item["id"], {"external_resume_id": external["id"]}).status_code == 200

    response = client.post("/api/apply/queue/preflight", json={"queue_ids": [item["id"]]})

    assert response.status_code == 200, response.text
    codes = {issue["code"] for row in response.json()["items"] for issue in row.get("issues", [])}
    assert "resume_missing" not in codes
