# SPDX-License-Identifier: Apache-2.0
"""T8 招呼语附带图片（一）：解析顺序、本地拒绝、临时文件清理、审计落库。

**全程不碰网络、不碰真站**。执行链（真 runner + 记录型假 CDP）在
``test_apply_greeting_image_chain.py``；共用的假件在 ``greeting_image_support.py``。

真站的三项未知（「发送图片」按钮 DOM、内嵌 input vs 系统文件选择器、是否需要二次确认）
见 ``services/sites/boss_apply_image.py`` 开头——**本文件证明不了它们**，整卡状态因此是
``blocked``。

覆盖的判据（对应台账第 10 条与 02-tasks.md 的验收清单）：
1. 解析顺序：行内 ``image_ids`` → 全局 ``greeting_image_id`` → 不发图；
2. 超 2 MB / 超 4 张在本地就明确拒绝（**不**偷偷降采样把图压到能发）；
3. 临时文件在成功路径与异常路径**都**被删掉（目录里不残留用户截图）；
4. 审计：四要素都落库，且日志里**不抄文件名**。
"""

from __future__ import annotations

from pathlib import Path

import pytest
from app.models.user_file import UserFile
from app.services.apply.greeting_image import (
    GreetingImageError,
    GreetingImageSetting,
    get_greeting_image_setting,
    normalize_image_ids,
    record_image_result,
    resolve_image_ids,
    save_greeting_image_setting,
    stage_greeting_images,
)
from app.services.user_files import user_files_dir
from greeting_image_support import item_of, noise_png_bytes, png_bytes, store, temp_dirs
from test_apply_task_runner import _setup_task

# ===== 1. 解析顺序：行内 > 全局 > 不发 =====


def test_inline_image_ids_win_over_the_global_default():
    """行内有值就用行内的，且**不看**总开关：那是用户对这一条岗位的显式选择。"""
    setting = GreetingImageSetting(enabled=True, image_id=3)

    assert resolve_image_ids([7, 9], setting) == [7, 9]
    assert resolve_image_ids(["7"], GreetingImageSetting(enabled=False, image_id=3)) == [7]


def test_the_global_default_is_used_only_when_the_row_has_none():
    setting = GreetingImageSetting(enabled=True, image_id=3)

    assert resolve_image_ids([], setting) == [3]
    assert resolve_image_ids(None, setting) == [3]


def test_the_global_default_is_ignored_while_the_toggle_is_off():
    """默认关是**真**默认：只设了图、没打开开关，就不发。"""
    assert resolve_image_ids([], GreetingImageSetting(enabled=False, image_id=3)) == []


def test_nothing_is_sent_when_neither_source_is_set():
    assert resolve_image_ids([], GreetingImageSetting()) == []
    assert resolve_image_ids(None, GreetingImageSetting()) == []


def test_image_ids_are_normalized_deduplicated_and_keep_their_order():
    """库里的 JSON 是用户可编辑的脏数据：脏值丢掉、重复去掉、顺序保留。"""
    assert normalize_image_ids([5, "5", 0, -2, True, "x", None, 5, 9]) == [5, 9]
    assert normalize_image_ids(None) == []
    assert normalize_image_ids([]) == []


def test_the_setting_defaults_to_off_and_no_default_image(db_session):
    setting = get_greeting_image_setting(db_session)

    assert setting.enabled is False
    assert setting.image_id is None


def test_saving_a_setting_refuses_an_image_that_no_longer_exists(db_session):
    """存一个不存在的 id 会让失败晚到投递那一刻，而设置页完全看不出来 → 当场拒绝。"""
    with pytest.raises(GreetingImageError) as excinfo:
        save_greeting_image_setting(db_session, enabled=True, image_id=999999)

    assert "已不在文件副本库里" in str(excinfo.value)
    assert get_greeting_image_setting(db_session) == GreetingImageSetting()


def test_saving_a_setting_round_trips_through_the_kv_table(db_session):
    file_id = store(db_session, png_bytes(), "截图.png", "image/png")

    save_greeting_image_setting(db_session, enabled=True, image_id=file_id)

    assert get_greeting_image_setting(db_session) == GreetingImageSetting(True, file_id)


# ===== 2. 落临时文件 + 本地拒绝（超 2 MB / 超 4 张 / 非图片）=====


def test_staging_writes_one_temp_file_per_image_and_cleanup_removes_the_directory(db_session):
    before = temp_dirs()
    first = store(db_session, png_bytes(8, 8), "图一.png", "image/png")
    second = store(db_session, png_bytes(10, 10), "图二.png", "image/png")

    staging = stage_greeting_images(db_session, [first, second])

    assert temp_dirs() - before == {staging.directory.name}
    assert staging.paths() and all(Path(path).exists() for path in staging.paths())
    assert sorted(path.suffix for path in staging.directory.iterdir()) == [".png", ".png"]
    assert staging.file_ids() == [first, second]

    staging.cleanup()

    assert temp_dirs() - before == set()
    assert not staging.directory.exists()


