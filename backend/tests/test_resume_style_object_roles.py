# SPDX-License-Identifier: Apache-2.0
"""W3：``object_roles`` 域——「文字级别」按选中字段/角色生效的校验、优先级与 HTML 产出。

三件事必须同时成立：

1. **校验**：键形如 ``"<object_id>:<role>"``，角色 ∈ ROLES、属性按该角色的白名单收窄
   （meta 不允许段距等）、≤400 条、空域返回`` None ``（R3：不落库）；
2. **优先级**：role 基础 → objects[objectId] → object_roles["<id>:<role>"]（最高）。
   PDF / Word 都走 ``ResolvedStyle.effective(role, object_id=...)``，所以 HTML 的
   ``entry_style_css`` 必须与这条优先级逐字对等（角色规则里字号按该角色模板基准展开）；
3. **向后兼容**：旧配置没有 object_roles 时 ``resolve_style`` / ``entry_style_css`` /
   ``render_html`` 与改动前逐字节相同（空域 == 没有域）。

浏览器计算样式属人工核对，不进 CI：pytest 环境没有浏览器。
"""

from __future__ import annotations

import io
import re
import zipfile

from app.schemas.resume import ResumeContent
from app.services.exporter import render_html
from app.services.resume.resume_render_overrides import prune_overrides
from app.services.resume.resume_style import entry_style_css, resolve_style
from app.services.resume.resume_style_schema import (
    MAX_OBJECT_ROLES,
    template_role_defaults,
    validate_object_roles_domain,
)
from app.services.resume.resume_template_format import validated_format_config
from test_pdf_exporter import _text_runs, needs_font

ENTRY_ID = "exp_12345678"
OTHER_ID = "prj_87654321"


def _style(object_roles: dict, template: str = "classic"):
    return resolve_style(
        template=template,
        format_config={"object_roles": {"version": 1, **object_roles}},
    )


def _rules(css: str) -> dict[str, str]:
    """拆成 {selector: declarations}；规则格式固定为"两空格缩进 + 单行规则"。"""
    found: dict[str, str] = {}
    for line in css.splitlines():
        match = re.match(r"^\s+(.+?) \{ (.+) \}$", line)
        if match:
            found[match.group(1)] = match.group(2)
    return found


def _resume() -> ResumeContent:
    """最小真实简历：一条教育 + 一条经历（对象 id 与模板 data-object-id 对齐）。"""
    return ResumeContent.model_validate(
        {
            "photo": "",
            "name": "测试",
            "gender": "",
            "birth_year": "",
            "phone": "",
            "email": "",
            "city": "",
            "personal_website": "",
            "github": "",
            "job_intent": "工程师",
            "summary": "一段总结",
            "education": [],
            "experience": [
                {
                    "id": ENTRY_ID,
                    "company": "甲公司",
                    "role": "工程师",
                    "start_date": "2020-01",
                    "end_date": "2021-01",
                    "description": ["做了一件事"],
                }
            ],
            "campus_experience": [],
            "projects": [],
            "skills": [],
            "awards": [],
        }
    )


# ===== 1. 域校验 =====


def test_valid_role_scoped_props_are_kept_and_narrowed_by_role():
    domain = validate_object_roles_domain(
        {
            "version": 1,
            f"{ENTRY_ID}:body": {"font_scale": 1.4, "bold": True, "space_before": 0.3},
            # meta 不允许段距/行高：这两个属性被丢掉，其余保留。
            f"{ENTRY_ID}:meta": {"font_scale": 1.2, "space_before": 0.3, "line_height": 1.5},
            # entry_title 允许对齐、不允许缩进。
            f"{ENTRY_ID}:entry_title": {"align": "center", "indent": 0.5},
        }
    )
    assert domain == {
        "version": 1,
        f"{ENTRY_ID}:body": {"font_scale": 1.4, "bold": True, "space_before": 0.3},
        f"{ENTRY_ID}:meta": {"font_scale": 1.2},
        f"{ENTRY_ID}:entry_title": {"align": "center"},
    }


def test_malformed_keys_out_of_range_values_and_unknown_roles_are_dropped():
    domain = validate_object_roles_domain(
        {
            "version": 1,
            "short:body": {"bold": True},  # 对象 id 太短
            f"{ENTRY_ID}:nope": {"bold": True},  # 未知角色
            f"{ENTRY_ID}:body:extra": {"bold": True},  # 多一个冒号，对象 id 不合法
            f"{ENTRY_ID}:body": {"font_scale": 9.0, "color": "red", "bogus": 1},  # 全非法
            f"{OTHER_ID}:name": {"letter_spacing": 9.0},  # 越界
            f"{OTHER_ID}:body": "not-a-dict",
        }
    )
    assert domain is None


