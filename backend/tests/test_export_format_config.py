# SPDX-License-Identifier: Apache-2.0
"""导出参数同源（R1）：请求里的 ``format_config`` 必须真的进入渲染。

"预览一页、导出两页"的**直接原因**是导出请求体没有 ``format_config``：用户在预览里把
字号拖到 7px（``small`` 档 × ``font_scale_adjust=0.636``）、没点「保存版式」就导出，
导出侧仍按记录里的旧字号排版。预览走 ``POST /resumes/render`` 时早就带上了这组草稿值，
导出却没带——同一份简历在两条路径上读到了两组参数。

这里钉住四件事：
1. 服务端接受 ``format_config`` 并做白名单化（未知键丢弃、越界回退）；
2. 它**优先于**记录里存的版式（请求 > 记录 > 模板默认）；
3. 它真的改变了渲染结果（同一份内容：带 7px 参数一页，不带就两页）；
4. 交付指纹跟着变——否则库里会出现"指纹相同、字节不同"的两份存档。
"""

from __future__ import annotations

import pytest
from app.schemas.resume import ResumeContent
from app.services import user_fonts
from app.services.export_pipeline import (
    ExportRequest,
    RenderContext,
    build_export,
    render_config_fingerprint,
)
from app.services.resume.resume_template_format import (
    FORMAT_FIELDS,
    SYSTEM_FONT,
    format_css,
    format_field_options,
    validated_format_config,
)
from test_pdf_exporter import needs_font
from tests.font_fixtures import build_test_font

# 7px = 最小档 11px × 0.636（前端无级字号滑块落库的系数）。
SMALL_7PX = {"font_scale_adjust": 0.636}


def _long_resume() -> ResumeContent:
    """一份"按标准字号排不下、按 7px 排得下"的简历。"""
    return ResumeContent(
        name="张三",
        phone="13800000000",
        email="zhangsan@example.com",
        job_intent="后端工程师",
        summary="五年后端开发经验，负责高并发交易系统的设计与落地，熟悉 Python、Go 与分布式存储。",
        experience=[
            {
                "company": f"示例科技 {index}",
                "role": "高级后端工程师",
                "start_date": "2021-03",
                "end_date": "2024-06",
                "description": [
                    "负责订单核心链路的性能优化，将平均响应时间从 180ms 降到 45ms，峰值 QPS 提升三倍。",
                    "主导分库分表改造，完成 12 个业务表的平滑迁移，期间零故障、零数据丢失。",
                    "搭建可观测体系，覆盖指标、日志与链路追踪，线上问题平均定位时间缩短 60%。",
                ],
            }
            for index in range(6)
        ],
        projects=[
            {
                "name": f"项目 {index}",
                "role": "负责人",
                "description": [
                    "设计并实现异步任务调度平台，支撑每日百万级任务，失败自动重试与告警。",
                    "沉淀公共组件与接入规范，被 5 个业务团队复用。",
                ],
            }
            for index in range(3)
        ],
        skills=[
            {"name": name, "level": "熟练"}
            for name in ("Python", "Go", "PostgreSQL", "Redis", "Kafka", "Kubernetes")
        ],
    )


def _pdf_pages(resume: ResumeContent, format_config: dict | None, *, page_limit: int = 2) -> int:
    artifact = build_export(
        ExportRequest(
            format="pdf",
            font_scale="small",
            page_limit=page_limit,
            format_config=format_config,
        ),
        resume,
        RenderContext(page_limit=page_limit, font_scale="standard", format_config={}),
    )
    assert artifact.pages is not None
    return artifact.pages


@needs_font
def test_request_format_config_actually_changes_pagination():
    """同一份内容、同一个 2 页上限：带 7px 草稿排成 1 页，不带就排成 2 页。

    这就是"预览一页、导出两页"的最小复现——差别只来自那组没被带上的草稿版式。
    """
    resume = _long_resume()

    assert _pdf_pages(resume, SMALL_7PX) == 1
    assert _pdf_pages(resume, None) == 2


@needs_font
def test_one_page_limit_still_fits_without_the_draft_config():
    """1 页上限时自动一页仍会收字号，两条路径都装得下——参数同源不破坏既有收页。"""
    resume = _long_resume()

    assert _pdf_pages(resume, None, page_limit=1) == 1
    assert _pdf_pages(resume, SMALL_7PX, page_limit=1) == 1


@needs_font
def test_request_format_config_beats_recorded_layout():
    """记录里存着"标准字号"时，请求的草稿系数仍然生效（请求 > 记录）。"""
    resume = _long_resume()
    artifact = build_export(
        ExportRequest(format="pdf", page_limit=2, format_config=SMALL_7PX),
        resume,
        # 记录的 font_scale 是 standard、页数上限是 2；请求没有改上限，只给了系数。
        RenderContext(page_limit=2, font_scale="standard", format_config={}),
    )
    assert artifact.pages == 1


