# SPDX-License-Identifier: Apache-2.0
"""链接岗位抽取：规则层（JSON/JSON-LD/HTML）、四态、日期/类型/状态归一、JD 切分、
模型兜底的原文依据校验（#16B / #17B-E）。全部离线（假 provider + 内联 fixture HTML）。
"""

from __future__ import annotations

import asyncio
import json

import pytest
from app.services.web_fetch.extractor import extract_detail, extract_rows
from app.services.web_fetch.extractor_model import build_list_messages, field_is_grounded
from app.services.web_fetch.fetcher import FetchedPage
from app.services.web_fetch.field_rules import (
    FETCH_FAILED,
    FILLED,
    NOT_FETCHED,
    NOT_ON_PAGE,
    infer_job_type,
    infer_status,
    normalize_posted_at,
    split_jd_sections,
)
from app.services.web_fetch.html_utils import html_to_text


class FakeProvider:
    """假模型：返回固定 JSON 文本，并记录调用次数。"""

    def __init__(self, response: str) -> None:
        self.response = response
        self.calls = 0

    async def chat(self, _messages, *, thinking: bool = True) -> str:
        self.calls += 1
        return self.response


def run(coro):
    return asyncio.run(coro)


def html_page(
    html: str,
    *,
    url: str = "https://jobs.example.com/campus",
    fetched_on: str = "2026-11-11",
    json_payloads=None,
) -> FetchedPage:
    return FetchedPage(
        url=url,
        status_code=200,
        content_type="text/html",
        text=html_to_text(html),
        engine="http",
        fetched_on=fetched_on,
        html=html,
        json_payloads=list(json_payloads or []),
    )


JOB_CARDS = """
<div class="job-list">
  <div class="job-card">
    <a class="job-name" href="/campus/position/1001">Java 后端开发工程师</a>
    <span class="salary">25-40K·15薪</span>
    <span class="location">北京</span>
    <span class="company">字节跳动科技有限公司</span>
  </div>
  <div class="job-card">
    <a class="job-name" href="/campus/position/1002">前端开发工程师</a>
    <span class="salary">20-35K</span>
    <span class="location">上海</span>
    <span class="company">示例网络科技有限公司</span>
  </div>
  <div class="job-card">
    <a class="job-name" href="/campus/position/1003">算法工程师</a>
    <span class="salary">30-50K</span>
    <span class="location">深圳</span>
    <span class="company">示例数据科技有限公司</span>
  </div>
</div>
"""


def test_html_repeated_cards_yield_exactly_three_rows():
    """只有 3 条岗位的页面结果必须恰好 3 条，不出现第 4 条（幻觉反例的规则侧）。"""
    page = html_page(JOB_CARDS)
    result = run(extract_rows(page))
    assert result.method == "rules"
    assert len(result.rows) == 3
    titles = {row.title for row in result.rows}
    assert titles == {"Java 后端开发工程师", "前端开发工程师", "算法工程师"}
    first = next(row for row in result.rows if row.title == "Java 后端开发工程师")
    assert first.data["location"] == "北京"
    assert "25-40K" in first.data["salary"]
    assert first.data["source_url"].endswith("/campus/position/1001")
    assert first.field_states["description"] == NOT_FETCHED
    assert first.field_states["title"] == FILLED
    assert first.summary


def test_json_array_is_preferred_and_maps_detail_links():
    payload = {
        "data": {
            "jobList": [
                {
                    "jobTitle": "后端开发工程师",
                    "cityName": "北京",
                    "salaryDesc": "25-40K",
                    "jobUrl": "/campus/position/1",
                    "companyName": "示例科技",
                },
                {
                    "jobTitle": "数据分析师",
                    "cityName": "上海",
                    "salaryDesc": "18-30K",
                    "jobUrl": "/campus/position/2",
                    "companyName": "示例数据",
                },
                {
                    "jobTitle": "产品经理",
                    "cityName": "杭州",
                    "salaryDesc": "20-35K",
                    "jobUrl": "/campus/position/3",
                    "companyName": "示例产品",
                },
            ]
        }
    }
    page = html_page("<html><body><div id='root'></div></body></html>", json_payloads=[payload])
    result = run(extract_rows(page))
    assert result.method == "rules"
    assert len(result.rows) == 3
    urls = {row.detail_url for row in result.rows}
    assert urls == {
        "https://jobs.example.com/campus/position/1",
        "https://jobs.example.com/campus/position/2",
        "https://jobs.example.com/campus/position/3",
    }
    first = result.rows[0]
    assert first.data["title"] == "后端开发工程师"
    assert first.data["job_type"] == "校招"
    assert first.job_type_inferred is True


