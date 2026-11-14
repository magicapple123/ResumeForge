# SPDX-License-Identifier: Apache-2.0
"""F18 面试镜头：抽帧校验 / 确定性聚合 / 报告合并 / 录像生命周期 / 备份显式排除。

这里刻意把"聚合"与"模型调用"分开测：
- 聚合是纯函数，边界（0 帧、<3 可见帧、全不可见）必须逐条钉死——报告里的分数会
  影响用户对自己表现的判断，不能靠一次模型调用碰运气；
- 模型调用只测**降级**（未声明视觉能力 / 调用抛错）与"写入不覆盖报告其它键"。
"""

from __future__ import annotations

import json
import time
from types import SimpleNamespace

import pytest
from app.models.interview import InterviewSession
from app.services.data_backup.asset_categories import ASSET_CATEGORIES
from app.services.data_backup.coverage import RUNTIME_ONLY, is_covered
from app.services.interview import interview_camera as camera
from tests.interview_target_support import start_interview as _start

# 最小 JPEG：normalize_image_attachment 只校验文件头与体积，不解码像素。
_JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 256 + b"\xff\xd9"


def _data_url(payload: bytes = _JPEG) -> str:
    import base64

    return "data:image/jpeg;base64," + base64.b64encode(payload).decode("ascii")


def _frame(**overrides) -> dict:
    values = {
        "face_visible": True,
        "gaze_at_camera": True,
        "head_stable": True,
        "framing_ok": True,
        "lighting_ok": True,
        "note": "",
    }
    values.update(overrides)
    return values


class _VisionProvider:
    """假 provider：只实现 chat，配置里带 model（能力判定读它）。"""

    config = SimpleNamespace(model="vision-test")

    def __init__(self, reply: str = "", *, error: Exception | None = None) -> None:
        self.reply = reply
        self.error = error
        self.calls: list[list[dict]] = []

    async def chat(self, messages, *, thinking: bool = True) -> str:
        self.calls.append(messages)
        if self.error:
            raise self.error
        return self.reply


# ---------------------------------------------------------------- 帧校验


def test_validate_frames_rejects_empty_and_oversized():
    with pytest.raises(camera.CameraFrameError):
        camera.validate_frames([])
    with pytest.raises(camera.CameraFrameError):
        camera.validate_frames([_data_url()] * (camera.CAMERA_MAX_FRAMES + 1))
    with pytest.raises(camera.CameraFrameError):
        camera.validate_frames(["not-a-data-url"])


def test_validate_frames_rejects_frame_over_byte_budget():
    oversized = b"\xff\xd8\xff" + b"\x00" * (camera.CAMERA_MAX_FRAME_BYTES + 1024) + b"\xff\xd9"
    with pytest.raises(camera.CameraFrameError):
        camera.validate_frames([_data_url(oversized)])


def test_validate_frames_normalizes_data_url():
    frames = camera.validate_frames([_data_url(), _data_url()])
    assert len(frames) == 2
    assert all(item.startswith("data:image/jpeg;base64,") for item in frames)


# ---------------------------------------------------------------- 聚合边界


def test_aggregate_reports_no_frames_as_insufficient():
    result = camera.aggregate_frames([])
    assert result["score"] is None
    assert result["insufficient"] is True
    assert result["visible_frames"] == 0


def test_aggregate_needs_three_visible_frames():
    result = camera.aggregate_frames([_frame(), _frame(), _frame(face_visible=False)])
    assert result["visible_frames"] == 2
    assert result["score"] is None
    assert result["insufficient"] is True
    assert "2 帧" in result["reason"]


def test_aggregate_all_invisible_never_scores():
    result = camera.aggregate_frames([_frame(face_visible=False)] * 6)
    assert result["score"] is None
    assert result["insufficient"] is True


