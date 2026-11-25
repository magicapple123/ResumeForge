# SPDX-License-Identifier: Apache-2.0
"""详情页形态识别（CR-30）：``?jobUnionId=`` 这类查询参数、``/xxx/detail`` 路径、
站点配置 JSON 被当成岗位、无 ``<h1>`` 时的标题结构证据。

背景（2026-11-25 实测）：美团校招详情页 ``/web/position/detail?jobUnionId=...`` 被判成
列表页，列表分支又把站点配置接口里的 ``data.name = "招聘官网"`` 当成一条岗位，
四个字段全空但界面显示「共识别 1 条」。整组用例都用内联 fixture，不联网。
"""

from __future__ import annotations

import asyncio

from app.services.web_fetch.extractor import DETAIL_ONLY_WARNING, extract_rows
from app.services.web_fetch.fetcher import FetchedPage
from app.services.web_fetch.html_utils import html_to_text
from app.services.web_fetch.page_intent import classify_page_intent

#: 真实站点的形态：路径结束于 /detail，岗位 id 在查询参数 jobUnionId 里。
DETAIL_URL = (
    "https://zhaopin.meituan.com/web/position/detail?jobUnionId=4921909221&highlightType=campus"
)

#: 无 <h1>（真实页 h1 数量为 0），岗位名只在 ``.postion_name .title`` 里。
DETAIL_HTML = """
<div class="header"><a href="/web/home">招聘官网</a></div>
<nav>首页 LongCat人才招聘 北斗计划 社会招聘 校园招聘 登录</nav>
<div class="positin_detail_wrapper_content">
  <div class="position_detail_sticky">
    <div class="postion_name"><span class="title">AI产品实习生</span>
      <span class="tag green">实习-日常实习</span></div>
    <div class="split_line_box">
      <div><span>更新时间：2026/11/25</span></div>
      <div><span>工作地点：北京市</span></div>
      <div><span>部门：核心本地商业-基础研发平台</span></div>
    </div>
  </div>
  <h2>岗位职责</h2>
  <p>参与 AI 产品从 0 到 1 探索，挖掘通用 Agent 在生活、办公、娱乐等场景的需求，
     持续跟进前沿创新产品，快速做原型验证并推动落地。</p>
  <h2>任职要求</h2>
  <p>对 AGI 有强烈热情，具备产品判断力，能够独立完成需求分析与原型设计。</p>
</div>
"""

#: 站点配置接口：``name`` + ``url`` 让 _looks_like_job_item 误判成岗位。
SITE_CONFIG = {
    "status": 1,
    "message": "success",
    "data": {
        "id": "1",
        "name": "招聘官网",
        "url": "https://zhaopin.meituan.com/web/home",
        "imgUrl": "//s3plus.meituan.net/zhaopin/bg/social.png",
        "globalConfig": {"email": ""},
        "sectionTypes": [{"id": "168", "sectionName": "LongCat 大模型人才校招", "sections": []}],
    },
}


def _page(*, url: str = DETAIL_URL, html: str = DETAIL_HTML, payloads=None) -> FetchedPage:
    return FetchedPage(
        url=url,
        status_code=200,
        content_type="text/html",
        text=html_to_text(html),
        engine="browser",
        fetched_on="2026-11-25",
        html=html,
        json_payloads=list(payloads or []),
    )


def test_detail_path_without_id_is_recognized_as_detail():
    """``/web/position/detail`` + ``jobUnionId``：以前 shape 为空 → 直接判列表。"""
    assert classify_page_intent(_page()) == "job_detail"


def test_job_union_id_query_is_a_detail_shape():
    """没有 /detail 后缀、只有 jobUnionId 时，也要按「详情形态」走结构判断。"""
    url = "https://jobs.example.com/campus/position?jobUnionId=10086"
    assert classify_page_intent(_page(url=url)) == "job_detail"


def test_site_config_payload_is_not_imported_as_a_job():
    """站点配置对象不能变成「招聘官网」这条岗位。"""
    result = asyncio.run(extract_rows(_page(payloads=[SITE_CONFIG]), intent="auto"))
    titles = [row.title for row in result.rows]
    assert "招聘官网" not in titles
    assert titles[:1] == ["AI产品实习生"]


def test_detail_title_uses_structural_evidence_when_page_has_no_h1():
    """没有 h1 时，标题取「元信息之前最近的标题元素」，不取导航第一项。"""
    result = asyncio.run(extract_rows(_page(), intent="auto"))
    assert len(result.rows) == 1
    row = result.rows[0]
    assert row.title == "AI产品实习生"
    assert row.data["location"] == "北京市"
    assert row.data["posted_at"] == "2026-11-25"


def test_single_row_without_any_evidence_is_reported_instead_of_imported():
    """只有一行、无详情链接、四个字段全空：判「没识别到」，不给假行。"""
    page = _page(
        url="https://jobs.example.com/campus/position",
        html="<main>Welcome</main>",
        payloads=[{"data": [{"jobTitle": "招聘官网", "jobUrl": "/web/home"}]}],
    )
    result = asyncio.run(extract_rows(page, intent="job_list"))
    assert result.rows == []
    assert DETAIL_ONLY_WARNING in result.warnings
    assert result.method == "none"