def test_empty_or_non_mapping_domain_returns_none():
    for raw in (None, {}, {"version": 1}, "bogus", [], {"version": 1, "bad": {}}):
        assert validate_object_roles_domain(raw) is None


def test_domain_is_capped_at_400_entries():
    raw = {f"exp_{index:08d}:body": {"bold": True} for index in range(MAX_OBJECT_ROLES + 5)}
    domain = validate_object_roles_domain(raw)
    assert domain is not None
    assert len(domain) - 1 == MAX_OBJECT_ROLES


def test_validated_format_config_roundtrips_domain_and_drops_empty():
    payload = {"version": 1, f"{ENTRY_ID}:body": {"bold": True, "font_scale": 1.2}}
    assert validated_format_config({"object_roles": payload}) == {"object_roles": payload}
    assert "object_roles" not in validated_format_config({"object_roles": {"version": 1}})
    assert "object_roles" not in validated_format_config(
        {"object_roles": {"version": 2, f"{ENTRY_ID}:body": {"bold": True}}}
    )


# ===== 2. 优先级：role → object → object_role =====


def test_object_role_is_the_most_specific_layer():
    style = resolve_style(
        template="classic",
        format_config={
            "roles": {
                "version": 1,
                "body": {"font_scale": 1.2, "line_height": 1.55, "indent": 1.2},
            },
            "objects": {
                "version": 1,
                ENTRY_ID: {
                    "font_scale": 1.3,
                    "line_height": 1.4,
                    "color": "#123456",
                    "space_before": 0.6,
                },
            },
            "object_roles": {
                "version": 1,
                f"{ENTRY_ID}:body": {"font_scale": 1.6, "bold": True},
            },
        },
    )
    effective = style.effective("body", object_id=ENTRY_ID)
    assert effective.font_scale == 1.6  # object_role 最高
    assert effective.bold is True
    assert effective.line_height == 1.4  # 对象层没被角色层冲掉
    assert effective.color == "#123456"
    assert effective.space_before == 0.6
    assert effective.indent == 1.2  # 角色基础层
    # 其它角色不受这条 object_role 影响：meta 仍只拿到对象层（bold 未被角色级写入）。
    assert style.effective("meta", object_id=ENTRY_ID).bold is None
    assert (
        style.effective("body", object_id=OTHER_ID).font_scale == 1.2
    )  # 无对象/角色覆盖 → 角色基础
    # 来源：命中 object_roles 与命中 objects 同报 object（都属"这一条"的局部调整）。
    assert style.source_of("font_scale", role="body", object_id=ENTRY_ID) == "object"
    assert style.source_of("line_height", role="body", object_id=ENTRY_ID) == "object"
    assert style.source_of("indent", role="body", object_id=ENTRY_ID) == "role"
    assert not style.empty


def test_old_config_without_domain_is_still_empty():
    assert resolve_style(template="classic", format_config=None).empty
    assert resolve_style(template="classic", format_config={"objects": {"version": 1}}).empty
    assert resolve_style(template="classic", format_config={"object_roles": {"version": 1}}).empty


# ===== 3. HTML：角色级规则（字号按该角色模板基准展开） =====


def test_html_rule_expands_font_scale_with_the_role_base_ratio():
    css = entry_style_css(_style({f"{ENTRY_ID}:entry_title": {"font_scale": 1.4, "bold": True}}))
    ratios = {
        role: float(values.get("font_scale", 1.0))
        for role, values in template_role_defaults("classic").items()
    }
    expected = (
        f'  [data-object-id="{ENTRY_ID}"] [data-role="entry_title"] '
        f"{{ font-size: calc(var(--fs) * 1.4 * {ratios['entry_title']:g}); font-weight: 700; }}"
    )
    assert expected in css
    # 只写这一条角色规则：其它角色（含对象根规则）不出现。
    assert "[data-role=" not in css.replace(expected.strip(), "")


def test_html_rule_only_forwards_text_appearance_props():
    css = entry_style_css(
        _style(
            {
                f"{ENTRY_ID}:body": {
                    "font_scale": 1.2,
                    "align": "center",
                    "space_before": 0.4,
                    "space_after": 0.2,
                    "indent": 0.5,
                    "bullet": "dash",
                }
            }
        )
    )
    declarations = _rules(css)[f'[data-object-id="{ENTRY_ID}"] [data-role="body"]']
    assert "font-size: calc(var(--fs) * 1.2 * 1);" in declarations
    # Q12：对齐属于「正文」范围，允许转发到该角色的文字元素。
    assert "text-align: center;" in declarations
    # 段距 / 缩进 / 符号仍只落在对象根与定向规则（这里没有对象根覆盖，所以一个都不出现）。
    for token in ("margin-top", "margin-bottom", "padding-left", "list-style"):
        assert token not in declarations