def test_json_ld_job_posting_is_supported():
    ld = json.dumps(
        {
            "@type": "JobPosting",
            "title": "数据分析师",
            "hiringOrganization": {"name": "示例科技有限公司"},
            "jobLocation": {"address": {"addressLocality": "上海"}},
            "description": "<p>岗位职责：负责数据看板建设</p><p>任职要求：熟悉 SQL</p>",
            "datePosted": "2026-10-30",
            "url": "https://jobs.example.com/position/9",
        },
        ensure_ascii=False,
    )
    page = html_page(f"<html><body><script type='application/ld+json'>{ld}</script></body></html>")
    result = run(extract_rows(page))
    assert len(result.rows) == 1
    row = result.rows[0]
    assert row.data["title"] == "数据分析师"
    assert row.data["company"] == "示例科技有限公司"
    assert row.data["location"] == "上海"
    assert row.data["posted_at"] == "2026-10-30"
    assert row.detail_url == "https://jobs.example.com/position/9"


@pytest.mark.parametrize(
    ("raw", "expected", "inferred"),
    [
        ("2026-10-30", "2026-10-30", False),
        ("2026年10月30日", "2026-10-30", False),
        ("3天前", "2026-11-08", True),
        ("昨天", "2026-11-10", True),
        ("刚刚", "2026-11-11", True),
        ("本周", "2026-11-11", True),
        ("近期", "", False),
        ("", "", False),
    ],
)
def test_posted_at_normalization(raw, expected, inferred):
    value, is_inferred = normalize_posted_at(raw, fetched_on="2026-11-11")
    assert value == expected
    assert is_inferred is inferred
    if expected:
        # 落库的必须是合法 ISO 日期（表单是 DatePicker，存原文会 Invalid Date）。
        from datetime import date

        assert date.fromisoformat(value)


def test_posted_at_relative_is_kept_out_of_db_but_raw_is_on_the_row():
    html = """
    <div class="job-position">
      <a href="/position/88">测试开发工程师</a>
      <span>北京</span>
      <span>发布时间：3天前</span>
    </div>
    """
    page = html_page(html)
    row = run(extract_rows(page)).rows[0]
    # 相对日期按抓取日（2026-11-11）换算并标「按抓取日推算」。
    assert row.data["posted_at"] == "2026-11-08"
    assert row.posted_at_inferred is True


def test_job_type_is_conservative_and_inferred_flag_is_honest():
    assert infer_job_type(page_url="https://x.com/campus", text="校园招聘")[0] == "校招"
    assert infer_job_type(page_url="https://x.com/campus", text="") == ("校招", True)
    assert infer_job_type(page_url="https://x.com/social", text="") == ("其他", False)
    assert infer_job_type(page_url="https://x.com/jobs", text="实习生")[0] == "实习"


def test_status_never_reports_already_applied():
    assert infer_status("职位已截止") == "已截止"
    assert infer_status("正常招聘中") == "开放中"
    # 「已投递」是本地状态，页面写了也不能抓。
    assert infer_status("你已投递该职位") == "开放中"


def test_jd_split_requires_explicit_headings():
    with_headings = "后端开发工程师\n岗位职责\n负责服务端接口开发。\n任职要求\n熟悉 Python 与 SQL。\n福利待遇\n六险一金"
    split = split_jd_sections(with_headings)
    assert split["split"] is True
    assert "负责服务端接口开发" in split["description"]
    assert "熟悉 Python" in split["requirements"]
    assert "六险一金" in split["additional_info"]

    without_headings = "后端开发工程师\n负责服务端接口开发，熟悉 Python 与 SQL。\n工作地点北京。"
    unsplit = split_jd_sections(without_headings)
    assert unsplit["split"] is False
    assert unsplit["requirements"] == ""
    assert "负责服务端接口开发" in unsplit["description"]


def test_detail_page_with_headings_fills_description_and_requirements():
    body = (
        "高级后端开发工程师\n示例科技有限公司\n"
        + "岗位职责\n"
        + "负责核心交易系统的设计与开发。" * 20
        + "\n任职要求\n"
        + "熟悉 Python、MySQL 与分布式系统。" * 10
        + "\n发布时间：2026-10-30\n工作地点：北京"
    )
    page = html_page(
        f"<html><body><div class='job-detail'>{body}</div></body></html>",
        url="https://jobs.example.com/position/1",
    )
    result = run(extract_detail(page))
    assert len(result.fields["description"]) > 200
    assert result.fields["requirements"]
    assert result.jd_split is True
    assert result.fields["status"] == "开放中"
    assert result.fields["posted_at"] == "2026-10-30"
    assert result.fields["location"] == "北京"


