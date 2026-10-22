# SPDX-License-Identifier: Apache-2.0
"""演示库自检：``CHECKS`` 只读清单 + ``run_checks()``。

搬迁自 ``scripts/seed_demo_data.py`` 第 1529–1613 行。改这个清单前先读 ``run_checks`` 的
docstring 与那段「刻意不查」的注释：口径是"抓演示数据不符合 schema"，不是"抓全部接口"。
"""

from __future__ import annotations

CHECKS = [
    "/api/health",
    "/api/profile",
    "/api/profile/photos",
    "/api/jobs?page=1&page_size=10",
    "/api/jobs/1",
    "/api/jobs/1/match-analysis",
    "/api/candidate-jobs",
    "/api/candidate-jobs/1",
    "/api/resumes?page=1&page_size=10",
    "/api/resumes/1",
    "/api/resumes/1/export?format=html",
    "/api/resumes/templates",
    "/api/resume-templates",
    "/api/resume-templates/builtin",
    "/api/claims",
    "/api/claims/baseline",
    "/api/claims/1",
    "/api/materials",
    "/api/materials/categories",
    "/api/materials/1",
    "/api/knowledge",
    "/api/knowledge/categories",
    "/api/knowledge/1",
    "/api/tracker",
    "/api/tracker/export?format=csv",
    "/api/reminders",
    "/api/reminders/upcoming?limit=8",
    "/api/referrals",
    "/api/referrals/stats",
    "/api/interview",
    "/api/interview-experiences",
    "/api/interview-experiences/sources",
    "/api/interview/question-banks",
    "/api/interview/reviews",
    "/api/drill",
    "/api/assistant/conversations?limit=100",
    "/api/assistant/conversations/1",
    "/api/assistant/skills",
    "/api/apply/queue",
    "/api/apply/records?page=1&page_size=10",
    "/api/apply/records/grouped?page=1&page_size=10",
    "/api/apply/tasks",
    "/api/apply/tasks/current",
    "/api/apply/sites",
    "/api/apply/config",
    "/api/apply/browser/status",
    "/api/collect/config",
    # 刻意不查 /api/collect/filters 与 /api/collect/site-health：前者会去站点取筛选选项
    # （读登录会话 → 全网通用清单 → 内置快照），跑一次十几秒；后者探测站点可达性。
    # 这个自检要抓的是"演示数据不符合 schema"，不需要联网，跑得快才有人愿意跑。
    "/api/share-packages",
    "/api/trash",
    "/api/settings/llm",
    "/api/settings/llm/records",
    "/api/settings/search",
    "/api/settings/reminder-popup",
    "/api/stats",
    "/api/analytics/dashboard?trend_months=6",
    "/api/search?q=运营",
]


def run_checks() -> int:
    """把只读接口挨个读一遍，返回失败条数。

    这里换成一个真正的 HTTP 客户端不合适（要么起服务、要么暴露端口），TestClient 走的是同一套
    路由与同一个序列化层，schema 不匹配一样会 500——而"演示数据不符合 schema"正是要抓的东西。
    """
    from app.main import app  # noqa: PLC0415
    from fastapi.testclient import TestClient  # noqa: PLC0415

    client = TestClient(app, client=("127.0.0.1", 50000), raise_server_exceptions=False)
    failures: list[str] = []
    for path in CHECKS:
        response = client.get(path)
        if response.status_code >= 400:
            failures.append(f"{response.status_code} {path} :: {response.text[:200]}")
    if failures:
        print("演示数据自检未通过：")
        for item in failures:
            print("  " + item.replace("\n", " "))
        return len(failures)
    print(f"演示数据自检通过：{len(CHECKS)} 个只读接口全部正常。")
    return 0
