# SPDX-License-Identifier: Apache-2.0
"""I-03：页眉姓名 / 性别的最终样式解析（字段级 > 角色级 > 无覆盖）。

这条判据被 PDF 与 Word 两个导出器共用。之前它们各写一份：
PDF 只查 `style("name")`（没有 object_id，字段级永远不生效），
Word 的姓名干脆是常量（`bold=True` / `accent` / `name_ratio`）。
所以"把姓名改成红色"在草稿生效、在导出里全部失效。

用例覆盖四象限（清单验收 6 的前三条）：
无覆盖 / 只覆盖 color / 三项全覆盖 / 性别独立覆盖。
"""

from __future__ import annotations

import zipfile
from io import BytesIO

import pytest
from app.schemas.resume_document_plan import HeaderPlan, Inline
from app.services.resume.resume_header_style import name_block_styles
from app.services.resume.resume_style import RoleStyle
from docx import Document
from test_pdf_exporter import needs_font

NAME_PATH = "header.hd_name01"
GENDER_PATH = "header.hd_gend01"


def _header(name_path: str = NAME_PATH, gender_path: str = GENDER_PATH) -> HeaderPlan:
    return HeaderPlan(
        name=[Inline(text="陈可", role="name", path=name_path)],
        name_meta=[Inline(text="女", role="meta", path=gender_path)],
    )


def _style_factory(roles: dict[str, RoleStyle], objects: dict[str, RoleStyle]):
    """按 `(role, object_id)` 取样式，模拟 `resume_style` 的查询函数。

    `field_only=True` 时只查字段层（`objects` 字典），与真实查询函数
    （`fit._role_style_query` / `docx_exporter._role_style_query`）同形。
    """

    def style(
        role: str, object_id: str | None = None, *, field_only: bool = False
    ) -> RoleStyle | None:
        if object_id is not None:
            return objects.get(f"{object_id}:{role}")
        return None if field_only else roles.get(role)

    return style


def test_no_override_returns_none_so_defaults_stay_byte_identical() -> None:
    """没有任何设置 → 两个返回值都是 None，调用方沿用历史默认（产物逐字节不变）。"""
    name_style, gender_style = name_block_styles(_header(), _style_factory({}, {}))
    assert name_style is None
    assert gender_style is None


def test_only_color_override_on_name_keeps_other_properties_unset() -> None:
    """只设颜色：只有 color 有值，font_scale / bold 仍是 None（由调用方取历史默认）。"""
    style = _style_factory({}, {f"{NAME_PATH}:meta": RoleStyle(color="#ba3737")})
    name_style, _ = name_block_styles(_header(), style)
    assert name_style is not None
    assert name_style.color == "#ba3737"
    assert name_style.font_scale is None
    assert name_style.bold is None


def test_all_three_properties_override() -> None:
    """font_scale + color + bold 全覆盖。"""
    style = _style_factory(
        {}, {f"{NAME_PATH}:meta": RoleStyle(font_scale=1.2, color="#2f855a", bold=False)}
    )
    name_style, _ = name_block_styles(_header(), style)
    assert name_style is not None
    assert name_style.font_scale == 1.2
    assert name_style.color == "#2f855a"
    assert name_style.bold is False


def test_gender_field_level_wins_over_role_level_meta() -> None:
    """I-42 之后的顺序：**字段级 > 角色级 meta**（I-03 的验收 4 不能回退）。

    角色级 meta 有颜色与字号，字段级只设了颜色 —— 颜色取字段级，字号取角色级。
    """
    style = _style_factory(
        {"meta": RoleStyle(color="#111111", font_scale=1.4)},
        {f"{GENDER_PATH}:meta": RoleStyle(color="#ba3737")},
    )
    _, gender_style = name_block_styles(_header(), style)
    assert gender_style is not None
    assert gender_style.color == "#ba3737"  # 字段级赢
    assert gender_style.font_scale == 1.4  # 角色级在这项上兜底