def test_more_than_four_images_are_rejected_before_anything_is_staged(db_session):
    before = temp_dirs()
    ids = [
        store(db_session, png_bytes(8, 8 + index), f"图{index}.png", "image/png")
        for index in range(5)
    ]

    with pytest.raises(GreetingImageError) as excinfo:
        stage_greeting_images(db_session, ids)

    assert "一次最多上传 4 个图片" in str(excinfo.value)
    assert temp_dirs() - before == set(), "被拒之前不该先建临时目录"


def test_an_image_over_two_megabytes_is_rejected_instead_of_shrunk(db_session):
    """**不偷偷降采样**：超限就是超限（台账第 10 条禁止为"能发"绕开 attachments 的体积限制）。"""
    content = noise_png_bytes(1100)
    assert len(content) > 2 * 1024 * 1024, "样本本身必须真的超过 2 MB，否则这条用例什么都没验"
    file_id = store(db_session, content, "大截图.png", "image/png")

    with pytest.raises(GreetingImageError) as excinfo:
        stage_greeting_images(db_session, [file_id])

    assert "不能超过 2 MB" in str(excinfo.value)


def test_a_non_image_copy_is_rejected_with_a_readable_reason(db_session):
    file_id = store(db_session, b"just some notes\n", "笔记.txt", "text/plain")

    with pytest.raises(GreetingImageError) as excinfo:
        stage_greeting_images(db_session, [file_id])

    assert "不是图片" in str(excinfo.value)


def test_the_temp_directory_is_removed_when_a_later_image_fails(db_session):
    """**异常路径的真覆盖**：第一张合格、第二张读不出来 → 整目录必须消失。"""
    before = temp_dirs()
    good = store(db_session, png_bytes(), "好图.png", "image/png")
    broken = store(db_session, png_bytes(9, 9), "坏图.png", "image/png")
    stored = db_session.query(UserFile).filter_by(id=broken).one()
    (user_files_dir(db_session.get_bind()) / stored.disk_name).unlink()

    with pytest.raises(GreetingImageError) as excinfo:
        stage_greeting_images(db_session, [good, broken])

    assert "磁盘副本读不出来" in str(excinfo.value)
    assert temp_dirs() - before == set(), "异常路径也必须把临时目录删干净"


# ===== 3. 审计：四要素都落库，且不往日志里抄文件名 =====


def test_record_image_result_writes_the_audit_quadruple(db_session) -> None:
    task = _setup_task(db_session, 1)
    item = item_of(db_session, task)
    item.queue_item_id = 4242
    db_session.commit()

    record_image_result(
        db_session,
        item,
        status="upload_failed",
        detail="找不到上传控件",
        file_ids=[7, 8],
    )

    item = item_of(db_session, task)
    assert (item.queue_item_id, item.image_status, item.image_target) == (
        4242,
        "upload_failed",
        "greeting_image",
    )
    assert item.image_file_ids == [7, 8]
    assert item.image_finished_at is not None


def test_the_result_is_exposed_to_the_records_api(db_session) -> None:
    """记录行要带出图片结果（``sent`` / ``upload_failed`` / ``skipped``）与一句诊断。"""
    from app.services.apply._records import _record_out

    task = _setup_task(db_session, 1)
    item = item_of(db_session, task)
    item.image_status = "upload_failed"
    item.image_target = "greeting_image"
    item.image_detail = "已把图片交给页面，但没有看到图片消息出现在会话里"
    db_session.commit()

    out = _record_out(item, jd_changed=False)

    assert out.image_status == "upload_failed"
    assert out.image_target == "greeting_image"
    assert "没有看到图片消息" in out.image_detail


def test_the_audit_log_never_copies_a_file_name(db_session, caplog) -> None:
    """日志里只写 id：文件名常常就是「张三-简历截图.png」，落进日志等于抄了一份个人信息。"""
    import logging

    from app.services.apply import greeting_image as module

    task = _setup_task(db_session, 1)
    item = item_of(db_session, task)
    item.queue_item_id = 4243
    db_session.commit()

    with caplog.at_level(logging.INFO, logger=module.__name__):
        record_image_result(db_session, item, status="sent", detail="已发出 1 张", file_ids=[7])

    assert "queue_item_id=4243" in caplog.text
    assert "result=sent" in caplog.text
    # 四要素里的 file_id 是 id，不是名字：任何 `.png` 文件名都不该出现在这行日志里。
    assert ".png" not in caplog.text
