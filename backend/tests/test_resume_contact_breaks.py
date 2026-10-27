# SPDX-License-Identifier: Apache-2.0
"""页眉联系方式：#3「字段不拆行 + 字段之间可换行 + contact_breaks 强制换行」四链路回归。

## 用户反馈

截图里「个人主页：huangcenguo.top」在一行中间被折成两行：联系方式是**一整串文本**，
浏览器只能在字段内部找断点；`<span>` 之间没有空白字符，本来连"字段之间换行"的机会都没有。

## 口径（四条链路一致）

* 每个字段是一个**不可拆单元**：HTML 用 `.header .contact span { white-space: nowrap }`，
  PDF / Word 按整字段排版（HTML 的 `<wbr>` / PDF 的装行 / Word 的空格断点都只在字段之间）；
* 字段之间可以自动换行：HTML 用 `<wbr>` 提供断点；
* 用户可控的 `format_config.contact_breaks: list[str]`：列出"在哪个字段前强制换行"，
  落成 HTML `<br>` / Word `w:br` / PDF 新行；未知键丢弃、空列表 = 没设置；
* **旧简历没有这个键时行为不变**：除了"字段不再被从中间劈开"这个修复本身，产物与
  加键前逐字节等价（不会凭空出现 `<br>` 或空行）。

本文件只放跨链路断言；纯函数细节与 Word 文档结构分别由
`test_resume_contact.py` 与 `test_docx_exporter.py` 承担。
"""

from __future__ import annotations

import io
import re

import pytest
from app.schemas.resume import ResumeContent
from app.services.docx_exporter import build_resume_docx
from app.services.exporter import render_html
from app.services.pdf_exporter import build_resume_pdf, font_available
from app.services.resume.resume_template_format import validated_format_config
from app.services.resume.resume_templates import RESUME_TEMPLATES, TEMPLATES_DIR
from docx import Document

needs_font = pytest.mark.skipif(not font_available(), reason="本机没有可用的中文字体")

CONTACT = {
    "phone": "13800001234",
    "email": "zhangsan@example.com",
    "city": "杭州",
    "birth_year": "1998",
    "github": "https://github.com/zhangsan",
    "personal_website": "https://zhangsan.dev",
}


def _resume(**overrides) -> ResumeContent:
    return ResumeContent(name="张三", summary="一句话总结。", **{**CONTACT, **overrides})


def _contact_block(html: str) -> str:
    """取出 `.contact` 的 innerHTML（其他区块的标记不参与断言）。"""
    match = re.search(r'<div class="contact" data-role="meta">(.*?)</div>', html, re.S)
    assert match, "HTML 里没有页眉联系方式块"
    return match.group(1)


def _strip_nonce(html: str) -> str:
    """CSP nonce 每次随机：比较"新键是否有任何影响"前先归一化，否则永远不相等。"""
    stripped = re.sub(r'nonce="[0-9a-f]+"', 'nonce="<random>"', html)
    return re.sub(r"nonce-[0-9a-f]+", "nonce-<random>", stripped)


# ===== format_config.contact_breaks 白名单契约 =====


def test_contact_breaks_is_whitelisted_and_normalized():
    """合法字段键被保留、按字段顺序归一；未知键静默丢弃；空列表不写这个键。"""
    config = validated_format_config(
        {"contact_breaks": ["personal_website", "bogus", "github", "github"]}
    )
    assert config["contact_breaks"] == ["github", "personal_website"]

    assert "contact_breaks" not in validated_format_config({"contact_breaks": []})
    assert "contact_breaks" not in validated_format_config({"contact_breaks": "bogus"})
    # 空域与"从未设置"等价：其他键一个不受影响。
    assert validated_format_config({"accent": "#112233"}) == {"accent": "#112233"}


def test_contact_breaks_accepts_the_comma_string_form():
    """与 section_order 的宽松度一致：查询串 / 手写 JSON 的逗号形态也认。"""
    assert validated_format_config({"contact_breaks": "email,github"})["contact_breaks"] == [
        "email",
        "github",
    ]


# ===== HTML：字段不拆行 + 字段间断点 + 强制换行 =====


