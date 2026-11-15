# SPDX-License-Identifier: Apache-2.0
"""扫描件识别的两个接口族：引擎设置（三档）与后台任务（立即返回任务号）。

守的性质：

1. 三档设置能读能写，非法值被拒；
2. 没配 Key 时给的是"可操作的中文原因"，而不是 500；
3. 任务**立即**返回任务号（前端不再等 180 秒被 90 秒预算掐断），轮询能看到进度与正文；
4. **没有取消端点**——服务端断开也照常计费，给按钮只会制造错误预期（撞车契约 5）。
"""

from __future__ import annotations

import io
import time

import pytest
from app.api import ocr as ocr_api
from app.services.ocr.client import OcrPage, OcrResult
from app.services.ocr.policy import build_ocr_context
from app.services.ocr.tasks import reset_tasks
from pypdf import PdfWriter


def _pdf_bytes(pages: int) -> bytes:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=595, height=842)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def _fake_result(texts: list[str]):
    pages = tuple(OcrPage(index=i, text=t, finish_reason="stop") for i, t in enumerate(texts))
    return OcrResult(
        request_id="ocr-fake", purpose="text_recognition", page_count=len(texts), pages=pages
    )


def _use_fake_key(monkeypatch):
    monkeypatch.setattr(
        ocr_api, "load_ocr_context", lambda db=None: build_ocr_context("auto", "sk-test-fake")
    )


@pytest.fixture(autouse=True)
def _reset_ocr_tasks():
    reset_tasks()
    yield
    reset_tasks()


def test_settings_expose_three_tiers_with_backend_owned_labels(client):
    """三档的可读说明由后端给（前端不再写一份中文，否则迟早说两套）。"""
    response = client.get("/api/ocr/settings")
    assert response.status_code == 200
    body = response.json()
    assert body["engine"] in {"auto", "ocr", "vision"}
    assert [item["value"] for item in body["engine_options"]] == ["auto", "ocr", "vision"]
    for item in body["engine_options"]:
        assert item["label"], "每一档都必须带说明文案"
    assert isinstance(body["key_configured"], bool)


def test_settings_round_trip_and_reject_unknown_tier(client):
    saved = client.put("/api/ocr/settings", json={"engine": "vision"})
    assert saved.status_code == 200
    assert saved.json()["engine"] == "vision"
    assert client.get("/api/ocr/settings").json()["engine"] == "vision"

    rejected = client.put("/api/ocr/settings", json={"engine": "magic"})
    assert rejected.status_code == 422


def test_task_requires_a_key_and_says_what_to_do(client, monkeypatch):
    """没 Key 时不能静默降级：422 + 一句指出缺什么的中文原因。"""
    monkeypatch.setattr(ocr_api, "load_ocr_context", lambda db=None: build_ocr_context("ocr", ""))
    response = client.post(
        "/api/ocr/tasks", files={"file": ("scan.pdf", _pdf_bytes(2), "application/pdf")}
    )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert "DeepSeek API Key" in detail


