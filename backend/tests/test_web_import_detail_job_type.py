# SPDX-License-Identifier: Apache-2.0
"""详情页岗位类型推断（CR-39）：只在标题附近找页面证据，导航里的「校园招聘」不算。

背景（2026-11-25 美团详情页实测）：页面上写着「实习-日常实习」，导入后却是「其他」——
`ExtractedRow.build` 推断类型时只传了 URL、`text=""`，页面明确标签那条分支永远走不到。

口径（优先级从高到低）：页面明确标签 → 标题附近行 → URL 频道 → 「其他」。
列表页行为必须逐字节不变：列表行不读页面文本，只按 URL 推。
"""

from __future__ import annotations

import asyncio

from app.services.web_fetch.extractor import extract_rows
from app.services.web_fetch.fetcher import FetchedPage
from app.services.web_fetch.html_utils import html_to_text

#: 真实站点形态：导航里也有「校园招聘」，正文标签是「实习-日常实习」。
MEITUAN_DETAIL_HTML = """
<div class="header"><a href="/web/home">招聘官网</a></div>
<nav>首页 LongCat人才招聘 北斗计划 社会招聘 校园招聘 登录</nav>
<div class="postion_name"><div class="title">AI产品实习生</div>
  <div class="tag green">实习-日常实习</div></div>
<div class="split_line_box">
  <div><span>更新时间：2026/11/25</span></div>
  <div><span>工作地点：北京市</span></div>
  <div><span>部门：核心本地商业-基础研发平台</span></div>
</div>
<h2>岗位职责</h2>
<p>参与 AI 项目从 0 到 1 探索，挖掘通用 Agent 在生活、办公、娱乐等场景的需求。</p>
<h2>任职要求</h2>
<p>对 AGI 有强烈热情，具备产品判断力，能够独立完成需求分析与原型设计。</p>
"""

#: 真实站点二次实测（2026-11-25 17:3x）：浏览器渲染后标题与标签被并进同一行
#: （innerText = ``AI产品实习生实习-日常实习``），标题行不是整行匹配。
MERGED_TAG_HTML = """
<nav>首页 LongCat人才招聘 北斗计划 社会招聘 校园招聘 登录</nav>
<div class="postion_name"><span class="title">AI产品实习生</span><span class="tag green">实习-日常实习</span></div>
<div><span>更新时间：2026/11/25</span></div>
<div><span>工作地点：北京市</span></div>
<h2>岗位职责</h2>
<p>参与 AI 项目从 0 到 1 探索，挖掘通用 Agent 在生活、办公、娱乐等场景的需求。</p>
<h2>任职要求</h2>
<p>对 AGI 有强烈热情，具备产品判断力，能够独立完成需求分析与原型设计。</p>
"""

#: 纯 URL 校招频道页：正文没有任何类型词。
CAMPUS_ONLY_HTML = """
<h1>后端开发工程师</h1>
<div><span>工作地点：北京市</span></div>
<h2>岗位职责</h2>
<p>负责服务端接口开发与维护。</p>
<h2>任职要求</h2>
<p>熟悉 Python 与 SQL。</p>
"""

#: 没有任何证据的详情页。
NO_EVIDENCE_HTML = """
<h1>后端开发工程师</h1>
<div><span>工作地点：北京市</span></div>
<h2>岗位职责</h2>
<p>负责服务端接口开发与维护。</p>
<h2>任职要求</h2>
<p>熟悉 Python 与 SQL。</p>
"""

LIST_HTML = """
<div class="job-list">
  <div class="job-card"><a href="/campus/position/1">后端开发工程师</a><span>北京</span></div>
  <div class="job-card"><a href="/campus/position/2">前端开发工程师</a><span>上海</span></div>
</div>
"""


def _page(*, url: str, html: str) -> FetchedPage:
    return FetchedPage(
        url=url,
        status_code=200,
        content_type="text/html",
        text=html_to_text(html),
        engine="browser",
        fetched_on="2026-11-25",
        html=html,
        json_payloads=[],
    )


def _detail_row(*, url: str, html: str):
    result = asyncio.run(extract_rows(_page(url=url, html=html), intent="job_detail"))
    assert len(result.rows) == 1
    return result.rows[0]


def test_list_rows_keep_url_only_inference():
    """列表页回归：列表行不看页面文本，校招频道 → 校招（inferred=True）。"""
    result = asyncio.run(
        extract_rows(
            _page(url="https://jobs.example.com/campus", html=LIST_HTML), intent="job_list"
        )
    )
    assert [row.data["job_type"] for row in result.rows] == ["校招", "校招"]
    assert all(row.job_type_inferred for row in result.rows)


def test_list_rows_card_label_still_wins():
    """列表页回归：卡片文本里的「实习」仍按页面证据判（旧行为，不动）。"""
    html = LIST_HTML.replace("后端开发工程师", "后端开发工程师 实习")
    result = asyncio.run(
        extract_rows(_page(url="https://jobs.example.com/list", html=html), intent="job_list")
    )
    assert {row.data["job_type"] for row in result.rows} == {"其他", "实习"}


def test_detail_page_uses_nearby_tag_not_navigation():
    """导航含「校园招聘」不影响：标题旁的「实习-日常实习」优先判为实习。"""
    row = _detail_row(
        url=(
            "https://zhaopin.meituan.com/web/position/detail"
            "?jobUnionId=4921909221&highlightType=campus"
        ),
        html=MEITUAN_DETAIL_HTML,
    )
    assert row.data["job_type"] == "实习"
    # 来自页面证据，不算「推断」。
    assert row.job_type_inferred is False


def test_detail_page_with_merged_title_and_tag_line():
    """标题与标签被并进同一行时，也要能从这一行读到「实习」。"""
    row = _detail_row(
        url=(
            "https://zhaopin.meituan.com/web/position/detail"
            "?jobUnionId=4921909221&highlightType=campus"
        ),
        html=MERGED_TAG_HTML,
    )
    assert row.data["job_type"] == "实习"
    assert row.job_type_inferred is False


def test_detail_page_url_campus_channel_still_infers_campus():
    """页面无类型证据时，校招频道 URL 仍判校招，并如实标 inferred=True。"""
    row = _detail_row(url="https://jobs.example.com/campus/position/9", html=CAMPUS_ONLY_HTML)
    assert row.data["job_type"] == "校招"
    assert row.job_type_inferred is True


def test_detail_page_without_any_evidence_is_other():
    """既无页面证据也不是校招频道：仍是「其他」。"""
    row = _detail_row(url="https://jobs.example.com/position/9", html=NO_EVIDENCE_HTML)
    assert row.data["job_type"] == "其他"
    assert row.job_type_inferred is False
