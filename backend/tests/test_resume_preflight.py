# SPDX-License-Identifier: Apache-2.0
"""W11 统一检查：三层合并、分级映射、快照一致性、稳定 id。

文件命名：`tests/test_preflight.py` 已被"启动完整性检查"占用（另一个功能），本文件按被测模块
前缀命名，避免覆盖既有用例（与 test_resume_document_save.py 同一条命名理由）。

这组用例刻意走**真实 HTTP 端点**（而不是直接调 service）：W11 的价值一半在编排——
正文覆盖、版式覆盖、快照指纹、层选择都只在路由层才能验证。
"""

from __future__ import annotations

BASE = {
    "name": "张示例",
    "job_intent": "后端工程师",
    "summary": "五年后端开发经验",
    "experience": [
        {
            "company": "示例科技",
            "role": "后端工程师",
            "start_date": "2020-01",
            "end_date": "至今",
            "description": ["负责订单系统重构"],
        }
    ],
}


def _create(client, content: dict | None = None) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={"job_id": None, "content": content or BASE, "draft": False},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _preflight(client, record_id: int, **body):
    return client.post(f"/api/resumes/{record_id}/preflight", json=body)


def test_content_layer_flags_incomplete_marker_as_blocker(client):
    content = {**BASE, "summary": "负责【待补：具体指标】的系统重构"}
    record_id = _create(client, content)
    response = _preflight(client, record_id, layers=["content"])
    assert response.status_code == 200, response.text
    payload = response.json()
    issues = [issue for issue in payload["issues"] if issue["code"] == "incomplete_marker"]
    assert issues, payload["issues"]
    assert issues[0]["severity"] == "blocker"
    assert issues[0]["locator"]["scope"] == "section"
    assert issues[0]["locator"]["section"] == "summary"
    assert payload["summary"]["blocker"] >= 1
    assert payload["layers_run"] == ["content"]


def test_issue_id_is_stable_across_requests(client):
    content = {**BASE, "summary": "负责【待补：指标】的重构"}
    record_id = _create(client, content)
    first = _preflight(client, record_id, layers=["content"]).json()
    second = _preflight(client, record_id, layers=["content"]).json()
    assert [issue["id"] for issue in first["issues"]] == [issue["id"] for issue in second["issues"]]


def test_snapshot_changes_with_content_and_layout(client):
    record_id = _create(client)
    base = _preflight(client, record_id, layers=["content"]).json()
    changed = _preflight(
        client,
        record_id,
        layers=["content"],
        content={**BASE, "summary": "改过的总结"},
    ).json()
    assert changed["snapshot"]["content_sha256"] != base["snapshot"]["content_sha256"]
    layout_changed = _preflight(
        client, record_id, layers=["content"], layout={"page_limit": 2}
    ).json()
    assert (
        layout_changed["snapshot"]["render_config_sha256"]
        != base["snapshot"]["render_config_sha256"]
    )
    assert layout_changed["snapshot"]["page_limit"] == 2


def test_measure_overflow_maps_to_blocker(client):
    record_id = _create(client)
    payload = _preflight(
        client,
        record_id,
        layers=["layout"],
        measure={"used_height": 297.0, "page_content_height": 260.0},
        layout={"page_limit": 1},
    ).json()
    codes = {issue["code"] for issue in payload["issues"]}
    assert "layout_overflow" in codes
    overflow = [i for i in payload["issues"] if i["code"] == "layout_overflow"][0]
    assert overflow["severity"] == "blocker"
    assert overflow["fix"]["action"] == "open_layout_analyze"


def test_layout_layer_without_measure_says_so_instead_of_passing(client):
    record_id = _create(client)
    payload = _preflight(client, record_id, layers=["layout"]).json()
    codes = {issue["code"] for issue in payload["issues"]}
    assert "layout_no_measure" in codes
    assert "layout_overflow" not in codes


def test_risk_layer_without_model_is_not_reported_as_pass(client):
    record_id = _create(client)
    payload = client.post(
        f"/api/resumes/{record_id}/preflight",
        json={"layers": ["content", "risk"]},
    ).json()
    codes = {issue["code"] for issue in payload["issues"]}
    assert "model_not_configured" in codes
    assert "risk" in payload["layers_run"]


def test_product_layer_extracts_machine_text_and_keeps_hidden_out(client):
    content = {
        **BASE,
        "experience": [
            {
                "company": "示例科技",
                "role": "后端工程师",
                "description": ["负责订单系统重构"],
            },
            {
                "company": "隐藏公司",
                "role": "秘密岗位",
                "description": ["不该出现在产物里的隐藏内容"],
                "hidden": True,
            },
        ],
    }
    record_id = _create(client, content)
    response = _preflight(client, record_id, layers=["layout", "product"])
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["machine_text"], "产物层应当抽到至少一页文本"
    joined = "".join(page["text"] for page in payload["machine_text"])
    assert "负责订单系统重构" in joined
    assert "隐藏公司" not in joined
    assert "不该出现在产物里的隐藏内容" not in joined
    codes = {issue["code"] for issue in payload["issues"]}
    assert "product_hidden_leak" not in codes
    assert payload["font_coverage"] is not None


def test_ats_severity_mapping_uses_verify_not_blocker(client):
    record_id = _create(client)
    payload = _preflight(
        client,
        record_id,
        layers=["content"],
        jd_text="需要 Kubernetes 与 Go 语言经验",
    ).json()
    ats_issues = [issue for issue in payload["issues"] if issue["code"].startswith("ats_")]
    assert ats_issues, payload["issues"]
    assert all(issue["severity"] in {"verify", "suggestion"} for issue in ats_issues)
    assert payload["disclaimer"] == "本地规则估计，不代表真实 ATS 解析结果"


def test_capabilities_matrix_is_shipped_but_not_faked(client):
    record_id = _create(client)
    payload = _preflight(client, record_id, layers=["content"]).json()
    assert payload["capabilities"]["pdf"]["italic"] == "approx"
    assert payload["capabilities"]["pdf"]["link_clickable"] == "unsupported"
    assert payload["capabilities"]["docx"]["italic"] == "supported"