def test_task_returns_immediately_and_polling_reports_progress(client, monkeypatch):
    """任务化：POST 立刻给任务号，GET 能看到 pages_done 递增到总数与最终正文。"""
    from app.services.ocr import tasks as tasks_module

    _use_fake_key(monkeypatch)
    monkeypatch.setattr(
        tasks_module, "recognize_document", lambda *a, **k: _fake_result(["识别出的正文"])
    )

    created = client.post(
        "/api/ocr/tasks", files={"file": ("scan.pdf", _pdf_bytes(3), "application/pdf")}
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["task_id"]
    assert body["total_pages"] == 3

    status = None
    for _ in range(60):
        status = client.get(f"/api/ocr/tasks/{body['task_id']}").json()
        if status["status"] != "running":
            break
        time.sleep(0.05)
    assert status is not None
    assert status["status"] == "succeeded"
    assert status["pages_done"] == 3
    assert status["total_pages"] == 3
    assert "识别出的正文" in status["text"]
    # 服务端不支持取消：前端只能"停止等待"，这个字段是文案的唯一依据。
    assert status["server_cancel_supported"] is False


def test_empty_page_is_retried_once_and_recovers(client, monkeypatch):
    """服务端偶发整页空文本：重试一次就能恢复（实测 9 页里会出现 1–2 页）。

    空页钱照扣、字却没拿到，所以这条是"花钱买正确性"的守点，不能删掉重试。
    """
    from app.services.ocr import tasks as tasks_module

    _use_fake_key(monkeypatch)
    calls: list[str] = []

    def _fake(page_raw, name, key, *, purpose, content_type):
        calls.append(name)
        if calls.count(name) == 1:
            return _fake_result([""])
        return _fake_result([f"{name} 的正文"])

    monkeypatch.setattr(tasks_module, "recognize_document", _fake)
    created = client.post(
        "/api/ocr/tasks", files={"file": ("scan.pdf", _pdf_bytes(2), "application/pdf")}
    )
    task_id = created.json()["task_id"]
    status = _wait(client, task_id)
    assert status["status"] == "succeeded"
    assert "scan.pdf-p1.pdf 的正文" in status["text"]
    assert "scan.pdf-p2.pdf 的正文" in status["text"]
    # 每页各调了两次（首次空 → 重试），第 1 页共 2 次。
    assert calls.count("scan.pdf-p1.pdf") == 2


def test_persistently_empty_page_is_named_in_the_warnings(client, monkeypatch):
    """重试后仍为空：必须点名是哪一页，不能悄悄少一段。"""
    from app.services.ocr import tasks as tasks_module

    _use_fake_key(monkeypatch)

    def _fake(page_raw, name, key, *, purpose, content_type):
        return _fake_result([""]) if name.endswith("-p1.pdf") else _fake_result(["第二页正文"])

    monkeypatch.setattr(tasks_module, "recognize_document", _fake)
    created = client.post(
        "/api/ocr/tasks", files={"file": ("scan.pdf", _pdf_bytes(2), "application/pdf")}
    )
    status = _wait(client, created.json()["task_id"])
    assert status["status"] == "succeeded"
    assert any("1" in warning and "没返回文字" in warning for warning in status["warnings"])


def _wait(client, task_id: str) -> dict:
    """轮询到任务结束（最多 3 秒，够 2 页的假识别跑完）。"""
    for _ in range(60):
        status = client.get(f"/api/ocr/tasks/{task_id}").json()
        if status["status"] != "running":
            return status
        time.sleep(0.05)
    raise AssertionError("OCR 任务没有在预期时间内结束")


def test_unknown_task_is_404_with_a_readable_reason(client):
    response = client.get("/api/ocr/tasks/not-a-real-task")
    assert response.status_code == 404
    assert "识别任务" in response.json()["detail"]


def test_there_is_no_cancel_endpoint():
    """刻意没有取消端点（撞车契约 5）：离线枚举路由，防止有人"顺手补一个"。"""
    from app.main import app

    paths = set()
    pending = [app.router]
    while pending:
        current = pending.pop()
        for route in getattr(current, "routes", []):
            pending.append(route) if hasattr(route, "routes") else None
            path = getattr(route, "path", "")
            if path:
                paths.add(path)
    cancelled = [path for path in paths if "ocr" in path and "cancel" in path]
    assert cancelled == [], f"OCR 不允许提供服务端取消：{cancelled}"


def test_task_path_is_registered_for_a_larger_body():
    """100 MiB 能力不能被 8 MB 的全局请求体闸门挡在门外。"""
    from app.application import create_app
    from app.config import get_settings
    from app.middleware.request_context import RequestContextMiddleware

    app = create_app()
    layers = [item for item in app.user_middleware if item.cls is RequestContextMiddleware]
    assert layers, "RequestContextMiddleware 没有装配"
    larger = layers[0].kwargs["larger_body_paths"]
    assert ocr_api.TASK_PATH == "/api/ocr/tasks"
    assert ocr_api.TASK_PATH in larger
    assert larger[ocr_api.TASK_PATH] > get_settings().max_request_body_mb * 1024 * 1024
    # 端点自己的 100 MiB 上限保持不变（服务端限制，不能跟着放宽）。
    assert ocr_api.MAX_OCR_FILE_BYTES == 100 * 1024 * 1024
