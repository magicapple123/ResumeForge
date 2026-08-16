"""API 冒烟测试：核心链路（资料、岗位、抓取、搜索、统计、设置）走通。"""
from app.schemas.setting import LLMConfig


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_profile_roundtrip(client):
    payload = {
        "name": "张三",
        "email": "zhangsan@example.com",
        "job_intent": "后端开发工程师",
        "educations": [{"school": "天津工业大学", "major": "软件工程", "degree": "本科"}],
        "experiences": [{"company": "某科技公司", "role": "实习生", "description": "开发\n测试"}],
        "projects": [],
        "skills": [{"name": "Python", "level": "熟练"}],
        "awards": [],
    }
    response = client.put("/api/profile", json=payload)
    assert response.status_code == 200
    saved = response.json()
    assert saved["name"] == "张三" and len(saved["educations"]) == 1

    response = client.get("/api/profile")
    assert response.json()["educations"][0]["school"] == "天津工业大学"

    # 再次 PUT 是整体替换：清空教育经历
    payload["educations"] = []
    response = client.put("/api/profile", json=payload)
    assert response.json()["educations"] == []


def test_job_crud_and_keywords(client):
    payload = {
        "title": "后端开发工程师",
        "company": "示例公司",
        "location": "北京",
        "description": "熟练掌握 Python、MySQL，本科及以上学历，3年以上经验",
    }
    response = client.post("/api/jobs", json=payload)
    assert response.status_code == 201
    job = response.json()
    keyword_names = {tag["name"] for tag in job["keywords"]}
    assert {"Python", "MySQL"} <= keyword_names

    response = client.get(f"/api/jobs/{job['id']}")
    assert response.status_code == 200

    response = client.put(f"/api/jobs/{job['id']}", json={"status": "已投递"})
    assert response.json()["status"] == "已投递"

    response = client.delete(f"/api/jobs/{job['id']}")
    assert response.status_code == 204
    assert client.get(f"/api/jobs/{job['id']}").status_code == 404


def test_job_list_search_and_pagination(client):
    client.post("/api/jobs", json={"title": "后端开发工程师", "company": "A公司", "description": "Python"})
    client.post("/api/jobs", json={"title": "前端开发工程师", "company": "B公司", "description": "React"})
    response = client.get("/api/jobs", params={"keyword": "后端"})
    body = response.json()
    assert body["total"] == 1 and body["items"][0]["company"] == "A公司"
    response = client.get("/api/jobs", params={"page": 2, "page_size": 1})
    assert response.json()["total"] == 2 and len(response.json()["items"]) == 1


def test_scrape_demo_source(client):
    response = client.get("/api/jobs/meta/sources")
    names = [source["name"] for source in response.json()]
    assert "demo" in names

    response = client.post("/api/jobs/scrape", json={"source": "demo", "limit": 100})
    body = response.json()
    assert body["created"] > 0

    # 再次抓取应全部去重
    response = client.post("/api/jobs/scrape", json={"source": "demo", "limit": 100})
    assert response.json()["created"] == 0

    # 未知抓取源返回 400
    assert client.post("/api/jobs/scrape", json={"source": "nope"}).status_code == 400


def test_search_across_jobs(client):
    client.post("/api/jobs", json={"title": "算法工程师", "company": "C公司", "description": "机器学习"})
    response = client.get("/api/search", params={"q": "机器学习"})
    body = response.json()
    assert len(body["jobs"]) == 1 and body["jobs"][0]["company"] == "C公司"


def test_stats(client):
    client.post("/api/jobs", json={"title": "算法工程师", "company": "C公司"})
    response = client.get("/api/stats")
    body = response.json()
    assert body["job_count"] == 1 and body["open_job_count"] == 1
    assert body["resume_count"] == 0


def test_settings_roundtrip(client):
    config = LLMConfig(base_url="https://api.example.com/v1", api_key="sk-test", model="test-model")
    response = client.put("/api/settings/llm", json=config.model_dump())
    assert response.status_code == 200
    response = client.get("/api/settings/llm")
    assert response.json()["model"] == "test-model"

    # 测试连接：未填配置或配置无效时应友好返回而非抛 500
    response = client.post("/api/settings/llm/test", json=LLMConfig().model_dump())
    assert response.status_code == 200 and response.json()["ok"] is False


def test_generate_requires_profile_and_llm(client):
    # 无资料、无 LLM 配置时生成接口应给出明确的 400 提示
    client.post("/api/jobs", json={"title": "后端开发工程师", "company": "A公司"})
    response = client.post("/api/resumes/generate", json={"job_id": 1})
    assert response.status_code == 400
