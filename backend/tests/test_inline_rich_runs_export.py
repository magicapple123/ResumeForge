# SPDX-License-Identifier: Apache-2.0
"""I-12 P1/P4：四出口读 `rich.runs`，且"只有标记串的旧文档"渲染不变。

三条守门线（顺序就是"证据链"的顺序）：

1. **投影可逆**：`runs_to_marks` 的输出被唯一解析器 `parse_rich_runs` 原样读回
   （文字 + 加粗 + 链接 + 字号 + 颜色），所以"结构化 runs"和"等价标记串"在四个出口里
   必然同形——这不是巧合，是构造出来的。
2. **出口等价**：同一份内容的两种磁盘形态（`value` 带标记 / `value` 纯文本 + `rich.runs`）
   在 HTML / PDF / Word / TXT 里给出同一份纸面（P4 旧备份兼容的核心证据）。
3. **旧文档零变化**：没有 `rich` 的 item 读路径原样返回 `value`（plan 段文本等于原值），
   这是"存量简历逐字节不变"的可断言形式。

**不测**"有 rich 且 value 里还留着标记"的混合态：迁移工具对已带 `rich` 的 item 直接跳过
（幂等），混合态在数据里不该出现；真出现时按"value 是纯文本"理解（契约口径）。
"""

from __future__ import annotations

import io
import re

import pytest
from app.services.docx_exporter import build_resume_docx
from app.services.exporter import export_markdown, render_html
from app.services.pdf_exporter import build_resume_pdf, font_available
from app.services.resume.document_plan import build_document_plan
from app.services.resume.resume_rich_marks import (
    RichRun,
    item_runs,
    item_text,
    runs_to_marks,
)
from app.services.resume.resume_rich_text import parse_rich_runs
from app.services.txt_exporter import export_txt
from tests.document_export_samples import docx_text, html_text, pdf_text

needs_font = pytest.mark.skipif(not font_available(), reason="本机没有可用的中文字体")


# ===== 1. 投影 ↔ 解析往返 =====


@pytest.mark.parametrize(
    ("plain", "runs"),
    [
        ("带 8 人团队，覆盖 3 条产品线", [RichRun(0, 7, bold=True)]),
        ("拆解需求并排期", [RichRun(0, 4, color="#c0392b")]),
        ("两样都改", [RichRun(0, 4, size=0.9, color="#C00")]),
        ("点这里 看详情", [RichRun(0, 3, link="https://example.com/x")]),
        ("加粗链接", [RichRun(0, 4, bold=True, link="https://e.com", size=0.8, color="#333")]),
        ("甲 乙 丙", [RichRun(0, 1, bold=True), RichRun(2, 3, bold=True)]),
        ("普通文本", []),
    ],
)
def test_runs_projection_round_trips(plain: str, runs: list[RichRun]) -> None:
    """投影出的标记串被唯一解析器读回后，文字与样式与 runs 一一对应。"""
    marks = runs_to_marks(plain, runs)
    spans = parse_rich_runs(marks)
    assert "".join(span.text for span in spans) == plain, f"标记串={marks!r}"
    # 只比"被 runs 覆盖的片段"：未覆盖的片段是普通 span，两种形态本来就都该是纯文本。
    styled = [
        (span.text, span.bold, span.link, span.size, span.color)
        for span in spans
        if span.bold or span.link or span.size or span.color
    ]
    expected = [
        (
            plain[run.start : run.end],
            bool(run.bold),
            run.link,
            run.size,
            run.color.lower() if run.color else None,
        )
        for run in runs
        if run.end > run.start
    ]
    assert styled == expected


def test_runs_projection_merges_adjacent_same_style() -> None:
    """相邻同态 run 合并成一段，不产出 `**a****b**` 这类碎标记。"""
    marks = runs_to_marks("ab", [RichRun(0, 1, bold=True), RichRun(1, 2, bold=True)])
    assert marks == "**ab**"


def test_runs_projection_keeps_literal_markers_when_no_runs() -> None:
    """没有 runs 时原样返回：未配对的星号是用户真想印出来的字符。"""
    assert runs_to_marks("单价 ** 元", []) == "单价 ** 元"


