"""导出服务测试。"""
import json

from app.schemas.resume import (
    ResumeAward,
    ResumeContent,
    ResumeEducation,
    ResumeExperience,
    ResumeProject,
    ResumeSkill,
)
from app.services.exporter import build_filename, export_json, export_markdown, render_html, sanitize_filename

RESUME = ResumeContent(
    name="张三",
    phone="13800000000",
    email="zhangsan@example.com",
    city="天津",
    job_intent="后端开发工程师",
    summary="一句话总结。",
    education=[
        ResumeEducation(school="天津工业大学", major="软件工程", degree="本科", gpa="3.8/4.0", courses=["数据结构"])
    ],
    experience=[ResumeExperience(company="某科技公司", role="后端实习生", description=["负责服务开发"])],
    projects=[ResumeProject(name="简历通", tech_stack=["Python", "FastAPI"], highlights=["已开源"])],
    skills=[ResumeSkill(name="Python", level="熟练")],
    awards=[ResumeAward(name="奖学金", date="2024.10")],
)

PHOTO_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl2kAAAAASUVORK5CYII="
)


def test_export_json_roundtrip():
    data = json.loads(export_json(RESUME))
    assert data["name"] == "张三"
    assert ResumeContent.model_validate(data) == RESUME


def test_export_markdown_contains_sections():
    markdown = export_markdown(RESUME)
    for section in ("# 张三 · 后端开发工程师", "## 教育经历", "## 实习/工作经历", "## 项目经历", "## 专业技能", "## 荣誉奖项"):
        assert section in markdown
    assert "- Python（熟练）" in markdown


def test_render_html_escapes_script_tags():
    # 大模型输出可能夹带 HTML，模板必须自动转义防 XSS
    malicious = RESUME.model_copy(update={"summary": "<script>alert(1)</script>保持专业"})
    html = render_html(malicious)
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html
    assert "张三" in html


def test_exports_render_photo_without_empty_placeholder():
    with_photo = RESUME.model_copy(update={"photo": PHOTO_DATA_URL})

    html = render_html(with_photo)
    assert '<img class="profile-photo"' in html
    assert f'src="{PHOTO_DATA_URL}"' in html
    assert f"![个人照片]({PHOTO_DATA_URL})" in export_markdown(with_photo)
    assert '<img class="profile-photo"' not in render_html(RESUME)


def test_filename_sanitize_and_build():
    assert sanitize_filename("a/b\\c:d*e?f") == "a_b_c_d_e_f"
    assert sanitize_filename("...") == "resume"
    filename = build_filename(RESUME, "md")
    assert filename.startswith("张三-后端开发工程师-") and filename.endswith(".md")
