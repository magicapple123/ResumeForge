# SPDX-License-Identifier: Apache-2.0
"""字体预子集化：省掉八成的字体解析成本，但**一个字都不能少**。

背景见 ``services/pdf_exporter/font_subset``：fpdf2 每次 ``add_font`` 都要把 19MB 字体的
``glyf`` 表整张解出来（实测占一趟渲染的 83%，而真正的绘制只有 13ms），可一轮调参里正文
一个字都没变。做法是把字体裁到"这份内容用到的几百个字"，于是第二趟起渲染从 ~560ms 掉到
~90ms（第二趟本身要现裁子集，~420ms 的一次性成本；线上由 ``prewarm`` 挪到后台）。

所以这里最要紧的用例**不是"快了"**，而是**少没少字**：子集化是拿"上一趟真实渲染画出去的
字"当输入，一旦这个集合比实际需要的少，纸面上就会静默少掉一行字——那是肉眼几乎发现不了
的 bug。下面用"PDF 里抽出来的每个字都必须在这个集合里"来钉死它。
"""

from __future__ import annotations

from io import BytesIO

import pytest
from app.services.pdf_exporter import font_subset, reset_font_cache
from app.services.pdf_exporter.fit import build_resume_pdf
from app.services.resume.resume_sample import sample_resume_content
from font_fixtures import isolate_pdf_font_env
from pypdf import PdfReader
from test_pdf_exporter import _text_runs, needs_font


@pytest.fixture(autouse=True)
def _isolate_host_font_env(monkeypatch):
    """本文件量的是"系统可用字体"这条链路：先摘掉宿主自己的字体兜底。

    CI 的 Linux 作业把 RESUMEFORGE_PDF_FONT 指到 WQY（金样导出需要 TrueType 中文字体），
    而它的字形覆盖与本机候选字体不同（实测缺「•」）——环境变量又优先于系统候选，于是
    "子集不能少字"的断言会按宿主字体假红。字体路径是进程级缓存，前后各清一次。
    """
    isolate_pdf_font_env(monkeypatch)
    reset_font_cache()
    yield
    reset_font_cache()


def _text(content: bytes) -> str:
    """PDF 里实际印出来的文字（按页拼起来）。"""
    return "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(content)).pages)


def _render(resume, **kwargs):
    return build_resume_pdf(
        resume, template=kwargs.pop("template", "classic"), page_limit=1, **kwargs
    )


def _fonts() -> tuple[str, str]:
    from app.services.pdf_exporter.fonts import resolve_font_paths

    fonts = resolve_font_paths(None)
    assert fonts is not None
    return fonts


def _timed(resume) -> float:
    """排一趟要多久（毫秒）。"""
    from time import perf_counter

    started = perf_counter()
    _render(resume)
    return (perf_counter() - started) * 1000


@needs_font
def test_the_second_render_uses_a_subset_and_loses_nothing():
    """第二趟换小字体，产物必须与全量字体**逐字逐点**一致。"""
    resume = sample_resume_content()

    first = _render(resume)
    assert font_subset.stats() == (1, 0), "第一趟只该记住字符集，还没到裁字体"

    second = _render(resume)

    assert font_subset.stats()[1] == 1, "第二趟应当用上了预子集字体"
    assert _text_runs(second.content) == _text_runs(first.content)
    assert _text(second.content) == _text(first.content)


@needs_font
def test_the_charset_covers_every_character_that_was_actually_drawn():
    """**少字守卫**：PDF 里印出来的每一个字，都必须在字符集里。

    字符集是"上一趟真实渲染画出去的字"，所以它天然覆盖栏目标题（「个人总结」「教育经历」
    这些正文里根本没有的字）——但凡哪天有人改了渲染器、加了新标题又没进集合，这里立刻红。
    """
    resume = sample_resume_content()
    result = _render(resume)

    drawn = set(result.chars)
    printed = set(_text(result.content))
    missing = printed - drawn - set("\n\r\t ")
    assert not missing, f"这些字印出来了却不在字符集里，下一趟子集会漏掉它们：{missing}"
    # 栏目标题确实进来了（否则上一条断言在"标题恰好都是正文里的字"时是空转）。
    assert any(set(title) <= drawn for title in ("个人总结", "教育经历", "专业技能", "项目经历"))


