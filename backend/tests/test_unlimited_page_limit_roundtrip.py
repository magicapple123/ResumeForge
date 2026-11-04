# SPDX-License-Identifier: Apache-2.0
"""「不限篇幅」（``page_limit = 0``）的**存档往返**：0 不许在任何一层被折成 1 页。

``test_unlimited_page_limit.py`` 钉的是生成链路（请求契约、篇幅引导、篇幅闸门）；
本文件钉**存取链路**：读出来还是不是 0、存档里记的是不是 0、拿存档重放还是一条完整的
文件、快照/恢复会不会把「不限」记成 1 页。

为什么这一层单独一个文件：``page_limit`` 在语义层是"用户的篇幅承诺"，在渲染层是
"pdf_exporter.fit 的 max_pages"。两者用同一个数字表达，于是到处有人写
``... or 1`` —— 而 ``0 or 1`` 恰好等于最**严**的上限。这类缺陷不报错、不抛异常，
只在用户下载完文件数页数时暴露，而且**每一条链路都要单独钉**，漏一处就退回去。
"""

from __future__ import annotations

from io import BytesIO

import pytest
from app.models.resume import ResumeRecord
from app.schemas.resume import ResumeContent
from app.schemas.resume_generation import UNLIMITED_PAGE_LIMIT, UNLIMITED_RENDER_MAX_PAGES
from app.services.resume.document_versions import layout_snapshot
from app.services.resume.resume_delivery import (
    default_render_context,
    page_limit_or_default,
    replay_delivery_export,
)
from pypdf import PdfReader
from tests.test_pdf_exporter import needs_font

TRUNCATED_HEADER = "X-Resume-Truncated"
PAGES_HEADER = "X-Resume-Pages"
PAGE_LIMIT_HEADER = "X-Resume-Page-Limit"


def _pdf_pages(payload: bytes) -> int:
    """直接数产物里的页数：这是"用户下载到几页"最接近的断言。"""
    return len(PdfReader(BytesIO(payload)).pages)


def _long_content() -> dict:
    """一份**必然超过 2 页**的简历：让"被裁到 1 页"这件事在页数上看得见。"""
    return ResumeContent(
        name="林致远",
        phone="13800001234",
        email="lin.zhiyuan@example.com",
        city="杭州",
        job_intent="高级后端开发工程师",
        summary="十年后端开发经验，负责交易系统与基础中间件的设计与落地，长期承担跨团队技术方案评审。",
        experience=[
            {
                "company": f"示例科技{index}",
                "role": "后端工程师",
                "start_date": "2019-03",
                "end_date": "2024-06",
                "description": [
                    f"第 {index} 段经历：负责订单核心链路优化，平均响应时间从 180ms 降到 45ms。",
                    f"第 {index} 段经历：主导分库分表改造，完成 12 个业务表的平滑迁移，期间零故障。",
                    f"第 {index} 段经历：搭建灰度与回滚机制，把发布风险控制在一分钟内可回退。",
                ],
            }
            for index in range(5)
        ],
        projects=[
            {
                "name": f"异步任务调度平台 {index}",
                "role": "负责人",
                "description": [
                    "支撑每日百万级任务，失败自动重试与告警，任务积压可在五分钟内定位。",
                ],
            }
            for index in range(3)
        ],
        skills=[{"name": name, "level": "熟练"} for name in ("Python", "Go", "Redis", "MySQL")],
    ).model_dump()