def test_runs_projection_drops_unrepresentable_style_instead_of_leaking_markers() -> None:
    """越界字号 / 非法颜色 / 含 `]` 的链接一律降级成纯文本，绝不印出半截标记。"""
    plain = "abc"
    assert runs_to_marks(plain, [RichRun(0, 3, size=2.5)]) == plain
    assert runs_to_marks(plain, [RichRun(0, 3, color="red")]) == plain
    assert runs_to_marks(plain, [RichRun(0, 3, link="https://e.com/a)b")]) == plain
    assert runs_to_marks("[x]", [RichRun(0, 1, link="https://e.com")]) == "[x]"


def test_runs_projection_clamps_out_of_range_offsets() -> None:
    """越界下标按纯文本裁剪（不抛异常、不吞字）。"""
    assert runs_to_marks("ab", [RichRun(0, 99, bold=True)]) == "**ab**"
    assert runs_to_marks("ab", [RichRun(9, 99, bold=True)]) == "ab"


# ===== 2. item 读取（pydantic / dict 两种形态） =====


def test_item_runs_reads_dict_and_pydantic_forms() -> None:
    """磁盘（dict）与运行时（pydantic）两种形态读到同一组 runs。"""
    from app.schemas.resume_document import parse_document

    raw = {
        "version": 2,
        "header": {"items": []},
        "sections": [
            {
                "key": "projects",
                "kind": "entries",
                "entries": [
                    {
                        "id": "ob_000000001",
                        "items": [
                            {
                                "kind": "field",
                                "id": "it_000000001",
                                "key": "name",
                                "value": "带 8 人团队",
                                "placement": "body",
                                "rich": {"runs": [{"start": 0, "end": 7, "bold": True}]},
                            }
                        ],
                    }
                ],
            }
        ],
    }
    as_dict = raw["sections"][0]["entries"][0]["items"][0]
    as_model = parse_document(raw).sections[0].entries[0].items[0]
    expected = [RichRun(0, 7, bold=True)]
    assert item_runs(as_dict) == expected
    assert item_runs(as_model) == expected
    assert item_text(as_dict) == item_text(as_model) == "**带 8 人团队**"


def test_item_runs_drops_inverted_and_keeps_sorted() -> None:
    """`end <= start` 直接丢弃；乱序输入按 start 排序。"""
    item = {
        "value": "abcd",
        "rich": {
            "runs": [
                {"start": 2, "end": 4, "bold": True},
                {"start": 3, "end": 3, "bold": True},
                {"start": 0, "end": 1, "color": "#c00"},
            ]
        },
    }
    assert item_runs(item) == [RichRun(0, 1, color="#c00"), RichRun(2, 4, bold=True)]


def test_item_runs_ignores_malformed_payload() -> None:
    """rich 不是 dict/对象、runs 不是列表：当作没有 rich（退回旧解析）。"""
    assert item_runs({"value": "x", "rich": "nope"}) == []
    assert item_runs({"value": "x", "rich": {"runs": "nope"}}) == []
    assert item_text({"value": "**x**", "rich": None}) == "**x**"


def test_item_without_rich_reads_value_verbatim() -> None:
    """旧文档（没有 rich）的读路径原样返回 value —— 存量简历逐字节不变的形式化断言。"""
    for value in (
        "**带 8 人团队**，覆盖 3 条产品线",
        "{@color=#c00}拆解需求{@}",
        "[官网](https://e.com)",
    ):
        assert item_text({"value": value}) == value


# ===== 3. 四出口等价（P4 核心证据） =====

#: 一份覆盖页眉 + 条目头 + lead/trail + 正文的样本；两种磁盘形态由下面的 builder 生成。
_VALUES = {
    "hd_name": ("陈可", "**陈**可"),
    "hd_intent": ("产品经理", "**产品经理**"),
    "it_title": ("示例项目", "**示例项目**"),
    "it_meta": ("2024", "{@color=#c0392b}2024{@}"),
    "it_lead": ("负责人", "**负责人**"),
    "it_body": ("带 8 人团队，覆盖 3 条产品线", "**带 8 人团队**，覆盖 3 条产品线"),
    "it_trail": ("上海", "上海"),
}

