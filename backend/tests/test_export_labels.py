# SPDX-License-Identifier: Apache-2.0
"""A 包（简历语言）的验收测试：**同一份内容、同一个语言，五条链路印同一套纸面文案**。

为什么这批测试值得单独存在：纸面上的固定文案今天在五处独立渲染（服务端 PDF、Word、HTML
模板、Markdown、纯文本）。只要有一处漏改，产物里就会出现"预览是 Summary、PDF 里仍是
个人总结"这类无法自证的差异——而用户把文件发出去之后，没人再从产品界面看一眼 PDF 里的
那一行字。所以这里**不是逐个渲染器各测一遍**，而是从五种产物的真实字节里把文案抠出来，
断言它们**逐字相同**，这才是"漏改一个渲染器"的唯一可靠闸门。

覆盖面按两个批次分层（同一个文件，便于"两条链路是不是真的同源"一次看完）：

- 第 1–8 节 = **A1**：七个分区标题（批 2）；
- 第 9 节 = **A2**：字段前缀（`Objective` / `GPA / Rank` / …）、列表分隔符（`、` / `", "`）、
  等级与性别括号、以及"源码里不再有这些中文字面量"的点守卫（批 4）。

约定：

- 语言只影响**纸面固定文案**，不翻译正文，所以样本正文里刻意不含任何标题词
  （否则"英文产物里不该出现中文标题"这条会被正文本身证伪）。
- PDF / Word 的字节里带创建时间与字体子集名，HTML 带 per-document CSP nonce，所以
  "默认语言零回归"对这三者比的是**提取文本**，对 md/txt 才比字节（见
  ``test_omitting_the_language_is_the_same_as_passing_zh_cn``）。
- 全角冒号（`Objective：…`）是附录 A 已明确接受的已知瑕疵，**不做**标点本地化，
  因此没有任何断言要求它变半角。
"""

from __future__ import annotations

import ast
import html
import io
import re
import tokenize
from pathlib import Path
from typing import get_args

import pytest
from app.schemas.resume import ResumeLanguage as SchemaResumeLanguage
from app.services.docx_exporter import build_resume_docx
from app.services.export_pipeline import ExportRequest, RenderContext, build_export
from app.services.exporter import export_markdown, render_html
from app.services.pdf_exporter import (
    build_resume_pdf,
    rendered_page_count,
    resolve_accent,
    resolve_layout,
)
from app.services.resume.resume_labels import (
    DEFAULT_RESUME_LANGUAGE,
    RESUME_LANGUAGES,
    ResumeLanguage,
    section_titles,
)
from app.services.txt_exporter import export_txt
from tests.export_label_samples import (
    EN_TITLES,
    SECTION_KEYS,
    ZH_TITLES,
    _docx_text,
    _pdf_text,
    _plain,
    _products,
    _resume,
    _resume_without_projects,
    needs_font,
)

APP_DIR = Path(__file__).resolve().parents[1] / "app"

# A2 的字段前缀：这些中文词**只许**出现在 `resume_labels.py` 的表里。渲染器里再写一遍，
# 就是"改了表却没改渲染器"那种静默分叉（英文产物里会冒出一个中文词）。
A2_ZH_LITERALS: tuple[str, ...] = (
    "求职意向",
    "绩点/排名",
    "核心课程",
    "技术栈/工具",
    "个人照片",
    "个人主页",
)

# 负责画这些文案的源码 → 是否按"去掉注释与 docstring 后的代码"来判定。
# 注释里出现中文词是合理的（历史说明、边界解释：`exporter.py` 的 docstring 就写着
# "以前漏掉了性别与出生年"），**代码**里出现则一律算漏改。模板另按 `{# … #}` 处理。
GUARDED_SOURCES: dict[str, bool] = {
    "services/pdf_exporter/render.py": True,
    "services/docx_exporter.py": True,
    # W05 把七个分区渲染拆到 docx_sections；拆分后必须继续被这条守卫覆盖。
    "services/docx_sections.py": True,
    # W21 又把学术三节（论文 / 科研项目 / 专利）拆到 docx_academic_sections：
    # 新文件同样画中文/英文字段前缀，必须一起被这条守卫覆盖。
    "services/docx_academic_sections.py": True,
    "services/exporter.py": True,
    "templates/_resume_blocks.j2": False,
    "templates/_resume_sections.j2": False,
}


