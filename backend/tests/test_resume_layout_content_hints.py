# SPDX-License-Identifier: Apache-2.0
"""W09 内容精简候选：版面诊断响应里的低相关要点提示（content_hints）。

fixture 覆盖三件事：有岗位时能给出可定位的提示；信息不足（没有岗位/没有稳定 id）时
返回空列表；旧响应结构（diagnosis/fit_ladder/fit_room）逐字不变。判据是本地确定性计算
（复用岗位相关性打分），不调模型、不落库。
"""

from __future__ import annotations

from app.schemas.resume_document import OBJECT_ID_PATTERN
from tests.document_test_support import entries_of

MEASURE = {"measure": {"used_height": 120.0, "page_content_height": 260.0}}


def _create_job(client) -> dict:
    response = client.post(
        "/api/jobs",
        json={
            "title": "后端开发工程师",
            "company": "示例公司",
            "description": "熟练掌握 Python、MySQL，负责后端接口与分布式系统开发",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_resume(client, content: dict, job_id: int | None = None) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={"job_id": job_id, "title": "内容精简测试", "content": content, "draft": False},
    )
    assert response.status_code == 201, response.text
    return int(response.json()["id"])


def _analyze(client, resume_id: int) -> dict:
    response = client.post(f"/api/resumes/{resume_id}/layout/analyze", json=MEASURE)
    assert response.status_code == 200, response.text
    return response.json()


def _content() -> dict:
    return {
        "name": "张示例",
        "summary": "后端开发经验",
        "experience": [
            {
                "id": "expobj0001",
                "company": "示例科技",
                "role": "后端工程师",
                "description": [
                    "使用 Python 开发订单系统的后端接口",
                    "负责组织年会与团建活动",
                ],
                "point_ids": {"description": ["point0001", "point0002"]},
            }
        ],
    }


def test_content_hints_are_empty_without_a_target_job(client):
    resume_id = _create_resume(client, _content())
    payload = _analyze(client, resume_id)
    assert payload["content_hints"] == []
    # 旧字段一个不少（旧客户端不读 content_hints 也不受影响）。
    assert {"diagnosis", "fit_ladder", "fit_room"} <= set(payload)


def test_content_hints_flag_the_low_relevance_point(client):
    job = _create_job(client)
    resume_id = _create_resume(client, _content(), job_id=job["id"])
    payload = _analyze(client, resume_id)

    hints = payload["content_hints"]
    assert hints, payload
    # 只提示无关的那条；命中 Python/后端的要点不提示。
    assert len(hints) == 1, hints
    hint = hints[0]
    assert hint["kind"] == "low_relevance"
    assert hint["section"] == "experience"
    assert hint["object_id"] == "expobj0001"
    assert hint["point_field"] == "description"
    assert hint["point_id"] == "point0002"
    assert "团建" in hint["evidence"][0]
    assert any("岗位关键词" in line for line in hint["evidence"])
    assert hint["reason"]


def test_entries_without_ids_get_stable_ids_and_hints(client):
    """v2 存储总会归一化出稳定 id：旧语义「没有 id 就不提示」在 v2 下已不存在。

    改成钉 v2 等价性质：输入无 id → 转换后条目/要点仍有 W01 合法 id，且 hint 的
    object_id/point_id 指向这些稳定 id（不再是空）。
    """
    job = _create_job(client)
    content = _content()
    content["experience"][0].pop("id")
    content["experience"][0].pop("point_ids")
    resume_id = _create_resume(client, content, job_id=job["id"])
    stored = client.get(f"/api/resumes/{resume_id}").json()["content"]
    entry = entries_of(stored, "experience")[0]
    assert OBJECT_ID_PATTERN.fullmatch(entry["id"])
    text_ids = [item["id"] for item in entry["items"] if item["kind"] == "text"]
    assert all(OBJECT_ID_PATTERN.fullmatch(item_id) for item_id in text_ids)

    payload = _analyze(client, resume_id)
    hints = payload["content_hints"]
    assert hints, payload
    assert hints[0]["object_id"] == entry["id"]
    assert hints[0]["point_id"] in text_ids


def test_content_hints_are_deterministic_and_capped(client):
    job = _create_job(client)
    skills = [
        {"id": f"skill000{i}", "name": name, "level": "熟练"}
        for i, name in enumerate(
            [
                "插花",
                "烘焙",
                "摄影",
                "徒步",
                "围棋",
                "书法",
                "园艺",
                "陶艺",
                "游泳",
                "骑行",
                "钓鱼",
                "露营",
                "剪纸",
                "茶艺",
                "香道",
            ],
            start=1,
        )
    ]
    content = {"name": "张示例", "summary": "一段总结", "skills": skills}
    resume_id = _create_resume(client, content, job_id=job["id"])

    first = _analyze(client, resume_id)["content_hints"]
    second = _analyze(client, resume_id)["content_hints"]
    assert first == second
    assert 0 < len(first) <= 10
    assert all(item["kind"] == "low_relevance" for item in first)
    assert all(item["section"] == "skills" for item in first)
    assert all(item["point_field"] is None and item["point_id"] is None for item in first)
