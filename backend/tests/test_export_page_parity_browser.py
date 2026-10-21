# SPDX-License-Identifier: Apache-2.0
"""浏览器对拍：预览（浏览器算）与服务端导出（fpdf2 算）必须说同一句话。

**为什么单独一个文件**：这些用例要起真实 Chromium，而 ``test_export_page_parity.py``
其余 87 条纯服务端断言（响应头口径、预览载荷、页数纯函数）在普通 CI 上必须能跑。拆分
沿"要不要起浏览器"这条缝切，两个文件各自受 ``test_file_size_budget`` 的 500 行预算约束
（2026-10-22 从 572 行的原文件拆出）。

**marker**：``cross_engine``（注册见 ``backend/pytest.ini``）——CI 只在手动触发时执行，
见 ``.github/workflows/cross-engine.yml``。因为该作业从未在 ubuntu-latest 上跑绿过，
现在**只留 workflow_dispatch**，跑绿之后再挂 ``push: [main]``。

**浏览器对拍的历史**：三条数据对拍在 2026-10-21 打通。根因不是"环境没有浏览器"，而是
``backend/.venv`` 里 playwright 1.55.0 期望的 chromium-1187 与本机已装的 1234/1243/1248
对不上；把后端 playwright 升到 1.63.0（对应 chromium-1248）后就能起浏览器。现在读的是
真实的 ``body.dataset.pages`` / ``data-overflow``，浏览器起不来时仍然 skip（并打印真实
原因），不假装全绿——skip 逻辑在 ``browser_parity_support.py``。

**共用 harness**一律走 ``browser_parity_support``（``load_document`` /
``measure_layout`` / ``measure_layout_stable`` / ``read_preview_probe`` /
``parity_resume``），不在两个文件里各写一份："加载 HTML、等字体、等两帧"这套逻辑一旦
出现两份，早晚会一份修了另一份没修，而表现出来像是"跨引擎结果不稳定"。
"""

from __future__ import annotations

import asyncio
import math

import pytest
from app.schemas.resume import ResumeContent
from browser_parity_support import (
    load_document,
    measure_layout,
    measure_layout_stable,
    parity_resume,
    read_preview_probe,
)
from test_export_page_parity import _create_resume, _export_pdf
from test_pdf_exporter import needs_font

# 本文件里每一条都需要真实 Chromium（``chromium_page`` fixture）+ 中文字体。
pytestmark = [pytest.mark.cross_engine, needs_font]

# 预览 HTML 的来源：前端预览走 `POST /api/resumes/render`（见
# frontend/src/components/ResumeDetailModal.tsx → renderResume），不是导出端点。
# 用同一个入口才对得上"用户看到的草稿"。
_PREVIEW_RENDER_PATH = "/api/resumes/render"
_PARITY_TEMPLATE = "classic"
# 26mm 是面板上限（最窄正文宽度）：两侧的分页口径若不同，这里最先分歧。
_WIDE_PADDING_MM = 26
# 11mm 是多数模板的默认页边距，用来验"正常档位下两边都说 1 页"。
_DEFAULT_PADDING_MM = 11


def _render_preview_html(
    client,
    *,
    template: str,
    page_padding: int,
    page_limit: int = 1,
    content: ResumeContent | None = None,
) -> str:
    """取预览用的 HTML（与前端预览同一个端点、同一组参数）。"""
    response = client.post(
        _PREVIEW_RENDER_PATH,
        json={
            "content": (content or parity_resume()).model_dump(),
            "template": template,
            "page_limit": page_limit,
            "font_scale": "standard",
            "format_config": {"page_padding": page_padding},
        },
    )
    assert response.status_code == 200, response.text
    return response.text


def _draft_pages_needed(page, page_limit: int) -> int:
    """前端 `pagesNeededFor()` 的同一套算术：`ceil(正文高 / 一页可用高)`。"""
    measured = measure_layout_stable(page, page_limit)
    return max(1, math.ceil(measured["used_height"] / measured["page_content_height"]))


def _overflowing_resume() -> ResumeContent:
    """把同一份经历重复两遍：内容明显超过一页（26mm 页边距下服务端需要 2 页）。

    用来验"明确溢出"这一档——内容真排出 body 盒子、`scrollHeight` 会增长。而
    "刚好超一点点"那一档由本文件末尾
    ``test_exported_html_overflow_probe_detects_slight_overflow`` 专门守边界
    （旧判据在那里漏报，2026-10-21 已修）。
    """
    base = parity_resume()
    return base.model_copy(update={"experience": [*base.experience, *base.experience]})