# ===== 1. 跨格式标题一致性（本文件最重要的一条） =====


@needs_font
@pytest.mark.parametrize("language", ["zh-CN", "en-US"])
def test_all_five_chains_print_exactly_the_same_section_titles(language: str):
    """同一份内容、同一个语言：五条链路抠出来的七个标题必须**逐字相同**。

    这条断言的失败信息会指出"哪个格式少了哪个标题"——漏改一个渲染器时，它是第一个红的。
    """
    expected = [section_titles(language)[key] for key in SECTION_KEYS]
    found_by_format: dict[str, list[str]] = {}
    for fmt, text in _products(language).items():
        compact = _plain(text)
        found_by_format[fmt] = [title for title in expected if _plain(title) in compact]

    for fmt, found in found_by_format.items():
        missing = [title for title in expected if title not in found]
        assert not missing, f"{language} 的 {fmt} 产物缺少分区标题：{missing}（实得 {found}）"
    # 七条链路各自都齐全之后，它们彼此的"标题序列"自然是同一串。
    assert len(set(map(tuple, found_by_format.values()))) == 1


# ===== 2. 语言切换真的换掉了标题 =====


@needs_font
def test_switching_the_language_switches_the_titles_in_every_chain():
    """`en-US` 五条链路都印英文标题、都不再印那七个中文标题；`zh-CN` 反之。

    反向断言（"不该出现的没出现"）才是"渲染器真的换了来源"的证据：只断言英文标题在场，
    一个同时印两种标题的实现也会通过。
    """
    zh_products = _products("zh-CN")
    en_products = _products("en-US")

    for fmt in zh_products:
        zh_text = _plain(zh_products[fmt])
        en_text = _plain(en_products[fmt])

        leaked = [title for title in ZH_TITLES if _plain(title) in en_text]
        assert not leaked, f"en-US 的 {fmt} 产物里还留着中文标题：{leaked}"
        missing = [title for title in EN_TITLES if _plain(title) not in en_text]
        assert not missing, f"en-US 的 {fmt} 产物缺少英文标题：{missing}"

        assert all(_plain(title) in zh_text for title in ZH_TITLES), f"{fmt} 丢了中文标题"
        unexpected = [title for title in EN_TITLES if _plain(title) in zh_text]
        assert not unexpected, f"zh-CN 的 {fmt} 产物里出现了英文标题：{unexpected}"


# ===== 3. 默认语言零回归 =====

_NONCE_RE = re.compile(r"[0-9a-f]{32}")


def _without_nonce(source: str) -> str:
    """抹掉 per-document CSP nonce——它每次都不同，与"内容变没变"无关。

    匹配的是 32 位十六进制串本身，而不是 `nonce="…"` 这一种写法：同一个 nonce 还会以
    `'nonce-<hex>'` 的形式出现在 `<style>` 的 CSP 属性里（两处都得换掉，否则同一次渲染
    的两个副本比不相等）。
    """
    return _NONCE_RE.sub("<per-document-nonce>", source)


def test_omitting_the_language_is_the_same_as_passing_zh_cn():
    """不传 `language` 与传 `"zh-CN"` 必须得到同一份东西（文本格式比字节）。"""
    resume = _resume()
    assert export_markdown(resume) == export_markdown(resume, language="zh-CN")
    assert export_txt(resume) == export_txt(resume, language="zh-CN")
    assert _without_nonce(render_html(resume)) == _without_nonce(
        render_html(resume, language="zh-CN")
    )

    # 管线出口同样零变化：`RenderContext()` 的默认值就是 zh-CN。
    request = ExportRequest(format="md")
    assert build_export(request, resume, RenderContext()) == build_export(
        request, resume, RenderContext(language="zh-CN")
    )


