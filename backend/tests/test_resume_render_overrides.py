# SPDX-License-Identifier: Apache-2.0
"""W07-BE：format_config 域协议 + 角色/对象覆盖 + 分页/照片裁剪域的解析与 HTML 产出。

覆盖（契约第 1 册 §1.2/§1.4/§1.6、第 2 册 §3.2、第 3 册 §7.1）：

* 域分派：合法域写入、空域不落库（R3）、version>1 整域丢弃（R2）、越界/未知键丢弃；
* 角色/对象解析：六层次序（对象 > 角色）、来源三态、空覆盖零 CSS；
* HTML 唯一 CSS 产出：角色规则逐字、分页 @media print、默认空串；
* 照片裁剪：派生数据（非破坏）+ 哈希失效；
* prune：指向不存在对象的覆盖与失效裁剪域被裁掉、幂等、无需改动返回 None；
* catalog：role_fields / template_role_defaults / style_props 与后端表同源。
"""

from __future__ import annotations

import base64
import io
import re

import pytest
from app.schemas.resume import ResumeContent
from app.services.resume import resume_photo_crop
from app.services.resume.format_capabilities import CAPABILITY_KEYS
from app.services.resume.resume_config_domains import DOMAIN_KEYS, is_supported
from app.services.resume.resume_pagination import SECTION_KEYS as PAGINATION_SECTION_KEYS
from app.services.resume.resume_pagination import pagination_css, resolve_pagination
from app.services.resume.resume_photo_crop import photo_sha256
from app.services.resume.resume_render_overrides import (
    prune_overrides,
    render_overrides_css,
    resolve_render_overrides,
)
from app.services.resume.resume_sections import DEFAULT_SECTION_ORDER
from app.services.resume.resume_style import entry_style_css, resolve_style, role_style_css
from app.services.resume.resume_style_schema import (
    PROP_BOUNDS,
    ROLE_PROPS,
    ROLES,
    STYLE_PROPS,
    template_role_defaults,
    validate_objects_domain,
    validate_roles_domain,
)
from app.services.resume.resume_template_format import FONT_KEY, validated_format_config
from PIL import Image
from test_pdf_exporter import _text_runs, needs_font

PHOTO = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "YAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def _png(width: int = 8, height: int = 8) -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (10, 120, 200)).save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


# ===== 1. 域机制 =====


def test_domain_keys_are_the_frozen_four():
    assert DOMAIN_KEYS == ("roles", "objects", "pagination", "photo_crop")
    assert all(is_supported(key, 1) for key in DOMAIN_KEYS)
    assert not is_supported("roles", 2)


def test_validated_format_config_accepts_domains_and_drops_empty_ones():
    config = validated_format_config(
        {
            "roles": {"version": 1, "body": {"line_height": 1.55}},
            "objects": {"version": 1, "exp_12345678": {"space_before": 0.6}},
            "pagination": {"version": 1, "entries": {"exp_12345678": {"break_before": "page"}}},
            "photo_crop": {
                "version": 1,
                "source": {"sha256": photo_sha256(PHOTO), "width": 1, "height": 1},
                "rect": {"x": 0, "y": 0, "w": 1, "h": 1},
                "aspect": "free",
            },
        }
    )
    for key in DOMAIN_KEYS:
        assert key in config
    # R3：空域（只有 version / 全非法）不落库。
    empty = validated_format_config(
        {
            "roles": {"version": 1},
            "objects": {"version": 1, "bad": {"nope": 1}},
            "pagination": {"version": 1},
            "photo_crop": {"version": 1},
        }
    )
    assert not [key for key in DOMAIN_KEYS if key in empty]


def test_unsupported_domain_version_is_dropped_whole():
    config = validated_format_config({"roles": {"version": 2, "body": {"line_height": 1.5}}})
    assert "roles" not in config


def test_role_domain_drops_unknown_roles_props_and_out_of_range_values():
    domain = validate_roles_domain(
        {
            "version": 1,
            "body": {"line_height": 1.55, "indent": 1.2, "bogus": 1, "font_scale": 9.0},
            "nope": {"line_height": 1.5},
            "name": {"line_height": 1.8},  # name 不允许 line_height
        }
    )
    assert domain == {"version": 1, "body": {"line_height": 1.55, "indent": 1.2}}


def test_objects_domain_requires_stable_ids_and_bounds_entries():
    domain = validate_objects_domain(
        {
            "version": 1,
            "exp_12345678": {"bullet": "dash", "space_before": 0.6},
            "short": {"line_height": 1.4},  # id 太短
            "bad id": {"line_height": 1.4},  # 非法字符
        }
    )
    assert domain == {"version": 1, "exp_12345678": {"bullet": "dash", "space_before": 0.6}}


