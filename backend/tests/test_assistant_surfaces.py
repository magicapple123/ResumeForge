"""侧栏助手与投投悬浮球会话作用域隔离测试。"""


def test_page_and_floating_conversations_are_listed_separately(client):
    page = client.post("/api/assistant/conversations", json={"title": "侧栏对话"})
    floating = client.post(
        "/api/assistant/conversations",
        json={"title": "投投对话", "surface": "floating"},
    )

    assert page.status_code == 201
    assert floating.status_code == 201
    assert page.json()["surface"] == "page"
    assert floating.json()["surface"] == "floating"

    page_list = client.get("/api/assistant/conversations").json()
    floating_list = client.get("/api/assistant/conversations?surface=floating").json()
    assert [item["id"] for item in page_list] == [page.json()["id"]]
    assert [item["id"] for item in floating_list] == [floating.json()["id"]]


def test_conversation_routes_reject_cross_surface_access(client):
    created = client.post(
        "/api/assistant/conversations",
        json={"title": "只属于投投", "surface": "floating"},
    ).json()

    assert client.get(f"/api/assistant/conversations/{created['id']}").status_code == 404
    assert (
        client.get(f"/api/assistant/conversations/{created['id']}?surface=floating").status_code
        == 200
    )
    assert (
        client.patch(
            f"/api/assistant/conversations/{created['id']}",
            json={"title": "不应改到浮窗"},
        ).status_code
        == 404
    )


def test_fork_keeps_the_source_surface(client):
    created = client.post(
        "/api/assistant/conversations",
        json={"title": "浮窗续聊", "surface": "floating"},
    ).json()

    forked = client.post(
        f"/api/assistant/conversations/{created['id']}/fork?surface=floating",
        json={"message_limit": 1},
    )
    assert forked.status_code == 201
    assert forked.json()["surface"] == "floating"
    assert client.get("/api/assistant/conversations?surface=floating").json()

