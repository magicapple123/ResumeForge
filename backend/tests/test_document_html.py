# SPDX-License-Identifier: Apache-2.0
"""HTML 出口（v2）：data-role 五角色 / data-resume-path 唯一 / 条目头三种布局 /
灰字段网格与 flow / inline 板块 / 转义与链接安全 / 自制模板 include 别名。"""

from __future__ import annotations

import copy
import re

from app.services.exporter import render_html
from app.services.resume.resume_templates import RESUME_TEMPLATES
from tests.document_export_samples import html_text, make_document


def _html(document=None, **kwargs) -> str:
    return render_html(document if document is not None else make_document(), **kwargs)


def test_html_roles_and_page_title():
    html = _html()
    roles = set(re.findall(r'data-role="([a-z_]+)"', html))
    assert {"name", "section_title", "entry_title", "meta", "body"} <= roles
    assert "<title>陈可 - 产品经理 - 简历</title>" in html


def test_html_paths_are_v2_item_paths():
    paths = re.findall(r'data-resume-path="([^"]*)"', _html())
    assert paths
    # 标签 Inline 与值 Inline 同属一个 item，因此同一路径可以出现多次；定位粒度是 **item**
    # （同一个 item 的标签+值共享路径是契约，前端据此点纸面定位到同一个字段）。
    assert len(set(paths)) >= 20
    for path in paths:
        assert path and not re.match(r"^[a-z_]+\.\d+\.\d+$", path)
    assert "education.ob_edu000001.it_edu000001" in paths
    assert "header.hd_00000001" in paths


def test_entry_head_layouts_and_gray_field_grid():
    html = _html()
    assert "head-split" in html
    assert "head-stacked" in html
    assert "sub-grid sub-cols-2" in html
    assert "sub-flow" in html
    # flow 行内分隔符由 planner 写进 segments（不是渲染器补的语言文案）。
    text = html_text(html)
    assert "Python" in text and "SQL" in text
    assert text.index("Python") < text.index("SQL")


def test_head_layout_variants_emit_dom_order_matching_paper():
    stacked = _html()
    # 项目条目是 stacked：标题在元信息之前（DOM 与纸面同序）。
    # 从 DOM 里第一个 stacked 条目头开始截，而不是从 CSS 里的类名开始——CSS 会随
    # 结构规则增长，从类名写死 4000 字符窗口会在无关样式改动后假红灯。
    start = stacked.index('<div class="entry-head head-stacked')
    project_block = stacked[start : start + 4000]
    assert project_block.index("校园招聘会策划") < project_block.index("项目负责人")

    document = copy.deepcopy(make_document())
    for entry in document["sections"][0]["entries"]:
        entry["layout"] = {"head": "meta_first"}
    meta_first = _html(document)
    assert "head-meta_first" in meta_first
    start = meta_first.index('<div class="entry-head head-meta_first')
    education_block = meta_first[start : start + 4000]
    assert education_block.index("本科") < education_block.index("示例大学")


def test_solo_cell_takes_whole_row():
    document = copy.deepcopy(make_document())
    entry = document["sections"][0]["entries"][0]
    entry["layout"] = {"columns": 2, "align": "equal"}
    for item in entry["items"]:
        if item.get("id") == "it_edu000005":
            item["solo"] = True
    html = _html(document)
    assert "sub-cell-solo" in html


def test_inline_section_is_a_tag_list():
    """Q26：技能块必须是 ul.skill-list > li（模板 .skill-list li 的标签 CSS 才生效）。"""
    html = _html()
    start = html.index('<ul class="skill-list"')
    block = html[start : html.index("</ul>", start) + len("</ul>")]
    assert block.count("<li>") == 2
    text = html_text(block)
    # 条目之间不再输出「；」（HTML 靠 li 分行）；条目内字段用 · 连接。
    assert "；" not in text
    compact = text.replace(" ", "")
    assert "Python" in compact and "技能分类：后端" in compact
    # body 黑字在前、trail 灰字在后。
    assert compact.index("Python") < compact.index("技能分类：后端")


