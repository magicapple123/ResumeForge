# SPDX-License-Identifier: Apache-2.0
"""A2 的第二个闸门：**请求语言覆盖记录语言**（导出面板的「草稿语言」）。

这份文件是本批新增的独立话题。它的 5 个用例在开发期间曾作为 ``test_export_labels.py`` 的
第 9 节存在——那是**未提交的工作区状态**，该文件因此涨到 552 行、超出 500 行预算 52 行。
提交前按"一个文件一个话题"把它们整体搬到这里，于是相对 ``HEAD`` 的净效果是**纯新增**：
``test_export_labels.py`` 零 diff，本文件独立成篇，用例与断言相对那个开发中间态逐字未改。

把这段来历写清楚是有必要的：``git log -p`` 里本文件是整份新增、原文件没有任何改动，
读者无法从提交历史自证"第 9 节存在过"，只看到一句"从第 9 节搬出来"会以为是记错了。

为什么这条关系必须单独钉住：导出面板的既定契约是"预览里的版式草稿就是导出的版式"，
``font_scale`` / ``page_limit`` / ``format_config`` 都由请求带上，后端在管线里覆盖记录值。
语言漏走这条路时，用户把预览切成 English、又没点「保存版式」，就会拿到一份**全中文**的
PDF/Word/HTML/MD/TXT——而他眼前明明是英文。下面几条从管线出口与 API 两个层面钉住：

- 管线层面证明"请求值进了渲染器"（``_pipeline_products`` 按**记录**语言建
  ``RenderContext``，只有请求带语言——这正是 ``_export_record`` 的形态）；
- API 层面证明"payload 真的被转成了管线请求"（``/export`` 端点带 ``language`` 的往返）。
"""

from __future__ import annotations

import pytest
from app.services.export_pipeline import (
    ExportRequest,
    RenderContext,
    build_export,
    render_config_fingerprint,
)
from tests.export_label_samples import (
    EN_TITLES,
    ZH_TITLES,
    _docx_text,
    _html_text,
    _pdf_text,
    _plain,
    _resume,
    needs_font,
)

# ===== 请求语言覆盖记录语言（导出面板的「草稿语言」） =====
#
# 导出面板的既定契约是"预览里的版式草稿就是导出的版式"：`font_scale` / `page_limit` /
# `format_config` 都由请求带上，后端在管线里覆盖记录值。语言漏走这条路时，用户把预览
# 切成 English、又没点「保存版式」，就会拿到一份**全中文**的 PDF/Word/HTML/MD/TXT——
# 而他眼前明明是英文。下面几条从管线出口与 API 两个层面钉住这条覆盖关系：
# 管线层面证明"请求值进了渲染器"，API 层面证明"payload 真的被转成了管线请求"。


def _pipeline_products(record_language: str, request_language: str | None) -> dict[str, str]:
    """五份产物的文本：``RenderContext`` 按**记录**语言建，只有请求带语言。

    这正是 ``_export_record`` 的形态（上下文的 ``language=record.language``），所以它
    与 ``export_label_samples._products`` 不是一回事——后者直接调渲染器，根本证明不了
    "请求里的语言有没有传到渲染器"，而漏传正是本批缺陷本身。
    """
    context = RenderContext(language=record_language)
    resume = _resume()
    products: dict[str, str] = {}
    for fmt in ("pdf", "docx", "html", "md", "txt"):
        artifact = build_export(
            ExportRequest(format=fmt, language=request_language),
            resume,
            context,
        )
        if fmt == "pdf":
            products[fmt] = _pdf_text(artifact.content)
        elif fmt == "docx":
            products[fmt] = _docx_text(artifact.content)
        elif fmt == "html":
            products[fmt] = _html_text(artifact.content.decode("utf-8"))
        else:
            products[fmt] = artifact.content.decode("utf-8")
    return products


def _assert_titles(
    products: dict[str, str],
    expected: tuple[str, ...],
    unexpected: tuple[str, ...],
    note: str,
) -> None:
    """每个格式都要**印齐** `expected` 标题、且**一条都不许**出现 `unexpected`。

    反向断言是"真的换了来源"的证据：只断言英文标题在场，一个同时印两种标题的实现
    也会通过（与第 2 节同一条道理）。
    """
    for fmt, text in products.items():
        compact = _plain(text)
        missing = [title for title in expected if _plain(title) not in compact]
        leaked = [title for title in unexpected if _plain(title) in compact]
        assert not missing, f"{note}：{fmt} 产物缺少标题 {missing}"
        assert not leaked, f"{note}：{fmt} 产物里还留着另一种语言的标题 {leaked}"


