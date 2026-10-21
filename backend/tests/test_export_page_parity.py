# SPDX-License-Identifier: Apache-2.0
"""页边距单旋钮 + 引擎/溢出响应头 + 预览与导出的页数一致性（R1）。

**用户实测的分歧**：导出面板把「页边距(mm)」写进 ``ExportRequest.margin_mm``，而只有
PDF/Word 读这个字段（``pdf_exporter/layout.py``），预览与 HTML 只认
``format_config.page_padding``。于是"改面板值 → 预览不变、PDF 变"——同一件事有两个落点，
就必然有一天不一致。

修法是把落点收成一个：面板只往 ``format_config.page_padding`` 写（clamp 8–26），
预览、HTML、PDF、Word 全部读它。本文件钉住修完之后的四条不变量：

1. **一处旋钮、两条路径**：``page_padding`` 同时出现在导出的 HTML 与 PDF 里，且真的
   改变了 PDF 的正文起点（不是"参数传了但没人用"）；
2. **``page_limit=1`` ⇒ 恰好 1 页**：8 个内置模板 × 4 档页边距，一个都不能例外——
   界面上"1 页"是对用户的承诺，服务端不许悄悄排成 2 页；
3. **``page_limit=2`` ⇒ 不超过 2 页**；
4. **标志不许说谎**：``X-Resume-Overflow`` 必须与 ``X-Resume-Pages-Needed`` /
   ``X-Resume-Page-Limit`` 的结论一致（``overflow`` 为真 ⇔ ``needed > limit``），且
   ``X-Resume-Pages`` 恒等于 ``min(needed, limit)``（超限即截断，不再缩字号）；
   ``X-Pdf-Engine`` 只在真的由 PDF 引擎渲染时出现（给 HTML 也回一个 "fpdf2" 是假话）。

关于 5 与 7：面板的 InputNumber 已收窄到 8–26，这两个值只可能来自旧前端或手工请求；
``validated_format_config`` 会把它们丢掉、回落到模板默认值。留在用例里是为了证明
"越界值不会把页数搞崩"，不是为了让它们生效。

**浏览器对拍不在本文件**（2026-10-22 拆出）：需要真实 Chromium 的用例（3 组对拍 +
"只超一点点"的边界回归，共 2 个测试函数 / 4 个用例项）搬到
``test_export_page_parity_browser.py``，原因是本批新增对拍后本文件从 389 行涨到 572 行、
越过 ``test_file_size_budget`` 的 500 行预算。拆分缝是"要不要起浏览器"——本文件只留
不依赖浏览器的部分（响应头口径、预览载荷、页数纯函数），在普通 CI 上就能跑；搬走的那批
打 ``cross_engine`` marker，只在手动触发的作业里跑。拆分前后收集数不变（91 → 87 + 4）。
"""

from __future__ import annotations

import pytest
from app.schemas.resume import ResumeContent
from app.services.export_pipeline import (
    ExportRequest,
    RenderContext,
    build_export,
)
from app.services.resume.resume_template_catalog import RESUME_TEMPLATES
from test_pdf_exporter import needs_font

# 8 个内置模板（顺序即模板注册表顺序，新增模板会自动进入本文件的矩阵）。
TEMPLATES = tuple(RESUME_TEMPLATES)
# 11 是多数模板的默认页边距；18 是偏宽的一档；5 / 7 低于面板下限 8（见模块 docstring）。
PAGE_PADDINGS = (5, 7, 11, 18)
# 组合成显式的笛卡尔积：失败时报告直接点名"哪个模板、哪一档页边距"。
TEMPLATE_PADDING_CASES = [
    (template, padding) for template in TEMPLATES for padding in PAGE_PADDINGS
]


def _short_resume() -> ResumeContent:
    """一份在最大页边距下也排得进 1 页的简历：让断言只反映版式，不反映内容长度。"""
    return ResumeContent(
        name="张三",
        phone="13800000000",
        email="zhangsan@example.com",
        job_intent="后端工程师",
        summary="三年后端开发经验，负责交易系统的设计与落地，熟悉 Python 与分布式存储。",
        experience=[
            {
                "company": "示例科技",
                "role": "后端工程师",
                "start_date": "2021-03",
                "end_date": "2024-06",
                "description": [
                    "负责订单核心链路优化，平均响应时间从 180ms 降到 45ms。",
                    "主导分库分表改造，完成 12 个业务表的平滑迁移，期间零故障。",
                ],
            }
        ],
        projects=[
            {
                "name": "异步任务调度平台",
                "role": "负责人",
                "description": ["支撑每日百万级任务，失败自动重试与告警。"],
            }
        ],
        skills=[{"name": name, "level": "熟练"} for name in ("Python", "Go", "Redis")],
    )


