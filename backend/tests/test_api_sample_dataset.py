"""体验示例数据集端点的守卫：创建、切换、播种、幂等复用与主数据隔离。"""

from app.api import settings as settings_api
from app.dataset_registry import read_metadata, write_metadata
from app.services.sample_dataset import SAMPLE_SEED_VERSION


def test_load_sample_creates_switches_and_seeds(client):
    response = client.post("/api/settings/datasets/sample/load")
    assert response.status_code == 200
    payload = response.json()
    assert payload["sample"] is True
    # 首次载入是**新建**：reused 为 False（前端据此说"已就绪"而不是"已回到"）。
    assert payload["reused"] is False
    assert payload["name"] == "体验示例"

    # 已切换到示例数据集：列表里它是激活项。
    datasets = client.get("/api/settings/datasets").json()
    active = [item for item in datasets if item["is_active"]]
    assert len(active) == 1
    assert active[0]["name"] == "体验示例"
    assert active[0]["source"] == "sample"

    # 播了种：4 个岗位（不同状态/来源）+ 2 份简历（一份挂岗位、一份通用）。
    jobs = client.get("/api/jobs").json()["items"]
    assert len(jobs) == 4
    assert "市场运营专员" in {job["title"] for job in jobs}
    assert "示例科技有限公司" in {job["company"] for job in jobs}
    statuses = {job["status"] for job in jobs}
    assert {"开放中", "已投递", "已截止"} <= statuses
    assert {job["recognition_source"] for job in jobs} >= {"手动填写", "粘贴文本识别"}
    # 至少一个岗位带结构化关键词与完整 JD（详情接口有内容可读）。
    assert any(job["keywords"] for job in jobs)
    assert any(job["has_description"] for job in jobs)
    backend = next(job for job in jobs if job["title"] == "后端开发工程师")
    job_detail = client.get(f"/api/jobs/{backend['id']}").json()
    assert "任职要求" in job_detail["description"]

    resumes = client.get("/api/resumes").json()["items"]
    assert len(resumes) == 2
    assert {resume["title"] for resume in resumes} == {
        "示例简历 · 市场运营",
        "示例通用简历",
    }
    # 通用简历不挂岗位（job_title 为空串），挂岗的那份标题是市场运营专员。
    assert {resume["job_title"] for resume in resumes} == {"", "市场运营专员"}
    assert any(resume["job_id"] is None for resume in resumes)

    # 求职进度：3 条、覆盖多个阶段，都能从进度接口读到。
    tracks = client.get("/api/tracker").json()["items"]
    assert len(tracks) == 3
    assert {track["status"] for track in tracks} == {"applied", "interview", "offer"}

    # 资料箱 / 知识库 / 面经 / 历史题库 / 网申资料：各页面都有内容可看。
    materials = client.get("/api/materials").json()
    assert len(materials) == 3
    assert all(material["title"].startswith("示例素材") for material in materials)

    knowledge = client.get("/api/knowledge").json()
    assert len(knowledge) == 3
    assert all(entry["title"].startswith("示例知识") for entry in knowledge)

    experiences = client.get("/api/interview-experiences").json()
    assert len(experiences) == 1
    assert experiences[0]["company"] == "示例网络科技股份有限公司"
    assert len(experiences[0]["questions"]) == 3

    question_banks = client.get("/api/interview/question-banks").json()
    assert len(question_banks) == 1
    assert question_banks[0]["job_title"] == "后端开发工程师"
    assert len(question_banks[0]["groups"]) == 2

    webform = client.get("/api/webform/extra-profile").json()
    assert webform["values"] == {
        "student_id": "202301001",
        "height": "175",
        "specialty": "示例特长：视频拍摄与剪辑（虚构）",
    }


def test_load_sample_is_idempotent_within_the_same_seed_version(client):
    """同一播种版本重复载入：切换回同一份示例数据集，不再新建（用户实测缺陷）。"""
    first = client.post("/api/settings/datasets/sample/load")
    assert first.status_code == 200
    first_id = first.json()["id"]

    second = client.post("/api/settings/datasets/sample/load")
    assert second.status_code == 200
    payload = second.json()
    assert payload["id"] == first_id
    assert payload["reused"] is True
    assert payload["sample"] is True

    # 数据集列表里始终只有一份「体验示例」。
    names = [item["name"] for item in client.get("/api/settings/datasets").json()]
    assert names.count("体验示例") == 1


def test_load_sample_creates_a_new_dataset_when_seed_version_is_older(client):
    """旧版本的示例数据集**原样保留**：丰富化后重新载入走新建流程（reused=False）。"""
    first = client.post("/api/settings/datasets/sample/load").json()

    # 直接把已有示例数据集的 seed_version 降级，模拟"旧版本示例数据集"。
    metadata = read_metadata(first["id"])
    metadata["seed_version"] = "1"
    write_metadata(first["id"], metadata)

    second = client.post("/api/settings/datasets/sample/load")
    assert second.status_code == 200
    payload = second.json()
    assert payload["id"] != first["id"]
    assert payload["reused"] is False

    # 新数据集打的是当前版本标记；旧的那份原样保留（不就地升级）。
    assert read_metadata(payload["id"])["seed_version"] == SAMPLE_SEED_VERSION
    assert read_metadata(first["id"])["seed_version"] == "1"
    names = [item["name"] for item in client.get("/api/settings/datasets").json()]
    assert names.count("体验示例") == 2


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

    # 重复载入走幂等复用：不再新建（同一份示例数据集原样切回去）。
    again = client.post("/api/settings/datasets/sample/load")
    assert again.status_code == 200
    assert again.json()["id"] == first.json()["id"]


def test_load_sample_rejects_non_loopback(client, monkeypatch):
    """与数据集管理同一道本机闸：非回环来源必须 403（测试里替换同一条判定）。"""
    monkeypatch.setattr(settings_api, "_is_loopback_request", lambda _request: False)
    response = client.post("/api/settings/datasets/sample/load")
    assert response.status_code == 403
