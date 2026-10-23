# SPDX-License-Identifier: Apache-2.0
"""导出服务测试。"""

import base64
import json
import re

import pytest
from app.schemas.resume import (
    ResumeAward,
    ResumeCampusExperience,
    ResumeContent,
    ResumeEducation,
    ResumeExperience,
    ResumeProject,
    ResumeSkill,
)
from app.services import user_fonts
from app.services.exporter import (
    build_filename,
    export_json,
    export_markdown,
    render_html,
    sanitize_filename,
)
from app.services.resume.resume_sample import sample_resume_content
from app.services.resume.resume_template_catalog import RESUME_TEMPLATES
from tests.font_fixtures import build_test_font, write_font

RESUME = ResumeContent(
    name="张三",
    phone="13800000000",
    email="zhangsan@example.com",
    city="天津",
    job_intent="后端开发工程师",
    summary="一句话总结。",
    education=[
        ResumeEducation(
            school="天津工业大学",
            major="软件工程",
            degree="本科",
            gpa="3.8/4.0",
            courses=["数据结构"],
        )
    ],
    experience=[
        ResumeExperience(company="某科技公司", role="后端实习生", description=["负责服务开发"])
    ],
    campus_experience=[
        ResumeCampusExperience(
            organization="学生会",
            role="宣传部部长",
            start_date="2023.09",
            end_date="2024.06",
            description=["策划校园活动"],
        )
    ],
    projects=[
        ResumeProject(name="简历通", tech_stack=["Python", "FastAPI"], highlights=["已开源"])
    ],
    skills=[ResumeSkill(name="Python", level="熟练")],
    awards=[ResumeAward(name="奖学金", date="2024.10")],
)

PHOTO_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl2kAAAAASUVORK5CYII="
)


@pytest.fixture(autouse=True)
def font_dir(tmp_path, monkeypatch):
    """所有渲染用例都在空字体目录里跑：不去读开发机上真实选中的字体。"""
    monkeypatch.setattr(user_fonts, "DATA_DIR", str(tmp_path))
    return tmp_path


def _activate_test_font() -> None:
    write_font("测试字体.ttf", build_test_font())
    user_fonts.set_active("测试字体.ttf")


def test_export_json_roundtrip():
    data = json.loads(export_json(RESUME))
    assert data["name"] == "张三"
    assert ResumeContent.model_validate(data) == RESUME


def test_export_json_excludes_photo_data_url():
    with_photo = RESUME.model_copy(update={"photo": PHOTO_DATA_URL})
    data = json.loads(export_json(with_photo))
    assert "photo" not in data


def test_export_markdown_contains_sections():
    markdown = export_markdown(RESUME)
    for section in (
        "# 张三 · 后端开发工程师",
        "## 教育经历",
        "## 实习/工作经历",
        "## 校园经历",
        "## 项目经历",
        "## 专业技能",
        "## 荣誉奖项",
    ):
        assert section in markdown
    assert "- Python（熟练）" in markdown
    assert "### 学生会 · 宣传部部长" in markdown


def test_render_html_escapes_script_tags():
    # 大模型输出可能夹带 HTML，模板必须自动转义防 XSS
    malicious = RESUME.model_copy(update={"summary": "<script>alert(1)</script>保持专业"})
    html = render_html(malicious)
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html
    assert "张三" in html
    assert "校园经历" in html
    assert "学生会" in html


def test_exports_render_photo_without_empty_placeholder():
    with_photo = RESUME.model_copy(update={"photo": PHOTO_DATA_URL})

    html = render_html(with_photo)
    assert '<img class="profile-photo"' in html
    assert f'src="{PHOTO_DATA_URL}"' in html
    assert PHOTO_DATA_URL not in export_markdown(with_photo)
    assert '<img class="profile-photo"' not in render_html(RESUME)


def test_render_html_does_not_include_print_button():
    html = render_html(RESUME)
    assert "print-bar" not in html
    assert "打印 / 另存为 PDF" not in html


def test_render_html_uses_single_a4_page_layout():
    html = render_html(RESUME)

    assert "width: 210mm" in html
    assert "height: 297mm" in html
    assert "@page { size: A4; margin: 0; }" in html


