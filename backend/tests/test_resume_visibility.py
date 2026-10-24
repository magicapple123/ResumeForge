# SPDX-License-Identifier: Apache-2.0
"""W06：条目可见性/锁定字段的持久契约与导出过滤。

守四件事：

1. **三态序列化**：旧记录没有 ``hidden`` / ``lock_content`` / ``lock_layout``，序列化后
   也不会长出 ``null`` / ``false`` 键——内容指纹与黄金导出基线因此逐字节不变。
2. **保存往返**：六类条目各写一次标志 → GET 能读回；取消时**省略键**（而不是写
   ``false``）也能让键从 content JSON 里消失（W06-FE 的大纲 UI 就是这么写的）。
3. **导出过滤**：HTML / PDF 文本 / Word OOXML / Markdown / TXT / 交付 JSON 都排除
   hidden 条目；lock_* 只是标志，不影响可见性。六种格式共用
   ``services/resume/resume_visibility.visible_resume`` 这一份实现。
4. **内部数据保留**：详情接口与投递快照（``resume_delivery_record.content``）仍含隐藏
   正文；隐藏条目里的【待补】占位符不再拦导出，可见条目里的仍然拦。
"""

from __future__ import annotations

import io
import json
import re
import zipfile

import pytest
from app.database import SessionLocal
from app.models.resume_delivery import ResumeDeliveryRecord
from app.schemas.resume import (
    ResumeAward,
    ResumeCampusExperience,
    ResumeContent,
    ResumeEducation,
    ResumeExperience,
    ResumeProject,
    ResumeSkill,
)
from app.services.export_pipeline import ExportRequest, RenderContext, build_export
from app.services.pdf_exporter import build_resume_pdf
from app.services.resume.resume_visibility import is_hidden_entry, visible_resume
from pydantic import ValidationError
from test_pdf_exporter import needs_font

EXPORT = "/api/resumes/{id}/export"
RENDER = "/api/resumes/render"
PREVIEW_PDF = "/api/resumes/{id}/preview-pdf"

HIDDEN_PROBES = ("隐藏教育大学", "隐藏科技", "隐藏社团", "隐藏项目", "隐藏技能", "隐藏奖项")
VISIBLE_PROBES = ("可见教育大学", "可见科技", "可见社团", "可见项目", "Python", "可见奖项")


def _content() -> dict:
    """六类条目各两条：一条可见、一条 hidden，探针互不重叠。"""
    return {
        "name": "张三",
        "phone": "13800000000",
        "email": "zhangsan@example.com",
        "job_intent": "后端工程师",
        "summary": "三年后端开发经验。",
        "education": [
            {"school": "可见教育大学", "major": "计算机", "degree": "本科", "gpa": "3.8"},
            {"school": "隐藏教育大学", "major": "软件工程", "degree": "硕士", "hidden": True},
        ],
        "experience": [
            {"company": "可见科技", "role": "后端工程师", "description": ["负责订单链路。"]},
            {
                "company": "隐藏科技",
                "role": "实习生",
                "description": ["这段不应被导出。"],
                "hidden": True,
                "lock_content": True,
            },
        ],
        "campus_experience": [
            {"organization": "可见社团", "role": "负责人", "description": ["组织活动。"]},
            {
                "organization": "隐藏社团",
                "role": "成员",
                "description": ["不导出。"],
                "hidden": True,
            },
        ],
        "projects": [
            {"name": "可见项目", "role": "负责人", "description": ["上线了。"]},
            {"name": "隐藏项目", "role": "参与", "description": ["不导出。"], "hidden": True},
        ],
        "skills": [
            {"name": "Python", "level": "精通", "lock_content": True, "lock_layout": True},
            {"name": "隐藏技能", "level": "了解", "hidden": True},
        ],
        "awards": [
            {"name": "可见奖项", "date": "2024.01"},
            {"name": "隐藏奖项", "date": "2023.01", "hidden": True},
        ],
    }


def _resume() -> ResumeContent:
    return ResumeContent.model_validate(_content())


