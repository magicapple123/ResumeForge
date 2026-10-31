# SPDX-License-Identifier: Apache-2.0
"""W21 场景 B-E07（plan §11.2）：数据集切换 × 离线可用性。

收口前（2026-10-25 上一轮）的结论是 B-E07 **没有场景级证据**：数据集隔离只有单测
（tests/test_dataset_scope*.py、test_dataset_request_identity.py），"无模型 / 无网仍
可用"从未被一条链路证明。本文件补这三段，全部用合成数据、不碰 backend/data、不启动
服务、不改产品源码：

- (a) 请求进行中切换数据集：预览请求持租约期间切换被排空拦下（409，点名 http-request），
  请求收尾后切换成功；同一记录 ID 在两个库里指向不同正文时，来回切换的正文与**预览
  缓存**不串——切回 A 命中的是 A 自己那份产物。
- (b) 没有模型配置：编辑 / 检查 / 四种格式导出照常；生成链路给可读的 400；全程 0 个
  出站 HTTP 请求（守卫记录断言，不是"看起来没联网"）。
- (c) 没有网络：本地检查与导出照常；模型连通性测试快速失败并回可读消息（不挂起）——
  守卫记录到的那次尝试正说明"0 个"不是守卫没生效。

**未覆盖（如实登记，不写成 PASS）**：

1. 前端在请求进行中切数据集时的请求取消 / 本地缓存失效（浏览器级）——后端证明的是
   "切换被排空、请求身份冻结、缓存按内容指纹区分"，前端那一半需要浏览器 smoke；
2. 真实断网（拔网线 / 防火墙）与真实模型服务超时——这里用 DNS 层守卫模拟；
3. 真实 Electron 壳与安装包形态。
"""

from __future__ import annotations

import threading

import pytest
from app import database
from app.main import app as fastapi_app
from app.models.resume import ResumeRecord
from app.runtime import dataset_scope
from app.services import pdf_preview_cache
from fastapi.testclient import TestClient
from test_pdf_exporter import _text_runs, needs_font
from tests.document_test_support import values

MAIN = "main"


# ===== 合成数据与小工具 =====


def _content(summary: str) -> dict:
    """一份"能直接导出"的最小正文：不含【待补】类标记，四种格式都不会被闸门拦下。"""
    return {
        "name": "示例用户",
        "phone": "138-0000-0000",
        "email": "sample.offline@example.com",
        "city": "示例市",
        "job_intent": "示例岗位",
        "summary": summary,
        "education": [{"school": "示例大学", "major": "示例专业", "degree": "本科"}],
        "experience": [
            {"company": "示例科技有限公司", "role": "示例岗位", "description": ["示例要点"]}
        ],
        "skills": [{"name": "示例技能", "level": "熟练"}],
    }


def _create_resume(client, summary: str) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={"job_id": None, "title": "B-E07 场景", "content": _content(summary)},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create_dataset(client, name: str) -> str:
    response = client.post("/api/settings/datasets", json={"name": name})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _activate(client, dataset_id: str):
    return client.post(f"/api/settings/datasets/{dataset_id}/activate")


def _pdf_text(content: bytes) -> str:
    return "".join(run[3] for run in _text_runs(content))


@pytest.fixture
def external_network_guard(monkeypatch):
    """断网模拟：应用发出的**每一个非本机 HTTP 请求**都立刻失败，并记下它。

    为什么拦 ``httpx.Client.send`` / ``AsyncClient.send`` 而不是 DNS：

    - 本机装了系统级代理（实测 ``HTTPS_PROXY=127.0.0.1:7897`` 一类的本机转发）时，
      httpx 解析/连接的是**代理主机**，目标域名根本不会走到 DNS。只挡域名会让"真联网"
      也表现为"没有解析"，断言退化成恒真式。
    - ``send`` 是请求对象离开应用前的最后一道公共出口（同步 + 异步、含 ``stream``），
      与代理、DNS、防火墙都无关：记到一次就是真的发了一次。
    - 只放行 TestClient 自己的 ``testserver``：那是进程内 ASGI 调用，不是网络。
    """
    import httpx

    attempts: list[str] = []
    real_client_send = httpx.Client.send
    real_async_send = httpx.AsyncClient.send

    def _is_local(request) -> bool:  # noqa: ANN001
        return request.url.host in {"testserver", "127.0.0.1", "localhost"}

    def _blocked(request) -> httpx.ConnectError:  # noqa: ANN001
        attempts.append(f"{request.method} {request.url}")
        return httpx.ConnectError(f"B-E07 离线用例拦截出站请求：{request.url}", request=request)

    def guarded_send(self, request, *args, **kwargs):  # noqa: ANN001, ANN002
        if not _is_local(request):
            raise _blocked(request)
        return real_client_send(self, request, *args, **kwargs)

    async def guarded_async_send(self, request, *args, **kwargs):  # noqa: ANN001, ANN002
        if not _is_local(request):
            raise _blocked(request)
        return await real_async_send(self, request, *args, **kwargs)

    monkeypatch.setattr(httpx.Client, "send", guarded_send)
    monkeypatch.setattr(httpx.AsyncClient, "send", guarded_async_send)
    return attempts


