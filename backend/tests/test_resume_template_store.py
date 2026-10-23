# SPDX-License-Identifier: Apache-2.0
"""自制模板的持久化与解析：清洗、重名、解析回退。

`resolve_style_template` / `resolve_format_config` 是渲染前的最后一道解析：记录里存的
模板名可能指向一个已被删除的自制模板，那时必须安静地退回默认内置模板，而不是让
预览和导出一起报错。
"""
import pytest
from app.services.resume.resume_template_store import (
    TemplateError,
    custom_format_options,
    custom_template_options,
    resolve_format_config,
    resolve_style_template,
    sanitize_template_html,
)

STYLE_HTML = """<!DOCTYPE html>
<html><head><title>{{ resume.name }}</title></head>
<body><script src="https://evil.example/x.js"></script>
<iframe src="https://evil.example"></iframe>
{% include "_resume_sections.j2" %}
</body></html>
"""


def test_sanitize_strips_network_and_scripts():
    cleaned = sanitize_template_html(STYLE_HTML)
    assert "<script" not in cleaned.lower()
    assert "evil.example" not in cleaned
    # 缺 CSP 时自动补上：导出的 HTML 会被当作普通网页打开。
    assert "Content-Security-Policy" in cleaned


def test_resolve_falls_back_to_builtin(db_session):
    name, html = resolve_style_template(db_session, "这个模板不存在")
    assert name == "classic"
    assert html == ""
    assert resolve_format_config(db_session, "也不存在") == {}


def test_resolve_format_preset(db_session):
    config = resolve_format_config(db_session, "compact")
    assert config["line_height"] == 1.45
    # 标准预设本身没有覆盖项，返回空字典代表"沿用模板自带版式"。
    assert resolve_format_config(db_session, "standard") == {}


def test_style_template_is_offline_for_writes(client, db_session):
    """自制样式模板已下线：写路径一律 400，错误文案只说原因。"""
    created = client.post(
        "/api/resume-templates",
        json={"name": "自定义A", "kind": "style", "html": STYLE_HTML},
    )
    assert created.status_code == 400
    assert created.json()["detail"] == "自制模板已下线，只能创建版式"

    # 读不到也不该抛异常：记录里可能还存着这个名字。
    assert resolve_style_template(db_session, "自定义A") == ("classic", "")
    assert custom_template_options(db_session) == []


def test_existing_style_rows_are_not_read_anymore(client, db_session):
    """DB 里存量的 style 行**不删**，但读路径必须彻底不认它。

    这是"零迁移"下线的关键：老记录里的模板名还在，导出时不能拿到用户模板 HTML
    （那会把一条已经下线的渲染路径重新激活），只能安静地退回默认内置模板。
    """
    from app.models.resume_template import TEMPLATE_KIND_STYLE, ResumeTemplate

    row = ResumeTemplate(
        name="存量样式",
        kind=TEMPLATE_KIND_STYLE,
        description="",
        html=STYLE_HTML,
        config={},
        source_name="",
        enabled=True,
    )
    db_session.add(row)
    db_session.commit()

    assert resolve_style_template(db_session, "存量样式") == ("classic", "")
    assert custom_template_options(db_session) == []
    # 行还在（用户能在列表里看到并删除），只是不再参与渲染。
    assert client.get("/api/resume-templates", params={"kind": "style"}).json()[0]["name"] == "存量样式"
    # 编辑同样被拒：能改只会让人以为"改了有用"。
    edited = client.put(f"/api/resume-templates/{row.id}", json={"name": "改名试试"})
    assert edited.status_code == 400


def test_format_template_requires_a_real_setting(client, db_session):
    # 一项都没设的格式模板对用户是"以为设了什么"，直接拒绝。
    empty = client.post("/api/resume-templates", json={"name": "空版式", "kind": "format"})
    assert empty.status_code == 400

    # 越界值会被丢弃，丢掉后没有剩余项时同样按"空配置"拒绝。
    out_of_range = client.post(
        "/api/resume-templates",
        json={"name": "越界版式", "kind": "format", "config": {"line_height": 99}},
    )
    assert out_of_range.status_code == 400

    created = client.post(
        "/api/resume-templates",
        json={"name": "紧凑A", "kind": "format", "config": {"line_height": 1.5, "accent": "#123456"}},
    )
    assert created.status_code == 201
    assert custom_format_options(db_session)[0]["config"] == {
        "line_height": 1.5,
        "accent": "#123456",
    }


def test_builtin_source_endpoint_is_gone(client):
    """`GET /builtin-source` 只服务「复制内置模板」，随自制模板一起下线。

    现在这条路径落到 `GET /{template_id}` 上——`builtin-source` 不是整数，所以是 422
    而不是 404。两种都表示"这个端点不存在了"，重要的是它不再返回模板源码。
    """
    response = client.get("/api/resume-templates/builtin-source?name=modern")
    assert response.status_code in (404, 422)
    assert "html" not in response.text


def test_name_validation_rejects_markup():
    from app.services.resume.resume_template_store import validate_template_name

    with pytest.raises(TemplateError):
        validate_template_name("<script>")


def test_sanitize_replaces_a_template_supplied_csp():
    """模板自带的 CSP 必须被换成应用这一条，而不是让应用这条整个不注入。

    此前的判断是"文档里已经有 Content-Security-Policy 字样就跳过"，于是模板只要写上
    这个词——哪怕只是注释里提一句——就能让应用的 CSP 完全不出现；没有 CSP 之后，
    `<img onerror=...>` 这类事件属性里的脚本会照常执行。
    """
    hostile = (
        "<!DOCTYPE html><html><head>"
        "<!-- Content-Security-Policy -->"
        '<meta http-equiv="Content-Security-Policy" content="default-src *; script-src '
        "'unsafe-inline'\" />"
        "</head><body><p>我的模板</p></body></html>"
    )

    cleaned = sanitize_template_html(hostile)

    # 应用这一条必须在（用 nonce 与 default-src 'none' 作为标志），
    # 而模板自带那条宽松的必须没了。
    assert "script-src 'nonce-" in cleaned
    assert "default-src 'none'" in cleaned
    assert "default-src *" not in cleaned


def test_sanitize_strips_meta_refresh():
    """`<meta http-equiv="refresh">` 能把浏览器自动跳到外部地址，必须剥掉。

    meta 是空元素、没有闭合标签，而剥离规则原来只写成对匹配的那种写法——
    那条正则要求出现 `</meta ...>`，现实中永远不会命中。
    """
    hostile = (
        "<!DOCTYPE html><html><head>"
        '<meta http-equiv="refresh" content="0;url=https://evil.example/phish" />'
        '<meta charset="utf-8" />'
        "</head><body><p>我的模板</p></body></html>"
    )

    cleaned = sanitize_template_html(hostile)

    assert "evil.example" not in cleaned
    assert "url=" not in cleaned
    # 字符集声明与应用的 CSP（本身就是一条 http-equiv meta）都不能被误伤。
    assert "charset" in cleaned.lower()
    assert "Content-Security-Policy" in cleaned
