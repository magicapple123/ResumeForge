# SPDX-License-Identifier: Apache-2.0
"""学术模板（scholar）：参考版式移植后的形状守卫。

本文件只钉**这一套模板**自己的事实，通用口径（注册表 ↔ CSS 逐条漂移、字号层级、
技能标签形状、列表缩进……）由 `test_resume_layout_templates.py` /
`test_resume_layout_header_css.py` / `test_pdf_exporter_columns.py` 覆盖——那些用例按
`RESUME_TEMPLATES` 参数化，新增模板会自动进入，所以这里不重复抄一遍取值。

这里守四件"只有本模板才成立"的事：

1. 文件在 catalog 里、能渲染、且**共用片段**没被绕过（`data-resume-path` 是前端
   「点纸面字段定位编辑」的契约，必须由共用宏产出，不能在模板里自己写正文标记）；
2. 标题形状是**加粗 + 整宽细线**，不是色块、不是左竖条（参考版式的核心特征）；
3. 短条目是**三列项目符号列表**（`.skill-list` 的 grid + `li::before` 的「•」）；
4. 纯黑白：CSS 里出现的每个十六进制颜色都是灰阶（r == g == b）。
"""

from __future__ import annotations

import re

from app.services.exporter import render_html
from app.services.resume.resume_sample import sample_resume_content
from app.services.resume.resume_template_catalog import (
    RESUME_TEMPLATES,
    VISIBLE_TEMPLATE_NAMES,
)
from app.services.resume.resume_templates import TEMPLATES_DIR
from test_resume_layout_templates import _fs_scale, _selector_block
from tests.document_test_support import as_document, item_path

TEMPLATE_NAME = "scholar"

# 参考版式里必须有正文锚点的几处：页眉按 key 取 header item 的路径，正文按
# (section, field_key) 由同一份 v2 文档算出 section.entry_id.item_id。
HEADER_PATH_KEYS = ("name", "job_intent", "phone", "email")
BODY_PATH_FIELDS = (
    ("education", "school"),
    ("education", "gpa"),
    ("experience", "company"),
    ("projects", "name"),
    ("skills", "name"),
)


def _css() -> str:
    return (TEMPLATES_DIR / RESUME_TEMPLATES[TEMPLATE_NAME]["file"]).read_text(encoding="utf-8")


# ===== 1. catalog 与渲染 =====


def test_scholar_is_registered_and_visible():
    """在 catalog 里、文件存在、名字进可见清单（可见清单的顺序是 UI 顺序，追加在末尾）。"""
    spec = RESUME_TEMPLATES[TEMPLATE_NAME]

    assert spec["label"] == "学术"
    assert spec["file"] == "resume_scholar.html.j2"
    assert spec["description"].strip()
    # 参考版式是黑体（不加衬线），所以 serif_heading 为假——前端据此不给字族提示。
    assert spec["serif_heading"] is False
    assert (TEMPLATES_DIR / spec["file"]).is_file()
    assert TEMPLATE_NAME in VISIBLE_TEMPLATE_NAMES
    assert VISIBLE_TEMPLATE_NAMES[-1] == TEMPLATE_NAME


def test_scholar_renders_through_the_shared_sections_fragment():
    """正文必须来自 `_resume_sections.j2`：`data-resume-path` 一个都不能少。

    模板若自己重写正文标记，前端「点纸面字段定位编辑」会静默失效（点上去没有目标），
    而这件事在视觉上完全看不出来——所以这条断言盯的是标记的**来处**，不只是"页面能渲染"。
    """
    document = as_document(sample_resume_content())
    html = render_html(document, template=TEMPLATE_NAME)

    assert "<html" in html
    for item in document["header"]["items"]:
        if item["key"] in HEADER_PATH_KEYS:
            assert f'data-resume-path="header.{item["id"]}"' in html, item["key"]
    for section, field_key in BODY_PATH_FIELDS:
        path = item_path(document, section, field_key)
        assert f'data-resume-path="{path}"' in html, path
    # 共用片段与测量脚本都真的被 include 进来了。
    assert "dataset.overflow" in html
    assert "--fit-scale" not in html


def test_scholar_leaves_no_hole_when_there_is_no_photo():
    """没有照片时不渲染 `.profile-photo` —— 参考版式里那块是方形照片，不是预留空位。

    示例内容**现在带照片**（模板预览要能看出照片位长什么样），所以这里显式取一份
    ``photo=""`` 的内容来验"没有照片"这条分支：既断言照片元素没出现，也断言页头本身
    还在（避免用"整块页头都不渲染"这种更省事但错误的方式通过）。
    """
    without_photo = sample_resume_content().model_copy(update={"photo": ""})
    html = render_html(without_photo, template=TEMPLATE_NAME)

    assert 'class="profile-photo"' not in html
    assert 'class="header"' in html


# ===== 2. 标题形状：加粗 + 整宽细线 =====