# ===== (a) 请求进行中切换数据集 =====


@needs_font
def test_be07_inflight_request_blocks_switch_and_never_mixes_datasets(client, monkeypatch):
    """预览请求进行中：切换 409；往返后正文与预览缓存都不串。

    这里的"进行中"是**真的 HTTP 请求 + 真的租约**：预览在渲染前被门控挡住，中间件
    已经为该请求登记了 ``http-request`` 租约——不是手工 acquire 一个假的。
    """
    from app.api.resumes import export_routes

    monkeypatch.setattr("app.services.datasets._DRAIN_TIMEOUT_SECONDS", 0.2)
    record_id = _create_resume(client, "A 库正文：请求进行中也不许换库。")
    other = _create_dataset(client, "B-E07 目标库")

    entered = threading.Event()
    gate = threading.Event()
    real_build = export_routes.build_export_delivery

    def blocking_build(*args, **kwargs):  # noqa: ANN002, ANN003
        if not entered.is_set():
            entered.set()
            assert gate.wait(30), "测试没有放行被阻塞的预览请求"
        return real_build(*args, **kwargs)

    monkeypatch.setattr(export_routes, "build_export_delivery", blocking_build)
    seen: dict = {}

    def _inflight_preview() -> None:
        probe = TestClient(fastapi_app, client=("127.0.0.1", 50002))
        response = probe.post(f"/api/resumes/{record_id}/preview-pdf", json={"page_limit": 1})
        seen["status"] = response.status_code
        seen["text"] = _pdf_text(response.content)
        seen["sha"] = response.headers.get("X-Content-Sha256")

    worker = threading.Thread(target=_inflight_preview, name="be07-inflight-preview")
    worker.start()
    try:
        assert entered.wait(30), "预览请求没有进入渲染阶段"
        blocked = _activate(client, other)
        # 排空拦下切换，并点名"正在跑的是谁"——不是一个笼统的失败。
        assert blocked.status_code == 409, blocked.text
        assert "http-request" in blocked.json()["detail"]
        assert dataset_scope.current_dataset_id() == MAIN
    finally:
        gate.set()
        worker.join(timeout=30)
    assert not worker.is_alive()
    # 请求收尾后完成：它读到的、渲染的都是 A 库那份正文。
    assert seen["status"] == 200
    assert "A 库正文" in seen["text"]

    # 排空完成 → 切换成功。
    assert _activate(client, other).status_code == 200
    # 同一个记录 ID 在 B 库是另一份正文（数据集彼此独立，ID 可以重合）。
    with database.SessionLocal() as session:
        session.add(
            ResumeRecord(
                id=record_id,
                title="B 库同号记录",
                content=_content("B 库正文：另一个数据集里的同号简历。"),
            )
        )
        session.commit()
    detail_b = client.get(f"/api/resumes/{record_id}")
    assert detail_b.status_code == 200, detail_b.text
    assert any("B 库正文" in text for text in values(detail_b.json()["content"]))
    preview_b = client.post(f"/api/resumes/{record_id}/preview-pdf", json={"page_limit": 1})
    assert preview_b.status_code == 200, preview_b.text
    text_b = _pdf_text(preview_b.content)
    assert "B 库正文" in text_b
    assert "A 库正文" not in text_b

    # 切回 A：正文回到 A 那一份，预览命中的也是 A 自己的缓存产物。
    assert _activate(client, MAIN).status_code == 200
    detail_a = client.get(f"/api/resumes/{record_id}")
    assert detail_a.status_code == 200, detail_a.text
    assert any("A 库正文" in text for text in values(detail_a.json()["content"]))
    preview_a = client.post(f"/api/resumes/{record_id}/preview-pdf", json={"page_limit": 1})
    assert preview_a.status_code == 200, preview_a.text
    text_a = _pdf_text(preview_a.content)
    assert "A 库正文" in text_a
    assert "B 库正文" not in text_a
    assert preview_a.headers.get("X-Content-Sha256") == seen["sha"]  # 切回命中 A 的缓存
    assert preview_b.headers.get("X-Content-Sha256") != seen["sha"]  # 没有把 A 的产物给 B
    assert pdf_preview_cache.stats()[0] == 2  # 两份正文各一份产物；切回不再多一份


