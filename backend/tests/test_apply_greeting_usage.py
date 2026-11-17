# SPDX-License-Identifier: Apache-2.0
"""话术库使用计数（#14D）与屏蔽清单「无效关键词显形」（#14E）。

计数必须是**增量**：整表 ``PUT`` 写的是绝对值，而"套用"发生在队列页、"保存"发生在
设置页，两者天然会交叉——前端若把读到的旧 ``uses`` 一起发回去，别处刚累加的会被
覆盖清零。所以：

- 日常计数只走 ``POST /greeting-templates/{id}/use``（``count`` 默认 1）；
- 批量套用同一条模板只发**一次**请求、带 ``count=N``；
- 前端整表保存**不带** ``uses``，后端按"省略 = 保留原计数"处理。

``inactive_keywords`` 的判定必须与 ``clean_keywords`` 同源：界面说"不会生效"的词，
匹配时就必须真的不参与；两份规则各写一遍迟早会漂成"界面标灰、实际在筛"。
"""

from __future__ import annotations

from app.services.apply.blocklist import clean_keywords

TEMPLATES = "/api/apply/greeting-templates"
BLOCKLIST = "/api/apply/blocklist"


def _save(client, *templates: dict[str, object]) -> list[dict[str, object]]:
    response = client.put(TEMPLATES, json={"templates": list(templates)})
    assert response.status_code == 200
    return response.json()["templates"]


def _uses(client, template_id: str) -> int:
    for item in client.get(TEMPLATES).json()["templates"]:
        if item["id"] == template_id:
            return int(item["uses"])
    raise AssertionError(f"话术库里找不到模板 {template_id}")


def test_apply_once_increments_usage_by_one(client):
    template = _save(client, {"name": "通用开场", "body": "您好{name}，想聊聊贵司的岗位。"})[0]

    response = client.post(f"{TEMPLATES}/{template['id']}/use")

    assert response.status_code == 200
    assert response.json()["uses"] == 1
    assert _uses(client, str(template["id"])) == 1


def test_batch_apply_carries_the_count_in_one_request(client):
    template = _save(client, {"name": "批量开场", "body": "您好{name}，看到贵司在招{job_title}。"})[
        0
    ]

    # 批量套用 3 条：一次请求带 count=3。若被实现成"发 N 次 +1"，这里只会得到 1。
    response = client.post(f"{TEMPLATES}/{template['id']}/use", json={"count": 3})

    assert response.status_code == 200
    assert response.json()["uses"] == 3
    assert _uses(client, str(template["id"])) == 3

    # 增量语义：再套用一次是 4，不是重新写成 1。
    client.post(f"{TEMPLATES}/{template['id']}/use")
    assert _uses(client, str(template["id"])) == 4

    # count 必须是正数；0 会让"套用了一次"看起来什么都没发生。
    assert client.post(f"{TEMPLATES}/{template['id']}/use", json={"count": 0}).status_code == 422


def test_unknown_template_is_404_not_a_silent_noop(client):
    response = client.post(f"{TEMPLATES}/no-such-template/use")

    assert response.status_code == 404


def test_blocklist_exposes_inactive_keywords_and_keeps_them(client):
    keywords = ["北京", "外包", "A", "区块链"]
    saved = client.put(BLOCKLIST, json={"companies": [], "keywords": keywords})

    assert saved.status_code == 200
    body = client.get(BLOCKLIST).json()
    # 停用词照样保存：界面上要如实显示"你填了，但它不会生效"。
    assert body["keywords"] == keywords
    assert body["inactive_keywords"] == ["北京", "外包", "A"]
    # 同一份规则：有效项 + 无效项 = 全部输入，不多不少。
    assert set(body["inactive_keywords"]) == set(body["keywords"]) - set(
        clean_keywords(body["keywords"])
    )


def test_full_table_save_keeps_usage_count(client):
    template = _save(client, {"name": "通用开场", "body": "您好，想聊聊。"})[0]
    client.post(f"{TEMPLATES}/{template['id']}/use", json={"count": 2})
    assert _uses(client, str(template["id"])) == 2

    # 前端保存话术库：整表提交但**不带** uses（只改名字与正文）。
    edited = client.put(
        TEMPLATES,
        json={
            "templates": [
                {
                    "id": template["id"],
                    "name": "通用开场（改）",
                    "body": "您好{name}，想聊聊贵司的{job_title}。",
                }
            ]
        },
    )

    assert edited.status_code == 200
    assert edited.json()["templates"][0]["name"] == "通用开场（改）"
    assert _uses(client, str(template["id"])) == 2


def test_stale_uses_in_full_save_would_reset_the_count(client):
    """反证用：前端若把本地读到的旧 ``uses`` 一起发回来，计数会被写回旧值。

    这条用例把"为什么前端不许发送 uses"钉在契约上——它现在绿，是因为前端没发；
    一旦前端改回发送，test_full_table_save_keeps_usage_count 的前置假设就失效了，
    而这条会指出后果。
    """
    template = _save(client, {"name": "通用开场", "body": "您好，想聊聊。"})[0]
    client.post(f"{TEMPLATES}/{template['id']}/use", json={"count": 2})

    client.put(
        TEMPLATES,
        json={
            "templates": [
                {"id": template["id"], "name": "通用开场", "body": "您好，想聊聊。", "uses": 0}
            ]
        },
    )

    assert _uses(client, str(template["id"])) == 0
