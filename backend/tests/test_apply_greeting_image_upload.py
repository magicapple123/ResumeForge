# SPDX-License-Identifier: Apache-2.0
"""CR-18：招呼语配图的**就地上传 / 删除**（队列行与设置页共用同一份接口）。

三条判据：
1. 重复上传同一张图只留一条（``user_file`` 按 sha256 去重），接口回的是同一个 id；
2. 仍被引用的图不能删（全局默认 / 投递队列行 / 投递审计三处），返回 409；
3. 非法后缀、扩展名与魔数不一致、超过 2 MB 的字节一律在入口拒绝（400）。

上传成功之后前端靠 ``deletable`` 决定那张图能不能删，所以这里同时钉住这个字段：
未引用 = true，命中所列任一引用 = false。
"""

from __future__ import annotations

from app.models.apply import ApplyQueueItem, ApplyTask, ApplyTaskItem
from app.models.setting import AppSetting
from app.models.user_file import UserFile
from app.services.apply.greeting_image import KEY_GREETING_IMAGE_ENABLED, KEY_GREETING_IMAGE_ID
from app.services.user_files import user_files_dir
from greeting_image_support import noise_png_bytes, png_bytes

UPLOAD = "/api/apply/greeting-image/upload"
DELETE = "/api/apply/greeting-image/{file_id}"
SETTING = "/api/apply/greeting-image"


def _upload(client, content: bytes, name: str = "配图.png", mime: str = "image/png"):
    return client.post(UPLOAD, files={"file": (name, content, mime)})


def _options(client) -> dict[int, dict]:
    return {int(item["id"]): item for item in client.get(SETTING).json()["options"]}


def test_upload_png_then_it_shows_up_as_deletable(client):
    response = _upload(client, png_bytes())

    assert response.status_code == 201, response.text
    created = response.json()
    assert created["id"] > 0
    assert created["name"] == "配图.png"
    assert created["deletable"] is True

    option = _options(client)[created["id"]]
    assert option["size_bytes"] == len(png_bytes())
    assert option["deletable"] is True


def test_uploading_the_same_bytes_twice_keeps_one_row(client, db_session):
    first = _upload(client, png_bytes())
    second = _upload(client, png_bytes(), name="另一份.png")

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json()["id"] == first.json()["id"]

    assert len(_options(client)) == 1


def test_non_image_extension_is_rejected(client):
    response = client.post(UPLOAD, files={"file": ("说明.txt", b"hello", "text/plain")})

    assert response.status_code == 400
    assert "图片" in response.json()["detail"]


def test_extension_must_match_the_magic_bytes(client):
    # 扩展名说 png，内容其实是纯文本：魔数验不过就拒，而不是"存下来再说"。
    response = _upload(client, b"not a png at all", name="假的.png", mime="image/png")

    assert response.status_code == 400
    assert "格式" in response.json()["detail"] or "不一致" in response.json()["detail"]


def test_oversized_image_is_rejected_before_saving(client):
    response = _upload(client, noise_png_bytes(1200), name="太大的.png")

    assert response.status_code == 400
    assert "2 MB" in response.json()["detail"]


def test_unreferenced_image_can_be_deleted(client, db_session):
    created = _upload(client, png_bytes()).json()
    row = db_session.get(UserFile, created["id"])
    assert row is not None
    disk_path = user_files_dir(db_session.get_bind()) / row.disk_name
    assert disk_path.exists(), "上传应当落一份磁盘副本"

    response = client.delete(DELETE.format(file_id=created["id"]))

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert created["id"] not in _options(client)
    # 行与磁盘副本一起清掉：只删行会让"删了还在"一直占着用户的磁盘。
    db_session.expire_all()
    assert db_session.get(UserFile, created["id"]) is None
    assert not disk_path.exists()


def test_global_default_reference_blocks_deletion(client, db_session):
    created = _upload(client, png_bytes()).json()
    db_session.add(AppSetting(key=KEY_GREETING_IMAGE_ENABLED, value="true"))
    db_session.add(AppSetting(key=KEY_GREETING_IMAGE_ID, value=str(created["id"])))
    db_session.commit()

    response = client.delete(DELETE.format(file_id=created["id"]))

    assert response.status_code == 409
    assert "全局" in response.json()["detail"]
    assert _options(client)[created["id"]]["deletable"] is False


def test_queue_row_reference_blocks_deletion(client, db_session):
    created = _upload(client, png_bytes()).json()
    db_session.add(
        ApplyQueueItem(job_title="后端开发", company="某公司", image_ids=[created["id"]])
    )
    db_session.commit()

    response = client.delete(DELETE.format(file_id=created["id"]))

    assert response.status_code == 409
    assert "队列" in response.json()["detail"]


def test_apply_audit_reference_blocks_deletion(client, db_session):
    created = _upload(client, png_bytes()).json()
    task = ApplyTask(kind="apply", status="completed", total=1)
    db_session.add(task)
    db_session.flush()
    db_session.add(
        ApplyTaskItem(task_id=task.id, job_title="后端开发", image_file_ids=[created["id"]])
    )
    db_session.commit()

    response = client.delete(DELETE.format(file_id=created["id"]))

    assert response.status_code == 409
    assert "投递记录" in response.json()["detail"]


def test_delete_unknown_file_returns_404(client):
    response = client.delete(DELETE.format(file_id=999999))

    assert response.status_code == 404