@needs_font
def test_the_subset_render_is_fast():
    """这条守的是**性能本身**：谁把子集路径弄丢了，这里立刻红。

    为什么量第三趟而不是第二趟：第二趟要**现裁**子集（fontTools 解 19MB 字体的 cmap，
    ~200ms/字体，两份 ~420ms），那一趟本来就是"付一次账单"。线上靠 ``prewarm`` 把这份
    账单挪到后台，所以稳态（第三趟起）才是用户拖滑块时真正感受到的数字。

    为什么比**比值**而不是毫秒数：绝对阈值会被机器负载和插桩一起推高（实测同一个用例：
    裸跑 ~90ms 稳过，串行覆盖率跑 200ms 线直接红）。比值是自校准的——全量字体那一趟和
    子集那一趟在同一台机器、同一层插桩下测，优化没生效时比值就在 1.0 附近。
    """
    resume = sample_resume_content()
    full_ms = _timed(resume)  # 第一趟：全量字体 + 记住字符集
    _render(resume)  # 第二趟：现裁子集（一次性成本）
    subset_ms = _timed(resume)

    assert subset_ms < full_ms * 0.5, (
        f"全量字体 {full_ms:.0f}ms、子集 {subset_ms:.0f}ms，预子集字体似乎没生效"
    )


@needs_font
def test_prewarm_prepares_the_subset_before_the_next_render(monkeypatch):
    """后台预热必须**真的把子集裁出来**，不能只是起个线程装样子。

    它省掉的是"下一趟渲染现裁字体"的那 400ms——用户拖滑块的第二格就卡在这一步上。
    """
    import time

    monkeypatch.setattr(font_subset, "_warm_enabled", True)
    resume = sample_resume_content()
    _render(resume)  # 这一趟末尾会起后台预热

    deadline = time.perf_counter() + 30
    while font_subset.pending_warmups() and time.perf_counter() < deadline:
        time.sleep(0.01)

    assert font_subset.pending_warmups() == 0, "后台预热 30s 还没跑完"
    assert font_subset.stats()[1] == 1, "预热没裁出子集，下一趟渲染还得自己现裁"


@needs_font
def test_new_content_collects_a_new_charset():
    """内容变了就重新收一轮：新出现的字必须在集合里，否则会静默少字。"""
    resume = sample_resume_content()
    _render(resume)
    _render(resume)  # 这一趟走子集

    changed = resume.model_copy(update={"summary": "换一段完全不同的总结：区块链与共识算法。"})
    first = _render(changed)
    second = _render(changed)  # 新内容的第二趟：走新的子集

    assert set("区块链共识算法") <= set(first.chars)
    assert "区块链" in _text(first.content)
    assert _text_runs(second.content) == _text_runs(first.content)


@needs_font
def test_a_broken_subset_falls_back_to_the_full_font(monkeypatch):
    """子集渲染失败必须**退回全量字体**，而不是让导出失败。

    这是加速，不是功能：字体被替换、临时目录不可写、子集文件损坏……任何一条都不该让
    用户点「导出」时拿到一个 500。
    """
    resume = sample_resume_content()
    _render(resume)  # 记住字符集，下一趟会走子集

    monkeypatch.setattr(
        font_subset,
        "subset_font_paths",
        lambda fonts, chars: ("/根目录不存在/regular.ttf", "/根目录不存在/bold.ttf"),
    )

    result = _render(resume)

    assert result.content.startswith(b"%PDF")
    assert "简历" in _text(result.content) or _text(result.content).strip()
    # 这份字符集被丢掉了：下趟老老实实用全量字体。
    assert font_subset.stats()[0] == 0


def test_subsetting_a_missing_font_returns_none_instead_of_raising():
    """fail-open：拿不到字体就返回 None（调用方用原字体），绝不抛异常。"""
    assert (
        font_subset.subset_font_paths(("/不存在/a.ttf", "/不存在/b.ttf"), frozenset("甲乙")) is None
    )


