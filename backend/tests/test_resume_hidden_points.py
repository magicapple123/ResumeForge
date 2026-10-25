# SPDX-License-Identifier: Apache-2.0
"""W06 补项：要点级隐藏（hidden_points）——数据契约 + 八条出口的过滤一致性。

条目级 hidden 是"整条不投递"；要点级 hidden_points 是"这一条里的某几行不投递"。
它存 point_ids 映射里的要点 id（不是下标：复制/排序/插入都会让下标漂移），
过滤后必须同步裁剪 point_ids 映射，保证"数组与 id 等长"的不变量继续成立。

四个契约维度：

1. **序列化三态**：None 与空列表都不落键（旧记录 / 旧内容指纹逐字节不变）；
2. **过滤唯一实现**：visible_resume 同时处理条目级与要点级；缺 point_ids 的旧记录不猜；
3. **六种投递产物**（HTML/PDF/Word/MD/TXT/交付 JSON）都排除隐藏要点；
4. **内部数据保留**：详情接口与投递快照仍含隐藏要点原文（隐藏必须可恢复）。
"""

from __future__ import annotations

import io
import json
import re
import zipfile

import pytest
from app.database import SessionLocal
from app.models.resume_delivery import ResumeDeliveryRecord
from app.schemas.resume import ResumeContent, ResumeExperience
from app.services.export_pipeline import ExportRequest, RenderContext, build_export
from app.services.resume.resume_visibility import visible_resume
from pydantic import ValidationError
from test_pdf_exporter import needs_font

EXPORT = "/api/resumes/{id}/export"

POINT_HIDDEN_PROBES = ("隐藏要点甲", "隐藏要点乙")
POINT_VISIBLE_PROBES = ("可见要点甲", "可见要点乙", "可见要点丙", "可见亮点")


def _point_content() -> dict:
    """一条经历 + 一条项目，各带一个被隐藏的要点（探针互不重叠）。"""
    return {
        "name": "张三",
        "job_intent": "后端工程师",
        "experience": [
            {
                "company": "可见科技",
                "role": "工程师",
                "description": ["可见要点甲", "隐藏要点甲", "可见要点乙"],
                "point_ids": {"description": ["pnt0000001", "pnt0000002", "pnt0000003"]},
                "hidden_points": ["pnt0000002"],
            }
        ],
        "projects": [
            {
                "name": "可见项目",
                "description": ["隐藏要点乙", "可见要点丙"],
                "highlights": ["可见亮点"],
                "point_ids": {
                    "description": ["pnt0000004", "pnt0000005"],
                    "highlights": ["pnt0000006"],
                },
                "hidden_points": ["pnt0000004"],
            }
        ],
    }


def _point_resume() -> ResumeContent:
    return ResumeContent.model_validate(_point_content())


def _create(client, content: dict) -> int:
    created = client.post(
        "/api/resumes/manual",
        json={"title": "要点隐藏用例", "content": content, "job_id": None},
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


def _build(fmt: str) -> bytes:
    request = ExportRequest(format=fmt)
    context = RenderContext(template="classic", page_limit=2)
    return build_export(request, _point_resume(), context).content


def _compact(text: str) -> str:
    return re.sub(r"\s+", "", text or "")


def _html_text(raw: str) -> str:
    body = re.sub(r"<(script|style)\b[^>]*>.*?</\1\s*>", "", raw, flags=re.S | re.I)
    return re.sub(r"<[^>]+>", "", body)


def _docx_text(content: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(content)) as bundle:
        xml = bundle.read("word/document.xml").decode("utf-8")
    return re.sub(r"<[^>]+>", "", xml)


def _pdf_text(content: bytes) -> str:
    from pypdf import PdfReader

    return "".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(content)).pages)


def _assert_point_visibility(text: str) -> None:
    probe = _compact(text)
    for hidden in POINT_HIDDEN_PROBES:
        assert hidden not in probe, f"隐藏要点泄漏到投递产物：{hidden}"
    for visible in POINT_VISIBLE_PROBES:
        assert visible in probe, f"可见要点被误删：{visible}"


# ===== 1. 序列化三态 =====


def test_hidden_points_is_tri_state_and_empty_is_omitted():
    for kwargs in ({}, {"hidden_points": None}, {"hidden_points": []}):
        assert "hidden_points" not in ResumeExperience(company="甲", **kwargs).model_dump()
    dumped = ResumeExperience(company="甲", hidden_points=["pnt0000001"]).model_dump()
    assert dumped["hidden_points"] == ["pnt0000001"]
    for bad in ("abc", {"a": 1}, 3):
        with pytest.raises(ValidationError):
            ResumeExperience(company="甲", hidden_points=bad)


# ===== 2. 过滤唯一实现 =====


def test_visible_resume_filters_hidden_points_and_keeps_ids_aligned():
    resume = _point_resume()
    published = visible_resume(resume)

    experience = published.experience[0]
    assert experience.description == ["可见要点甲", "可见要点乙"]
    assert experience.point_ids == {"description": ["pnt0000001", "pnt0000003"]}
    project = published.projects[0]
    assert project.description == ["可见要点丙"]
    assert project.highlights == ["可见亮点"]
    assert project.point_ids == {"description": ["pnt0000005"], "highlights": ["pnt0000006"]}
    # 源内容一个字节都不能动：隐藏必须是可恢复的。
    assert resume.experience[0].description == ["可见要点甲", "隐藏要点甲", "可见要点乙"]
    assert resume.experience[0].hidden_points == ["pnt0000002"]


