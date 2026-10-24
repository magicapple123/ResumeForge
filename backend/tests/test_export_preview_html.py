# SPDX-License-Identifier: Apache-2.0
"""``POST /api/resumes/{id}/export`` 的 ``preview`` 开关（2026-10-24）。

简历中心每点开一份简历都会取一次 ``format=html`` 的渲染产物，走的就是这条导出管线。
默认行为（落一份副本、不进结果缓存）对"用户真的要下载一个文件"是对的，对"屏幕上
看一眼"则是纯浪费：既写盘，又让每次重新打开都从头排一遍。

本文件守三件事：

1. ``preview=true`` **不落盘**：即使设置了「生成内容保存位置」也不写文件、不返回
   ``X-Saved-To``；
2. ``preview=true`` **同一组输入只排一趟**：第二次直接回上一次的字节；
3. ``preview`` 缺省时行为**一字未变**：仍然落盘、仍然返回 ``X-Saved-To`` —— 这是
   "换个参数只为预览省事"与"悄悄改了导出语义"的分界线。
"""

from __future__ import annotations

from urllib.parse import unquote

from app.database import SessionLocal
from app.schemas.resume import ResumeContent
from app.services.settings_service import save_export_save_location

EXPORT = "/api/resumes/{id}/export"


def _resume() -> ResumeContent:
    return ResumeContent(
        name="李四",
        phone="13900000000",
        email="lisi@example.com",
        job_intent="前端工程师",
        summary="四年前端开发经验，负责中后台体系与组件库建设。",
        experience=[
            {
                "company": "示例网络",
                "role": "前端工程师",
                "start_date": "2020-07",
                "end_date": "2024-05",
                "description": ["主导组件库从 0 到 1，覆盖 60+ 业务页面。"],
            }
        ],
        skills=[{"name": "TypeScript", "level": "熟练"}],
    )


def _create_resume(client) -> int:
    created = client.post(
        "/api/resumes/manual",
        json={"title": "预览性能", "content": _resume().model_dump(), "job_id": None},
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


def _html(client, resume_id: int, *, preview: bool):
    return client.post(
        EXPORT.format(id=resume_id),
        json={"format": "html", "preview": preview},
    )


def test_preview_request_neither_saves_a_copy_nor_reports_a_location(client, tmp_path):
    resume_id = _create_resume(client)
    with SessionLocal() as db:
        save_export_save_location(db, str(tmp_path))

    response = _html(client, resume_id, preview=True)

    assert response.status_code == 200, response.text
    assert response.headers.get("X-Saved-To") is None
    # 目录里必须**什么都没有**：预览不是用户要的文件。
    assert list(tmp_path.iterdir()) == []
    assert "<html" in response.text.lower()


def test_preview_request_serves_the_second_call_from_cache(client, tmp_path, monkeypatch):
    resume_id = _create_resume(client)
    with SessionLocal() as db:
        save_export_save_location(db, str(tmp_path))

    # 第二次不落盘是**缓存命中**的结果，不是"碰巧没写"：把渲染入口换成计数器，
    # 数一数到底排了几趟（HTTP 层计数只能说明收到几个请求）。
    from app.services import export_pipeline

    calls: list[int] = []
    original = export_pipeline.render_html

    def counting(*args, **kwargs):  # noqa: ANN002, ANN003 - 只数次数
        calls.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(export_pipeline, "render_html", counting)

    first = _html(client, resume_id, preview=True)
    second = _html(client, resume_id, preview=True)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.content == first.content
    # 只排了第一趟；第二次命中缓存，连 render_html 都没进。
    assert len(calls) == 1
    assert list(tmp_path.iterdir()) == []


def test_export_without_preview_still_saves_a_copy(client, tmp_path):
    """缺省语义不变：真正的导出仍然会落盘并返回保存位置。"""
    resume_id = _create_resume(client)
    with SessionLocal() as db:
        save_export_save_location(db, str(tmp_path))

    response = _html(client, resume_id, preview=False)

    assert response.status_code == 200, response.text
    saved_to = response.headers.get("X-Saved-To")
    assert saved_to is not None
    assert unquote(saved_to).startswith(str(tmp_path))
    assert len(list(tmp_path.iterdir())) == 1