def test_gender_falls_back_to_role_level_meta() -> None:
    """I-42：没有任何字段级覆盖时，性别段取 meta 角色级（此前这里恒为 None = 固定 muted）。"""
    style = _style_factory({"meta": RoleStyle(color="#222222", bold=True)}, {})
    _, gender_style = name_block_styles(_header(), style)
    assert gender_style is not None
    assert gender_style.color == "#222222"
    assert gender_style.bold is True


def test_field_level_wins_over_name_role() -> None:
    """同名属性上，字段级覆盖姓名角色级。"""
    style = _style_factory(
        {"name": RoleStyle(color="#000000", font_scale=1.1)},
        {f"{NAME_PATH}:meta": RoleStyle(color="#ba3737")},
    )
    name_style, _ = name_block_styles(_header(), style)
    assert name_style is not None
    assert name_style.color == "#ba3737"  # 字段级赢
    assert name_style.font_scale == 1.1  # 角色级在这项上保留


def test_missing_paths_do_not_crash() -> None:
    """空姓名 / 空性别（老数据）不能抛错。"""
    empty = HeaderPlan(name=[], name_meta=[])
    name_style, gender_style = name_block_styles(
        empty, _style_factory({"name": RoleStyle(color="#123456")}, {})
    )
    assert gender_style is None
    # 姓名角色级仍生效（没有字段可覆盖）。
    assert name_style is not None
    assert name_style.color == "#123456"


# ===== 端到端：字段级样式真的进到 PDF / Word 的绘制入口 =====
#
# 上面六条只测纯函数。I-03 最初卡住的正是"纯函数对了、端到端没命中"：
# `object_roles` 的键是 **字段路径**（`header.<item_id>:<role>`，见
# `resume_style_types.ResolvedStyle.entry_role` 的 `f"{object_id}:{role}"`），
# 不是 item id。`header.<id>` 是页眉字段的路径形态（`field_style_target._HEADER_PATH`，
# `document_plan` 用 `"header." + item.id` 给每一段挂 path）。
# 下面用真实的 `build_resume_pdf` / `build_resume_docx` 验证这条链路。

NAME_ID = "hd_name01"
GENDER_ID = "hd_gend01"
NAME_FIELD = f"header.{NAME_ID}"
GENDER_FIELD = f"header.{GENDER_ID}"

#: 验收里的三个值：姓名红、性别绿、姓名字号 +20%。
NAME_COLOR = (186, 55, 55)
GENDER_COLOR = (47, 133, 90)
NAME_SCALE = 1.2


def _document() -> dict:
    """最小 v2 文档：只有页眉的姓名与性别两个字段。"""
    return {
        "version": 2,
        "language": "zh-CN",
        "header": {
            "items": [
                {
                    "kind": "field",
                    "id": NAME_ID,
                    "key": "name",
                    "value": "陈可",
                    "placement": "name",
                },
                {
                    "kind": "field",
                    "id": GENDER_ID,
                    "key": "gender",
                    "value": "女",
                    "placement": "name_meta",
                },
            ]
        },
        "sections": [],
    }


def _name_style_config() -> dict:
    """姓名三项全覆盖 + 性别只改颜色（与 capture.py 同一份配置）。"""
    return {
        "object_roles": {
            "version": 1,
            f"{NAME_FIELD}:meta": {
                "color": "#ba3737",
                "bold": False,
                "font_scale": NAME_SCALE,
            },
            f"{GENDER_FIELD}:meta": {"color": "#2f855a"},
        }
    }


def _spy_draw_name_gender(monkeypatch) -> dict:
    """捕获 `draw_name_gender` 的实参（不比对 PDF 字节，避免字体差异假红）。"""
    from app.services.pdf_exporter import header as header_module

    captured: dict = {}
    original = header_module.draw_name_gender

    def spy(pdf, name, plan, **kwargs):
        captured.update(kwargs)
        captured["name"] = name
        captured["plan"] = plan
        return original(pdf, name, plan, **kwargs)

    monkeypatch.setattr(header_module, "draw_name_gender", spy)
    return captured