def _create(client, content: dict | None = None) -> int:
    created = client.post(
        "/api/resumes/manual",
        json={"title": "可见性用例", "content": content or _content(), "job_id": None},
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


def _compact(text: str) -> str:
    return re.sub(r"\s+", "", text)


def _assert_hidden_absent(text: str) -> None:
    compact = _compact(text)
    for probe in HIDDEN_PROBES:
        assert probe not in compact, f"隐藏条目泄漏到投递产物：{probe}"
    for probe in VISIBLE_PROBES:
        assert probe in compact, f"可见条目意外丢失：{probe}"


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


def _build(fmt: str) -> bytes:
    request = ExportRequest(format=fmt)
    context = RenderContext(template="classic", page_limit=2)
    return build_export(request, _resume(), context).content


# ===== 1. 序列化三态（旧记录字节不变的红线在 test_export_golden 里，这里钉字段语义）=====


def test_visibility_flags_are_tri_state_on_all_six_entry_models():
    for model in (
        ResumeEducation,
        ResumeExperience,
        ResumeCampusExperience,
        ResumeProject,
        ResumeSkill,
        ResumeAward,
    ):
        assert "hidden" not in model().model_dump(), model.__name__
        assert model(hidden=True).model_dump()["hidden"] is True, model.__name__
        assert model(hidden=False).model_dump()["hidden"] is False, model.__name__
        dumped = model(lock_content=True, lock_layout=True).model_dump()
        assert dumped["lock_content"] is True and dumped["lock_layout"] is True, model.__name__


def test_legacy_content_dump_has_no_visibility_keys():
    dumped = json.dumps(
        ResumeContent.model_validate({"name": "张三"}).model_dump(), ensure_ascii=False
    )
    for key in ("hidden", "lock_content", "lock_layout"):
        assert key not in dumped, f"旧内容序列化多出了 {key}：{dumped}"


def test_non_bool_visibility_flag_is_rejected():
    for kwargs in ({"hidden": "abc"}, {"lock_content": 2}, {"lock_layout": []}):
        with pytest.raises(ValidationError):
            ResumeExperience(**kwargs)


def test_visible_resume_is_identity_when_nothing_is_hidden():
    resume = ResumeContent.model_validate({"name": "张三", "experience": [{"company": "甲"}]})
    assert visible_resume(resume) is resume


def test_visible_resume_filters_all_six_and_keeps_input_intact():
    resume = _resume()
    published = visible_resume(resume)
    assert [item.school for item in published.education] == ["可见教育大学"]
    assert [item.company for item in published.experience] == ["可见科技"]
    assert [item.organization for item in published.campus_experience] == ["可见社团"]
    assert [item.name for item in published.projects] == ["可见项目"]
    assert [item.name for item in published.skills] == ["Python"]
    assert [item.name for item in published.awards] == ["可见奖项"]
    # 源内容一个字节都不能动：隐藏/恢复显示必须无损。
    assert len(resume.experience) == 2 and resume.experience[1].hidden is True
    assert is_hidden_entry({"hidden": True}) and not is_hidden_entry({"hidden": False})
    assert not is_hidden_entry({}) and not is_hidden_entry({"hidden": None})


# ===== 2. 保存往返与旧记录兼容 =====


def test_save_and_read_back_roundtrips_flags_for_all_six(client):
    resume_id = _create(client)
    content = client.get(f"/api/resumes/{resume_id}").json()["content"]
    assert content["education"][1]["hidden"] is True
    assert content["experience"][1]["hidden"] is True
    assert content["experience"][1]["lock_content"] is True
    assert content["campus_experience"][1]["hidden"] is True
    assert content["projects"][1]["hidden"] is True
    assert content["skills"][0]["lock_content"] is True
    assert content["skills"][0]["lock_layout"] is True
    assert content["skills"][1]["hidden"] is True
    assert content["awards"][1]["hidden"] is True


def test_omitting_a_flag_clears_it(client):
    """W06-FE 的取消口径：**省略键**（不写 false）也要让键从 content JSON 里消失。"""
    resume_id = _create(client)
    cleared = _content()
    for section in ("education", "experience", "skills"):
        for item in cleared[section]:
            item.pop("hidden", None)
            item.pop("lock_content", None)
            item.pop("lock_layout", None)
    response = client.put(f"/api/resumes/{resume_id}/content", json={"content": cleared})
    assert response.status_code == 200, response.text
    content = client.get(f"/api/resumes/{resume_id}").json()["content"]
    for section in ("education", "experience", "skills"):
        for item in content[section]:
            for key in ("hidden", "lock_content", "lock_layout"):
                assert key not in item, f"{section} 的 {key} 没有被省略语义清掉"


def test_legacy_record_reads_back_without_visibility_keys(client, db_session):
    legacy = {"name": "李四", "experience": [{"company": "甲公司"}], "skills": [{"name": "Go"}]}
    resume_id = _create(client, legacy)
    detail = client.get(f"/api/resumes/{resume_id}").json()["content"]
    assert "hidden" not in detail["experience"][0]
    # 旧客户端（不知道这三个字段）整份保存回来，也不能长出 null/false 键。
    response = client.put(f"/api/resumes/{resume_id}", json=legacy)
    assert response.status_code == 200, response.text
    again = client.get(f"/api/resumes/{resume_id}").json()["content"]
    assert "hidden" not in again["experience"][0]


def test_non_bool_flag_is_rejected_by_the_api(client):
    resume_id = _create(client)
    response = client.put(
        f"/api/resumes/{resume_id}",
        json={"name": "张三", "experience": [{"company": "甲", "hidden": "abc"}]},
    )
    assert response.status_code == 422, response.text


def test_visibility_flags_do_not_participate_in_id_validation(client):
    resume_id = _create(client, {"name": "张三"})
    # 只有可见性标志、没有 id：id 校验必须放行（它只管 id / point_ids）。
    ok = client.put(
        f"/api/resumes/{resume_id}",
        json={"name": "张三", "experience": [{"company": "甲", "hidden": True}]},
    )
    assert ok.status_code == 200, ok.text
    # 反过来，非法 id 仍然 422——隐藏标志不会把 id 校验绕过去。
    bad = client.put(
        f"/api/resumes/{resume_id}",
        json={"name": "张三", "experience": [{"company": "甲", "id": "bad id", "hidden": True}]},
    )
    assert bad.status_code == 422, bad.text
    assert "对象标识" in bad.text


# ===== 3. 六种投递产物都排除 hidden =====


def test_html_export_excludes_hidden_entries():
    raw = _build("html").decode("utf-8")
    _assert_hidden_absent(_html_text(raw))


def test_markdown_and_txt_exports_exclude_hidden_entries():
    _assert_hidden_absent(_build("md").decode("utf-8"))
    _assert_hidden_absent(_build("txt").decode("utf-8"))


def test_delivery_json_excludes_hidden_entries():
    payload = json.loads(_build("json").decode("utf-8"))
    assert [item["school"] for item in payload["education"]] == ["可见教育大学"]
    assert [item["company"] for item in payload["experience"]] == ["可见科技"]
    assert [item["organization"] for item in payload["campus_experience"]] == ["可见社团"]
    assert [item["name"] for item in payload["projects"]] == ["可见项目"]
    assert [item["name"] for item in payload["skills"]] == ["Python"]
    assert [item["name"] for item in payload["awards"]] == ["可见奖项"]
    # 锁只是标志：可见条目带着 lock_* 仍然必须出现在投递 JSON 里。
    assert payload["skills"][0]["lock_content"] is True
    assert payload["skills"][0]["lock_layout"] is True


def test_docx_excludes_hidden_entries():
    _assert_hidden_absent(_docx_text(_build("docx")))


@needs_font
def test_pdf_text_excludes_hidden_entries():
    _assert_hidden_absent(_pdf_text(_build("pdf")))


# ===== 4. 预览端点同样按纸面过滤（草稿/精确预览与下载必须长得一样）=====


def test_draft_html_render_excludes_hidden_entries(client):
    response = client.post(RENDER, json={"content": _content(), "template": "classic"})
    assert response.status_code == 200, response.text
    _assert_hidden_absent(_html_text(response.text))


@needs_font
def test_exact_preview_pdf_excludes_hidden_entries(client):
    resume_id = _create(client)
    response = client.post(PREVIEW_PDF.format(id=resume_id), json={"page_limit": 2})
    assert response.status_code == 200, response.text
    _assert_hidden_absent(_pdf_text(response.content))


# ===== 5. 内部数据保留：详情与投递快照仍含隐藏正文 =====


def test_detail_and_delivery_snapshot_keep_hidden_content(client):
    resume_id = _create(client)
    detail = client.get(f"/api/resumes/{resume_id}").json()["content"]
    assert detail["experience"][1]["hidden"] is True, "详情接口是编辑态，必须保留隐藏正文"

    response = client.post(
        EXPORT.format(id=resume_id), json={"format": "html", "record_delivery": True}
    )
    assert response.status_code == 200, response.text
    assert "隐藏科技" not in _compact(_html_text(response.text))

    with SessionLocal() as db:
        snapshots = db.query(ResumeDeliveryRecord).all()
    assert snapshots, "record_delivery=true 必须落一份投递快照"
    snapshot = snapshots[-1].content
    companies = [item.get("company") for item in snapshot["experience"]]
    assert "隐藏科技" in companies, "内部投递快照必须保留隐藏正文（否则恢复显示成了删除）"
    assert "hidden" in snapshot["experience"][1]


# ===== 6. 导出闸门只看纸面：隐藏条目里的【待补】不拦导出 =====


def test_completeness_gate_ignores_hidden_placeholders(client):
    visible = {"name": "张三", "summary": "性能提升【待补：具体倍数】。"}
    resume_id = _create(client, visible)
    blocked = client.post(EXPORT.format(id=resume_id), json={"format": "html"})
    assert blocked.status_code == 409, blocked.text
    assert "未完成标记" in blocked.text

    hidden = {
        "name": "李四",
        "summary": "正常内容。",
        "experience": [
            {
                "company": "甲公司",
                "role": "工程师",
                "description": ["性能提升【待补：具体倍数】。"],
                "hidden": True,
            }
        ],
    }
    resume_id = _create(client, hidden)
    exported = client.post(EXPORT.format(id=resume_id), json={"format": "html"})
    assert exported.status_code == 200, exported.text
    assert "【待补" not in exported.text


def test_visible_pdf_export_keeps_the_same_page_count_after_filtering():
    """过滤后的 PDF 仍能正常出产物（不是"排到一半因为空章节崩掉"）。"""
    artifact = build_resume_pdf(_resume(), template="classic", page_limit=2)
    assert artifact.content[:5] == b"%PDF-"
    assert artifact.pages == 1