def test_aggregate_weights_and_metric_scope():
    frames = [
        _frame(),
        _frame(gaze_at_camera=False),
        _frame(head_stable=False, framing_ok=False),
        _frame(face_visible=False),
    ]
    result = camera.aggregate_frames(frames)
    # 可见 3/4 → 0.75；视线 2/3；头部 2/3；构图 2/3；光线 3/3。
    assert result["metrics"] == {
        "face_visible": 0.75,
        "gaze_at_camera": 0.6667,
        "head_stable": 0.6667,
        "framing_ok": 0.6667,
        "lighting_ok": 1.0,
    }
    expected = (
        round(0.30 * 0.75 + 0.30 * (2 / 3) + 0.20 * (2 / 3) + 0.10 * (2 / 3) + 0.10 * 1.0, 4) * 100
    )
    assert result["score"] == pytest.approx(round(expected, 1), abs=0.05)
    assert result["insufficient"] is False


def test_aggregate_perfect_frames_score_100():
    result = camera.aggregate_frames([_frame()] * 4)
    assert result["score"] == 100.0


def test_aggregate_is_deterministic_for_same_input():
    frames = [_frame(gaze_at_camera=False), _frame(), _frame(), _frame()]
    first = camera.aggregate_frames(frames)
    second = camera.aggregate_frames(frames)
    first.pop("analyzed_at")
    second.pop("analyzed_at")
    assert first == second


def test_apply_total_weight_defaults_off():
    result = camera.aggregate_frames([_frame()] * 4)
    camera.apply_total_weight(result, False, 80)
    assert result["count_in_total"] is False
    assert result["combined_score"] is None
    assert result["score"] == 100.0  # 原始镜头分不被改写


def test_apply_total_weight_uses_fixed_weight_when_on():
    result = camera.aggregate_frames([_frame()] * 4)
    camera.apply_total_weight(result, True, 80)
    expected = round(80 * (1 - camera.CAMERA_SCORE_IN_TOTAL_WEIGHT) + 100 * 0.15, 1)
    assert result["combined_score"] == expected


# ---------------------------------------------------------------- 报告合并


def test_merge_camera_report_preserves_scores_and_dimensions():
    session = InterviewSession(title="t")
    session.report = {"score": 77, "dimensions": [{"name": "技术"}], "summary": "还行"}
    camera.merge_camera_report(session, {"score": 60})
    assert session.report["score"] == 77
    assert session.report["dimensions"] == [{"name": "技术"}]
    assert session.report["camera"] == {"score": 60}


def test_camera_only_report_is_not_treated_as_generated():
    assert camera.has_real_report({"camera": {"score": 1}}) is False
    assert camera.has_real_report({"camera": {}, "score": 0, "dimensions": []}) is False
    assert camera.has_real_report({"summary": "x"}) is True


# ---------------------------------------------------------------- 录像生命周期


@pytest.fixture()
def data_root(tmp_path, monkeypatch):
    monkeypatch.setattr("app.config.DATA_DIR", tmp_path)
    return tmp_path