@pytest.mark.parametrize("template", sorted(RESUME_TEMPLATES))
def test_every_template_renders_contact_fields_as_unbreakable_units(template):
    """9 个内置模板：每个字段一个 span、字段间 <wbr>、span 上声明 nowrap。"""
    html = render_html(_resume(), template=template)
    block = _contact_block(html)

    # 六个字段一个不能少，顺序固定（与 PDF / Word 共用 resume_contact.CONTACT_FIELDS）。
    for key in CONTACT:
        assert f'data-resume-path="{key}"' in block, f"{template} 缺少字段 {key}"

    # 相邻字段之间各有一个 <wbr>（5 个），不是藏在字段内部的断点。
    assert block.count("<wbr") == 5, f"{template} 的字段之间没有自动换行点"
    assert "<br" not in block, f"{template} 默认不该有强制换行"

    # 字段内部 nowrap：缺了它 <wbr> 会退化成可在字段内任意折行（旧 bug 的形态）。
    style = (TEMPLATES_DIR / RESUME_TEMPLATES[template]["file"]).read_text(encoding="utf-8")
    assert re.search(r"\.header \.contact span \{[^}]*white-space:\s*nowrap", style), (
        f"{template} 的 .contact span 没有声明 white-space: nowrap"
    )


def test_contact_breaks_render_a_forced_break_before_the_chosen_field():
    """contact_breaks 命中字段前渲染 <br>；命中第一个字段时无意义、不产生标记。"""
    html = render_html(_resume(), format_config={"contact_breaks": ["personal_website"]})
    block = _contact_block(html)
    assert block.count("<br") == 1
    # <br> 紧挨着被选的字段之前（中间不允许先出现别的 span）。
    assert re.search(r'<br\s*/?>\s*<span data-resume-path="personal_website"', block), (
        "强制换行没有落在个人主页字段之前"
    )

    first_field = render_html(_resume(), format_config={"contact_breaks": ["phone"]})
    assert "<br" not in _contact_block(first_field), "在第一个字段前换行是空操作"


def test_html_without_contact_breaks_matches_an_empty_list():
    """旧简历（没有新键）与"显式空列表"产物逐字节一致——新键只在设置后生效。"""
    plain = _strip_nonce(render_html(_resume()))
    empty = _strip_nonce(render_html(_resume(), format_config={"contact_breaks": []}))
    assert plain == empty


# ===== PDF：强制换行落成新行；整字段不拆行 =====


def _pdf_lines(content: bytes) -> list[str]:
    """把 PDF 提取文本按视觉行切开（去掉中文字体的 NUL 填充与空白）。"""
    import pypdf

    reader = pypdf.PdfReader(io.BytesIO(content))
    raw = "".join(page.extract_text() or "" for page in reader.pages)
    return ["".join(line.split()) for line in raw.replace("\x00", "").splitlines() if line.strip()]


@needs_font
def test_pdf_contact_breaks_start_a_new_line():
    """contact_breaks 在 PDF 里是真实换行：被选字段不会与前一个字段同处一行。"""
    short = {
        "phone": "1234",
        "email": "a@b.c",
        "city": "沪",
        "birth_year": "1998",
        "github": "g.com/x",
        "personal_website": "w.dev",
    }
    resume = ResumeContent(name="张三", summary="一句话总结。", **short)
    plain = build_resume_pdf(resume, template="classic", page_limit=1)
    forced = build_resume_pdf(
        resume,
        template="classic",
        page_limit=1,
        format_config={"contact_breaks": ["personal_website"]},
    )

    def line_with(content: bytes, needle: str) -> str:
        lines = _pdf_lines(content)
        matches = [line for line in lines if needle in line]
        assert matches, f"PDF 里没找到 {needle!r}"
        return matches[0]

    # 六个短字段在默认设置下排得进一行（行内包含个人主页）。
    assert line_with(plain.content, "个人主页") == line_with(plain.content, "1234")
    # 强制换行后，个人主页**独占一行**（前面不能还挂着其它字段）。
    website_line = line_with(forced.content, "个人主页")
    assert "1234" not in website_line and "GitHub" not in website_line


@needs_font
def test_pdf_never_breaks_a_contact_field_itself():
    """长网址整体不拆行：提取文本里必须有一行完整包含 URL（不跨行断开）。"""
    url = "https://zhangsan.dev/very/long/path/that/should/never/be/split/in/the/middle"
    resume = _resume(personal_website=url)
    lines = _pdf_lines(build_resume_pdf(resume, template="classic", page_limit=1).content)
    assert any(url in line for line in lines), "PDF 把长网址从中间拆成了两行"


# ===== Word：强制换行落成 w:br（结构细节在 test_docx_exporter 已钉，这里只做交叉验证）=====


def _docx_body(document) -> str:
    return document.element.body.xml


def test_word_and_html_share_the_same_forced_break_field():
    """同一个 contact_breaks 配置：HTML 在个人主页前 <br>，Word 在它前面 w:br。"""
    config = {"contact_breaks": ["personal_website"]}
    html_block = _contact_block(render_html(_resume(), format_config=config))
    assert html_block.count("<br") == 1

    document = Document(
        io.BytesIO(build_resume_docx(_resume(), page_limit=1, format_config=config).content)
    )
    assert _docx_body(document).count("<w:br") == 1
