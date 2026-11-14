# SPDX-License-Identifier: Apache-2.0
"""多平台采集（R-15 B）：三家 ATS 的详情页适配器。

用**本地 HTML fixture**（不联网）钉三件事：

1. 认平台：host 优先、DOM 标记兜底，认不出返回空串（老路径不变）；
2. 取正文：只在平台容器里取，容器为空/太短就整份作废，绝不拿整页导航当 JD；
3. 编排：`extract_detail` 命中平台后写入 `platform`，且不再把导航混进 description。
"""

from __future__ import annotations

import asyncio

from app.services.web_fetch.extractor import extract_detail
from app.services.web_fetch.platform_adapters import (
    GREENHOUSE,
    LEVER,
    WORKDAY,
    detect_platform,
    platform_detail_fields,
)

GREENHOUSE_HTML = """
<html><body>
<nav>首页 职位 关于我们</nav>
<div id="app_body">
  <div class="job__description">
    <p>我们正在招聘一名 Agent 产品经理，负责对话式产品的规划与落地。</p>
    <p>与算法、工程团队协作，推动 1,600 条工作流的上线验证。</p>
    <h3>Responsibilities</h3>
    <p>定义产品路线图，拆解到可交付的需求。</p>
    <h3>Requirements</h3>
    <p>三年以上 B 端产品经验，熟悉 LLM 应用。</p>
    <h3>Benefits</h3>
    <p>弹性工作，年度体检。</p>
  </div>
</div>
<footer>相关职位 你可能喜欢</footer>
</body></html>
"""

LEVER_HTML = """
<html><body>
<header>公司博客 招聘</header>
<div class="posting-page">
  <div class="content-wrapper">
    <p>We are hiring a backend engineer to build the resume pipeline.</p>
    <p>You will own the ingestion service and its observability.</p>
    <h3>Qualifications</h3>
    <p>Python, FastAPI, and a taste for small diffs.</p>
  </div>
</div>
</body></html>
"""

WORKDAY_HTML = """
<html><body>
<div data-automation-id="jobPostingHeader">
  <h2>Senior Product Manager</h2>
  <div>Company: Acme Robotics</div>
  <div>Location: 上海</div>
</div>
<div data-automation-id="jobPostingDescription">
  <p>Lead the agent platform roadmap across three product lines.</p>
  <p>Partner with research to ship evaluated, measurable features.</p>
  <h3>岗位要求</h3>
  <p>五年以上产品经验，有 AI 产品落地案例。</p>
</div>
</body></html>
"""


class _Page:
    """最小页面对象：与 fetcher 的 FetchedPage 同形（text / html / url）。"""

    def __init__(self, text: str, html: str, url: str) -> None:
        self.text = text
        self.html = html
        self.url = url
        self.content_type = "text/html"


def test_detect_by_host_and_marker():
    assert detect_platform("https://boards.greenhouse.io/acme/jobs/1", "") == GREENHOUSE
    assert detect_platform("https://jobs.lever.co/acme/abc", "") == LEVER
    assert detect_platform("https://acme.myworkdayjobs.com/job/1", "") == WORKDAY
    # 客户自定义域名：靠 DOM 标记认。
    assert detect_platform("https://careers.acme.com/x", GREENHOUSE_HTML) == GREENHOUSE
    assert detect_platform("https://careers.acme.com/x", LEVER_HTML) == LEVER
    assert detect_platform("https://careers.acme.com/x", WORKDAY_HTML) == WORKDAY
    assert detect_platform("https://example.com/x", "<html><body>hi</body></html>") == ""


def test_greenhouse_container_wins_and_sections_split():
    platform, fields = platform_detail_fields(
        "https://boards.greenhouse.io/acme/jobs/1", GREENHOUSE_HTML
    )
    assert platform == GREENHOUSE
    assert "Agent 产品经理" in fields["description"]
    assert "1,600 条工作流" in fields["description"]
    assert "三年以上 B 端产品经验" in fields["requirements"]
    assert "弹性工作" in fields["additional_info"]
    # 平台容器之外的导航/相关职位不能混进来。
    joined = " ".join(fields.values())
    assert "首页" not in joined and "相关职位" not in joined


def test_lever_and_workday():
    platform, fields = platform_detail_fields("https://jobs.lever.co/acme/abc", LEVER_HTML)
    assert platform == LEVER
    assert "resume pipeline" in fields["description"]
    assert "Python, FastAPI" in fields["requirements"]

    platform, fields = platform_detail_fields("https://acme.myworkdayjobs.com/job/1", WORKDAY_HTML)
    assert platform == WORKDAY
    assert "agent platform roadmap" in fields["description"]
    assert fields["company"] == "Acme Robotics"
    assert fields["location"] == "上海"
    assert "五年以上产品经验" in fields["requirements"]


def test_unknown_platform_or_empty_container_is_a_noop():
    assert platform_detail_fields("https://example.com/job/1", "<p>hi</p>") == ("", {})
    # 认得出平台、但容器里没有正文（SPA 空壳）→ 字段为空，让上层走通用路径。
    shell = '<div data-automation-id="jobPostingDescription"></div>'
    assert platform_detail_fields("https://acme.myworkdayjobs.com/job/1", shell) == (WORKDAY, {})
    # 太短（导航残留）也不算 JD。
    short = '<div id="app_body"><p>Apply now</p></div>'
    assert platform_detail_fields("https://boards.greenhouse.io/a/jobs/1", short) == (
        GREENHOUSE,
        {},
    )


def test_extract_detail_uses_the_adapter_and_marks_the_platform():
    page = _Page(
        text="首页 职位 关于我们 我们正在招聘一名 Agent 产品经理",
        html=GREENHOUSE_HTML,
        url="https://boards.greenhouse.io/acme/jobs/1",
    )
    result = asyncio.run(extract_detail(page))
    assert result.platform == GREENHOUSE
    assert "Agent 产品经理" in result.fields["description"]
    assert result.evidence.get("description") == "平台适配器"


def test_extract_detail_keeps_the_generic_path_when_platform_unknown():
    page = _Page(text="普通页面正文", html="<p>普通页面正文</p>", url="https://example.com/job/1")
    result = asyncio.run(extract_detail(page))
    assert result.platform == ""