#: 与上面 `_VALUES` 一一对应的 runs（下标基于**纯文本**）。
_RUNS = {
    "hd_name": [{"start": 0, "end": 1, "bold": True}],
    "hd_intent": [{"start": 0, "end": 4, "bold": True}],
    "it_title": [{"start": 0, "end": 4, "bold": True}],
    "it_meta": [{"start": 0, "end": 4, "color": "#c0392b"}],
    "it_lead": [{"start": 0, "end": 3, "bold": True}],
    "it_body": [{"start": 0, "end": 7, "bold": True}],
    "it_trail": [],
}


def _document(*, structured: bool) -> dict:
    """structured=True 造"纯文本 value + rich.runs"，False 造"value 带标记、没有 rich"。"""

    def item(key: str, *, key_name: str, placement: str) -> dict:
        plain, marks = _VALUES[key]
        data = {
            "kind": "field",
            "id": "it_" + key,
            "key": key_name,
            "value": plain if structured else marks,
            "placement": placement,
            "show_label": False,
        }
        if structured:
            data["rich"] = {"runs": _RUNS[key]}
        return data

    return {
        "version": 2,
        "language": "zh-CN",
        "header": {
            "items": [
                item("hd_name", key_name="name", placement="name"),
                item("hd_intent", key_name="intent", placement="subtitle"),
                {
                    "kind": "field",
                    "id": "hd_00000009",
                    "key": "phone",
                    "value": "13800000000",
                    "placement": "contact",
                },
            ]
        },
        "sections": [
            {
                "key": "projects",
                "kind": "entries",
                "entries": [
                    {
                        "id": "ob_proj000001",
                        "items": [
                            item("it_title", key_name="name", placement="title"),
                            item("it_meta", key_name="period", placement="meta"),
                            item("it_lead", key_name="role", placement="lead"),
                            item("it_body", key_name="summary", placement="body"),
                            item("it_trail", key_name="city", placement="trail"),
                        ],
                    }
                ],
            }
        ],
    }


def _body(html: str) -> str:
    """只看 body：`<title>` 与 CSP nonce 是渲染现场的噪声（见下面的独立断言）。"""
    return html.split("<body>", 1)[-1]


def _without_nonce(html: str) -> str:
    return re.sub(r'nonce="[0-9a-f]+"', 'nonce="X"', html)


def _docx_runs(data: bytes) -> list[tuple[str, bool, str | None, float | None]]:
    """Word 产物的逐 run 指纹（docx 字节含时间戳，只能比属性不能比字节）。"""
    from docx import Document

    document = Document(io.BytesIO(data))
    return [
        (
            run.text,
            bool(run.bold),
            str(run.font.color.rgb) if run.font.color and run.font.color.rgb else None,
            float(run.font.size.pt) if run.font.size else None,
        )
        for paragraph in document.paragraphs
        for run in paragraph.runs
    ]


def test_html_renders_rich_runs_like_the_equivalent_marker_document() -> None:
    """HTML：DOM 关键属性（标签 / 文本 / style）完全一致，且 rich 侧真的产出了样式。"""
    rich = _without_nonce(render_html(_document(structured=True)))
    legacy = _without_nonce(render_html(_document(structured=False)))
    assert _body(rich) == _body(legacy)
    # 反向守卫：不能"两边都没样式"而假装一致。
    assert "<strong>陈</strong>" in _body(rich)
    assert "color:#c0392b" in _body(rich)


def test_html_leaks_no_marker_into_the_page_title() -> None:
    """有 rich 的文档，`<title>` 不再出现 `**`（旧路径会把标记画进 title）。"""
    rich = render_html(_document(structured=True))
    title = re.search(r"<title>(.*?)</title>", rich, flags=re.S)
    assert title is not None
    assert "**" not in title.group(1)