def _create_resume(client, template: str, content: ResumeContent | None = None) -> int:
    """建一份简历并把样式模板钉成 ``template``（导出读的是记录上的模板名）。"""
    created = client.post(
        "/api/resumes/manual",
        json={
            "title": f"页边距-{template}",
            "content": (content or _short_resume()).model_dump(),
            "job_id": None,
        },
    )
    assert created.status_code == 201, created.text
    resume_id = created.json()["id"]
    layout = client.patch(f"/api/resumes/{resume_id}/layout", json={"template": template})
    assert layout.status_code == 200, layout.text
    assert layout.json()["template"] == template, layout.text
    return resume_id


def _export_pdf(client, resume_id: int, *, page_padding: int | None, page_limit: int):
    """走前端的真实请求形状：页边距只出现在 ``format_config.page_padding`` 里，不发 ``margin_mm``。"""
    body: dict = {"format": "pdf", "page_limit": page_limit}
    if page_padding is not None:
        body["format_config"] = {"page_padding": page_padding}
    response = client.post(f"/api/resumes/{resume_id}/export", json=body)
    assert response.status_code == 200, response.text
    return response


def _replay_artifact(template: str, *, page_padding: int, page_limit: int):
    """用同一条管线重算一次产物：拿 ``artifact.overflow`` 跟响应头对账。"""
    return build_export(
        ExportRequest(
            format="pdf",
            page_limit=page_limit,
            format_config={"page_padding": page_padding},
        ),
        _short_resume(),
        # 记录上只有模板名、没有格式模板也没有按简历的覆盖（见 _create_resume），
        # 所以这里的上下文与 ``_export_record`` 组出来的那份逐字段相同。
        RenderContext(template=template, page_limit=page_limit, font_scale="standard"),
    )


@needs_font
@pytest.mark.parametrize(("template", "padding"), TEMPLATE_PADDING_CASES)
def test_one_page_limit_always_yields_exactly_one_page(client, template, padding):
    """``page_limit=1`` 是服务端对用户的承诺：任何模板、任何页边距都只能排 1 页。"""
    resume_id = _create_resume(client, template)

    response = _export_pdf(client, resume_id, page_padding=padding, page_limit=1)

    assert response.headers["X-Resume-Pages"] == "1", (
        f"模板 {template} / 页边距 {padding}mm 排出了 {response.headers['X-Resume-Pages']} 页"
    )
    assert response.headers["X-Resume-Page-Limit"] == "1"


@needs_font
@pytest.mark.parametrize("template", TEMPLATES)
def test_two_page_limit_never_exceeds_two_pages(client, template):
    """放宽到 2 页只能更宽松，不能反过来排成 3 页。"""
    resume_id = _create_resume(client, template)

    response = _export_pdf(client, resume_id, page_padding=18, page_limit=2)

    pages = int(response.headers["X-Resume-Pages"])
    assert pages <= 2, f"模板 {template} 在 2 页上限下排出了 {pages} 页"
    assert response.headers["X-Resume-Page-Limit"] == "2"


@needs_font
@pytest.mark.parametrize(("template", "padding"), TEMPLATE_PADDING_CASES)
def test_overflow_flag_never_contradicts_the_page_headers(client, template, padding):
    """``X-Resume-Overflow`` 与"真实需要的页数 > 上限"必须同真同假，且引擎头如实。

    2026-10-21 语义变更：服务端**不再缩字号**，所以"超出上限"不再表现为"文件多排一页"，
    而是"文件被截断到上限 + overflow=true"。因此这里断言的是三条自洽关系：
    ``overflow ⇔ needed > limit``、``pages == min(needed, limit)``、``pages <= limit``。
    """
    resume_id = _create_resume(client, template)

    response = _export_pdf(client, resume_id, page_padding=padding, page_limit=1)
    pages = int(response.headers["X-Resume-Pages"])
    needed = int(response.headers["X-Resume-Pages-Needed"])
    limit = int(response.headers["X-Resume-Page-Limit"])
    overflow = response.headers["X-Resume-Overflow"] == "true"

    assert overflow is (needed > limit)
    assert pages == min(needed, limit)
    assert pages <= limit
    assert response.headers["X-Pdf-Engine"] == "fpdf2"