@needs_font
def test_pdf_draw_name_gender_receives_field_level_style(monkeypatch) -> None:
    """验收 1/3：姓名 `#ba3737` + `bold=false` 必须传到 PDF 绘制入口；性别同理。"""
    from app.services.pdf_exporter import build_resume_pdf

    captured = _spy_draw_name_gender(monkeypatch)
    build_resume_pdf(_document(), page_limit=2, format_config=_name_style_config())

    assert captured["name_color"] == NAME_COLOR
    assert captured["extra_color"] == GENDER_COLOR
    assert captured["name_bold"] is False


@needs_font
def test_pdf_name_font_scale_changes_the_measured_and_drawn_size(monkeypatch) -> None:
    """验收 2：字号 ×1.2 时，**量高与画字用的是同一个值**（否则页头高度会错）。

    `name_size` 同时喂给 `plan_name_gender`（量）与 `draw_name_gender`（画），
    而页头高度取自 plan —— 这里把两次捕获的 `name_size` 与基线对照，
    比值必须恰好等于 font_scale。
    """
    from app.services.pdf_exporter import build_resume_pdf

    baseline = _spy_draw_name_gender(monkeypatch)
    build_resume_pdf(_document(), page_limit=2)
    base_size = baseline["name_size"]

    captured = _spy_draw_name_gender(monkeypatch)
    build_resume_pdf(_document(), page_limit=2, format_config=_name_style_config())
    assert captured["name_size"] == pytest.approx(base_size * NAME_SCALE)


def _docx_run(paragraph, text: str):
    """段落里第一个包含 `text` 的 run（姓名与性别在同一条段落里的两个 run）。"""
    for run in paragraph.runs:
        if text in run.text:
            return run
    raise AssertionError(f"未找到含 {text!r} 的 run")


def _docx_name_paragraph(content: bytes):
    document = Document(BytesIO(content))
    for paragraph in document.paragraphs:
        if "陈可" in paragraph.text:
            return paragraph
    raise AssertionError("Word 产物里没有姓名段落")


def test_docx_name_run_takes_field_level_style() -> None:
    """验收 1/3：Word 的姓名 run 取同一份 resolve（颜色 / 加粗 / 字号）。"""
    from app.services.docx_exporter import build_resume_docx

    styled = build_resume_docx(_document(), page_limit=2, format_config=_name_style_config())
    run = _docx_run(_docx_name_paragraph(styled.content), "陈可")

    assert str(run.font.color.rgb) == "BA3737"
    assert run.font.bold is False

    plain = build_resume_docx(_document(), page_limit=2)
    base_run = _docx_run(_docx_name_paragraph(plain.content), "陈可")
    # Word 的字号以 1/2 磅为存储单位（约 0.5pt 量化误差），所以给 3% 容差。
    assert run.font.size == pytest.approx(base_run.font.size * NAME_SCALE, rel=0.03)


def test_docx_gender_run_takes_field_level_color_only() -> None:
    """验收 4：只改性别 → 只有性别 run 变色，姓名 run 保持 accent。"""
    from app.services.docx_exporter import build_resume_docx

    gender_only = {"object_roles": {"version": 1, f"{GENDER_FIELD}:meta": {"color": "#2f855a"}}}
    styled = build_resume_docx(_document(), page_limit=2, format_config=gender_only)
    paragraph = _docx_name_paragraph(styled.content)

    assert str(_docx_run(paragraph, "女").font.color.rgb) == "2F855A"
    # 姓名没有设颜色（只设了性别），沿用模板强调色 —— 与没有配置时同一个值。
    plain = _docx_run(_docx_name_paragraph(build_resume_docx(_document()).content), "陈可")
    assert str(_docx_run(paragraph, "陈可").font.color.rgb) == str(plain.font.color.rgb)