# ===== (b) 无模型配置：核心编辑/检查/导出仍可用 =====


@needs_font
def test_be07_edit_check_export_work_without_model_config(client, external_network_guard):
    """没有大模型配置：编辑、检查、四种格式导出全走本地；生成给可读的 400。"""
    config = client.get("/api/settings/llm")
    assert config.status_code == 200, config.text
    body = config.json()
    assert body["base_url"] == ""
    assert body["model"] == ""
    assert body["api_key"] == ""

    record_id = _create_resume(client, "离线场景：没有模型配置也能编辑。")
    edited = client.put(
        f"/api/resumes/{record_id}/content",
        json={"content": _content("离线场景：编辑后的总结。"), "expected_revision": 0},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["revision"] == 1

    preflight = client.post(
        f"/api/resumes/{record_id}/preflight", json={"layers": ["content", "layout"]}
    )
    assert preflight.status_code == 200, preflight.text
    assert "content" in preflight.json()["layers_run"]
    assert preflight.json()["snapshot"]["content_sha256"]

    for fmt in ("pdf", "md", "html", "json"):
        exported = client.post(
            f"/api/resumes/{record_id}/export", json={"format": fmt, "page_limit": 1}
        )
        assert exported.status_code == 200, (fmt, exported.text)
        assert exported.content
        assert len(exported.headers["X-Content-Sha256"]) == 64

    pdf = client.post(f"/api/resumes/{record_id}/export", json={"format": "pdf", "page_limit": 1})
    assert "编辑后的总结" in _pdf_text(pdf.content)

    # 生成链路：没有配置就是可读的 400（本地前置校验），不联网、不抛 500、不建孤儿任务。
    assert (
        client.put(
            "/api/profile",
            json={
                "name": "示例用户",
                "projects": [
                    {"name": "示例项目", "role": "核心开发", "description": "本地示例项目"}
                ],
            },
        ).status_code
        == 200
    )
    blocked = client.post("/api/resumes/generate/tasks", json={})
    assert blocked.status_code == 400, blocked.text
    assert blocked.json()["detail"] == "尚未配置大模型 API"
    assert external_network_guard == []


# ===== (c) 无网络：本地检查/导出可用，联网动作快速失败 =====


@needs_font
def test_be07_local_check_and_export_survive_network_outage(client, external_network_guard):
    """出站 HTTP 全部失败（模拟断网）时：检查与导出照常；模型连通性测试回可读消息。"""
    record_id = _create_resume(client, "断网场景：本地导出与检查照常。")

    preflight = client.post(
        f"/api/resumes/{record_id}/preflight",
        json={"layers": ["content", "layout"], "purpose": "export"},
    )
    assert preflight.status_code == 200, preflight.text
    assert preflight.json()["snapshot"]["content_sha256"]

    for fmt in ("pdf", "md", "html", "json"):
        exported = client.post(
            f"/api/resumes/{record_id}/export", json={"format": fmt, "page_limit": 1}
        )
        assert exported.status_code == 200, (fmt, exported.text)
    preview = client.post(f"/api/resumes/{record_id}/preview-pdf", json={"page_limit": 1})
    assert preview.status_code == 200, preview.text
    assert "断网场景" in _pdf_text(preview.content)
    # 上面这些全是本地路径：应用没有发出任何一个出站 HTTP 请求。
    assert external_network_guard == []

    # 唯一真的会联网的动作：模型连通性测试。断网时它必须快速失败并回可读消息。
    probe = client.post(
        "/api/settings/llm/test",
        json={
            "base_url": "https://offline.invalid/v1",
            "api_key": "synthetic-offline-key",
            "model": "offline-model",
            "timeout_seconds": 10,
        },
    )
    assert probe.status_code == 200, probe.text
    result = probe.json()
    assert result["ok"] is False
    assert "无法连接" in result["message"]
    # 守卫确实拦到了那次尝试：前一段的"0 次"不是守卫没生效。
    assert external_network_guard, "模型连通性测试没有触发任何出站请求，守卫形同虚设"