def test_style_props_and_bounds_are_the_frozen_contract():
    assert ROLES == ("name", "section_title", "entry_title", "body", "meta", "emphasis")
    keys = tuple(prop["key"] for prop in STYLE_PROPS)
    assert len(keys) == 12 and len(set(keys)) == 12
    assert PROP_BOUNDS["font_scale"] == (0.70, 2.40)
    assert PROP_BOUNDS["space_before"] == (0.0, 3.0)
    assert PROP_BOUNDS["line_height"] == (1.0, 2.6)
    assert PROP_BOUNDS["indent"] == (0.0, 4.0)
    assert PROP_BOUNDS["letter_spacing"] == (-0.10, 0.30)
    assert set(ROLE_PROPS["body"]) >= {"indent", "bullet", "align", "line_height"}
    assert "meta_align" in ROLE_PROPS["meta"]


def test_template_role_defaults_project_from_the_layout_registry():
    from app.services.resume.resume_template_layout import TEMPLATE_LAYOUT_DEFAULTS

    for name, defaults in TEMPLATE_LAYOUT_DEFAULTS.items():
        projected = template_role_defaults(name)
        assert projected["name"]["font_scale"] == pytest.approx(float(defaults["name_ratio"]))
        assert projected["body"]["line_height"] == pytest.approx(float(defaults["line_height"]))


def test_pagination_section_keys_match_the_renderer_order():
    assert tuple(PAGINATION_SECTION_KEYS) == tuple(DEFAULT_SECTION_ORDER)


def test_photo_crop_domain_validates_rect_and_source():
    good = {
        "version": 1,
        "source": {"sha256": "a" * 64, "width": 100, "height": 200},
        "rect": {"x": 0.1, "y": 0.2, "w": 0.5, "h": 0.6},
        "aspect": "3:4",
    }
    assert resume_photo_crop.validate_photo_crop_domain(good) is not None
    for broken in (
        {**good, "source": {"sha256": "A" * 64, "width": 100, "height": 200}},
        {**good, "rect": {"x": 0.8, "y": 0.2, "w": 0.5, "h": 0.6}},
        {**good, "rect": {"x": 0.1, "y": 0.2, "w": 0, "h": 0.6}},
    ):
        assert resume_photo_crop.validate_photo_crop_domain(broken) is None


# ===== 2. 角色/对象解析 =====


def test_style_resolution_prefers_object_over_role_and_reports_source():
    style = resolve_style(
        template="classic",
        format_config={
            "roles": {"version": 1, "body": {"line_height": 1.55, "indent": 1.2}},
            "objects": {"exp_12345678": {"line_height": 1.4}},
        },
    )
    assert style.role("body").indent == 1.2
    effective = style.effective("body", object_id="exp_12345678")
    assert effective.line_height == 1.4 and effective.indent == 1.2
    assert style.source_of("line_height", role="body", object_id="exp_12345678") == "object"
    assert style.source_of("line_height", role="body") == "role"
    assert style.source_of("line_height", role="name") == "template"


def test_default_style_is_empty_and_produces_no_css():
    overrides = resolve_render_overrides(template="classic", format_config=None, photo=PHOTO)
    assert overrides.empty
    assert render_overrides_css(overrides) == ""
    assert role_style_css(overrides.style) == ""
    assert entry_style_css(overrides.style) == ""


def test_role_css_is_deterministic_and_matches_the_contract_mapping():
    style = resolve_style(
        template="classic",
        format_config={
            "roles": {
                "version": 1,
                "body": {"line_height": 1.55, "indent": 1.6, "bullet": "dash"},
                "section_title": {"color": "#123c69", "space_after": 0.8},
            }
        },
    )
    css = role_style_css(style)
    assert '[data-role="body"] {' in css
    assert "line-height: 1.55;" in css
    assert "padding-left: calc(var(--fs) * 1.6);" in css
    assert "list-style-type: '–';" in css
    assert "color: #123c69;" in css
    assert "margin-bottom: calc(var(--fs) * 0.8);" in css


def test_object_css_targets_the_stable_object_id():
    style = resolve_style(
        template="classic",
        format_config={"objects": {"version": 1, "exp_12345678": {"space_before": 0.6}}},
    )
    css = entry_style_css(style)
    assert '[data-object-id="exp_12345678"]' in css
    assert "margin-top: calc(var(--fs) * 0.6);" in css