# 三项对拍项：用哪一档页边距、用哪份内容。
#   宽页边距最容易暴露"两侧分页口径不同"；默认档验"正常情况也别错"；
#   明确溢出（2 倍经历）落在"一定超"那一档，与"只超一点点"的边界用例互补。
_BROWSER_PARITY_CHECKS = (
    ("data-pages", _DEFAULT_PADDING_MM, "base"),
    ("data-overflow", _WIDE_PADDING_MM, "overflowing"),
    ("wide-margin-pages", _WIDE_PADDING_MM, "base"),
)

_PARITY_CONTENT = {
    "base": parity_resume,
    "overflowing": _overflowing_resume,
}


@pytest.mark.parametrize(("check", "page_padding", "content_kind"), _BROWSER_PARITY_CHECKS)
def test_browser_preview_and_export_agree(client, chromium_page, check, page_padding, content_kind):
    """预览（浏览器算）与导出的页数 / 溢出标志对拍。

    ``data-pages`` / ``data-overflow`` 由模板里的 ``_resume_fit_script.j2`` 写；
    该脚本在 ``previewColumns === "1"``（预览切多列）时**故意不写**，因为分列后
    ``body.scrollHeight`` 只剩一页高。所以这里必须在单列状态读——预览的
    `layout.ts` 也是先回到单列再量，口径一致。
    """
    content = _PARITY_CONTENT[content_kind]()
    resume_id = _create_resume(client, _PARITY_TEMPLATE, content)
    exported = _export_pdf(client, resume_id, page_padding=page_padding, page_limit=1)
    preview_html = _render_preview_html(
        client,
        template=_PARITY_TEMPLATE,
        page_padding=page_padding,
        content=content,
    )

    load_document(chromium_page, preview_html)
    probe = read_preview_probe(chromium_page)

    assert probe["previewColumns"] is None, (
        "当前文档处于多列预览状态，模板探针不会写 data-pages / data-overflow；"
        "对拍必须在单列状态下进行"
    )
    assert probe["measured"] == "1", (
        f"模板里的溢出探针没有跑（data-measured 缺失）：读到 {probe!r}；不能把'没量'当成'没溢出'"
    )

    server_pages = exported.headers["X-Resume-Pages"]
    server_needed = exported.headers["X-Resume-Pages-Needed"]
    server_overflow = exported.headers["X-Resume-Overflow"]

    if check == "data-pages":
        assert probe["pages"] == server_pages, (
            f"预览 data-pages={probe['pages']!r} 与导出 X-Resume-Pages={server_pages!r} 不一致"
            f"（页边距 {page_padding}mm，模板 {_PARITY_TEMPLATE}）"
        )
        return

    if check == "data-overflow":
        draft_overflow = "1" if probe["overflow"] == "1" else "0"
        server_flag = "1" if server_overflow == "true" else "0"
        assert draft_overflow == server_flag, (
            f"预览 data-overflow={probe['overflow']!r} 与导出 X-Resume-Overflow="
            f"{server_overflow!r} 不一致（页边距 {page_padding}mm，模板 {_PARITY_TEMPLATE}；"
            f"服务端 needed={server_needed} / pages={server_pages}）"
        )
        return

    # wide-margin-pages：`data-pages` 只是"用户选了几页"，真正会分歧的是"需要几页"。
    # 服务端把 needed 放在 X-Resume-Pages-Needed 里，前端由 layout.ts 自己算，
    # 两边必须给出同一个数字——否则用户会在预览里看到"放得下"、下载后却少了一截。
    draft_needed = _draft_pages_needed(chromium_page, 1)
    assert draft_needed == int(server_needed), (
        f"页边距 {page_padding}mm 下两边算出的所需页数不同：草稿 {draft_needed} 页 vs "
        f"服务端 {server_needed} 页（服务端 pages={server_pages}，"
        f"预览 data-pages={probe['pages']!r}）"
    )
    assert probe["pages"] == server_pages, (
        f"页边距 {page_padding}mm 下预览 data-pages={probe['pages']!r} 与导出 "
        f"X-Resume-Pages={server_pages!r} 不一致"
    )


