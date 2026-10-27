# SPDX-License-Identifier: Apache-2.0
"""语言能力独立分区（用户反馈 #11）的五条产物一致性。

旧版把语言压成一条 skills 记录（R-72 路线 1），制作台里显示成「专业技能」。2026-10
改为独立分区后，必须保证：HTML / PDF / Word / Markdown / TXT 五条链路都印出同一个
「语言能力」小节、同一组字段与同一份文本；没有语言的旧简历产物**一个字节都不变**
（空列表不序列化、模板空块不产生节点）。

渲染器各自实现组装，所以这里从**真实产物**里取文本比对，而不是只测投影层。
"""

from __future__ import annotations

import io
import json
import re
import zipfile

import pypdf
import pytest
from app.schemas.resume import ResumeContent
from app.services.docx_exporter import build_resume_docx
from app.services.exporter import export_markdown, render_html
from app.services.pdf_exporter import build_resume_pdf, font_available
from app.services.txt_exporter import export_txt

needs_font = pytest.mark.skipif(not font_available(), reason="本机没有可用的中文字体")

LANGUAGES = [
    {
        "name": "英语",
        "level": "CET-6",
        "certificate": "六级证书",
        "score": "550",
        "obtained_at": "2023-06",
    },
    {"name": "日语", "level": "N2"},
]


def _content(languages=None) -> ResumeContent:
    return ResumeContent(
        name="林示例",
        job_intent="后端工程师",
        summary="示例总结",
        skills=[{"name": "Python", "level": "熟练"}],
        languages=LANGUAGES if languages is None else languages,
    )


def _pdf_text(content: bytes) -> str:
    # 全量中文字体时 pypdf 会在字间插 NUL（与 test_export_golden 同一口径）。
    text = "".join(
        (page.extract_text() or "") for page in pypdf.PdfReader(io.BytesIO(content)).pages
    )
    return text.replace("\x00", "")


def _docx_text(content: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(content)) as bundle:
        xml = bundle.read("word/document.xml").decode("utf-8")
    return re.sub(r"<[^>]+>", " ", xml).replace("\x00", "")


def _plain(text: str) -> str:
    return re.sub(r"\s+", "", text)


@needs_font
def test_all_five_chains_print_the_language_section():
    content = _content()
    products = {
        "html": render_html(content),
        "markdown": export_markdown(content),
        "txt": export_txt(content),
        "pdf": _pdf_text(build_resume_pdf(content, page_limit=2).content),
        "docx": _docx_text(build_resume_docx(content, page_limit=2).content),
    }
    for name, text in products.items():
        compact = _plain(text)
        assert "语言能力" in compact, f"{name} 缺少语言能力标题"
        assert "CET-6" in compact, f"{name} 缺少语言水平"
        assert "六级证书" in compact, f"{name} 缺少语言证书"
        assert "550" in compact, f"{name} 缺少语言分数"
        assert "日语" in compact and "N2" in compact, f"{name} 缺少第二条语言"
        # 语言不再并入专业技能：标题与技能标题是两个独立小节（都出现即可）。
        assert "专业技能" in compact, f"{name} 缺少专业技能标题"


@needs_font
def test_language_fields_are_not_merged_into_skills():
    content = _content()
    assert [item.name for item in content.skills] == ["Python"]
    assert [item.name for item in content.languages] == ["英语", "日语"]
    html = render_html(content)
    # 技能小节里只有 Python；英语必须出现在语言小节（data-section 包裹）。
    assert 'data-section="languages"' in html
    skill_block = html.split('data-section="skills"', 1)[1].split("</div>", 1)[0]
    assert "英语" not in skill_block


def test_empty_languages_keep_old_content_shape():
    """没有语言的旧简历：serialize 后不出现 languages 键，产物里也没有该小节。"""
    content = ResumeContent(name="张三", summary="总结")
    dumped = json.dumps(content.model_dump(mode="json"), ensure_ascii=False)
    assert "languages" not in dumped
    assert "语言能力" not in render_html(content)
    assert "语言能力" not in export_markdown(content)
    assert "语言能力" not in export_txt(content)


def test_obtained_at_is_rendered_as_meta_tail():
    """取得时间在行尾以字段前缀展示（与技能分类同一类"元信息"，不混进语言括号）。"""
    html = render_html(_content())
    text = _plain(re.sub(r"<[^>]+>", " ", html))
    assert "取得时间：2023-06" in text