def test_pagination_css_is_print_only_and_empty_by_default():
    assert pagination_css(resolve_pagination(None)) == ""
    plan = resolve_pagination(
        {
            "pagination": {
                "version": 1,
                "entries": {"exp_12345678": {"break_before": "page"}},
                "sections": {"experience": {"break_before": "page"}},
                "continuation": {"repeat_name": True},
            }
        }
    )
    css = pagination_css(plan)
    assert css.startswith("@media print {")
    assert '[data-object-id="exp_12345678"] { break-before: page; }' in css
    assert '[data-section="experience"] { break-before: page; }' in css
    assert plan.repeat_name is True


# ===== 3. 照片裁剪（非破坏派生） =====


def test_photo_crop_renders_a_derived_image_and_keeps_the_source_intact():
    source = _png(40, 20)
    sha = photo_sha256(source)
    config = {
        "photo_crop": {
            "version": 1,
            "source": {"sha256": sha, "width": 40, "height": 20},
            "rect": {"x": 0.0, "y": 0.0, "w": 0.5, "h": 1.0},
            "aspect": "free",
        }
    }
    overrides = resolve_render_overrides(template="classic", format_config=config, photo=source)
    assert overrides.photo_crop is not None
    derived = overrides.photo_for_render(source)
    assert derived != source
    payload = base64.b64decode(derived.partition(",")[2])
    with Image.open(io.BytesIO(payload)) as image:
        assert image.size == (20, 20)  # 水平一半
    # 原图字符串一个字节都没改（非破坏）。
    assert source.startswith("data:image/png;base64,")


def test_photo_crop_is_ignored_when_the_photo_changed():
    config = {
        "photo_crop": {
            "version": 1,
            "source": {"sha256": "f" * 64, "width": 10, "height": 10},
            "rect": {"x": 0, "y": 0, "w": 1, "h": 1},
            "aspect": "free",
        }
    }
    overrides = resolve_render_overrides(template="classic", format_config=config, photo=PHOTO)
    assert overrides.photo_crop is None
    assert overrides.photo_for_render(PHOTO) == PHOTO


# ===== 4. prune（保存时裁掉死数据） =====


def test_prune_drops_dead_object_overrides_and_stale_photo_crop():
    content = {"name": "张三", "experience": [{"company": "甲", "id": "exp_12345678"}]}
    config = {
        "roles": {"version": 1, "body": {"line_height": 1.5}},
        "objects": {
            "version": 1,
            "exp_12345678": {"space_before": 0.6},
            "exp_deadbeef": {"space_before": 0.3},
        },
        "pagination": {
            "version": 1,
            "entries": {"exp_12345678": {"break_before": "page"}, "exp_deadbeef": {}},
        },
        "photo_crop": {
            "version": 1,
            "source": {"sha256": "f" * 64, "width": 10, "height": 10},
            "rect": {"x": 0, "y": 0, "w": 1, "h": 1},
            "aspect": "free",
        },
    }
    pruned = prune_overrides(content, config)
    assert pruned is not None
    assert pruned["objects"] == {"version": 1, "exp_12345678": {"space_before": 0.6}}
    assert pruned["pagination"] == {
        "version": 1,
        "entries": {"exp_12345678": {"break_before": "page"}},
    }
    assert "photo_crop" not in pruned
    assert pruned["roles"] == config["roles"]
    # 幂等 + 无需改动返回 None。
    assert prune_overrides(content, pruned) is None
    assert prune_overrides(content, None) is None


def test_photo_sha256_is_the_hash_of_the_data_url_string():
    assert len(photo_sha256(PHOTO)) == 64
    assert photo_sha256(None) == ""
    assert photo_sha256(PHOTO) == photo_sha256(PHOTO)


# ===== 5. catalog 三字段 =====


def test_templates_catalog_exposes_role_contract(client):
    payload = client.get("/api/resumes/templates").json()
    assert payload["role_fields"][0]["role"] == "name"
    assert payload["role_fields"][0]["label_key"].startswith("resume.role.")
    assert set(payload["template_role_defaults"]) >= {"classic", "scholar"}
    assert payload["template_role_defaults"]["classic"]["name"]["font_scale"] == pytest.approx(1.86)
    style_props = {item["key"]: item for item in payload["style_props"]}
    assert set(style_props) == {prop["key"] for prop in STYLE_PROPS}
    assert style_props["bullet"]["options"] == ["dot", "dash", "none"]


def test_capability_matrix_mention_is_consistent():
    # 避免误删机器表里的能力项（W05 文档双写守卫的互补断言）。
    assert "scholar_skills_grid" in CAPABILITY_KEYS