def test_reset_clears_charsets_and_subset_entries():
    font_subset.remember_charset("sig", "甲乙丙")
    assert font_subset.stats()[0] == 1

    font_subset.reset()

    assert font_subset.stats() == (0, 0)
    assert font_subset.charset_for("sig") is None


@needs_font
def test_a_deleted_subset_file_is_rebuilt_instead_of_handed_out():
    """临时目录被清理过之后，不能把已经不在的文件路径交出去。

    系统清理工具（或用户手动清 temp）会把子集文件删掉，而内存里还记着路径。交出去的话
    fpdf2 打不开字体 → 每次渲染都要先失败再退回全量字体，等于白丢优化。
    """
    from pathlib import Path

    chars = frozenset(_render(sample_resume_content()).chars) | frozenset("个人总结")
    cached = font_subset.subset_font_paths(_fonts(), chars)
    assert cached is not None
    for path in cached:
        Path(path).unlink()
        assert not Path(path).exists()

    rebuilt = font_subset.subset_font_paths(_fonts(), chars)

    assert rebuilt is not None
    assert all(Path(path).exists() for path in rebuilt), "交出来的子集文件必须真的在"


@pytest.mark.parametrize("text", ["", "   "])
def test_an_empty_charset_is_not_remembered(text):
    """空字符集不该进缓存：那会让下一趟裁出一个空字体，什么都画不出来。"""
    font_subset.remember_charset("sig-empty", text)
    assert font_subset.charset_for("sig-empty") is None


@needs_font
def test_a_classic_first_render_does_not_lose_the_scholar_bullet(caplog):
    """跨模板复用字符集时，模板专属装饰字符不能少（2026-10-24 真实缺陷）。

    同一进程里先渲 classic、再渲 scholar（用户切模板的真实路径）：子集缓存的键是**内容
    签名**、不含模板，classic 那趟没画过 scholar 三列技能的项目符号「•」，第二趟用子集
    字体时整列圆点静默变空白（fpdf2 只打一行 missing glyph 警告）。
    """
    import logging

    from app.schemas.resume import ResumeContent
    from app.services.pdf_exporter.fit import _content_signature

    resume = ResumeContent(
        name="张三",
        skills=[{"name": "Python", "level": "熟练"}, {"name": "Go", "level": "熟练"}],
    )
    with caplog.at_level(logging.WARNING):
        _render(resume, template="classic")
        charset = font_subset.charset_for(_content_signature(resume)[0])
        assert charset is not None
        assert "•" in charset, "模板专属项目符号「•」必须无条件进字符集，否则换模板后整列消失"
        scholar = _render(resume, template="scholar")

    assert "•" in _text(scholar.content)
    assert "missing the following glyphs" not in caplog.text


def test_every_paper_decorative_character_is_registered_for_the_subset():
    """审计：模板 CSS / 渲染器常量里出现的**每个**装饰字符都必须在字符集里。

    只补「•」能修这一次，但下一套模板换个符号（例如 ✦ / ▪ / ◦）会重演同一类缺陷——
    所以这里拿"模板 ``content:"…"`` 的字符全集 + 渲染器的项目符号常量"反向核对字符集，
    新增模板或换符号时立刻变红。
    """
    import re

    from app.services.pdf_exporter.canvas import _BULLET_MARK
    from app.services.pdf_exporter.fit import _DECORATIVE_CHARS
    from app.services.pdf_exporter.skill_tags import _TAG_BULLET, _TAG_SEPARATOR
    from app.services.pdf_exporter.style_blocks import _BULLET_CHARS
    from app.services.resume.resume_templates import RESUME_TEMPLATES, TEMPLATES_DIR

    required = set(_BULLET_MARK) | set(_TAG_BULLET) | set(_TAG_SEPARATOR)
    for marker in _BULLET_CHARS.values():
        required.update(marker)
    for spec in RESUME_TEMPLATES.values():
        css = (TEMPLATES_DIR / spec["file"]).read_text(encoding="utf-8")
        for marker in re.findall(r'content:\s*"([^"]*)"', css):
            required.update(marker)
    missing = required - _DECORATIVE_CHARS
    assert not missing, f"这些纸面装饰字符没进字体子集字符集：{sorted(missing)}"