@needs_font
@pytest.mark.parametrize("template", TEMPLATES)
def test_headers_match_the_pipeline_artifact(client, template):
    """头里的页数与溢出标志，必须等于同一条管线重算出的 ``artifact`` 的两个字段。

    上一个用例验的是"头与头之间自洽"，这一条验的是"头与产物之间自洽"——两者都得成立，
    否则可能出现"页数头改了、overflow 还在按旧口径说话"。
    """
    resume_id = _create_resume(client, template)

    response = _export_pdf(client, resume_id, page_padding=11, page_limit=1)
    artifact = _replay_artifact(template, page_padding=11, page_limit=1)

    assert response.headers["X-Resume-Pages"] == str(artifact.pages)
    assert response.headers["X-Resume-Pages-Needed"] == str(artifact.pages_needed)
    assert response.headers["X-Resume-Overflow"] == ("true" if artifact.overflow else "false")


def test_pdf_engine_header_only_claims_a_pdf_engine(client):
    """HTML 不是 fpdf2 排的，就不该顶着 ``X-Pdf-Engine: fpdf2``。"""
    created = client.post(
        "/api/resumes/manual",
        json={
            "title": "引擎头",
            "content": {"name": "张三", "summary": "关注后端。"},
            "job_id": None,
        },
    )
    assert created.status_code == 201, created.text
    resume_id = created.json()["id"]

    html = client.post(f"/api/resumes/{resume_id}/export", json={"format": "html"})
    assert html.status_code == 200, html.text
    assert "X-Pdf-Engine" not in html.headers
    # HTML 没有分页引擎，也就没有"装不下"这回事——三个头都不该凭空出现。
    assert "X-Resume-Overflow" not in html.headers
    assert "X-Resume-Pages" not in html.headers


def _left_text_x(content: bytes) -> float:
    """PDF 里最靠左的文字的 x（pt）：等价于左页边距，且不受"第一段是什么"影响。"""
    from test_pdf_exporter import _text_runs

    return min(run[0] for run in _text_runs(content))


@needs_font
def test_page_padding_is_the_single_knob_for_html_and_pdf(client):
    """同一个 ``format_config.page_padding`` 同时决定 HTML 的 padding 与 PDF 的正文起点。

    这一条才是"单旋钮"的正面证据：不是"参数传到了"，而是"两个产物都照着它排"。
    """
    resume_id = _create_resume(client, "classic")

    narrow_export = _export_pdf(client, resume_id, page_padding=8, page_limit=1)
    wide_export = _export_pdf(client, resume_id, page_padding=26, page_limit=1)
    assert narrow_export.headers["X-Resume-Pages"] == "1"
    assert wide_export.headers["X-Resume-Pages"] == "1"

    # PDF 侧：宽页边距必然让正文起点更靠右（同一份内容、同一个模板）。
    # 8mm → 26mm 是 18mm ≈ 51pt，留 20pt 的余量足够区分"真的生效"与"数值抖动"。
    narrow_x = _left_text_x(narrow_export.content)
    wide_x = _left_text_x(wide_export.content)
    assert wide_x > narrow_x + 20, f"页边距 8→26mm 后正文起点没动：{narrow_x} → {wide_x}"

    # HTML 侧：同一个值以 mm 出现在内联样式里，预览与导出的 HTML 读的是同一处。
    html_narrow = client.post(
        f"/api/resumes/{resume_id}/export",
        json={"format": "html", "format_config": {"page_padding": 8}},
    )
    html_wide = client.post(
        f"/api/resumes/{resume_id}/export",
        json={"format": "html", "format_config": {"page_padding": 26}},
    )
    assert html_narrow.status_code == 200, html_narrow.text
    assert html_wide.status_code == 200, html_wide.text
    assert "padding: 8mm" in html_narrow.content.decode("utf-8")
    assert "padding: 26mm" in html_wide.content.decode("utf-8")


@needs_font
def test_out_of_range_page_padding_falls_back_instead_of_breaking(client):
    """越界值（<8 或 >26）被白名单丢掉、回落到模板默认，页数不受影响。

    面板已经收窄到 8–26，这里守的是"旧前端/手工请求"这条来路：不能因为一个越界数字
    就排出 0 页或 3 页。
    """
    resume_id = _create_resume(client, "classic")

    for padding in (0, 5, 7, 40, 100):
        response = _export_pdf(client, resume_id, page_padding=padding, page_limit=1)
        assert response.headers["X-Resume-Pages"] == "1", f"页边距 {padding}mm"