# 边界回归（2026-10-21 修掉的缺陷，现在由这条用例长期钉住）：
# 旧判据是 `body.scrollHeight > 1122.5 * N + 1`。模板 body 是
# `height: 297mm; padding: 26mm; box-sizing: border-box`，正文只**略微**超过内容区、
# 落进下页边距时仍然整个在 body 盒子内，`scrollHeight` 恒等于 1123 → 导出 HTML 的
# `data-overflow` 报 0，而服务端对同一份内容给 needed=2 / overflow=true。
# 现在判据改成"最后一个可见正文元素的底边 vs 内容区底边"（与
# `resumeLayoutMeasure.ts` / `tests/assets/measure_layout.js` 同一口径），
# 这条用例专门钉那个边界：正文只超几毫米也必须说"超了"。
# 实测（classic / 26mm / 单页）：正文 ≈246mm vs 一页可用 245mm。
def test_exported_html_overflow_probe_detects_slight_overflow(client, chromium_page):
    """正文只超一点点时，导出 HTML 的 data-overflow 也必须说"超了"。

    **断言强度**（2026-10-22 收紧）：此前只断言"草稿标志 == 服务端标志"，两侧同时
    退化成 0 也会绿——那正是本用例要防的漏报。现在把"两侧都是 1"钉死：
    ``draft_overflow == "1"`` 与 ``server_overflow is True`` 各自独立成立，最后一行再
    保留跨侧一致性。这样无论哪一侧先退化，失败信息都直接指向那一侧。
    """
    content = parity_resume()
    resume_id = _create_resume(client, _PARITY_TEMPLATE, content)
    exported = _export_pdf(client, resume_id, page_padding=_WIDE_PADDING_MM, page_limit=1)
    preview_html = _render_preview_html(
        client,
        template=_PARITY_TEMPLATE,
        page_padding=_WIDE_PADDING_MM,
        content=content,
    )

    load_document(chromium_page, preview_html)
    probe = read_preview_probe(chromium_page)
    measured = measure_layout(chromium_page, 1)

    # 前置条件：这条用例只有在"正文真的略微超过一页"时才有意义。若哪天内容/版式变了
    # 让它重新放得下，断言会以"退化"的形式失败，而不是悄悄变成一条空转的用例。
    assert measured["used_height"] > measured["page_content_height"], (
        "本用例要的是「刚超一点」的版面，但当前正文并没有超过一页可用高度："
        f"正文 {measured['used_height']:.1f}px / 可用 {measured['page_content_height']:.1f}px"
    )

    draft_overflow = "1" if probe["overflow"] == "1" else "0"
    server_overflow = exported.headers["X-Resume-Overflow"] == "true"
    detail = (
        f"草稿正文 {measured['used_height']:.1f}px（≈{measured['used_height'] * 0.264583:.1f}mm）"
        f" / 一页可用 {measured['page_content_height']:.1f}px"
        f"（≈{measured['page_content_height'] * 0.264583:.1f}mm）；"
        f"服务端 X-Resume-Overflow={exported.headers['X-Resume-Overflow']!r}"
        f" / needed={exported.headers['X-Resume-Pages-Needed']}"
    )

    # 这份内容确实超了约 0.9mm：草稿侧必须自己说出"超了"。
    assert draft_overflow == "1", (
        "导出 HTML 的探针漏报：正文已经超出内容区，data-overflow 却仍是 "
        f"{probe['overflow']!r}；{detail}"
    )
    assert server_overflow is True, f"服务端没有报溢出，与版面不符；{detail}"
    # 保留跨侧一致性：两侧对"同一份内容超没超"只能有一个结论。
    assert draft_overflow == ("1" if server_overflow else "0"), (
        f"预览 data-overflow={probe['overflow']!r} 与服务端 "
        f"{exported.headers['X-Resume-Overflow']!r} 不一致；{detail}"
    )


async def test_async_tests_still_run_after_a_browser_test():
    """浏览器夹具不许把 asyncio 事件循环留在运行态。

    2026-10-22 实测：``chromium_page`` 曾是 session 作用域，playwright 的 sync API
    在同一个线程里跑自己的循环，于是**此后每个 async def 用例**都报
    ``RuntimeError: Cannot run the event loop while another loop is running``。
    症状极具误导性——失败全落在 ``test_writing_selection`` / ``test_webform_*`` 这些
    与浏览器无关的文件里，单文件跑又全绿，一次全量带出 317 个假失败。

    这条用例故意排在本文件的浏览器用例之后、且**自己不请求** ``chromium_page``：
    夹具若被改回 session 作用域，它就会变红；而它自己若也依赖夹具，两种作用域下都会
    冲突（夹具在用例运行期间是活的），那就不成其为判据了。
    """
    await asyncio.sleep(0)
    assert asyncio.get_running_loop().is_running()