@needs_font
def test_the_request_language_overrides_the_record_language():
    """记录是 `zh-CN`、请求 `en-US`：五条产物**全部**是英文标题，一条中文标题都不许留。"""
    products = _pipeline_products("zh-CN", "en-US")

    _assert_titles(products, EN_TITLES, ZH_TITLES, "记录 zh-CN + 请求 en-US")
    # 逐格式点名，失败信息直接指向"哪条链路没吃到请求值"。
    assert set(products) == {"pdf", "docx", "html", "md", "txt"}


@needs_font
def test_the_request_language_overrides_the_record_language_in_reverse():
    """记录是 `en-US`、请求 `zh-CN`：反向同样成立——这是"请求覆盖"，不是"只认英文"。"""
    products = _pipeline_products("en-US", "zh-CN")

    _assert_titles(products, ZH_TITLES, EN_TITLES, "记录 en-US + 请求 zh-CN")


@needs_font
@pytest.mark.parametrize(
    ("record_language", "expected", "unexpected"),
    [("zh-CN", ZH_TITLES, EN_TITLES), ("en-US", EN_TITLES, ZH_TITLES)],
)
def test_omitting_the_request_language_keeps_the_record_value(
    record_language: str,
    expected: tuple[str, ...],
    unexpected: tuple[str, ...],
):
    """请求不带语言（旧客户端 / 用户没切过语言）= 沿用记录值，与既有行为逐字一致。"""
    products = _pipeline_products(record_language, None)

    _assert_titles(products, expected, unexpected, f"记录 {record_language} + 请求不带 language")


def test_the_render_fingerprint_follows_the_request_language():
    """指纹必须按**生效后**的语言算：同一份内容换语言就是另一份配置。

    不把请求语言算进去，`POST /export` 带 `en-US` 会与"记录本来就是中文"的那次导出
    得到同一个指纹——交付血缘会把两个文字不同的文件判成同一份。
    """
    context = RenderContext(language="zh-CN")
    recorded = render_config_fingerprint(ExportRequest(format="pdf"), context)
    overridden = render_config_fingerprint(ExportRequest(format="pdf", language="en-US"), context)

    assert recorded != overridden, "换了语言却给出同一个渲染配置指纹"
    # 覆盖后的指纹 = "记录本来就是英文"的指纹：两者生效配置相同，必须同指纹。
    assert overridden == render_config_fingerprint(
        ExportRequest(format="pdf"), RenderContext(language="en-US")
    )


def _create_resume_via_api(client, language: str) -> int:
    """建一份记录并把它的语言钉成 ``language``（= 上次保存的版式）。"""
    created = client.post(
        "/api/resumes/manual",
        json={"title": "导出语言的草稿", "content": _resume().model_dump(), "job_id": None},
    )
    assert created.status_code == 201, created.text
    resume_id = created.json()["id"]
    patched = client.patch(f"/api/resumes/{resume_id}/layout", json={"language": language})
    assert patched.status_code == 200, patched.text
    return resume_id


@needs_font
def test_the_export_endpoint_honours_the_draft_language(client):
    """端到端：`POST /export` 带 `language` 就按它排，不带就用记录值。

    管线级的用例证明不了 API 层有没有把 `payload.language` 转进管线请求——而这条转发
    正是"前端发了、后端丢了"最容易发生的地方（本批缺的就是它）。
    """
    resume_id = _create_resume_via_api(client, language="zh-CN")

    overridden = client.post(
        f"/api/resumes/{resume_id}/export", json={"format": "pdf", "language": "en-US"}
    )
    assert overridden.status_code == 200, overridden.text
    _assert_titles(
        {"pdf": _pdf_text(overridden.content)}, EN_TITLES, ZH_TITLES, "POST /export 带 language"
    )

    kept = client.post(f"/api/resumes/{resume_id}/export", json={"format": "pdf"})
    assert kept.status_code == 200, kept.text
    _assert_titles(
        {"pdf": _pdf_text(kept.content)}, ZH_TITLES, EN_TITLES, "POST /export 不带 language"
    )