# ===== margin_mm 只是兼容回落值，不再覆盖 page_padding（QA 独立复现的漏口） =====
#
# 前端自 R1 起已经不发 ``margin_mm``，但旧前端 / 手工请求仍能构造
# ``{"margin_mm": 30, "format_config": {"page_padding": 8}}``。修之前 ``margin_mm``
# **优先**，于是预览（只读 page_padding）8mm、PDF 30mm——正是 R1 要消灭的那种分叉。
# 现在 ``page_padding`` 是唯一权威，``margin_mm`` 只在没给 ``page_padding`` 时作回落值。


@needs_font
def test_margin_mm_never_overrides_page_padding(client):
    """两者都给时以 ``page_padding`` 为准：PDF 的左边距必须等于 8mm，不是 30mm。"""
    resume_id = _create_resume(client, "classic")

    both = client.post(
        f"/api/resumes/{resume_id}/export",
        json={
            "format": "pdf",
            "page_limit": 1,
            "margin_mm": 30,
            "format_config": {"page_padding": 8},
        },
    )
    assert both.status_code == 200, both.text
    only_padding = _export_pdf(client, resume_id, page_padding=8, page_limit=1)

    # 与"只给 page_padding=8"逐点相同：margin_mm 对结果零影响。
    assert _left_text_x(both.content) == _left_text_x(only_padding.content)
    # 且明显不等于最大值那一档（否则这条断言就是空转）。
    wide = _export_pdf(client, resume_id, page_padding=26, page_limit=1)
    assert _left_text_x(both.content) < _left_text_x(wide.content) - 20

    # 与预览/HTML 同一处：导出的 HTML 也写 8mm。
    html = client.post(
        f"/api/resumes/{resume_id}/export",
        json={"format": "html", "margin_mm": 30, "format_config": {"page_padding": 8}},
    )
    assert html.status_code == 200, html.text
    assert "padding: 8mm" in html.content.decode("utf-8")
    assert "padding: 30mm" not in html.content.decode("utf-8")


@needs_font
def test_margin_mm_alone_still_works_for_old_clients(client):
    """只给 ``margin_mm=14``（老前端的形状）时行为不变：等价于 ``page_padding=14``。"""
    resume_id = _create_resume(client, "classic")

    legacy = client.post(
        f"/api/resumes/{resume_id}/export",
        json={"format": "pdf", "page_limit": 1, "margin_mm": 14},
    )
    assert legacy.status_code == 200, legacy.text
    modern = _export_pdf(client, resume_id, page_padding=14, page_limit=1)

    assert _left_text_x(legacy.content) == _left_text_x(modern.content)


def test_out_of_range_margin_mm_is_clamped_not_rejected():
    """越界的兼容值收进 8–26，既不 500 也不把正文排出纸张。

    这里直接钉解析层：``ExportRequest.margin_mm`` 的 schema 仍是它自己那份历史范围
    4–40（旧客户端照旧被接受），所以 100 这种值在 HTTP 层是 422、到不了解析层——
    解析层必须自己站稳，否则换个入口（重放存档、助手工具）就会漏进来。
    """
    from app.services.pdf_exporter.layout import resolve_layout
    from app.services.resume.resume_templates import (
        TEMPLATE_LAYOUT_DEFAULTS,
        page_padding_bounds,
    )

    low, high = page_padding_bounds()
    assert (low, high) == (8.0, 26.0)

    def margin(**kwargs) -> float:
        kwargs.setdefault("format_config", None)
        return resolve_layout(template="classic", base_px=14.0, **kwargs).margin_mm

    # 兼容值 clamp 到区间内。
    assert margin(margin_mm=100) == high
    assert margin(margin_mm=-5) == low
    assert margin(margin_mm=40) == high
    # page_padding 在时，margin_mm 完全不参与。
    assert margin(format_config={"page_padding": 9}, margin_mm=100) == 9.0
    # 两者都没有 → 模板默认值（存量简历的 PDF 不因本改动无端跳变）。
    assert margin() == float(TEMPLATE_LAYOUT_DEFAULTS["classic"]["padding_mm"])


@needs_font
def test_out_of_range_margin_mm_via_http_does_not_break_the_export(client):
    """HTTP 层：schema 范围内的极端值（40mm）被 clamp 到 26mm，仍然正常出 PDF。"""
    resume_id = _create_resume(client, "classic")

    clamped = client.post(
        f"/api/resumes/{resume_id}/export",
        json={"format": "pdf", "page_limit": 1, "margin_mm": 40},
    )
    assert clamped.status_code == 200, clamped.text
    assert clamped.headers["X-Resume-Pages"] == "1"
    at_max = _export_pdf(client, resume_id, page_padding=26, page_limit=1)
    assert _left_text_x(clamped.content) == _left_text_x(at_max.content)