def test_format_config_is_whitelisted():
    """未知键与越界值在进入渲染前就被丢掉，不因为请求多塞一个键就影响版式。"""
    artifact = build_export(
        ExportRequest(
            format="html",
            format_config={
                "line_height": 99,  # 越界（上限 2.2）→ 丢弃
                "page_padding": 2,  # 越界（下限 8）→ 丢弃
                "accent": "not-a-color",  # 非十六进制 → 丢弃
                "font_scale_adjust": 0.636,  # 合法 → 保留
                "evil_key": 1,  # 未知 → 丢弃
            },
        ),
        _long_resume(),
        RenderContext(format_config={}),
    )
    html = artifact.content.decode("utf-8")
    assert "--accent" not in html or "not-a-color" not in html
    assert "evil" not in html.lower()


def test_format_css_rules_match_frontend_probes():
    """行距 / 页边距的 ``css_rule`` 与前端探针**逐字一致**（项 6 / D10）。

    拖动滑块时前端把同一条规则注入预览 iframe（"即时可见"），松手后由这里的
    :func:`format_css` 生成真正生效的规则。两边只要差一个空格、一个 ``!important``
    的位置，或者一个数字格式（``1.7`` vs ``1.70000``），用户就会看到"松手后跳一下"
    ——探针说一套、真实渲染说另一套。

    前端侧的对偶断言在 ``frontend/src/utils/resumeFormatProbe.test.ts``（两端各钉一次）。
    """
    rules = {field["key"]: field.get("css_rule") for field in FORMAT_FIELDS}
    assert rules["line_height"] == "body { line-height: %s !important; }"
    assert rules["page_padding"] == "body { padding: %smm !important; }"

    # 格式化走 `f"{value:g}"`：整数不带小数点、无意义尾零去掉。
    # 前端 `formatG` 复刻的就是这个行为。
    css = format_css({"line_height": 1.7, "page_padding": 14})
    assert "body { line-height: 1.7 !important; }" in css
    assert "body { padding: 14mm !important; }" in css
    assert "1.70000" not in css


# ===== 项 14：每份简历选字体（不是 FORMAT_FIELDS 的一项）=====


@pytest.fixture()
def font_dir(tmp_path, monkeypatch):
    """把字体目录换到临时目录：校验走的是 `user_fonts.font_path`，它要读真实文件。"""
    monkeypatch.setattr(user_fonts, "DATA_DIR", str(tmp_path))
    return tmp_path


def test_font_key_keeps_an_existing_font(font_dir):
    user_fonts.save_font("思源黑体.ttf", build_test_font())

    assert validated_format_config({"font": "思源黑体.ttf"}) == {"font": "思源黑体.ttf"}


def test_font_key_drops_a_missing_font(font_dir):
    """字体被删了只能静默丢弃：回落到"跟随全局"，而不是让整份简历打不开。"""
    assert "font" not in validated_format_config({"font": "没有这个.ttf"})


def test_font_key_drops_path_traversal(font_dir):
    user_fonts.save_font("ok.ttf", build_test_font())

    assert "font" not in validated_format_config({"font": "../ok.ttf"})
    assert "font" not in validated_format_config({"font": "..\\ok.ttf"})


def test_font_key_keeps_the_system_sentinel(font_dir):
    """``__system__`` 不指向任何文件，但它是一个合法取值。"""
    assert validated_format_config({"font": SYSTEM_FONT}) == {"font": SYSTEM_FONT}


def test_font_key_drops_non_string_values(font_dir):
    assert "font" not in validated_format_config({"font": 123})
    assert "font" not in validated_format_config({"font": None})
    assert "font" not in validated_format_config({"font": ""})


def test_font_is_not_a_format_field():
    """**不能**加进 ``FORMAT_FIELDS``：格式模板编辑器会为它渲染一个数字输入框（D26）。"""
    assert "font" not in {field["key"] for field in FORMAT_FIELDS}
    assert "font" not in {item["key"] for item in format_field_options()}


def test_font_does_not_leak_into_css():
    """字体不是 CSS 覆盖项：它由 ``@font-face`` 内嵌那条链路负责。"""
    assert "font" not in format_css({"font": SYSTEM_FONT})


def test_render_fingerprint_changes_with_request_format_config():
    """指纹必须覆盖生效后的 format_config，否则指纹相同而字节不同。"""
    base = ExportRequest(format="pdf", page_limit=1)
    tuned = ExportRequest(format="pdf", page_limit=1, format_config=SMALL_7PX)
    context = RenderContext(page_limit=1, font_scale="standard", format_config={})

    assert render_config_fingerprint(base, context) != render_config_fingerprint(tuned, context)


def test_empty_request_format_config_keeps_recorded_fingerprint():
    """不带草稿版式时，指纹与旧口径完全一致（旧存档的可比性不被破坏）。"""
    context = RenderContext(page_limit=2, font_scale="standard", format_config={"line_height": 1.7})
    plain = ExportRequest(format="pdf")
    empty = ExportRequest(format="pdf", format_config={})

    assert render_config_fingerprint(plain, context) == render_config_fingerprint(empty, context)


# ===== API 层：POST /export 把 format_config 带进渲染 =====


def _manual_resume(client, content: dict) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={"title": "参数同源", "content": content, "job_id": None},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