def _write_recording(session_id: int, *, retention_days: int, created_at: int) -> None:
    path = camera.recording_path(session_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"webm-bytes")
    (path.parent / f"{session_id}.json").write_text(
        json.dumps(
            {"bytes": 10, "created_at": created_at, "retention_days": retention_days},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def test_recording_save_and_delete(data_root):
    import asyncio

    async def chunks():
        yield b"abc"
        yield b"def"

    info = asyncio.run(camera.save_recording(7, chunks(), retention_days=7))
    assert info["bytes"] == 6
    assert camera.recording_path(7).read_bytes() == b"abcdef"
    assert camera.recording_info(7)["retention_days"] == 7
    assert camera.delete_recording(7) is True
    assert camera.recording_info(7) is None


def test_recording_save_rejects_empty_and_cleans_partial(data_root):
    import asyncio

    async def empty():
        if False:
            yield b""

    with pytest.raises(ValueError):
        asyncio.run(camera.save_recording(8, empty()))
    assert not camera.recording_path(8).exists()
    assert not camera.recording_path(8).with_suffix(".webm.part").exists()


def test_second_segment_keeps_previous_file(data_root):
    """暂停后继续录制：新一段替换主文件，但上一段要留成 ``<id>.prev.webm``。"""
    import asyncio

    async def first():
        yield b"first"

    async def second():
        yield b"second"

    asyncio.run(camera.save_recording(9, first(), retention_days=7))
    asyncio.run(camera.save_recording(9, second(), retention_days=7))
    assert camera.recording_path(9).read_bytes() == b"second"
    assert camera.recording_path(9).with_name("9.prev.webm").read_bytes() == b"first"
    # 删除与到期都要带上上一段。
    assert camera.delete_recording(9) is True
    assert not camera.recording_path(9).with_name("9.prev.webm").exists()


def test_retention_days_only_accepts_known_values():
    assert camera.normalize_retention_days(30) == 30
    assert camera.normalize_retention_days(0) == 0
    assert camera.normalize_retention_days(999) == camera.DEFAULT_RETENTION_DAYS
    assert camera.normalize_retention_days("bad") == camera.DEFAULT_RETENTION_DAYS


def test_cleanup_expired_respects_retention(data_root):
    now = int(time.time())
    _write_recording(1, retention_days=7, created_at=now - 8 * 86400)
    _write_recording(2, retention_days=7, created_at=now - 6 * 86400)
    _write_recording(3, retention_days=0, created_at=now - 999 * 86400)
    assert camera.cleanup_expired(now) == 1
    assert camera.recording_info(1) is None
    assert camera.recording_info(2) is not None
    assert camera.recording_info(3) is not None


# ---------------------------------------------------------------- 备份排除


def test_recordings_dir_is_explicitly_excluded():
    """三盏红灯里的"新目录不许静默"：这里必须是**显式排除**，不是漏登记。"""
    assert camera.RECORDING_DIRNAME in RUNTIME_ONLY
    assert is_covered(camera.RECORDING_DIRNAME) is True
    assert camera.RECORDING_DIRNAME not in ASSET_CATEGORIES


# ---------------------------------------------------------------- 接口


@pytest.fixture()
def session_id(client, db_session, monkeypatch):
    # 开场需要"已配置模型"：与其它面试用例同一条打桩点（app.api.interview._require_provider）。
    monkeypatch.setattr("app.api.interview._require_provider", lambda _db: (_VisionProvider(), "m"))

    async def ask(_db, _session, _provider):
        return "讲讲你最近做的一个项目", "", False

    # 开场会立刻生成第一题：这里只测镜头，不该被题目生成牵连。
    monkeypatch.setattr("app.api.interview._ask_next_question", ask)
    response = _start(client, db_session)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_camera_frames_degrades_without_vision(client, db_session, session_id, monkeypatch):
    monkeypatch.setattr(
        "app.api.interview_camera._require_provider", lambda _db: (_VisionProvider(), "m")
    )
    monkeypatch.setattr(
        "app.api.interview_camera.resolve_capabilities",
        lambda _config: SimpleNamespace(vision=False),
    )
    response = client.post(
        f"/api/interview/{session_id}/camera-frames",
        json={"frames": [_data_url()] * 4, "count_in_score": True},
    )
    assert response.status_code == 200, response.text
    payload = response.json()["camera"]
    assert payload["score"] is None
    assert "未声明支持图像" in payload["error"]
    assert payload["count_in_total"] is True
    assert payload["combined_score"] is None  # 没有镜头分就谈不上并入


def test_camera_frames_writes_report_without_clobbering(
    client, db_session, session_id, monkeypatch
):
    session = db_session.get(InterviewSession, session_id)
    session.report = {"score": 77, "dimensions": [{"name": "技术", "score": 77}], "summary": "稳"}
    db_session.commit()

    reply = json.dumps(
        {"frames": [_frame()] * 4, "notes": ["保持平视"]},
        ensure_ascii=False,
    )
    provider = _VisionProvider(reply)
    monkeypatch.setattr("app.api.interview_camera._require_provider", lambda _db: (provider, "m"))
    monkeypatch.setattr(
        "app.api.interview_camera.resolve_capabilities",
        lambda _config: SimpleNamespace(vision=True),
    )
    response = client.post(
        f"/api/interview/{session_id}/camera-frames",
        json={"frames": [_data_url()] * 4, "count_in_score": False},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["camera"]["score"] == 100.0
    assert body["camera"]["notes"][0] == "保持平视"

    db_session.expire_all()
    session = db_session.get(InterviewSession, session_id)
    assert session.report["score"] == 77
    assert session.report["dimensions"] == [{"name": "技术", "score": 77}]
    assert session.report["camera"]["score"] == 100.0


def test_camera_frames_model_error_degrades(client, db_session, session_id, monkeypatch):
    provider = _VisionProvider(error=RuntimeError("boom"))
    monkeypatch.setattr("app.api.interview_camera._require_provider", lambda _db: (provider, "m"))
    monkeypatch.setattr(
        "app.api.interview_camera.resolve_capabilities",
        lambda _config: SimpleNamespace(vision=True),
    )
    response = client.post(
        f"/api/interview/{session_id}/camera-frames",
        json={"frames": [_data_url()] * 3},
    )
    assert response.status_code == 200, response.text
    assert response.json()["camera"]["error"]


def test_camera_frames_rejects_bad_payload(client, session_id):
    response = client.post(f"/api/interview/{session_id}/camera-frames", json={"frames": ["oops"]})
    assert response.status_code == 422
    assert "画面数据格式" in response.json()["detail"]


def test_recording_upload_playback_range_and_delete(client, session_id, data_root):
    body = b"0123456789"
    upload = client.post(
        f"/api/interview/{session_id}/recording?retention_days=30",
        content=body,
        headers={"content-type": "video/webm", "x-recording-seconds": "12"},
    )
    assert upload.status_code == 200, upload.text
    assert upload.json()["bytes"] == len(body)
    assert upload.json()["retention_days"] == 30

    meta = client.get(f"/api/interview/{session_id}/recording/meta")
    assert meta.status_code == 200
    assert meta.json()["bytes"] == len(body)

    partial = client.get(f"/api/interview/{session_id}/recording", headers={"Range": "bytes=2-5"})
    assert partial.status_code == 206
    assert partial.content == b"2345"
    assert partial.headers["content-range"] == f"bytes 2-5/{len(body)}"

    full = client.get(f"/api/interview/{session_id}/recording")
    assert full.status_code == 200
    assert full.content == body

    bad = client.get(f"/api/interview/{session_id}/recording", headers={"Range": "bytes=99-120"})
    assert bad.status_code == 416

    assert client.delete(f"/api/interview/{session_id}/recording").status_code == 204
    assert client.get(f"/api/interview/{session_id}/recording/meta").json() is None


def test_recording_rejects_wrong_content_type(client, session_id, data_root):
    response = client.post(
        f"/api/interview/{session_id}/recording",
        content=b"x",
        headers={"content-type": "video/mp4"},
    )
    assert response.status_code == 415


def test_delete_session_removes_recording(client, session_id, data_root):
    client.post(
        f"/api/interview/{session_id}/recording",
        content=b"abc",
        headers={"content-type": "video/webm"},
    )
    assert camera.recording_path(session_id).exists()
    assert client.delete(f"/api/interview/{session_id}").status_code == 204
    assert not camera.recording_path(session_id).exists()


def test_finish_keeps_camera_section(client, db_session, session_id, monkeypatch):
    """先写镜头段、再生成报告：生成报告不能把镜头段冲掉。"""
    session = db_session.get(InterviewSession, session_id)
    session.report = {"camera": {"score": 88, "insufficient": False}}
    db_session.commit()

    async def fake_report(_provider, _session):
        return {"score": 70, "dimensions": [{"name": "技术", "score": 70}], "summary": "ok"}

    monkeypatch.setattr("app.api.interview._require_provider", lambda _db: (_VisionProvider(), "m"))
    monkeypatch.setattr("app.api.interview.generate_report", fake_report)
    # 需要至少一轮回答才允许出报告：直接写一条已答消息。
    from app.services.interview.interview import add_message

    session = db_session.get(InterviewSession, session_id)
    add_message(session, role="user", content="我的回答")
    db_session.commit()

    response = client.post(f"/api/interview/{session_id}/finish")
    assert response.status_code == 200, response.text
    report = response.json()["report"]
    assert report["score"] == 70
    assert report["camera"]["score"] == 88