@needs_font
def test_omitting_the_language_is_the_same_as_passing_zh_cn_for_pdf_and_docx():
    """PDF / Word 比**提取文本 + 页数**而不是字节。

    PDF 带创建时间戳、Word 的 zip 条目带写入时间，字节级比对必然假红；而"默认语言零
    回归"要证明的是**纸面上印的字没变**，提取文本正是那个语义量（黄金矩阵同一口径）。
    """
    resume = _resume()

    default_pdf = build_resume_pdf(resume)
    zh_pdf = build_resume_pdf(resume, language="zh-CN")
    assert _plain(_pdf_text(default_pdf.content)) == _plain(_pdf_text(zh_pdf.content))
    assert (default_pdf.pages, default_pdf.pages_needed) == (zh_pdf.pages, zh_pdf.pages_needed)

    default_docx = build_resume_docx(resume)
    zh_docx = build_resume_docx(resume, language="zh-CN")
    assert _plain(_docx_text(default_docx.content)) == _plain(_docx_text(zh_docx.content))
    assert default_docx.pages == zh_docx.pages


# ===== 4. 未知语言回落 zh-CN，且不抛异常 =====


@pytest.mark.parametrize("bogus", ["fr-FR", "zh_CN", "en", "", "EN-US"])
def test_an_unrecognised_language_falls_back_to_zh_cn(bogus: str):
    """库里出现认不出的语言值时，正确行为是"按默认语言照常输出"。

    `zh_CN`（下划线）、`en`（不完整）、空串都可能来自外部工具改过的库或手写 SQL。
    让导出整条挂掉，等于用户因为一个他自己看不见的字段而下载不到简历。
    """
    resume = _resume()
    titles = [title for title in ZH_TITLES]

    markdown = export_markdown(resume, language=bogus)
    assert all(title in markdown for title in titles)
    assert all(title in export_txt(resume, language=bogus) for title in titles)

    html_source = render_html(resume, language=bogus)
    assert all(title in html_source for title in titles)

    artifact = build_export(ExportRequest(format="md"), resume, RenderContext(language=bogus))
    assert artifact.content.decode("utf-8") == markdown


@needs_font
@pytest.mark.parametrize("bogus", ["fr-FR", "zh_CN"])
def test_an_unrecognised_language_falls_back_to_zh_cn_for_pdf_and_docx(bogus: str):
    """两条二进制链路同样回落，不抛异常、不印空标题。"""
    resume = _resume()
    # 10 个分区在一页内排不下：给 3 页上限，否则 PDF 截断会"少标题"（与语言回落无关）。
    pdf_text = _plain(_pdf_text(build_resume_pdf(resume, page_limit=3, language=bogus).content))
    docx_text = _plain(_docx_text(build_resume_docx(resume, page_limit=3, language=bogus).content))
    for title in ZH_TITLES:
        assert _plain(title) in pdf_text, f"PDF 缺少中文标题：{title}"
        assert _plain(title) in docx_text, f"Word 缺少中文标题：{title}"


# ===== 5. 源码无字面量（点守卫） =====


def _docstring_line_numbers(source: str) -> set[int]:
    """模块 / 类 / 函数 docstring 覆盖的行号（1 起）。

    只认"块的首条语句是字符串常量"这一种——那正是 docstring 的定义；行内字符串与
    f-string 不算，它们出现在代码里就是真的文案。
    """
    numbers: set[int] = set()
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        body = getattr(node, "body", [])
        if not body:
            continue
        first = body[0]
        if (
            isinstance(first, ast.Expr)
            and isinstance(first.value, ast.Constant)
            and isinstance(first.value.value, str)
        ):
            numbers.update(range(first.lineno, (first.end_lineno or first.lineno) + 1))
    return numbers