@needs_font
def test_post_export_honours_draft_format_config(client):
    """未保存的 7px 草稿：导出页数与预览一致（1 页），而不是记录里的旧字号（2 页）。"""
    resume_id = _manual_resume(client, _long_resume().model_dump())

    tuned = client.post(
        f"/api/resumes/{resume_id}/export",
        json={
            "format": "pdf",
            "font_scale": "small",
            "page_limit": 2,
            "format_config": SMALL_7PX,
        },
    )
    assert tuned.status_code == 200, tuned.text
    assert tuned.headers["X-Resume-Pages"] == "1"

    plain = client.post(
        f"/api/resumes/{resume_id}/export",
        json={"format": "pdf", "font_scale": "small", "page_limit": 2},
    )
    assert plain.status_code == 200, plain.text
    assert plain.headers["X-Resume-Pages"] == "2"


def test_post_export_accepts_format_config_without_persisting_it(client):
    """导出用的草稿版式不许写回记录：它只是这一次的渲染参数。"""
    resume_id = _manual_resume(client, {"name": "张三", "summary": "关注后端。"})

    response = client.post(
        f"/api/resumes/{resume_id}/export",
        json={"format": "html", "format_config": {"line_height": 1.2}},
    )
    assert response.status_code == 200

    detail = client.get(f"/api/resumes/{resume_id}").json()
    assert detail["format_config"].get("line_height") in (None, 0)


def test_post_export_rejects_non_object_format_config(client):
    resume_id = _manual_resume(client, {"name": "张三", "summary": "关注后端。"})

    response = client.post(
        f"/api/resumes/{resume_id}/export",
        json={"format": "html", "format_config": "line-height: 1.2"},
    )
    assert response.status_code == 422


# ===== R3：离线分享包 =====


def test_share_zip_contains_html_pdf_and_readme(client):
    """一个 zip 里三样东西：可直接看的 HTML、可直接转发的 PDF、怎么用的说明。"""
    import io
    import zipfile

    resume_id = _manual_resume(client, {"name": "张三", "summary": "关注后端。"})

    response = client.get(f"/api/resumes/{resume_id}/share-zip")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = set(archive.namelist())
    assert {"简历.html", "说明.txt"} <= names
    # PDF 是否在包里取决于本机字体；在就从字节头确认它是真 PDF。
    if "简历.pdf" in names:
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            assert archive.read("简历.pdf").startswith(b"%PDF")


def test_share_zip_html_follows_the_record_language(client, db_session):
    """分享包里的 HTML **与 PDF** 都必须跟着**记录的语言**走（§8.3 第 3 条）。

    分享包是"发给别人看的那一份"：包里固定中文，等于用户明明选了英文简历、发出去的
    却是中文标题——而他在界面上看不出区别，收件人也不会来问。语言这里直接写进记录
    （不经 `PATCH /layout`），因为要验的是**导出链路消费记录的语言**，而不是保存接口。

    两条产物各抽一次：HTML 直接读字符串；PDF 用 pypdf 抽文本（包里有没有 PDF 取决于
    本机中文字体，没有就只验 HTML——不把"没字体"写成"验过了"）。
    """
    import io
    import zipfile

    import pypdf
    from app.models.resume import ResumeRecord

    resume_id = _manual_resume(
        client,
        {
            "name": "Zhang San",
            "summary": "Backend engineer.",
            "education": [
                {"school": "Example University", "major": "Computer Science", "degree": "Bachelor"}
            ],
        },
    )
    record = db_session.get(ResumeRecord, resume_id)
    assert record is not None
    record.language = "en-US"
    db_session.commit()

    response = client.get(f"/api/resumes/{resume_id}/share-zip")

    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = set(archive.namelist())
        html_source = archive.read("简历.html").decode("utf-8")
        pdf_bytes = archive.read("简历.pdf") if "简历.pdf" in names else None
    assert "Education" in html_source
    assert "教育经历" not in html_source
    if pdf_bytes is not None:
        pdf_text = "".join(
            page.extract_text() or "" for page in pypdf.PdfReader(io.BytesIO(pdf_bytes)).pages
        )
        assert "Education" in pdf_text
        assert "教育经历" not in pdf_text
    # 说明.txt 不是简历产物，仍是中文使用说明——它不该跟着简历语言变。
    assert "说明.txt" in names


def test_share_zip_falls_back_to_html_without_pdf(client, monkeypatch):
    """本机没有中文字体时，分享包仍要能生成（HTML + 说明里写清原因）。"""
    import io
    import zipfile

    from app.services.pdf_exporter import ResumePDFError

    def _boom(*args, **kwargs):
        raise ResumePDFError("未找到可用的中文字体")

    monkeypatch.setattr("app.services.export_pipeline.build_resume_pdf", _boom)
    resume_id = _manual_resume(client, {"name": "张三", "summary": "关注后端。"})

    response = client.get(f"/api/resumes/{resume_id}/share-zip")

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = set(archive.namelist())
        readme = archive.read("说明.txt").decode("utf-8")
    assert "简历.pdf" not in names
    assert "简历.html" in names
    assert "未能生成 PDF" in readme