def test_section_titles_are_bold_with_a_full_width_rule():
    """分区标题用 `border-bottom` 画线，且没有底色块 / 左竖条。

    `test_resume_layout_templates.py::_section_title_style` 把三种形状归成
    left_bar / accent_box / soft_box / underline / plain 五档，scholar 必须是 underline：
    参考版式里标题下面是一条横贯版心的细线，**不是**色块也不是竖条。
    """
    declarations = _selector_block(_css(), ".section-title")

    assert "font-weight: 700" in declarations
    assert "border-bottom:" in declarations
    assert "border-left:" not in declarations
    assert "background:" not in declarations
    # 整宽：标题不写 `display: inline-block`（那会把下划线缩到文字宽度）。
    assert "display: inline-block" not in declarations


# ===== 3. 三列项目符号列表 =====


def test_skill_list_is_a_three_column_bulleted_grid():
    """短条目（技能 / 证书）三列并排，每项前面一个「•」。

    这是本模板与其余 8 套最明显的差别：参考版式把「学生工作」「技能认证」这类一行一条的
    短内容铺成三列，好在一页里塞进更多条目。
    """
    css = _css()
    list_block = _selector_block(css, ".skill-list")
    assert "display: grid" in list_block
    assert "repeat(3, minmax(0, 1fr))" in list_block

    item = _selector_block(css, ".skill-list li")
    assert "list-style: none" in item
    bullet = _selector_block(css, ".skill-list li::before")
    assert 'content: "•"' in bullet


def test_scholar_body_stays_single_column():
    """正文仍是单栏：三列只作用于技能列表内部，不能写成 `.resume-sections` 网格。

    写成两栏会让 `_resume_sections.j2` 之外的 PDF 侧也去收窄列框
    （`test_pdf_exporter_columns.py` 按 `.resume-sections` 的 grid 反推 `column_count`），
    于是"预览单栏、导出两栏"。
    """
    assert ".resume-sections" not in _css()


# ===== 4. 纯黑白 =====


def test_every_color_in_the_stylesheet_is_grayscale():
    """参考版式是纯黑白：CSS 里的每个十六进制颜色都必须 r == g == b。

    有彩色混进来时肉眼未必立刻发现（一处浅蓝底已经很显眼，一处 5% 的色偏不会），
    所以用"每个颜色都必须是灰阶"这条机械判据挡住。
    """
    colors = re.findall(r"#[0-9a-fA-F]{3,6}\b", _css())
    assert colors, "样式表里一个颜色都没读到，说明这条断言本身失效了"

    def _rgb(token: str) -> tuple[int, int, int]:
        text = token.lstrip("#")
        if len(text) == 3:
            text = "".join(char * 2 for char in text)
        return int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16)

    offenders = [token for token in colors if len(set(_rgb(token))) != 1]
    assert not offenders, f"学术模板不该出现彩色：{offenders}"


# ===== 5. 注册表与 CSS 的关键参数对得上（本模板的抽查） =====


def test_scholar_layout_defaults_trace_back_to_its_own_css():
    """抽查几条最容易抄错的：页边距两值简写、行高、标题线、照片方形。

    全量核对在 `test_resume_layout_templates.py`（它按注册表参数化，已包含 scholar）；
    这里只留一手"本模板的读数本身是对的"，失败时报错能直接指向这套模板。
    """
    from app.services.resume.resume_template_layout import TEMPLATE_LAYOUT_DEFAULTS

    css = _css()
    defaults = TEMPLATE_LAYOUT_DEFAULTS[TEMPLATE_NAME]
    # 直接在整份样式表里取第一个 `padding: <上下>mm <左右>mm` 与第一个 `line-height`：
    # 它们都在 `body` 规则里，且 `body` 之后的规则没有第二处这种两值 mm 简写。
    # （不用 `body {…}` 取块：body 里 `height: {{ page_limit * 297 }}mm` 的 `}}` 会让
    #  `[^}]*` 提前截断，读不到后面的 padding。）
    padding = re.search(r"padding:\s*([\d.]+)mm\s+([\d.]+)mm", css)
    assert padding, "body 的 padding 应该是「上下 左右」两值简写"
    assert float(padding.group(1)) == defaults["padding_mm"]
    assert defaults["padding_sides_mm"] == (
        float(padding.group(2)),
        float(padding.group(2)),
    )

    line_height = re.search(r"line-height:\s*([\d.]+)", css)
    assert line_height, "模板里没找到行高"
    assert float(line_height.group(1)) == defaults["line_height"]

    photo = _selector_block(css, ".profile-photo")
    assert _fs_scale(photo, "width") == defaults["photo_width_ratio"]
    assert _fs_scale(photo, "height") == defaults["photo_height_ratio"]
    # 方形照片：宽高比例相同。
    assert defaults["photo_width_ratio"] == defaults["photo_height_ratio"]

    title = _selector_block(css, ".section-title")
    assert _fs_scale(title, "padding-bottom") == defaults["section_title_pad_y"]