def test_visible_style_config_roundtrip_keeps_domains_and_font():
    config = validated_format_config(
        {
            FONT_KEY: "__system__",
            "roles": {"version": 1, "name": {"letter_spacing": 0.05}},
            "objects": {"exp_12345678": {"align": "center"}},
        }
    )
    assert config["roles"] == {"version": 1, "name": {"letter_spacing": 0.05}}
    assert config["objects"] == {"version": 1, "exp_12345678": {"align": "center"}}
    # 角色 CSS 只认显式值：没设的角色不产生规则。
    style = resolve_style(template="classic", format_config=config)
    assert re.search(r'\[data-role="meta"\]', role_style_css(style)) is None


# ===== 6. 三个渲染器消费同一份 RenderOverrides（HTML / PDF / Word） =====


def _render_resume() -> ResumeContent:
    return ResumeContent(
        name="张三",
        job_intent="后端工程师",
        summary="一段总结。",
        experience=[
            {
                "company": "甲公司",
                "role": "工程师",
                "description": ["做了甲。"],
                "id": "exp_12345678",
            },
            {
                "company": "乙公司",
                "role": "工程师",
                "description": ["做了乙。"],
                "id": "exp_87654321",
            },
        ],
    )


def test_html_consumes_role_and_object_overrides():
    from app.services.exporter import render_html

    resume = _render_resume()
    default_html = render_html(resume)
    # 默认路径：模板已带 data-role 属性（角色覆盖的命中点），但没有任何角色 CSS。
    assert 'data-role="section_title"' in default_html
    assert '[data-role="' not in default_html
    assert default_html.count("--fit-scale") == 0

    styled = render_html(
        resume,
        format_config={
            "roles": {"version": 1, "body": {"line_height": 1.55}},
            "objects": {"version": 1, "exp_12345678": {"space_before": 0.6}},
        },
    )
    assert '[data-role="body"] { line-height: 1.55; }' in styled
    assert '[data-object-id="exp_12345678"]' in styled


@needs_font
def test_pdf_consumes_role_and_object_overrides():
    from app.services.pdf_exporter import build_resume_pdf

    resume = _render_resume()
    baseline = build_resume_pdf(resume, template="classic", page_limit=2)
    styled = build_resume_pdf(
        resume,
        template="classic",
        page_limit=2,
        format_config={
            "roles": {"version": 1, "body": {"font_scale": 1.8}},
            "objects": {"version": 1, "exp_12345678": {"bullet": "dash", "space_before": 0.9}},
        },
    )

    def body_size(content: bytes) -> float:
        runs = _text_runs(content)
        return next(run[2] for run in runs if "一段总结" in run[3])

    # 正文字号乘 1.8：同一段文字的字号确实变大（不是"解析了但没人用"）。
    assert body_size(styled.content) > body_size(baseline.content)
    # 对象级 bullet=dash 真的换了项目符号。
    assert any("–" in run[3] for run in _text_runs(styled.content))


def test_word_consumes_role_overrides():
    import io as _io
    import zipfile

    from app.services.docx_exporter import build_resume_docx

    document = build_resume_docx(
        _render_resume(),
        template="classic",
        page_limit=2,
        format_config={"roles": {"version": 1, "section_title": {"color": "#123c69"}}},
    )
    with zipfile.ZipFile(_io.BytesIO(document.content)) as bundle:
        xml = bundle.read("word/document.xml").decode("utf-8")
    assert "123C69" in xml, "Word 区块标题应使用角色覆盖色"


def test_photo_crop_reaches_html_and_word():
    import io as _io
    import zipfile

    from app.services.docx_exporter import build_resume_docx
    from app.services.exporter import render_html

    photo = _png(40, 20)
    config = {
        "photo_crop": {
            "version": 1,
            "source": {"sha256": photo_sha256(photo), "width": 40, "height": 20},
            "rect": {"x": 0.0, "y": 0.0, "w": 0.5, "h": 1.0},
            "aspect": "free",
        }
    }
    resume = _render_resume().model_copy(update={"photo": photo})
    html = render_html(resume, format_config=config)
    cropped = re.search(r'<img class="profile-photo" src="data:image/png;base64,([^"]+)"', html)
    assert cropped, "HTML 里应有照片"
    from PIL import Image

    with Image.open(_io.BytesIO(base64.b64decode(cropped.group(1)))) as image:
        assert image.size == (20, 20), "HTML 用的是按 rect 派生的裁剪图"

    document = build_resume_docx(resume, template="classic", page_limit=1, format_config=config)
    with zipfile.ZipFile(_io.BytesIO(document.content)) as bundle:
        assert any(name.startswith("word/media/") for name in bundle.namelist())