def _pdf_log(result) -> list[tuple]:
    """PDF 的绘制日志：语义锚点 + 取整后的页面坐标（同样的输入应当逐个相同）。

    为什么不比 PDF 字节：fpdf2 的字体子集前缀与 `/ID`、`/CreationDate` 每次渲染都变
    （见 `test_resume_generate_golden` 的文档说明），字节比对必然假红。绘制日志覆盖了
    "画了什么、画在哪一页、y 坐标多少"——页头高度一变这里就会现形。
    """
    return [
        (span.kind, span.section, span.page, span.y_top, span.y_bottom, span.text)
        for span in result.spans
    ]


@needs_font
def test_pdf_default_header_has_identical_drawing_log_when_no_style_is_set() -> None:
    """验收 5：没有任何姓名/性别样式时，**画出来的东西一个坐标都不差**。

    仓库没有跨版本可比的 PDF 金标（字体子集随平台变），所以比的是同一次运行、同一台
    机器上的两份产物：无 `format_config` 与"只有空 `object_roles` 域"。
    默认分支的取值由下一条用例逐项钉住。
    """
    from app.services.pdf_exporter import build_resume_pdf

    plain = build_resume_pdf(_document(), page_limit=2)
    empty_domain = build_resume_pdf(
        _document(), page_limit=2, format_config={"object_roles": {"version": 1}}
    )
    assert plain.pages == empty_domain.pages
    assert _pdf_log(plain) == _pdf_log(empty_domain)


def test_docx_default_header_is_byte_identical_when_no_style_domain_is_empty() -> None:
    """同一条回归主判据的 Word 版本：除 `docProps/core.xml`（含创建时间）外逐字节相同。"""
    from app.services.docx_exporter import build_resume_docx

    plain = build_resume_docx(_document(), page_limit=2)
    empty_domain = build_resume_docx(
        _document(), page_limit=2, format_config={"object_roles": {"version": 1}}
    )

    def parts(content: bytes) -> dict[str, bytes]:
        with zipfile.ZipFile(BytesIO(content)) as archive:
            return {
                name: archive.read(name)
                for name in archive.namelist()
                if name != "docProps/core.xml"  # 唯一含时间戳的成员
            }

    assert parts(plain.content) == parts(empty_domain.content)


@needs_font
def test_default_header_still_uses_the_historical_constants(monkeypatch) -> None:
    """没有覆盖时，喂给绘制入口的仍是历史常量（None → accent / muted、bold=True）。

    "逐字节不变"的充分条件就是这两条：取值与改前相同、绘制代码未改。
    """
    from app.services.pdf_exporter import build_resume_pdf

    captured = _spy_draw_name_gender(monkeypatch)
    build_resume_pdf(_document(), page_limit=2)

    assert captured["name_color"] is None  # → pdf.accent
    assert captured["extra_color"] is None  # → pdf.muted_text
    assert captured["name_bold"] is True


def test_both_exporters_import_the_same_resolver() -> None:
    """验收 6 的静态守卫：两个导出器必须是同一个 resolver（防止将来又各写一份）。"""
    from app.services import docx_document_header
    from app.services.pdf_exporter import header as header_module

    assert header_module.name_block_styles is docx_document_header.name_block_styles
    assert header_module.name_block_styles is name_block_styles


# ===== I-42：性别段的角色级 meta（字段级 > 角色级 > 固定值） =====


def _meta_role_config(**props: object) -> dict:
    """只设 `meta` 角色级的 format_config（性别段在 HTML 里就是 `[data-role=meta]`）。"""
    return {"roles": {"version": 1, "meta": props}}


@needs_font
def test_pdf_gender_takes_role_level_meta_color_and_leaves_name_alone(monkeypatch) -> None:
    """验收 1：只改 `meta` 角色颜色 → 性别段变色、姓名不变。"""
    from app.services.pdf_exporter import build_resume_pdf

    captured = _spy_draw_name_gender(monkeypatch)
    build_resume_pdf(_document(), page_limit=2, format_config=_meta_role_config(color="#222222"))

    assert captured["extra_color"] == (34, 34, 34)
    assert captured["name_color"] is None  # 姓名只认 name 角色 + 姓名字段级