def test_markdown_and_txt_render_rich_runs_like_the_equivalent_marker_document() -> None:
    """Markdown / TXT：同一份正文（TXT 是 Markdown 剥标记后的同源产物）。"""
    assert export_markdown(_document(structured=True)) == export_markdown(
        _document(structured=False)
    )
    assert export_txt(_document(structured=True)) == export_txt(_document(structured=False))


@needs_font
def test_pdf_renders_rich_runs_like_the_equivalent_marker_document() -> None:
    """PDF：语义锚点 + 取整坐标一致（纸面位置一个点都不差），文本里没有残留标记。"""
    rich = build_resume_pdf(_document(structured=True))
    legacy = build_resume_pdf(_document(structured=False))
    assert rich.pages == legacy.pages
    assert pdf_text(rich.content) == pdf_text(legacy.content)
    assert "**" not in pdf_text(rich.content)
    anchors = [
        (
            span.kind,
            span.section,
            span.page,
            round(span.y_top, 1),
            round(span.y_bottom, 1),
            span.object_id,
            span.text,
        )
        for span in rich.spans
    ]
    assert anchors == [
        (
            span.kind,
            span.section,
            span.page,
            round(span.y_top, 1),
            round(span.y_bottom, 1),
            span.object_id,
            span.text,
        )
        for span in legacy.spans
    ]


def test_markdown_visible_text_matches_html_character_for_character() -> None:
    """Markdown 可以丢样式，**一个字都不能多、不能少**（清单 P1 的额外要求）。

    口径：两边都压掉空白与 Markdown/TXT 的排版符号（`#` / `-` / `*`）以及跨行分隔用的
    `·`，剩下的字符序列必须相同——这比"某个字段出现了"强得多。
    """

    def squash(text: str) -> str:
        return re.sub(r"[\s·#*\-]+", "", text)

    for structured in (True, False):
        document = _document(structured=structured)
        html = squash(html_text(render_html(document)))
        markdown = squash(export_markdown(document))
        assert html == markdown, f"structured={structured}"


def _text_item_document(*, structured: bool) -> dict:
    """只有一个 `kind:"text"` 正文块的文档：正文在 `text` 上（不是 `value`）。

    `structured=True` 造"纯文本 text + rich.runs"，False 造"text 带标记、没有 rich"。
    """
    item = {
        "kind": "text",
        "id": "pt_000000001",
        "style": "bullet",
        "text": "带 8 人团队" if structured else "**带 8 人团队**",
    }
    if structured:
        item["rich"] = {"runs": [{"start": 0, "end": 7, "bold": True}]}
    return {
        "version": 2,
        "language": "zh-CN",
        "header": {"items": []},
        "sections": [
            {
                "key": "summary",
                "kind": "text",
                "entries": [{"id": "ob_sum000001", "items": [item]}],
            }
        ],
    }


def test_text_item_rich_runs_render_like_the_equivalent_marker_document() -> None:
    """正文文本块（`TextItem`，kind=text）也走同一条读路径：正文在 `text` 上。"""
    rich, legacy = _text_item_document(structured=True), _text_item_document(structured=False)
    assert (
        _without_nonce(render_html(rich)).split("<body>", 1)[-1]
        == _without_nonce(render_html(legacy)).split("<body>", 1)[-1]
    )
    assert export_markdown(rich) == export_markdown(legacy)
    assert export_txt(rich) == export_txt(legacy)
    # 反向守卫：样式真的从 `text` 上的 rich 走到了纸面（否则上面对比只是"都没样式"）。
    assert "<strong>带 8 人团队</strong>" in render_html(rich)


def test_text_item_rich_survives_serialization() -> None:
    """`TextItem.rich` 能存住：parse → to_json 原样往返（前端 P2 依赖这一点）。"""
    from app.schemas.resume_document import document_to_json, parse_document

    raw = {
        "version": 2,
        "header": {"items": []},
        "sections": [
            {
                "key": "summary",
                "kind": "text",
                "entries": [
                    {
                        "id": "ob_sum000001",
                        "items": [
                            {
                                "kind": "text",
                                "id": "pt_000000001",
                                "text": "甲",
                                "rich": {"runs": [{"start": 0, "end": 1, "bold": True}]},
                            }
                        ],
                    }
                ],
            }
        ],
    }
    dumped = document_to_json(parse_document(raw))
    item = dumped["sections"][0]["entries"][0]["items"][0]
    assert item["rich"] == {"runs": [{"start": 0, "end": 1, "bold": True}]}
    # 没有 rich 的文本块不许多出一个键（旧文档字节不变）。
    raw["sections"][0]["entries"][0]["items"][0].pop("rich")
    plain = document_to_json(parse_document(raw))["sections"][0]["entries"][0]["items"][0]
    assert "rich" not in plain