def test_hidden_points_without_usable_ids_are_ignored():
    """旧记录没有 point_ids / 长度对不上时不能按位置猜：整段原样保留。"""
    legacy = ResumeContent.model_validate(
        {
            "name": "张三",
            "experience": [
                {"company": "甲", "description": ["一", "二"], "hidden_points": ["pnt0000009"]}
            ],
            "projects": [
                {
                    "name": "项目",
                    "description": ["一", "二"],
                    "point_ids": {"description": ["pnt0000001"]},
                    "hidden_points": ["pnt0000001"],
                }
            ],
        }
    )
    published = visible_resume(legacy)
    assert published.experience[0].description == ["一", "二"]
    assert published.projects[0].description == ["一", "二"]


# ===== 3. 六种投递产物 =====


def test_html_and_text_products_exclude_hidden_points():
    _assert_point_visibility(_html_text(_build("html").decode("utf-8")))
    _assert_point_visibility(_build("md").decode("utf-8"))
    _assert_point_visibility(_build("txt").decode("utf-8"))


def test_delivery_json_excludes_hidden_point_text():
    payload = json.loads(_build("json").decode("utf-8"))
    assert payload["experience"][0]["description"] == ["可见要点甲", "可见要点乙"]
    assert payload["experience"][0]["point_ids"] == {"description": ["pnt0000001", "pnt0000003"]}
    assert payload["projects"][0]["description"] == ["可见要点丙"]
    assert payload["projects"][0]["highlights"] == ["可见亮点"]


def test_docx_excludes_hidden_point_text():
    _assert_point_visibility(_docx_text(_build("docx")))


@needs_font
def test_pdf_text_excludes_hidden_point_text():
    _assert_point_visibility(_pdf_text(_build("pdf")))


# ===== 4. 保存往返与内部数据保留 =====


def test_save_and_clear_roundtrip_for_hidden_points(client):
    resume_id = _create(client, _point_content())
    detail = client.get(f"/api/resumes/{resume_id}").json()["content"]
    assert detail["experience"][0]["hidden_points"] == ["pnt0000002"]

    cleared = _point_content()
    for section in ("experience", "projects"):
        for item in cleared[section]:
            item.pop("hidden_points", None)
    response = client.put(f"/api/resumes/{resume_id}/content", json={"content": cleared})
    assert response.status_code == 200, response.text
    again = client.get(f"/api/resumes/{resume_id}").json()["content"]
    assert "hidden_points" not in again["experience"][0]
    assert "hidden_points" not in again["projects"][0]


def test_api_rejects_non_list_hidden_points(client):
    resume_id = _create(client, {"name": "张三"})
    bad = {"name": "张三", "experience": [{"company": "甲", "hidden_points": "abc"}]}
    response = client.put(f"/api/resumes/{resume_id}", json=bad)
    assert response.status_code == 422, response.text


def test_engineering_snapshot_keeps_hidden_point_text(client):
    """内部投递快照保留隐藏要点原文（否则"恢复显示"等于删除）。"""
    resume_id = _create(client, _point_content())
    response = client.post(
        EXPORT.format(id=resume_id), json={"format": "html", "record_delivery": True}
    )
    assert response.status_code == 200, response.text
    _assert_point_visibility(_html_text(response.text))

    with SessionLocal() as db:
        snapshots = db.query(ResumeDeliveryRecord).all()
    assert snapshots, "record_delivery=true 必须落一份投递快照"
    snapshot = snapshots[-1].content
    assert snapshot["experience"][0]["description"] == ["可见要点甲", "隐藏要点甲", "可见要点乙"]
    assert snapshot["experience"][0]["hidden_points"] == ["pnt0000002"]


def test_product_text_expectations_skip_hidden_points_and_metadata():
    """W11 产物层检查不能把隐藏要点 / 要点 id 当成"应该出现在 PDF 里的文字"（假 blocker）。"""
    from app.services.resume.product_text import expected_lines

    lines = expected_lines(_point_resume())
    joined = "\n".join(lines)
    for hidden in POINT_HIDDEN_PROBES:
        assert hidden not in joined
    for visible in POINT_VISIBLE_PROBES:
        assert visible in joined
    for point_id in ("pnt0000001", "pnt0000002"):
        assert point_id not in joined


# ===== 5. 真实入口：草稿/精确预览与导出闸门 =====

RENDER = "/api/resumes/render"
PREVIEW_PDF = "/api/resumes/{id}/preview-pdf"


def test_draft_html_render_excludes_hidden_points(client):
    response = client.post(RENDER, json={"content": _point_content(), "template": "classic"})
    assert response.status_code == 200, response.text
    _assert_point_visibility(_html_text(response.text))


@needs_font
def test_exact_preview_pdf_excludes_hidden_points(client):
    resume_id = _create(client, _point_content())
    response = client.post(PREVIEW_PDF.format(id=resume_id), json={"page_limit": 2})
    assert response.status_code == 200, response.text
    _assert_point_visibility(_pdf_text(response.content))


def test_hidden_point_placeholder_does_not_block_export(client):
    """要点级隐藏与条目级同口径：隐藏要点里的【待补】不拦导出，可见要点里的照旧拦。"""
    visible_blocked = _point_content()
    visible_blocked["experience"][0]["description"][0] = "性能提升【待补：具体倍数】。"
    resume_id = _create(client, visible_blocked)
    blocked = client.post(EXPORT.format(id=resume_id), json={"format": "html"})
    assert blocked.status_code == 409, blocked.text

    hidden_ok = _point_content()
    hidden_ok["experience"][0]["description"][1] = "性能提升【待补：具体倍数】。"
    resume_id = _create(client, hidden_ok)
    exported = client.post(EXPORT.format(id=resume_id), json={"format": "html"})
    assert exported.status_code == 200, exported.text
    assert "【待补" not in exported.text
