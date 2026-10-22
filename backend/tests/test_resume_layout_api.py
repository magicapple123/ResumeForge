# SPDX-License-Identifier: Apache-2.0
"""版面诊断接口与按简历的版式覆盖。

最要紧的一条是**预览与导出必须用同一份版式配置**：如果自动一页只改了预览，
用户会在下载 PDF 之后才发现字号没变——而那时他已经按预览的样子投出去了。
所以这里显式钉住"导出走的是同一条解析路径"。
"""
from app.models.resume import ResumeRecord
from app.services.resume.resume_record import record_format_config

PAGE = 2600.0


def _make_resume(client, **overrides) -> int:
    payload = {
        "title": "测试简历",
        "content": {"name": "张三", "summary": "软件工程本科生。"},
        "job_id": None,
        **overrides,
    }
    response = client.post("/api/resumes/manual", json=payload)
    assert response.status_code == 201, response.text
    return response.json()["id"]


# ===== 诊断接口 =====


def test_analyze_offers_a_ladder_when_the_content_overflows(client):
    resume_id = _make_resume(client)
    response = client.post(
        f"/api/resumes/{resume_id}/layout/analyze",
        json={"measure": {"used_height": PAGE * 1.3, "page_content_height": PAGE, "page_limit": 1}},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["diagnosis"]["status"] == "overflow"
    assert body["diagnosis"]["pages_needed"] == 2
    assert len(body["fit_ladder"]) > 0
    # 每一档都要带可直接注入预览的 CSS——客户端不该自己拼这段 CSS。
    assert all(item["css"] for item in body["fit_ladder"])
    assert body["fit_ladder"][0]["config"]["page_padding"] < 14


def test_analyze_returns_no_ladder_when_it_already_fits(client):
    """放得下时给一堆"再收紧一点"只会让人白改一轮。"""
    resume_id = _make_resume(client)
    body = client.post(
        f"/api/resumes/{resume_id}/layout/analyze",
        json={"measure": {"used_height": PAGE * 0.9, "page_content_height": PAGE, "page_limit": 1}},
    ).json()
    assert body["diagnosis"]["status"] == "healthy"
    assert body["fit_ladder"] == []


def test_analyze_reports_the_font_floor_so_the_button_is_not_a_surprise(client):
    resume_id = _make_resume(client)
    body = client.post(
        f"/api/resumes/{resume_id}/layout/analyze",
        json={"measure": {"used_height": PAGE * 1.3, "page_content_height": PAGE, "page_limit": 1}},
    ).json()
    room = body["fit_room"]
    assert room["font_floor_px"] == 11.0
    assert room["has_room"] is True
    assert "9pt" in room["font_floor_note"]


def test_analyze_uses_the_draft_layout_instead_of_the_saved_one(client):
    """诊断按**屏幕上这一版**算：拖完滑块还没保存时，记录里还是旧值。

    `fit_room` / `fit_ladder` 回答的是"从当前版式再往紧收一档"。按记录值算的话，
    用户改完参数看到的还是上一版结论（面板整块不动），点「自动一页」也不是从他正在
    看的版式起步——2026-10-21 用户实测的正是这一格。

    不传版式字段的那一次同样在这里钉住：`None` = 用记录值，旧客户端行为不变。
    """
    resume_id = _make_resume(client)
    # 记录里存一个很松的版式：20mm 页边距（下限是 12mm，步长 2）。
    client.patch(f"/api/resumes/{resume_id}/layout", json={"format_config": {"page_padding": 20}})
    measure = {"used_height": PAGE * 1.3, "page_content_height": PAGE, "page_limit": 1}

    saved = client.post(
        f"/api/resumes/{resume_id}/layout/analyze", json={"measure": measure}
    ).json()
    draft = client.post(
        f"/api/resumes/{resume_id}/layout/analyze",
        json={"measure": measure, "format_config": {"page_padding": 12}},
    ).json()

    # 记录值 20mm → 第一档收到 18mm。
    assert saved["fit_ladder"][0]["config"]["page_padding"] == 18
    # 草稿已经是下限 12mm：这一档没有可收的，阶梯直接从下一项开始。
    assert "page_padding" not in draft["fit_ladder"][0]["config"]
    assert draft["fit_room"]["steps"] < saved["fit_room"]["steps"]


def test_analyze_uses_the_draft_style_template(client):
    """样式模板也是草稿值：换完模板还没保存，诊断要按新模板的默认版式算。

    各模板的默认页边距不同（classic 14mm / minimal 18mm），所以第一档收紧的目标值
    也必须不同——同样的数字说明读的还是记录里的旧模板。
    """
    resume_id = _make_resume(client)
    measure = {"used_height": PAGE * 1.3, "page_content_height": PAGE, "page_limit": 1}

    def first_padding(template: str) -> float:
        body = client.post(
            f"/api/resumes/{resume_id}/layout/analyze",
            json={"measure": measure, "template": template},
        ).json()
        return next(
            item["config"]["page_padding"]
            for item in body["fit_ladder"]
            if "page_padding" in item["config"]
        )

    assert first_padding("classic") == 12  # 14 → 12
    assert first_padding("minimal") == 16  # 18 → 16


def test_analyze_rejects_an_impossible_measurement(client):
    resume_id = _make_resume(client)
    response = client.post(
        f"/api/resumes/{resume_id}/layout/analyze",
        json={"measure": {"used_height": 100, "page_content_height": 0, "page_limit": 1}},
    )
    # page_content_height 必须是正数——0 表示"还没渲染完就量了"，那是客户端的问题。
    assert response.status_code == 422


def test_analyze_on_a_missing_resume_is_404(client):
    response = client.post(
        "/api/resumes/999/layout/analyze",
        json={"measure": {"used_height": 100, "page_content_height": PAGE, "page_limit": 1}},
    )
    assert response.status_code == 404


# ===== 按简历的版式覆盖 =====


def test_layout_patch_saves_the_override(client):
    resume_id = _make_resume(client)
    response = client.patch(
        f"/api/resumes/{resume_id}/layout",
        json={
            "template": "classic",
            "format_name": "",
            "page_limit": 1,
            "font_scale": "standard",
            "format_config": {"line_height": 1.4, "page_padding": 12},
        },
    )
    assert response.status_code == 200
    assert response.json()["format_config"] == {"line_height": 1.4, "page_padding": 12}


def test_layout_patch_without_format_config_leaves_it_alone(client):
    """`None` 是"这次不涉及"，不能把用户调好的覆盖顺手清掉。"""
    resume_id = _make_resume(client)
    client.patch(
        f"/api/resumes/{resume_id}/layout",
        json={"format_config": {"line_height": 1.4}},
    )
    client.patch(
        f"/api/resumes/{resume_id}/layout",
        json={"page_limit": 2},  # 只改页数，不带 format_config
    )
    assert client.get(f"/api/resumes/{resume_id}").json()["format_config"] == {"line_height": 1.4}


def test_layout_patch_with_an_empty_object_clears_the_override(client):
    """空字典是"清掉覆盖"——与 None 的语义必须区分开。"""
    resume_id = _make_resume(client)
    client.patch(f"/api/resumes/{resume_id}/layout", json={"format_config": {"line_height": 1.4}})
    client.patch(f"/api/resumes/{resume_id}/layout", json={"format_config": {}})
    assert client.get(f"/api/resumes/{resume_id}").json()["format_config"] == {}


def test_layout_patch_validates_the_override(client):
    """这段配置会被拼进 HTML 的 <style>，不校验就等于把 CSS 注入的口子交给前端。"""
    resume_id = _make_resume(client)
    response = client.patch(
        f"/api/resumes/{resume_id}/layout",
        json={
            "format_config": {
                "line_height": 99,  # 超出范围，应被丢掉
                "accent": "javascript:alert(1)",  # 不是十六进制颜色，应被丢掉
                "page_padding": 12,  # 合法
            }
        },
    )
    assert response.status_code == 200
    assert response.json()["format_config"] == {"page_padding": 12}


# ===== 语言（批 3）：拖字号滑杆不许把英文简历改回中文 =====


def test_patching_layout_without_language_keeps_it(client):
    """§9.1 R1 的自动化钉子。

    `PATCH /layout` 是**整体替换**（`ResumeLayoutUpdate`），所以 `language` 必须是
    "None = 这次不涉及"。这条用例只传度量参数、不传 `language`：语言必须原样留着，
    否则用户每拖一次字号滑杆，英文简历就被静默改回中文，而界面上没有任何提示。
    """
    resume_id = _make_resume(client)
    client.patch(f"/api/resumes/{resume_id}/layout", json={"language": "en-US"})
    assert client.get(f"/api/resumes/{resume_id}").json()["language"] == "en-US"

    client.patch(
        f"/api/resumes/{resume_id}/layout",
        # 只动页数与字号——这正是"拖一下滑杆"发出的那份请求体。
        json={"page_limit": 2, "font_scale": "large"},
    )
    body = client.get(f"/api/resumes/{resume_id}").json()
    assert body["language"] == "en-US"
    # 顺带确认这次 PATCH 本身是生效的：语言没变不是因为整个请求没被处理。
    assert body["page_limit"] == 2
    assert body["font_scale"] == "large"


def test_patching_layout_with_language_switches_it(client):
    """"不传 = 不涉及"不能退化成"永远改不了"：显式传值时必须真的改。"""
    resume_id = _make_resume(client)
    client.patch(f"/api/resumes/{resume_id}/layout", json={"language": "en-US"})
    body = client.patch(f"/api/resumes/{resume_id}/layout", json={"language": "zh-CN"}).json()
    assert body["language"] == "zh-CN"
    assert client.get(f"/api/resumes/{resume_id}").json()["language"] == "zh-CN"


def test_auto_fit_still_works_on_an_english_resume(client):
    """§8.3 第 4 条：「自动一页」在英文简历上仍然可用。

    「自动一页」落库的形态就是 `PATCH /layout` 带**诊断给出的那一档** `format_config`
    （页边距/区块间距/行高/字号系数）+ `page_limit`——前端点「确认」时发的正是这份请求体。
    所以这里按真实链路走一遍：诊断拿阶梯 → 保存第一档 → 断言 200、`page_limit` 生效、
    覆盖写入，且**英文没被顺手改回中文**（那是 R1 的另一种表现）。
    """
    resume_id = _make_resume(client)
    client.patch(f"/api/resumes/{resume_id}/layout", json={"language": "en-US", "page_limit": 2})

    ladder = client.post(
        f"/api/resumes/{resume_id}/layout/analyze",
        json={"measure": {"used_height": PAGE * 1.3, "page_content_height": PAGE, "page_limit": 1}},
    ).json()["fit_ladder"]
    assert ladder, "英文简历没有拿到「自动一页」阶梯"
    chosen = ladder[0]["config"]

    response = client.patch(
        f"/api/resumes/{resume_id}/layout",
        json={"page_limit": 1, "format_config": chosen},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["page_limit"] == 1  # 页数上限真的收回到 1
    assert body["format_config"] == chosen  # 自动一页试出来的那一档原样落库
    assert body["language"] == "en-US"  # 保存版式不许顺手改语言

    # 预览与导出同源：导出的 HTML 用这份版式，且标题是英文。
    html = client.get(f"/api/resumes/{resume_id}/export", params={"format": "html"}).text
    assert f"padding: {chosen['page_padding']:g}mm" in html
    assert "Summary" in html
    assert "个人总结" not in html


def test_render_uses_the_requested_language(client):
    """未落库的即时预览（生成后那一屏）也要按请求里的语言排版面文案。"""
    content = {"name": "张三", "summary": "软件工程本科生。", "education": []}

    chinese = client.post(
        "/api/resumes/render",
        json={"content": content, "template": "classic", "language": "zh-CN"},
    )
    assert chinese.status_code == 200
    assert "个人总结" in chinese.text

    english = client.post(
        "/api/resumes/render",
        json={"content": content, "template": "classic", "language": "en-US"},
    )
    assert english.status_code == 200
    assert "Summary" in english.text
    # 不传 = 默认语言，与历史输出逐字一致。
    default = client.post("/api/resumes/render", json={"content": content, "template": "classic"})
    assert default.status_code == 200
    assert "个人总结" in default.text


# ===== 预览与导出必须一致 =====

def test_exported_html_uses_the_per_resume_override(client):
    """自动一页改了预览却没改导出，是这类功能最坏的失败方式。"""
    resume_id = _make_resume(client)
    client.patch(
        f"/api/resumes/{resume_id}/layout",
        json={"format_config": {"line_height": 1.42, "page_padding": 12}},
    )
    html = client.get(f"/api/resumes/{resume_id}/export", params={"format": "html"}).text
    assert "line-height: 1.42" in html
    assert "padding: 12mm" in html


def test_render_accepts_a_temporary_override_without_saving_it(client):
    """自动一页逐档试版式时走这条路：试出来的方案在用户点确认之前不能落库。"""
    resume_id = _make_resume(client)
    response = client.post(
        "/api/resumes/render",
        json={
            "content": {"name": "张三", "summary": "软件工程本科生。"},
            "template": "classic",
            "page_limit": 1,
            "font_scale": "standard",
            "format_config": {"line_height": 1.35},
        },
    )
    assert response.status_code == 200
    assert "line-height: 1.35" in response.text
    # 没有落库
    assert client.get(f"/api/resumes/{resume_id}").json()["format_config"] == {}


def test_font_scale_adjust_reaches_the_html(client):
    """字号系数必须真的作用到渲染出来的 HTML。

    它走的是"渲染前预乘进 base_px"这条路（唯一对内置模板与用户自制模板都生效的路径），
    所以这里断言的是 `--fs` 的最终像素值，而不是某个可以被覆盖的 CSS 变量——
    后者会与预乘叠乘，让界面上调 1.1 实得 1.21 倍。
    """
    response = client.post(
        "/api/resumes/render",
        json={
            "content": {"name": "张三", "summary": "软件工程本科生。"},
            "template": "classic",
            "page_limit": 1,
            "font_scale": "standard",
            "format_config": {"font_scale_adjust": 0.9},
        },
    )
    assert response.status_code == 200
    # 标准档 14px × 0.9 = 12.6px。`--fs` 是**字面量**（2026-10-21 起不再乘任何自适应系数），
    # 所以这里断言的就是纸面上真正生效的像素值，滑杆读数与导出结果必须一比一。
    assert "--fs: 12.6px" in response.text


def test_override_wins_over_the_named_format_template(client):
    """按简历的覆盖叠加在具名格式模板之上，而不是被它盖掉。"""
    resume_id = _make_resume(client)
    client.patch(
        f"/api/resumes/{resume_id}/layout",
        json={"format_name": "compact", "format_config": {"line_height": 1.9}},
    )
    html = client.get(f"/api/resumes/{resume_id}/export", params={"format": "html"}).text
    # compact 预设本身把行高压到 1.45，按简历的覆盖要能盖过它。
    assert "line-height: 1.9" in html
    assert "line-height: 1.45" not in html


def test_record_format_config_is_the_single_resolution_point(db_session):
    """导出、预览、PDF 三处都调这一个函数，避免各解析一次、解析得不一样。"""
    record = ResumeRecord(
        title="测试",
        content={"name": "张三"},
        format_name="compact",
        format_config={"line_height": 1.9, "accent": "#123456"},
    )
    db_session.add(record)
    db_session.commit()

    config = record_format_config(db_session, record)
    assert config["line_height"] == 1.9  # 按简历的覆盖赢了
    assert config["accent"] == "#123456"
    assert config["page_padding"] == 11  # 预设里其余项保留


def test_style_template_format_values_are_included_for_non_html_exporters(client, db_session):
    """样式配置中的通用版式值也进入 PDF/Word 共用的解析结果。"""
    from app.services.resume.resume_template_store import create_user_template

    template = create_user_template(
        db_session,
        name="带版式覆盖的样式",
        kind="style",
        html='<!doctype html><html><head></head><body>{% include "_resume_sections.j2" %}</body></html>',
        config={"line_height": 1.3, "page_padding": 20, "accent": "#aa0000"},
    )
    record = ResumeRecord(
        title="样式模板覆盖",
        template=template.name,
        format_name="compact",
        format_config={"accent": "#123456"},
        content={"name": "示例"},
    )
    db_session.add(record)
    db_session.commit()

    config = record_format_config(db_session, record)
    # 具名版式先覆盖样式默认，再由当前简历自己的按简历覆盖覆盖最后。
    assert config["line_height"] == 1.45
    assert config["page_padding"] == 11
    assert config["accent"] == "#123456"