def test_every_template_renders_the_skill_tag_list():
    """Q26：9 套模板都走同一个 inline 宏；ul/li 结构不能靠某套模板的 CSS 才成立。"""
    document = make_document()
    for name in sorted(RESUME_TEMPLATES):
        html = render_html(document, template=name)
        start = html.index('<ul class="skill-list"')
        block = html[start : html.index("</ul>", start) + len("</ul>")]
        assert block.count("<li>") == 2, name
        text = html_text(block)
        assert "；" not in text, name
        compact = text.replace(" ", "")
        assert compact.index("Python") < compact.index("技能分类：后端"), name
        # 旧实现是 div.inline-entry 包 span，标签 CSS 全部失配。
        assert 'class="inline-entry"' not in block, name


def _clickable_document() -> dict:
    """Q27 夹具：列表值（教育 courses）与作者名（论文 authors）都要带 item path。"""
    return {
        "version": 2,
        "language": "zh-CN",
        "header": {
            "items": [
                {
                    "kind": "field",
                    "id": "hd_00000001",
                    "key": "name",
                    "value": "陈可",
                    "placement": "name",
                }
            ]
        },
        "sections": [
            {
                "key": "education",
                "kind": "entries",
                "entries": [
                    {
                        "id": "ob_edu000001",
                        "items": [
                            {
                                "kind": "list",
                                "id": "it_edu000001",
                                "key": "courses",
                                "values": ["市场调研", "消费者行为"],
                                "placement": "lead",
                                "join": "comma",
                            }
                        ],
                    }
                ],
            },
            {
                "key": "publications",
                "kind": "entries",
                "entries": [
                    {
                        "id": "ob_pub000001",
                        "items": [
                            {
                                "kind": "authors",
                                "id": "it_pub000001",
                                "key": "authors",
                                "authors": [
                                    {"name": "张示例", "is_self": True},
                                    {"name": "李示例", "corresponding": True},
                                ],
                                "placement": "trail",
                            }
                        ],
                    }
                ],
            },
        ],
    }


def test_list_and_author_values_render_with_item_paths():
    """Q27 契约：每个列表值 / 作者名都带同一个 item path，且路径最后一段是真实 item id。

    定位粒度是 item：同一 item 可以有多个带同一路径的节点（列表多值），但每个节点
    都能被前端 closest("[data-resume-path]") 命中并定位回对应字段。
    """
    document = _clickable_document()
    html = render_html(document)
    course_path = "education.ob_edu000001.it_edu000001"
    author_path = "publications.ob_pub000001.it_pub000001"
    for value in ("市场调研", "消费者行为"):
        assert re.search(rf'data-resume-path="{course_path}"[^>]*>{value}<', html), value
    for author in ("张示例", "李示例"):
        assert re.search(rf'data-resume-path="{author_path}"[^>]*>{author}<', html), author
    assert html.count(f'data-resume-path="{course_path}"') == 2
    assert html.count(f'data-resume-path="{author_path}"') == 2
    # 分隔符/星号不是可点击字段：不生成路径节点；路径最后一段必须是真实 item id。
    paths = re.findall(r'data-resume-path="([^"]*)"', html)
    assert all(paths)
    item_ids = {"hd_00000001", "it_edu000001", "it_pub000001"}
    assert {path.rsplit(".", 1)[-1] for path in paths} <= item_ids


def test_html_escapes_content_and_blocks_unsafe_links():
    document = copy.deepcopy(make_document())
    document["header"]["items"][0]["value"] = '<script>alert("x")</script>'
    for item in document["sections"][1]["entries"][0]["items"]:
        if item.get("id") == "it_prj000005":
            item["value"] = "javascript:alert(1)"
    html = _html(document)
    assert "<script>alert" not in html
    assert "&lt;script&gt;" in html
    assert 'href="javascript' not in html


def test_custom_template_alias_still_renders_v2_body():
    custom = (
        '<!doctype html><html><head></head><body>{% include "_resume_sections.j2" %}</body></html>'
    )
    html = render_html(make_document(), template_html=custom)
    assert "示例大学" in html
    assert "data-resume-path=" in html
    assert "window.addEventListener" in html  # A4 溢出探针补回


def test_hidden_content_never_renders():
    html = _html()
    for hidden in ("隐藏大学", "秘密字段", "隐藏要点"):
        assert hidden not in html
