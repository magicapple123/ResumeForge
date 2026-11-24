# SPDX-License-Identifier: Apache-2.0
"""T8 招呼语附带图片（二）：真实 runner 的执行链、失败语义与反证。

跑的是**真的** ``TaskRunner`` + ``task_apply.execute_item``，站点一侧换成记录型假 CDP
（``ImageCdp``）与只实现发图能力的假适配器（``ImageAdapter``）——**不碰网络、不碰真站**。

四条核心判据：
1. 没有图 → **不出现** ``uploading`` 步骤，CDP 序列里**没有** ``DOM.setFileInputFiles``；
2. 有图 → 临时文件先落盘再交给站点（交给站点那一刻文件必须存在），发完即删；
3. 图片失败（站点侧 / 本地拒绝 / 适配器没有这个能力）→ 记 ``image_status``，
   但**这条投递仍然是 success**（文本已送达，判失败会让用户重投、招聘方收到两条招呼语）；
4. 反证：两处来源都置空 → 序列里不出现 ``setFileInputFiles``；放回全局默认 → 又出现。

真站三项未知见 ``services/sites/boss_apply_image.py`` 开头，**本文件不覆盖它们**。
"""

from __future__ import annotations

import pytest
from app.models.apply import (
    FAILURE_FILE_UPLOAD_FAILED,
    IMAGE_STATUS_SENT,
    IMAGE_STATUS_SKIPPED,
    IMAGE_STATUS_UPLOAD_FAILED,
    IMAGE_TARGET_GREETING_IMAGE,
    ITEM_STATUS_SUCCESS,
    ApplyTask,
)
from app.services.apply.greeting_image import save_greeting_image_setting
from app.services.user_files import user_files_dir
from greeting_image_support import (
    FILE_INPUT_METHOD,
    ImageAdapter,
    item_of,
    png_bytes,
    run_task,
    step_names,
    store,
    temp_dirs,
)
from test_apply_task_runner import FakeAdapter, _setup_task

from app.models.user_file import UserFile  # isort: skip - 与分组内其它模型同级，保持阅读顺序

# ===== 夹具 =====


@pytest.fixture
def step_events(monkeypatch):
    """拦下 ``apply.step`` 诊断事件（默认 handler 会把它们丢掉，看不到顺序）。"""
    from app.services import diagnostics

    events: list[dict] = []
    monkeypatch.setattr(
        diagnostics,
        "record_event",
        lambda event, **details: events.append({"event": event, **details}),
    )
    return events


# ===== 1. 没有图：连上传步骤都不开 =====


def test_no_image_means_no_upload_step_and_no_file_input_call(
    db_session, step_events: list[dict]
) -> None:
    task = _setup_task(db_session, 1)

    client = run_task(db_session, task, ImageAdapter())

    assert FILE_INPUT_METHOD not in client.sent_methods()
    assert client.file_inputs == []
    # 没有图就连"回聊天页发图"这一步都不该发生（真站实测前，发图要走一次导航到 /web/geek/chat）。
    assert client.navigated_urls() == []
    assert step_names(step_events) == ["opening", "filling", "submitting", "verifying"]
    assert item_of(db_session, task).image_status == "", "没选图 = 这一步根本没试过"


# ===== 2. 有图：先落盘、再交给站点、发完就删 =====