def _make_resume(db, *, page_limit: int, content: dict | None = None) -> ResumeRecord:
    """直接落一条记录：``page_limit`` 想设成什么就设成什么（0 = 不限）。"""
    record = ResumeRecord(
        title=f"不限篇幅-{page_limit}",
        job_title="后端开发",
        company="示例科技",
        content=content if content is not None else _long_content(),
        warnings=[],
        source="ai",
        model="test-model",
        page_limit=page_limit,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def _deliveries(db) -> list:
    from app.models.resume_delivery import ResumeDeliveryRecord

    return list(db.query(ResumeDeliveryRecord).order_by(ResumeDeliveryRecord.id).all())


def _create_manual(client, content: dict | None = None) -> int:
    created = client.post(
        "/api/resumes/manual",
        json={"title": "手写不限篇幅", "content": content or _long_content(), "job_id": None},
    )
    assert created.status_code == 201, created.text
    return int(created.json()["id"])


def _patch_page_limit(client, resume_id: int, value: int) -> dict:
    """走真实的版式保存入口（这是"用户选了不限"唯一会落库的路径）。"""
    response = client.patch(f"/api/resumes/{resume_id}/layout", json={"page_limit": value})
    assert response.status_code == 200, response.text
    return response.json()


# ===== 1. 读路径：API 必须如实回答 0 =====


def test_api_answers_zero_after_saving_unlimited(client, db_session):
    """保存「不限」→ 读回来还是「不限」。

    写成 ``record.page_limit or 1`` 时，这里会拿到 1：编辑器的篇幅选择器立刻跳到最严的
    一档，用户会以为自己的选择没保存。
    """
    resume_id = _create_manual(client)

    saved = _patch_page_limit(client, resume_id, UNLIMITED_PAGE_LIMIT)
    assert saved["page_limit"] == UNLIMITED_PAGE_LIMIT

    detail = client.get(f"/api/resumes/{resume_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["page_limit"] == UNLIMITED_PAGE_LIMIT

    # 列表口径同源（同一个 ``_to_resume_out``）：两处显示的篇幅不许不一致。
    listed = client.get("/api/resumes", params={"limit": 50}).json()
    rows = listed["items"] if isinstance(listed, dict) else listed
    matched = [row for row in rows if row["id"] == resume_id]
    assert matched and matched[0]["page_limit"] == UNLIMITED_PAGE_LIMIT


# ===== 2. 存档语义：render_context / request_params 记的是 0 =====


def test_export_archive_records_zero_not_one(db_session, client):
    """导出存档里的 ``page_limit`` 是**语义值**：0 就是 0。

    存档是"当初那次交付"的证据。存 1 等于替用户改口，而且按它重放会导出 1 页。
    """
    record = _make_resume(db_session, page_limit=UNLIMITED_PAGE_LIMIT)

    response = client.post(
        f"/api/resumes/{record.id}/export",
        json={"format": "md", "record_delivery": True},
    )
    assert response.status_code == 200, response.text
    # 不限篇幅一个字节都不裁：裁剪头不该出现（"已按上限裁剪"是替用户说他没说过的话）。
    assert TRUNCATED_HEADER not in response.headers

    delivery = _deliveries(db_session)[0]
    assert delivery.render_context["page_limit"] == UNLIMITED_PAGE_LIMIT
    assert delivery.request_params["page_limit"] == UNLIMITED_PAGE_LIMIT


# ===== 3. 重放：存档重下出来仍是完整的那份文件 =====


@needs_font
def test_replay_keeps_every_page_of_an_unlimited_resume(db_session, client):
    """按存档重放：页数 == 当初导出的页数（≥2），且没有被裁。

    这是实测坏结果的正面版：修复前 ``render_context.page_limit`` 是 1，重放只导出 1 页，
    而用户当初下到的是 2 页以上——同一份证据，两份不同的文件。断言落在**真实 PDF 的
    页数**上（直接数重放出来的字节），而不是只看字典里的数字。
    """
    record = _make_resume(db_session, page_limit=UNLIMITED_PAGE_LIMIT)

    original = client.post(
        f"/api/resumes/{record.id}/export",
        json={"format": "pdf", "record_delivery": True},
    )
    assert original.status_code == 200, original.text
    pages = int(original.headers[PAGES_HEADER])
    assert pages >= 2, f"用例前提不成立：这份内容只排了 {pages} 页"
    # 语义值 0 走响应头：前端据此显示「不限」，而不是渲染保护上限 10。
    assert original.headers[PAGE_LIMIT_HEADER] == "0"
    assert TRUNCATED_HEADER not in original.headers

    delivery = _deliveries(db_session)[0]
    assert delivery.render_context["page_limit"] == UNLIMITED_PAGE_LIMIT
    assert delivery.pages == pages

    replay = client.get(f"/api/resumes/deliveries/{delivery.id}/download")
    assert replay.status_code == 200, replay.text
    assert _pdf_pages(replay.content) == pages

    # 直连重放函数再确认一次（产物级结论：页数对得上、没裁）。
    artifact = replay_delivery_export(delivery)
    assert artifact.pages == pages
    assert artifact.truncated is False
    assert _pdf_pages(artifact.content) == pages


# ===== 4. 快照与恢复：不限不会在版本平面上退化成 1 页 =====


def test_layout_snapshot_keeps_zero(db_session):
    record = _make_resume(db_session, page_limit=UNLIMITED_PAGE_LIMIT)
    assert default_render_context(db_session, record)["page_limit"] == UNLIMITED_PAGE_LIMIT
    assert layout_snapshot(db_session, record)["page_limit"] == UNLIMITED_PAGE_LIMIT


def test_version_roundtrip_keeps_unlimited(db_session, client):
    """拍版本 + 恢复一次，「不限」仍是「不限」（不是 1 页，也不是渲染保护上限 10）。"""
    resume_id = _create_manual(client)
    _patch_page_limit(client, resume_id, UNLIMITED_PAGE_LIMIT)

    created = client.post(f"/api/resumes/{resume_id}/versions", json={"name": "不限篇幅那一版"})
    assert created.status_code == 201, created.text
    version_id = created.json()["id"]

    restored = client.post(f"/api/resumes/{resume_id}/versions/{version_id}/restore", json={})
    assert restored.status_code == 200, restored.text
    assert restored.json()["resume"]["page_limit"] == UNLIMITED_PAGE_LIMIT
    assert client.get(f"/api/resumes/{resume_id}").json()["page_limit"] == UNLIMITED_PAGE_LIMIT


# ===== 5. 防过度修正：正常的页数一个都不许被改 =====


@pytest.mark.parametrize("page_limit", [1, 2, UNLIMITED_RENDER_MAX_PAGES])
def test_limited_records_keep_their_own_number(db_session, client, page_limit):
    record = _make_resume(db_session, page_limit=page_limit)
    assert default_render_context(db_session, record)["page_limit"] == page_limit
    assert layout_snapshot(db_session, record)["page_limit"] == page_limit

    response = client.post(
        f"/api/resumes/{record.id}/export",
        json={"format": "md", "record_delivery": True},
    )
    assert response.status_code == 200, response.text
    delivery = _deliveries(db_session)[0]
    assert delivery.render_context["page_limit"] == page_limit
    assert delivery.request_params["page_limit"] == page_limit


def test_page_limit_or_default_only_falls_back_on_missing():
    """只有"没有值"才回落 1；0 是一个**值**。"""
    assert page_limit_or_default(UNLIMITED_PAGE_LIMIT) == UNLIMITED_PAGE_LIMIT
    assert page_limit_or_default(2) == 2
    assert page_limit_or_default("3") == 3
    assert page_limit_or_default(None) == 1
    assert page_limit_or_default("") == 1
    assert page_limit_or_default("不是数字") == 1


# ===== 6. 助手链路：不限的记录按完整页数汇报，不谎报裁剪 =====


@needs_font
def test_assistant_status_reports_full_pages_for_unlimited(db_session):
    """助手工具对 0 的记录：页数是真实自然页数，不出现"超出上限被截断"。"""
    import json

    from app.services.assistant_tools.document_support import render_settings
    from app.services.assistant_tools.document_tools import _tool_get_resume_status

    record = _make_resume(db_session, page_limit=UNLIMITED_PAGE_LIMIT)

    settings = render_settings(db_session, record)
    assert settings["page_limit_is_unlimited"] is True
    # 渲染入口要正数上限：走 mode_page_limit 折成保护上限，绝不折成 1。
    assert settings["page_limit"] == UNLIMITED_RENDER_MAX_PAGES

    result = _tool_get_resume_status(db_session, {"resume_id": record.id})
    payload = json.loads(result.text)
    assert payload["pages"] >= 2
    assert payload["page_limit"] == UNLIMITED_PAGE_LIMIT
    assert payload["truncated_at"] is None
    assert "不限" in payload["reading"]
    assert "截断" not in payload["reading"]
