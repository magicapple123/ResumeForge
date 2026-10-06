"""体验示例数据集端点的守卫：创建、切换、播种与主数据隔离。"""

from app.api import settings as settings_api


def test_load_sample_creates_switches_and_seeds(client):
    response = client.post("/api/settings/datasets/sample/load")
    assert response.status_code == 200
    payload = response.json()
    assert payload["sample"] is True
    assert payload["name"] == "体验示例"

    # 已切换到示例数据集：列表里它是激活项。
    datasets = client.get("/api/settings/datasets").json()
    active = [item for item in datasets if item["is_active"]]
    assert len(active) == 1
    assert active[0]["name"] == "体验示例"

    # 播了种：一个岗位 + 一份挂在这个岗位上的示例简历。
    jobs = client.get("/api/jobs").json()["items"]
    assert len(jobs) == 1
    assert jobs[0]["title"] == "市场运营专员"
    assert jobs[0]["company"] == "示例科技有限公司"

    resumes = client.get("/api/resumes").json()["items"]
    assert len(resumes) == 1
    assert resumes[0]["job_title"] == "市场运营专员"


def test_load_sample_never_touches_main_dataset(client):
    """主数据隔离：先在主数据里放一个岗位，载入示例后主数据原样保留。"""
    created = client.post(
        "/api/jobs",
        json={"title": "主数据岗位", "company": "真实公司", "description": "真实 JD"},
    )
    assert created.status_code == 201

    first = client.post("/api/settings/datasets/sample/load")
    assert first.status_code == 200

    # 切回主数据：原来的岗位还在，示例数据集里的内容不混进来。
    datasets = client.get("/api/settings/datasets").json()
    main = next(item for item in datasets if item["id"] == "main")
    client.post(f"/api/settings/datasets/{main['id']}/activate")

    jobs = client.get("/api/jobs").json()["items"]
    assert [job["title"] for job in jobs] == ["主数据岗位"]

    # 重复载入：每次都是一份新的示例数据集（名字可重复，id 不同），不报错。
    again = client.post("/api/settings/datasets/sample/load")
    assert again.status_code == 200
    assert again.json()["id"] != first.json()["id"]


def test_load_sample_rejects_non_loopback(client, monkeypatch):
    """与数据集管理同一道本机闸：非回环来源必须 403（测试里替换同一条判定）。"""
    monkeypatch.setattr(settings_api, "_is_loopback_request", lambda _request: False)
    response = client.post("/api/settings/datasets/sample/load")
    assert response.status_code == 403
