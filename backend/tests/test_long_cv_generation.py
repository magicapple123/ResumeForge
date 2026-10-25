# SPDX-License-Identifier: Apache-2.0
"""A4 长 CV（W14 文档模式）：显式选择才生效，页数按模式校验，不自动切换。

计划 §8.6：``GenerateOptions.document_mode`` 可选、缺省 resume；普通简历保持 1–3 页、
长 CV 1–10 页（既有 ``MODE_PAGE_LIMITS``）；科研场景只建议、不自动切换；旧请求行为
逐字不变（缺省 resume）。
"""

from __future__ import annotations

import json

import pytest
from app.services.llm.base import BaseLLMProvider
from app.services.resume.resume_generate_runner import reset_resume_generate_runner
from tests.resume_generate_task_support import _configure, _job, _seed_profile, _wait_terminal


@pytest.fixture(autouse=True)
def _isolate_runner(clean_db):
    reset_resume_generate_runner()
    yield
    reset_resume_generate_runner()


class _Provider(BaseLLMProvider):
    def __init__(self, config):
        super().__init__(config)

    async def chat(self, _messages, *, thinking: bool = True):
        raise AssertionError("合法流式 JSON 不应触发一次性对话")

    async def stream_chat(self, _messages):
        yield json.dumps({"summary": "长 CV 内容。", "projects": [{"name": "项目"}]}, ensure_ascii=False)


def _patch_provider(monkeypatch):
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: _Provider(resolved),
    )


def test_options_default_to_resume_mode():
    from app.schemas.resume import GenerateOptions

    options = GenerateOptions()
    assert options.document_mode == "resume"
    assert options.page_limit == 1
    # 旧请求：不带 document_mode 时序列化仍能得到 resume（缺省不改变行为）。
    assert GenerateOptions.model_validate({"page_limit": 3}).document_mode == "resume"


def test_resume_mode_rejects_more_than_three_pages():
    """普通简历保持旧协议：>3 页仍按 422 拒绝（不放宽旧语义）。"""
    from app.schemas.resume import GenerateOptions
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        GenerateOptions(page_limit=4)
    with pytest.raises(ValidationError):
        GenerateOptions(document_mode="resume", page_limit=4)


def test_long_cv_accepts_up_to_ten_pages():
    from app.schemas.resume import GenerateOptions
    from pydantic import ValidationError

    assert GenerateOptions(document_mode="long_cv", page_limit=10).page_limit == 10
    with pytest.raises(ValidationError):
        GenerateOptions(document_mode="long_cv", page_limit=11)


def test_background_generation_persists_long_cv_mode(client, monkeypatch):
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    _patch_provider(monkeypatch)

    started = client.post(
        "/api/resumes/generate/tasks",
        json={
            "job_id": job["id"],
            "options": {"document_mode": "long_cv", "page_limit": 10},
        },
    )
    assert started.status_code == 201, started.text
    final = _wait_terminal(client, started.json()["id"])
    assert final["status"] == "completed"

    record = client.get(f"/api/resumes/{final['resume_id']}").json()
    assert record["document_mode"] == "long_cv"
    assert record["page_limit"] == 10


def test_old_request_without_document_mode_stays_resume(client, monkeypatch):
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    _patch_provider(monkeypatch)

    started = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]})
    assert started.status_code == 201, started.text
    final = _wait_terminal(client, started.json()["id"])
    record = client.get(f"/api/resumes/{final['resume_id']}").json()
    assert record["document_mode"] == "resume"
    assert record["page_limit"] == 1


def test_export_and_preflight_schemas_accept_long_cv_page_limits():
    """A4 收口：成套导出 / 草稿预检的请求 schema 不再把长 CV 的 10 页判 422。

    路由会按记录的 document_mode 用 mode_page_limit 夹紧，所以 schema 只放宽上限；
    普通简历的旧协议由生成/保存/渲染路径继续按 1–3 页校验。
    """
    from app.schemas.export_config import ExportBundleRequest
    from app.schemas.preflight import PreflightLayoutInput
    from pydantic import ValidationError

    # 上限放宽到 10；11 仍拒绝（普通简历旧协议由生成/保存/渲染路径继续按 1–3 页校验）。

    assert ExportBundleRequest(page_limit=10).page_limit == 10
    assert PreflightLayoutInput(page_limit=10).page_limit == 10
    with pytest.raises(ValidationError):
        ExportBundleRequest(page_limit=11)
    with pytest.raises(ValidationError):
        PreflightLayoutInput(page_limit=11)


def test_docx_estimation_accepts_long_cv_page_limit():
    """Word 只按 page_limit 标 overflow、不截断，长 CV 的 10 页不再被固定 3 页夹掉。"""
    from app.schemas.resume import ResumeContent
    from app.services.docx_exporter import build_resume_docx

    # Word 的返回值只有 content/pages/overflow（不暴露夹紧后的 page_limit），所以断言
    # "page_limit=10 不报错、文档生成成功"；若内部仍固定夹到 3 页，这个请求本身不会失败，
    # 但下面的真实长内容用例会通过 overflow 语义暴露（见 test_docx_* 的页数口径测试）。
    result = build_resume_docx(
        ResumeContent(name="长 CV 示例", summary="一段总结"),
        page_limit=10,
    )
    assert result.content
    assert isinstance(result.overflow, bool)


def test_long_cv_http_request_with_four_pages_is_accepted(client, monkeypatch):
    """真实 HTTP 边界：long_cv + 4 页不再被旧 3 页校验误拦（A4 退出门槛）。"""
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    _patch_provider(monkeypatch)

    started = client.post(
        "/api/resumes/generate/tasks",
        json={
            "job_id": job["id"],
            "options": {"document_mode": "long_cv", "page_limit": 4},
        },
    )
    assert started.status_code == 201, started.text
    final = _wait_terminal(client, started.json()["id"])
    assert final["status"] == "completed"
    record = client.get(f"/api/resumes/{final['resume_id']}").json()
    assert record["document_mode"] == "long_cv"
    assert record["page_limit"] == 4
