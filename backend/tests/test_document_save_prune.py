# SPDX-License-Identifier: Apache-2.0
"""W07：保存时裁剪域数据（契约 §1.6，lead 授权的 document_save 最小 diff）。

守三条：
1. 内容与域数据都没变 → 不写库、不推进 revision（written=False）；
2. 裁剪掉死对象/失效照片裁剪 → 与内容写入**同一条** UPDATE，revision 只 +1；
3. 版式保存路径同样先裁剪（不把死数据写回库）。
"""

from __future__ import annotations

import base64
import io

from app.models.resume import ResumeRecord
from app.services.resume.resume_photo_crop import photo_sha256
from PIL import Image

ID = "exp_12345678"
OTHER = "exp_deadbeef"
PHOTO_A = "data:image/png;base64," + base64.b64encode(
    (lambda buf: (Image.new("RGB", (4, 4), (1, 2, 3)).save(buf, format="PNG"), buf.getvalue())[1])(
        io.BytesIO()
    )
).decode("ascii")
PHOTO_B = "data:image/png;base64," + base64.b64encode(
    (lambda buf: (Image.new("RGB", (4, 4), (9, 9, 9)).save(buf, format="PNG"), buf.getvalue())[1])(
        io.BytesIO()
    )
).decode("ascii")


def _content(photo: str = "", ids: tuple[str, ...] = (ID,)) -> dict:
    return {
        "name": "张三",
        "photo": photo,
        "experience": [
            {"company": f"公司{i}", "role": "工程师", "description": ["做了事。"], "id": object_id}
            for i, object_id in enumerate(ids)
        ],
    }


def _create(client, *, photo: str = "", ids: tuple[str, ...] = (ID,)) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={"title": "裁剪用例", "content": _content(photo, ids), "job_id": None},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _layout(client, resume_id: int, format_config: dict, revision: int | None = None) -> dict:
    body: dict = {"format_config": format_config}
    if revision is not None:
        body["expected_revision"] = revision
    response = client.patch(f"/api/resumes/{resume_id}/layout", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def _photo_crop(photo: str) -> dict:
    return {
        "version": 1,
        "source": {"sha256": photo_sha256(photo), "width": 4, "height": 4},
        "rect": {"x": 0, "y": 0, "w": 1, "h": 1},
        "aspect": "free",
    }


def test_unchanged_content_and_domains_do_not_bump_revision(client):
    resume_id = _create(client)
    before = client.get(f"/api/resumes/{resume_id}").json()["revision"]
    response = client.put(
        f"/api/resumes/{resume_id}/content",
        json={"content": _content(), "expected_revision": before},
    )
    assert response.status_code == 200, response.text
    assert response.json()["revision"] == before, "内容与域都未变时不该推进 revision"


def test_save_content_prunes_dead_object_overrides_in_the_same_update(client, db_session):
    resume_id = _create(client)
    with db_session as db:
        record = db.get(ResumeRecord, resume_id)
        record.format_config = {
            **record.format_config,
            "objects": {"version": 1, ID: {"space_before": 0.6}, OTHER: {"space_before": 0.3}},
        }
        db.commit()
    before = client.get(f"/api/resumes/{resume_id}").json()["revision"]

    # 内容里删掉第一段经历（ID 随之消失），保存时 objects 里的两个 id 都应被裁掉。
    response = client.put(
        f"/api/resumes/{resume_id}/content",
        json={"content": _content(ids=("new_12345678",)), "expected_revision": before},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["revision"] == before + 1, "内容变化 + 裁剪必须是同一条 UPDATE（只 +1）"
    assert "objects" not in payload["format_config"]


def test_save_content_prunes_photo_crop_when_the_photo_changed(client):
    resume_id = _create(client, photo=PHOTO_A)
    _layout(client, resume_id, {"photo_crop": _photo_crop(PHOTO_A)})
    before = client.get(f"/api/resumes/{resume_id}").json()["revision"]
    changed = _content(photo=PHOTO_B)
    response = client.put(
        f"/api/resumes/{resume_id}/content", json={"content": changed, "expected_revision": before}
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert "photo_crop" not in payload["format_config"], "换了照片，旧裁剪域必须被裁掉"
    assert payload["revision"] == before + 1


def test_save_layout_prunes_dead_object_overrides(client):
    resume_id = _create(client)
    layout = _layout(
        client,
        resume_id,
        {"objects": {"version": 1, ID: {"bullet": "dash"}, OTHER: {"bullet": "dot"}}},
    )
    assert layout["format_config"]["objects"] == {"version": 1, ID: {"bullet": "dash"}}
    # 版本只推进一次（保存版式 = 一次确定的写入）。
    assert layout["revision"] == 1