def test_render_html_uses_a_unique_nonce_for_the_a4_script():
    first_html = render_html(RESUME)
    second_html = render_html(RESUME)
    first_nonce = re.search(r'<script nonce="([a-f0-9]+)">', first_html)
    second_nonce = re.search(r'<script nonce="([a-f0-9]+)">', second_html)

    assert first_nonce is not None
    assert second_nonce is not None
    assert first_nonce.group(1) != second_nonce.group(1)
    assert f"script-src 'nonce-{first_nonce.group(1)}'" in first_html
    assert "script-src 'unsafe-inline'" not in first_html


def test_filename_sanitize_and_build():
    assert sanitize_filename("a/b\\c:d*e?f") == "a_b_c_d_e_f"
    assert sanitize_filename("...") == "resume"
    filename = build_filename(RESUME, "md")
    assert filename.startswith("张三-后端开发工程师-") and filename.endswith(".md")


# ===== md / json 的字段完整性（"同一份简历几个输出说得不一样"的防线）=====


def _flatten_texts(value) -> list[str]:
    """把任意层级的字段值摊平成"应当出现在导出文本里的字符串"。"""
    if isinstance(value, dict):
        return [text for child in value.values() for text in _flatten_texts(child)]
    if isinstance(value, list):
        return [text for child in value for text in _flatten_texts(child)]
    if value is None or value == "" or value == 0:
        return []
    return [str(value)]


def test_markdown_export_covers_every_field_the_preview_shows():
    """md 导出必须覆盖所有非空字段（照片是**唯一**且有意的例外）。

    漏字段这种事**用户极难发现**——只有哪天把内容复制粘贴到招聘网站时才会觉得"怎么少了一行"。
    所以这里按字段逐个断言，而不是抽查几个代表。样本里刻意补上性别与出生年：它们以前
    只有预览里有、md 里没有。
    """
    resume = sample_resume_content().model_copy(update={"gender": "男", "birth_year": "1999"})

    markdown = export_markdown(resume)

    for name, value in resume.model_dump(exclude={"photo"}).items():
        for text in _flatten_texts(value):
            assert text in markdown, (name, text)


def test_json_export_keeps_every_field_except_the_photo():
    """JSON 必须字段完整；照片的排除是**有意**的（内嵌 data URL 会撑出无意义的大字段）。"""
    resume = sample_resume_content()

    data = json.loads(export_json(resume))

    assert set(data) == set(resume.model_dump().keys()) - {"photo"}


# ===== R10：预览 / 导出 HTML 与 PDF 同字体（内嵌子集化 @font-face）=====


def test_render_html_without_custom_font_embeds_nothing():
    """没选字体时不插 style，也不出现 @font-face——否则等于凭空多下载一份字体。"""
    html = render_html(RESUME)

    assert "@font-face" not in html
    assert 'id="rf-font"' not in html


def test_render_html_embeds_active_font_before_head_close():
    _activate_test_font()

    html = render_html(RESUME)

    assert '<style id="rf-font">' in html
    assert "@font-face" in html
    assert "data:font/ttf;base64," in html
    # CSP 之外的兜底：字体块必须在 </head> 之前，否则浏览器可能整块忽略。
    assert html.index('<style id="rf-font">') < html.index("</head>")
    encoded = html.split("data:font/ttf;base64,", 1)[1].split(")", 1)[0]
    assert len(base64.b64decode(encoded)) < 1_500_000


def test_render_html_inlines_font_for_custom_templates_too():
    """自制模板走沙箱分支，也必须带上同一个字体（两处共用一份注入逻辑）。"""
    _activate_test_font()

    html = render_html(
        RESUME,
        template_html="<html><head><title>t</title></head><body>{{ resume.name }}</body></html>",
    )

    assert '<style id="rf-font">' in html
    assert html.index('<style id="rf-font">') < html.index("</head>")


def test_render_html_survives_a_broken_font_file():
    write_font("broken.ttf", b"not a font at all")
    user_fonts.set_active("broken.ttf")

    html = render_html(RESUME)

    assert "张三" in html
    assert "@font-face" not in html


def test_every_builtin_template_allows_data_fonts():
    """8 个内置模板的 CSP 都必须放行 data: 字体，否则预览里字体被静默拦掉。"""
    for name in RESUME_TEMPLATES:
        html = render_html(RESUME, template=name)
        assert "font-src data:;" in html, name