def test_the_global_default_is_staged_and_sent_after_the_text(
    db_session, step_events: list[dict]
) -> None:
    content = png_bytes(12, 12)
    file_id = store(db_session, content, "默认图.png", "image/png")
    save_greeting_image_setting(db_session, enabled=True, image_id=file_id)
    task = _setup_task(db_session, 1)
    adapter = ImageAdapter()
    before = temp_dirs()

    client = run_task(db_session, task, adapter)

    assert adapter.upload_calls and len(adapter.upload_calls[0]) == 1
    assert adapter.existed_during_upload == [True], "交给站点的必须是**已落盘**的临时文件"
    assert adapter.uploaded_bytes == [content]
    # 公司名要一路传到发图那一步：真站上要靠它在聊天页的会话列表里定位本次投递的招聘方
    # （不发公司名就只能沿用"已经打开的那个会话"，那是猜）。
    assert adapter.upload_companies == ["公司0"]
    assert client.sent_methods().count(FILE_INPUT_METHOD) == 1
    # uploading 排在 verifying 之后：文本先确认送达，图片是补发的一条。
    assert step_names(step_events)[-2:] == ["verifying", "uploading"]

    item = item_of(db_session, task)
    assert item.status == ITEM_STATUS_SUCCESS
    assert item.image_status == IMAGE_STATUS_SENT
    assert item.image_target == IMAGE_TARGET_GREETING_IMAGE
    assert item.image_file_ids == [file_id]
    assert item.image_finished_at is not None
    assert temp_dirs() - before == set(), "发完就必须删掉临时文件"


def test_inline_images_override_the_global_default_in_the_real_chain(db_session) -> None:
    inline = png_bytes(11, 11)
    inline_id = store(db_session, inline, "行内.png", "image/png")
    global_id = store(db_session, png_bytes(13, 13), "全局.png", "image/png")
    save_greeting_image_setting(db_session, enabled=True, image_id=global_id)
    task = _setup_task(db_session, 1)
    item = item_of(db_session, task)
    item.image_ids = [inline_id]
    db_session.commit()
    adapter = ImageAdapter()

    run_task(db_session, task, adapter)

    assert adapter.uploaded_bytes == [inline], "行内选择必须压过全局默认"


def test_the_sent_detail_names_the_conversation_the_image_went_to(db_session) -> None:
    """「发给了谁」要落库：真站出过"回报已发出、实际发到别人会话"的事故（队列 #17 万事云），

    只写"已发出 N 张"事后无法核对。适配器核对通过的会话标题由它回报，记录里写成
    「已向「某某」发出 1 张图片」。
    """
    file_id = store(db_session, png_bytes(18, 18), "图.png", "image/png")
    task = _setup_task(db_session, 1)
    item = item_of(db_session, task)
    item.image_ids = [file_id]
    db_session.commit()

    run_task(db_session, task, ImageAdapter(target="杨女士 万事云 招聘人事"))

    item = item_of(db_session, task)
    assert item.image_status == IMAGE_STATUS_SENT
    assert item.image_detail == "已向「杨女士 万事云 招聘人事」发出 1 张图片"


def test_without_a_reported_target_the_detail_stays_the_neutral_wording(db_session) -> None:
    """适配器没回报标题（旧适配器 / 别的站点）时不许编：沿用"已随招呼语发出 N 张图片"。"""
    file_id = store(db_session, png_bytes(19, 19), "图.png", "image/png")
    task = _setup_task(db_session, 1)
    item = item_of(db_session, task)
    item.image_ids = [file_id]
    db_session.commit()

    run_task(db_session, task, ImageAdapter())

    item = item_of(db_session, task)
    assert item.image_status == IMAGE_STATUS_SENT
    assert item.image_detail == "已随招呼语发出 1 张图片"


# ===== 3. 失败语义：图片失败，投递仍算成功 =====


def test_upload_failure_is_recorded_but_the_item_still_counts_as_success(db_session) -> None:
    """文本已送达：图片失败只记 ``upload_failed``，**不改**投递状态（否则用户会重投）。"""
    before = temp_dirs()
    file_id = store(db_session, png_bytes(14, 14), "图.png", "image/png")
    task = _setup_task(db_session, 1)
    item = item_of(db_session, task)
    item.image_ids = [file_id]
    db_session.commit()
    adapter = ImageAdapter(fail_upload="找不到可用的图片上传控件")

    client = run_task(db_session, task, adapter)

    stored = db_session.get(ApplyTask, task.id)
    item = item_of(db_session, task)
    assert stored.status == "completed"
    assert stored.succeeded == 1 and stored.failed == 0
    assert item.status == ITEM_STATUS_SUCCESS, "图片失败不许把这条投递判失败"
    assert item.image_status == IMAGE_STATUS_UPLOAD_FAILED
    assert item.image_target == IMAGE_TARGET_GREETING_IMAGE
    assert FAILURE_FILE_UPLOAD_FAILED in item.image_detail
    assert item.image_file_ids == [file_id], "失败时也要记下尝试过哪几张"
    assert item.failure_category == "" and item.failure_detail == ""
    assert temp_dirs() - before == set(), "上传失败也必须删掉临时文件"
    # 失败路径上不该有第二次塞文件（一次机会，不反复点站点控件）。
    assert client.file_inputs == []


