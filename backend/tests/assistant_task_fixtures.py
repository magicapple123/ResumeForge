# SPDX-License-Identifier: Apache-2.0
"""#18A 执行器测试的共用夹具（非 test 文件，不会被 pytest 收集）。

放这里而不是拆进各测试文件：假 provider / 假抓取层 / 简历与岗位构造被
test_assistant_task_runner.py 与 test_assistant_task_runner_api.py 共用。
"""

from __future__ import annotations

import json

from app.models.agent_task import AgentTask
from app.services import agent_task_service
from app.services.web_fetch.errors import WebFetchError
from app.services.web_fetch.fetcher import FetchedPage, FetchedPages

LIST_URL = "https://jobs.example.com/campus/position"

RESUME_CONTENT = {
    "name": "张示例",
    "job_intent": "后端工程师",
    "education": [
        {
            "school": "清华大学",
            "major": "计算机科学与技术",
            "degree": "本科",
            "gpa": "3.8/4.0",
        }
    ],
    "experience": [
        {
            "company": "示例科技",
            "role": "后端工程师",
            "start_date": "2022.07",
            "end_date": "至今",
            "description": ["主导投递平台重构，把吞吐从每分钟 120 提升到 900。"],
        }
    ],
    "projects": [
        {
            "name": "ResumeForge 简历工作台",
            "role": "独立开发",
            "description": ["负责文档模型 v2 与导出链路。"],
        }
    ],
    "skills": [{"name": "Python", "level": "熟练"}],
}

LIST_PAYLOAD = {
    "data": {
        "jobs": [
            {
                "jobTitle": "后端开发工程师",
                "cityName": "北京",
                "salaryDesc": "25-40K",
                "jobUrl": "/campus/position/1",
                "companyName": "示例科技",
            },
            {
                "jobTitle": "前端开发工程师",
                "cityName": "上海",
                "salaryDesc": "20-35K",
                "jobUrl": "/campus/position/2",
                "companyName": "示例网络",
            },
            {
                "jobTitle": "算法工程师",
                "cityName": "深圳",
                "salaryDesc": "30-50K",
                "jobUrl": "/campus/position/3",
                "companyName": "示例数据",
            },
        ]
    }
}


def list_page() -> FetchedPage:
    return FetchedPage(
        url=LIST_URL,
        status_code=200,
        content_type="application/json",
        text="",
        engine="http",
        fetched_on="2026-11-11",
        json_payloads=[LIST_PAYLOAD],
    )


def detail_page(url: str) -> FetchedPage:
    from app.services.web_fetch.html_utils import html_to_text

    body = (
        "岗位职责\n"
        + "负责核心系统的设计与开发，保障线上稳定性。" * 12
        + "\n任职要求\n"
        + "熟悉 Python、MySQL 与分布式系统。" * 6
        + "\n福利待遇\n六险一金、免费三餐"
    )
    html = f"<html><body><div class='job-detail'>{body}</div></body></html>"
    return FetchedPage(
        url=url,
        status_code=200,
        content_type="text/html",
        text=html_to_text(html),
        engine="http",
        fetched_on="2026-11-11",
        html=html,
    )


class FakeFetcher:
    """按 URL 返回预置页面；没预置的 URL 抛 WebFetchError。"""

    pages: dict[str, object] = {}
    calls: list[str] = []

    def __init__(self, _db=None, *, config=None) -> None:
        self.config = config

    def fetch(self, url: str, *, engine: str | None = None) -> FetchedPage:
        FakeFetcher.calls.append(url)
        value = FakeFetcher.pages.get(url)
        if value is None:
            raise WebFetchError("这个页面抓不到")
        if isinstance(value, Exception):
            raise value
        return value  # type: ignore[return-value]

    def fetch_pages(self, url: str, *, pages: int = 1, engine: str | None = None) -> FetchedPages:
        first = self.fetch(url, engine=engine)
        return FetchedPages(pages=(first,), pages_fetched=1, truncated=False, stop_reason="no_next")


def reset_fetcher() -> None:
    FakeFetcher.pages = {}
    FakeFetcher.calls = []


class ScriptedProvider:
    """按顺序回放的假 provider；最后一条会重复使用。"""

    def __init__(self, responses: list[object]) -> None:
        self.responses = list(responses)
        self.calls = 0

    async def chat(self, messages, *, thinking: bool = True):  # noqa: ARG002 - 夹具签名固定
        self.calls += 1
        index = min(self.calls - 1, len(self.responses) - 1)
        value = self.responses[index]
        if isinstance(value, Exception):
            raise value
        return value


EMPTY_MATCH_JSON = json.dumps(
    {"hard_conditions": [], "core_abilities": [], "bonus_items": [], "notes": []}
)


def create_resume(client) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={"title": "执行器验证", "content": RESUME_CONTENT, "job_id": None},
    )
    assert response.status_code == 201, response.text
    return int(response.json()["id"])


def create_job(client, title: str = "后端开发工程师", company: str = "示例科技") -> int:
    response = client.post(
        "/api/jobs",
        json={
            "title": title,
            "company": company,
            # 投递台准入要求来源站点受支持；生成招呼语写队列会走真实入队闸门。
            "source_url": "https://www.zhipin.com/job/1",
        },
    )
    assert response.status_code == 201, response.text
    return int(response.json()["id"])


def make_task(
    db_session,
    *,
    kind: str,
    params: dict | None = None,
    steps: tuple[tuple[str, str], ...],
    source: str = "assistant",
) -> AgentTask:
    payload = None if params is None else {"kind": kind, **params}
    task = agent_task_service.create_task(
        db_session,
        title=f"测试任务 {kind}",
        steps=[{"title": title, "kind": step_kind} for title, step_kind in steps],
        source=source,
        params=payload,
    )
    return agent_task_service.start(db_session, task.id)
