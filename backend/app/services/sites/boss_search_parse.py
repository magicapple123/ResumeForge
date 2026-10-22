# SPDX-License-Identifier: Apache-2.0
"""BOSS 响应的纯函数解析层：搜索结果规整、岗位详情规整、响应体收集与接口错误归一。

2026-10-22（行数预算审计 A2）：从 ``boss_search`` 拆出——这 4 个模块级函数不依赖
``self``，只回答「这段响应能解析成什么」与「这个接口错误该怎么翻译」。
``boss_search`` 仍以同名 re-export 保留原命名空间（``boss.py`` / ``boss_scroll.py``
的 import 一个字都不用改）。
"""

from __future__ import annotations

import logging
from typing import Any

from ...models.apply import FAILURE_SELECTOR_INVALID
from ..browser.cdp_client import CdpClient, CdpError
from .base import SearchPage, SearchResult, SiteFailure
from .boss_network import DETAIL_MARKERS, SEARCH_MARKERS, api_error
from .boss_page import BOSS_DISPLAY_NAME
from .boss_search_scripts import NETWORK_RESPONSE_EVENT
from .boss_text import looks_like_salary, normalize_text, split_job_fields, split_title_salary

logger = logging.getLogger(__name__)


def parse_search_payload(
    payload: dict[str, Any], page: int, unmapped_conditions: list[str] | None = None
) -> SearchPage:
    """把 BOSS 搜索结果响应规整成 SearchPage；薪资缺失或不像薪资时退回标题里拆出的薪资。"""
    if not isinstance(payload, dict):
        raise SiteFailure(FAILURE_SELECTOR_INVALID, "搜索结果返回了无法解析的内容")
    results: list[SearchResult] = []
    items = payload.get("items")
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue
            title, title_salary = split_title_salary(item.get("title", ""))
            if not title:
                continue
            salary = normalize_text(item.get("salary", ""))
            if not looks_like_salary(salary):
                salary = title_salary
            results.append(
                SearchResult(
                    title=title,
                    company=normalize_text(item.get("company", "")),
                    location=normalize_text(item.get("location", "")),
                    salary=salary,
                    url=str(item.get("url", "")),
                    source=BOSS_DISPLAY_NAME,
                )
            )
    return SearchPage(
        results=results,
        page=page,
        has_next=bool(payload.get("has_next")),
        unmapped_conditions=list(unmapped_conditions or []),
    )


def parse_job_detail(payload: dict[str, Any]) -> dict[str, Any]:
    """把 BOSS 岗位详情响应规整成标准字段；需求缺失时退回描述里拆出的需求。"""
    if not isinstance(payload, dict):
        raise SiteFailure(FAILURE_SELECTOR_INVALID, "岗位详情返回了无法解析的内容")
    dom_requirements = normalize_text(payload.get("requirements", ""))
    sections = split_job_fields(payload.get("description", ""))
    return {
        "job_title": normalize_text(payload.get("job_title", "")),
        "company": normalize_text(payload.get("company", "")),
        "description": sections.description,
        "requirements": dom_requirements or sections.requirements,
        # 福利待遇 / 公司介绍这类第三段（对应 ``Job.additional_info``）。
        "additional_info": sections.additional,
        "url": str(payload.get("url", "")),
    }


def _with_response_bodies(client: CdpClient, events: list[dict[str, Any]]) -> list[Any]:
    from ..browser.network_capture import MAX_PARSED_RESPONSES, collect_bodies, response_urls

    wanted = {
        url
        for markers in (SEARCH_MARKERS, DETAIL_MARKERS)
        for url in response_urls(events, markers=markers)
    }
    body_events: list[dict[str, Any]] = []
    fetched: set[str] = set()
    for event in events:
        if len(body_events) >= MAX_PARSED_RESPONSES:
            break
        if event.get("method") != NETWORK_RESPONSE_EVENT:
            continue
        params = event.get("params")
        if not isinstance(params, dict):
            continue
        request_id = str(params.get("requestId") or "")
        if not request_id or request_id in fetched:
            continue
        response = params.get("response")
        url = str(response.get("url") or "") if isinstance(response, dict) else ""
        if url not in wanted:
            continue
        try:
            result = client.send("Network.getResponseBody", {"requestId": request_id})
        except CdpError:
            logger.debug("取响应体失败（可能已被回收）：%s", url)
            continue
        fetched.add(request_id)
        body_events.append(
            {"method": "Network.getResponseBody", "requestId": request_id, "result": result}
        )
    if not body_events:
        return []
    return collect_bodies([*events, *body_events])


def _raise_api_error(responses: list[Any], markers: tuple[str, ...], operation: str) -> None:
    for response in responses:
        url = str(getattr(response, "url", "") or "")
        if not any(marker and marker in url for marker in markers):
            continue
        error = api_error(getattr(response, "body", None))
        if error is None:
            continue
        code, message = error
        suffix = f"：{message}" if message else ""
        raise SiteFailure(
            FAILURE_SELECTOR_INVALID,
            f"BOSS {operation}接口返回错误 code={code}{suffix}。请检查筛选条件后重试",
            url=url,
        )