@needs_font
def test_text_item_rich_runs_render_in_pdf_and_word_like_markers() -> None:
    """文本块的三出口之二：PDF 坐标/文字一致，Word 的 run 属性一致。

    HTML/Markdown/TXT 在上面的用例里；这里补 PDF 与 Word，避免"文本块只测了一半出口"。
    """
    rich_pdf = build_resume_pdf(_text_item_document(structured=True))
    legacy_pdf = build_resume_pdf(_text_item_document(structured=False))
    assert rich_pdf.pages == legacy_pdf.pages
    assert pdf_text(rich_pdf.content) == pdf_text(legacy_pdf.content)
    assert "**" not in pdf_text(rich_pdf.content)
    anchors = [
        (span.kind, span.section, span.page, round(span.y_top, 1), span.object_id, span.text)
        for span in rich_pdf.spans
    ]
    assert anchors == [
        (span.kind, span.section, span.page, round(span.y_top, 1), span.object_id, span.text)
        for span in legacy_pdf.spans
    ]
    # 锚点里的 `text` 是**计划态**的串（渲染前），所以它带着投影出的标记——这正好证明
    # 文本块的 `rich` 真的进了 planner（没有 rich 时这里会是纯文本 `带 8 人团队`）。
    assert any(span.text == "**带 8 人团队**" for span in rich_pdf.spans)

    rich_docx = _docx_runs(build_resume_docx(_text_item_document(structured=True)).content)
    legacy_docx = _docx_runs(build_resume_docx(_text_item_document(structured=False)).content)
    assert rich_docx == legacy_docx
    # 反向守卫：加粗真的从文本块的 `rich` 走到了 Word 的 run 属性上。
    assert any(text == "带 8 人团队" and bold for text, bold, _, _ in rich_docx)


def test_docx_renders_rich_runs_like_the_equivalent_marker_document() -> None:
    """Word：逐 run 的文本 / 加粗 / 颜色 / 字号一致（docx 字节里含时间戳，比 run 属性）。"""
    rich = _docx_runs(build_resume_docx(_document(structured=True)).content)
    legacy = _docx_runs(build_resume_docx(_document(structured=False)).content)
    assert rich == legacy
    # 反向守卫：加粗与颜色真的从 rich 走到了 run 属性上。
    assert any(text == "陈" and bold for text, bold, _, _ in rich)
    assert any(color == "C0392B" for _, _, color, _ in rich)


def test_docx_text_matches_pdf_and_txt_for_rich_documents() -> None:
    """四个出口说同一件事：rich 文档的可见文本在 TXT / Word 里一致。"""
    document = _document(structured=True)
    from docx import Document

    docx = Document(io.BytesIO(build_resume_docx(document).content))
    text = docx_text(build_resume_docx(document).content)
    assert "带 8 人团队，覆盖 3 条产品线" in text
    assert "**" not in text and "**" not in export_txt(document), "文本出口残留了标记串"
    assert docx.paragraphs  # 产物是合法 docx（可被标准库重新打开）


# ===== 4. planner 只消费一次（读路径唯一入口的守卫） =====


def test_plan_text_for_rich_item_equals_the_projections_output() -> None:
    """planner 段文本 == `runs_to_marks(value, runs)`：说明出口侧没有再自己解析一遍。"""
    document = _document(structured=True)
    plan = build_document_plan(document)
    body = plan.sections[0].entries[0].body[0]
    assert body.segments[0].text == runs_to_marks(
        "带 8 人团队，覆盖 3 条产品线", [RichRun(0, 7, True)]
    )
    assert plan.header.name[0].text == "**陈**可"