def _lines_without_comments_and_docstrings(source: str) -> list[tuple[int, str]]:
    """返回 `(行号, 代码)`：注释被截掉、docstring 整行清空后仍非空的那些行。

    用 tokenize 而不是正则去注释：`"# 不是注释"` 这样的字符串字面量必须先被认成字符串，
    正则会把引号里的 `#` 当成注释起点，于是把真正的文案一起吞掉。
    """
    lines = source.splitlines()
    kept = list(lines)
    for number in _docstring_line_numbers(source):
        if 0 < number <= len(kept):
            kept[number - 1] = ""
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        if token.type == tokenize.COMMENT:
            row, column = token.start
            kept[row - 1] = kept[row - 1][:column]
    return [(number, text) for number, text in enumerate(kept, start=1) if text.strip()]


_JINJA_COMMENT_RE = re.compile(r"\{#.*?#\}", re.S)


def _scanned_lines(relative: str, drop_comments: bool) -> list[tuple[int, str]]:
    """取某个源码文件"去掉注释之后"的 `(行号, 原文)` 行。

    - `.py`：用 `ast` 认出 docstring、用 `tokenize` 认出 `#` 注释，两者都抹掉；
    - `.j2`：抹掉 `{# … #}`（Jinja 的注释，与 Python 的注释是同一个角色）。
      **保留换行**，这样报出来的行号还是文件里的真实行号。
    """
    source = (APP_DIR / relative).read_text(encoding="utf-8")
    if drop_comments:
        return _lines_without_comments_and_docstrings(source)
    without_comments = _JINJA_COMMENT_RE.sub(
        lambda match: "\n" * match.group(0).count("\n"), source
    )
    return list(enumerate(without_comments.splitlines(), start=1))


@pytest.mark.parametrize(("relative", "drop_comments"), sorted(GUARDED_SOURCES.items()))
def test_no_renderer_carries_its_own_chinese_labels(relative: str, drop_comments: bool):
    """七组标题与 A2 的字段前缀**只许**出现在 `resume_labels.py` 的表里。

    渲染器自带一份字面量，就会出现"改了表却没改渲染器"的静默分叉——这正是本任务要
    消灭的那类不一致。失败信息点名"文件:行号 + 命中的词 + 那一行原文"，改的时候不用猜。
    """
    offenders = [
        f"{relative}:{number}: {literal!r}\n    {text.strip()}"
        for number, text in _scanned_lines(relative, drop_comments)
        for literal in ZH_TITLES + A2_ZH_LITERALS
        if literal in text
    ]
    assert not offenders, (
        "渲染器里还留着中文纸面文案的字面量（应改为 section_titles/field_labels 取值）：\n"
        + "\n".join(offenders)
    )


# ===== 6. HTML 不缺标题（防"忘了把 section_titles 放进 context"） =====

# W07 起共享片段给标题加了 `data-role="section_title"`（角色覆盖的命中点）。守卫匹配
# "带任意属性的 section-title div"，**仍然断言标题文本与数量**——不是放宽到不检查标题。
_TITLE_DIV_RE = re.compile(r'<div class="section-title"[^>]*>([^<]*)</div>')
_TITLE_WITH_ROLE_RE = re.compile(r'<div class="section-title" data-role="section_title"[^>]*>')


@pytest.mark.parametrize("language", ["zh-CN", "en-US"])
def test_every_non_empty_section_has_a_non_empty_title_in_html(language: str):
    """`.section-title` 的数量 = 非空分区数，且**没有空标题**。

    空标题是"忘了把 `section_titles` 放进 Jinja 上下文"的唯一表现：模板里写的是
    `{{ section_titles.summary }}`，缺键时 Jinja 渲染成空串，产物看起来只是"没有标题"，
    不会报错——所以必须有一条断言专门盯它。
    """
    expected = [section_titles(language)[key] for key in SECTION_KEYS]

    full = render_html(_resume(), language=language)
    # 标题里的 `&` 会被 Jinja 转义成 `&amp;`（autoescape 是刻意的），比较前还原。
    titles = _TITLE_DIV_RE.findall(full)
    assert [html.unescape(found) for found in titles] == expected
    # 标题元素的角色标记也必须真的产出（W07 的角色覆盖靠它命中）。
    assert len(_TITLE_WITH_ROLE_RE.findall(full)) == len(expected)
    assert 'class="section-title"></div>' not in full

    partial = render_html(_resume_without_projects(), language=language)
    assert partial.count('class="section-title"') == len(SECTION_KEYS) - 1
    # 用"标题元素完全一致"判定：W14 的 "Research Projects" 里也含 "Projects" 子串。
    assert (
        f'class="section-title" data-role="section_title">{section_titles(language)["projects"]}<'
        not in partial
    )