def test_a_missing_copy_is_skipped_locally_and_never_reaches_the_site(db_session) -> None:
    """本地就拒（图被清理过）：记 skipped，站点一侧一次都不点。"""
    file_id = store(db_session, png_bytes(15, 15), "会被删的图.png", "image/png")
    stored = db_session.query(UserFile).filter_by(id=file_id).one()
    (user_files_dir(db_session.get_bind()) / stored.disk_name).unlink()
    task = _setup_task(db_session, 1)
    item = item_of(db_session, task)
    item.image_ids = [file_id]
    db_session.commit()
    adapter = ImageAdapter()

    client = run_task(db_session, task, adapter)

    item = item_of(db_session, task)
    assert adapter.upload_calls == []
    assert client.sent_methods().count(FILE_INPUT_METHOD) == 0
    assert item.status == ITEM_STATUS_SUCCESS
    assert item.image_status == IMAGE_STATUS_SKIPPED
    assert item.image_target == IMAGE_TARGET_GREETING_IMAGE
    assert "磁盘副本读不出来" in item.image_detail


def test_an_adapter_without_the_capability_records_a_skip(db_session) -> None:
    file_id = store(db_session, png_bytes(16, 16), "图.png", "image/png")
    task = _setup_task(db_session, 1)
    item = item_of(db_session, task)
    item.image_ids = [file_id]
    db_session.commit()

    client = run_task(db_session, task, FakeAdapter())

    item = item_of(db_session, task)
    assert client.sent_methods().count(FILE_INPUT_METHOD) == 0
    assert item.image_status == IMAGE_STATUS_SKIPPED
    assert "不支持自动附带图片" in item.image_detail
    assert item.status == ITEM_STATUS_SUCCESS


# ===== 4. 反证：清空两处来源 → 不出现 setFileInputFiles；放回去 → 又出现 =====


def test_clearing_both_sources_keeps_set_file_input_files_out_of_the_sequence(db_session) -> None:
    """反证的完整形态：先证明这个机制**会**发文件，再证明"清空"才是它不发的**原因**。"""
    content = png_bytes(17, 17)
    file_id = store(db_session, content, "默认图.png", "image/png")
    save_greeting_image_setting(db_session, enabled=True, image_id=file_id)

    # ① 有全局默认 → 序列里应当出现 setFileInputFiles。
    first_task = _setup_task(db_session, 1)
    first_client = run_task(db_session, first_task, ImageAdapter())
    assert FILE_INPUT_METHOD in first_client.sent_methods()

    # ② 把全局默认置空（并关掉开关）→ 复原一次"两处都没有"的状态。
    save_greeting_image_setting(db_session, enabled=False, image_id=None)
    second_task = _setup_task(db_session, 1)
    assert item_of(db_session, second_task).image_ids == [], "行内本来就该是空的"
    second_client = run_task(db_session, second_task, ImageAdapter())
    assert FILE_INPUT_METHOD not in second_client.sent_methods(), "两处都空时不该发文件"

    # ③ 复原：把默认图放回去 → setFileInputFiles 又出现（排除了"恰好别的东西坏了"）。
    save_greeting_image_setting(db_session, enabled=True, image_id=file_id)
    third_task = _setup_task(db_session, 1)
    third_client = run_task(db_session, third_task, ImageAdapter())
    assert FILE_INPUT_METHOD in third_client.sent_methods()