def test_html_only_emits_roles_that_exist_inside_an_object():
    css = entry_style_css(_style({f"{ENTRY_ID}:section_title": {"color": "#123c69"}}))
    assert css == ""
    assert entry_style_css(_style({f"{ENTRY_ID}:body": {"color": "#123c69"}})) != ""


def test_html_role_rule_wins_over_object_rule_by_source_order():
    css = entry_style_css(
        resolve_style(
            template="classic",
            format_config={
                "objects": {"version": 1, ENTRY_ID: {"font_scale": 1.2, "color": "#123456"}},
                "object_roles": {"version": 1, f"{ENTRY_ID}:body": {"font_scale": 1.5}},
            },
        )
    )
    root_index = css.index(f'[data-object-id="{ENTRY_ID}"] {{')
    role_index = css.index(f'[data-object-id="{ENTRY_ID}"] [data-role="body"]')
    assert root_index < role_index


def test_no_domain_and_empty_domain_render_identical_html():
    resume = _resume()

    def normalize(html: str) -> str:
        html = re.sub(r'nonce="[0-9a-f]{32}"', 'nonce="X"', html)
        return re.sub(r"nonce-[0-9a-f]{32}", "nonce-X", html)

    default_html = normalize(render_html(resume, template="classic"))
    empty_domain = normalize(
        render_html(resume, template="classic", format_config={"object_roles": {"version": 1}})
    )
    assert empty_domain == default_html
    assert "[data-object-id=" not in default_html


def test_render_html_injects_role_rule_after_the_template_css():
    styled = render_html(
        _resume(),
        template="classic",
        format_config={
            "object_roles": {
                "version": 1,
                f"{ENTRY_ID}:entry_title": {"font_scale": 1.4, "bold": True},
            }
        },
    )
    selector = f'[data-object-id="{ENTRY_ID}"] [data-role="entry_title"]'
    assert selector in styled
    assert "font-size: calc(var(--fs) * 1.4 * 1.07);" in styled  # classic 条目名基准
    # 同权重（0,2,0）时靠源码顺序生效：模板自带的 .entry-head .title 必须在前。
    assert styled.index(".entry-head .title") < styled.index(selector)
    assert "!important" not in next(line for line in styled.splitlines() if selector in line)


# ===== 4. prune：对象删除时同批裁掉角色级死键 =====


def test_prune_drops_object_role_keys_for_missing_objects():
    content = {"experience": [{"id": ENTRY_ID}]}
    config = {
        "roles": {"version": 1, "body": {"line_height": 1.5}},
        "object_roles": {
            "version": 1,
            f"{ENTRY_ID}:body": {"bold": True},
            "exp_deadbeef:body": {"bold": True},
        },
    }
    pruned = prune_overrides(content, config)
    assert pruned is not None
    assert pruned["object_roles"] == {"version": 1, f"{ENTRY_ID}:body": {"bold": True}}
    assert pruned["roles"] == config["roles"]
    assert prune_overrides(content, pruned) is None  # 幂等
    # 全失效 → 空域整键删除。
    gone = prune_overrides({"experience": []}, config)
    assert gone is not None
    assert "object_roles" not in gone


# ===== 5. PDF / Word 自动消费同一层（不改渲染器） =====


@needs_font
def test_pdf_consumes_body_object_role():
    from app.services.pdf_exporter import build_resume_pdf

    resume = _resume()
    baseline = build_resume_pdf(resume, template="classic", page_limit=2)
    styled = build_resume_pdf(
        resume,
        template="classic",
        page_limit=2,
        format_config={"object_roles": {"version": 1, f"{ENTRY_ID}:body": {"font_scale": 1.8}}},
    )

    def bullet_size(content: bytes) -> float:
        return next(run[2] for run in _text_runs(content) if "做了一件事" in run[3])

    assert bullet_size(styled.content) > bullet_size(baseline.content)


def test_word_consumes_entry_title_object_role():
    from app.services.docx_exporter import build_resume_docx

    document = build_resume_docx(
        _resume(),
        template="classic",
        page_limit=2,
        format_config={
            "object_roles": {
                "version": 1,
                f"{ENTRY_ID}:entry_title": {"color": "#123c69"},
            }
        },
    )
    with zipfile.ZipFile(io.BytesIO(document.content)) as bundle:
        xml = bundle.read("word/document.xml").decode("utf-8")
    assert "123C69" in xml, "Word 条目标题应使用角色级 object_roles 覆盖色"