# ===== 7. 自制模板仍能取到标题（防 `with context` 写错） =====


def test_a_custom_template_still_receives_the_section_titles():
    """自制模板的契约是 `{% include "_resume_sections.j2" %}`。

    `_resume_blocks.j2` 是**宏文件**，宏看不到父模板上下文——所以引入那行必须是
    `with context`。写错了的表现是"自制模板导出的简历一个标题都没有"，而默认模板全正常，
    最容易漏。
    """
    custom = (
        "<!DOCTYPE html><html><head><title>{{ resume.name }}</title></head><body>"
        '{% include "_resume_sections.j2" %}'
        "</body></html>"
    )

    for language in ("zh-CN", "en-US"):
        rendered = render_html(_resume(), template_html=custom, language=language)
        for title in section_titles(language).values():
            assert html.escape(title) in rendered, f"自制模板在 {language} 下缺标题：{title}"


# ===== 8. 页数估算跟着语言走 =====


@needs_font
@pytest.mark.parametrize("language", ["zh-CN", "en-US"])
def test_the_page_count_matches_what_that_language_actually_renders(language: str):
    """`pages_needed` 必须等于**该语言**真实排出来的页数。

    标题文字长度随语言变（`Campus Activities` 比「校园经历」宽得多），所以"量的"和
    "画的"用了两种语言时，页数结论就会说谎。这里拿 `rendered_page_count`（真渲染一趟、
    数页数）当权威，与 `build_resume_pdf` 报出的 `pages_needed` 对齐。
    """
    resume = _resume()
    # 与 `build_resume_pdf(template="classic", font_scale="standard")` 同一份版式参数。
    layout = resolve_layout(template="classic", base_px=14.0, format_config={})
    accent = resolve_accent("classic", {})

    drawn = rendered_page_count(resume, accent=accent, layout=layout, language=language)
    result = build_resume_pdf(
        resume, template="classic", font_scale="standard", page_limit=1, language=language
    )

    assert result.pages_needed == drawn, (
        f"{language}：报出需要 {result.pages_needed} 页，实际排出 {drawn} 页"
    )

    # Word 的页数估算走的是同一段测量代码（`_estimate_pages` → `measure_content_height`），
    # 与 PDF 真实页数的既有容差是 ±1（见 `docx_exporter` 模块 docstring）。
    docx = build_resume_docx(resume, template="classic", page_limit=1, language=language)
    assert docx.pages is not None
    assert abs(docx.pages - drawn) <= 1, f"{language}：Word 估算 {docx.pages} 页 vs PDF {drawn} 页"


def test_the_two_language_declarations_list_the_same_values():
    """两处语言取值声明必须逐字相同。

    ``schemas.resume.ResumeLanguage`` 是 schema 层的限值（schemas 是叶子层，不能
    import services，见 ``tests/test_import_direction.py``），
    ``resume_labels.ResumeLanguage`` 是收口函数的返回类型。任一处加了语言而另一处
    没加，结果就是"能存进库、能通过校验，导出时却拿不到标题"——所以让漏改在这里
    当场失败，而不是等用户看到空白小节。
    """
    assert get_args(SchemaResumeLanguage) == RESUME_LANGUAGES
    assert get_args(ResumeLanguage) == RESUME_LANGUAGES
    assert DEFAULT_RESUME_LANGUAGE in RESUME_LANGUAGES