def test_detail_page_without_headings_keeps_requirements_empty():
    """没有小标题：整段进 description，requirements 必须为空，绝不自己造标题。"""
    body = "后端开发工程师\n" + "负责服务端接口开发与维护，熟悉 Python 与 SQL。\n" * 15
    page = html_page(
        f"<html><body><div class='job-detail'>{body}</div></body></html>",
        url="https://jobs.example.com/position/2",
    )
    result = run(extract_detail(page))
    assert len(result.fields["description"]) > 200
    assert result.fields["requirements"] == ""
    assert result.jd_split is False


def test_model_fallback_only_runs_when_rules_miss():
    provider = FakeProvider(json.dumps({"rows": []}, ensure_ascii=False))
    page = html_page(JOB_CARDS)
    result = run(extract_rows(page, provider=provider))
    assert provider.calls == 0
    assert len(result.rows) == 3
    assert result.method == "rules"


def test_model_fallback_drops_fields_without_grounding():
    """模型编造的字段（原文里没有）必须被丢弃，只有能核对的值才保留。"""
    page = html_page(
        "<html><body><p>校招岗位：Java 开发工程师</p><p>工作地点：北京</p></body></html>"
    )
    model_payload = json.dumps(
        {
            "rows": [
                {
                    "title": "Java 开发工程师",
                    "company": "谷歌",
                    "location": "北京",
                    "salary": "100-200K",
                },
                {"title": "凭空编造的岗位", "company": "不存在的公司", "location": "火星"},
            ]
        },
        ensure_ascii=False,
    )
    provider = FakeProvider(model_payload)
    result = run(extract_rows(page, provider=provider))
    assert provider.calls == 1
    assert result.method == "model"
    assert len(result.rows) == 1
    row = result.rows[0]
    assert row.data["title"] == "Java 开发工程师"
    assert "company" not in row.data  # 原文没有「谷歌」
    assert row.data["location"] == "北京"
    assert "salary" not in row.data


def test_model_failure_degrades_to_empty_result_with_warning():
    class BrokenProvider:
        async def chat(self, _messages, *, thinking: bool = True):
            raise RuntimeError("模型挂了")

    page = html_page("<html><body><p>普通网页</p></body></html>")
    result = run(extract_rows(page, provider=BrokenProvider()))
    assert result.rows == []
    assert result.method == "none"
    assert result.warnings


def test_model_input_is_clipped_to_30k():
    page = html_page("<html><body>" + "填充文字 " * 20000 + "</body></html>")
    messages = build_list_messages(page)
    assert len(messages[1]["content"]) <= 30_000 + 2_000


def test_field_grounding_accepts_exact_and_line_coverage():
    source = "负责交易系统开发，熟悉 Python。\n熟悉 MySQL 与 Redis。"
    assert field_is_grounded("Python", source)
    assert not field_is_grounded("Java", source)
    assert field_is_grounded("负责交易系统开发，熟悉 Python。\n熟悉 MySQL 与 Redis。", source)


def test_single_job_detail_intent_returns_one_filled_row():
    body = (
        "高级前端开发工程师\n示例科技有限公司\n岗位职责\n"
        + "负责管理后台页面开发。" * 20
        + "\n任职要求\n"
        + "熟悉 React 与 TypeScript。" * 10
    )
    html = f"<html><head><title>高级前端开发工程师 - 示例科技</title></head><body><div class='job-detail'>{body}</div></body></html>"
    page = html_page(html, url="https://jobs.example.com/position/7")
    result = run(extract_rows(page, intent="job_detail"))
    assert len(result.rows) == 1
    row = result.rows[0]
    assert row.title == "高级前端开发工程师"
    assert row.data["source_url"] == "https://jobs.example.com/position/7"
    assert row.data["description"]
    assert row.field_states["description"] == FILLED
    assert row.jd_split is True


def test_fetch_failed_state_is_distinct_from_not_on_page():
    row = run(extract_rows(html_page(JOB_CARDS))).rows[0]
    row.mark_fetch_failed("页面打不开")
    assert row.field_states["description"] == FETCH_FAILED
    assert row.field_states["additional_info"] == FETCH_FAILED
    assert row.field_states["company"] in {FILLED, NOT_ON_PAGE}
    assert row.detail_error == "页面打不开"