@needs_font
def test_pdf_gender_size_follows_role_level_meta(monkeypatch) -> None:
    """验收 2 的取值侧：`extra_size` 必须乘上角色级的 `font_scale`（量高与画字同一个值）。"""
    from app.services.pdf_exporter import build_resume_pdf

    baseline = _spy_draw_name_gender(monkeypatch)
    build_resume_pdf(_document(), page_limit=2)
    base_size = baseline["extra_size"]

    captured = _spy_draw_name_gender(monkeypatch)
    build_resume_pdf(_document(), page_limit=2, format_config=_meta_role_config(font_scale=1.5))
    assert captured["extra_size"] == pytest.approx(base_size * 1.5)
    assert captured["name_size"] == pytest.approx(baseline["name_size"])  # 姓名不动


@needs_font
def test_pdf_field_level_gender_still_beats_role_level_meta(monkeypatch) -> None:
    """验收 3（= I-03 验收 4 的回退线）：两层都设颜色时字段级赢。"""
    from app.services.pdf_exporter import build_resume_pdf

    config = _meta_role_config(color="#222222")
    config["object_roles"] = {"version": 1, f"{GENDER_FIELD}:meta": {"color": "#ba3737"}}
    captured = _spy_draw_name_gender(monkeypatch)
    build_resume_pdf(_document(), page_limit=2, format_config=config)

    assert captured["extra_color"] == NAME_COLOR


def test_gender_size_changes_the_planned_row_height() -> None:
    """验收 2 的几何侧：性别字号超过姓名时，块的**行高**跟着长（不是只变字）。

    直接量算，避开构建产物：`plan.name_gender` 的 `height` 就是页头高度的那一段，
    它变大意味着后续分区下移、页数可能变——这正是"只变字不变高"要防的症状。
    """
    from app.services.pdf_exporter.name_gender import plan_name_gender
    from test_pdf_exporter import _pdf_with_font

    pdf = _pdf_with_font()
    small = plan_name_gender(pdf, "陈可", "女", width=120, name_size=26.4, extra_size=9.0)
    big = plan_name_gender(pdf, "陈可", "女", width=120, name_size=26.4, extra_size=40.0)

    assert big.height > small.height


def test_docx_gender_run_takes_role_level_meta() -> None:
    """验收 1/2 的 Word 侧：性别 run 的颜色 / 字号取角色级 meta，姓名 run 不动。"""
    from app.services.docx_exporter import build_resume_docx

    styled = build_resume_docx(
        _document(),
        page_limit=2,
        format_config=_meta_role_config(color="#222222", font_scale=1.5),
    )
    paragraph = _docx_name_paragraph(styled.content)
    plain_paragraph = _docx_name_paragraph(build_resume_docx(_document()).content)

    gender_run = _docx_run(paragraph, "女")
    base_gender_run = _docx_run(plain_paragraph, "女")
    assert str(gender_run.font.color.rgb) == "222222"
    assert gender_run.font.size == pytest.approx(base_gender_run.font.size * 1.5, rel=0.03)

    # 姓名不受 meta 角色影响。
    assert str(_docx_run(paragraph, "陈可").font.color.rgb) == str(
        _docx_run(plain_paragraph, "陈可").font.color.rgb
    )


@needs_font
def test_default_gender_stays_on_the_historical_constants(monkeypatch) -> None:
    """验收 4：从未调过 meta 角色样式时，性别段仍是 muted + `name_extra_ratio`。"""
    from app.services.pdf_exporter import build_resume_pdf

    captured = _spy_draw_name_gender(monkeypatch)
    build_resume_pdf(_document(), page_limit=2)

    assert captured["extra_color"] is None  # → pdf.muted_text
    assert captured["extra_bold"] is False
    assert captured["plan"].same_line is True
