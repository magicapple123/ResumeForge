# SPDX-License-Identifier: Apache-2.0
"""A stale tab's request must never mutate a different dataset with the same numeric ID."""

import logging

from app.runtime import dataset_scope


def _create(client, name):
    response = client.post("/api/settings/datasets", json={"name": name})
    assert response.status_code == 200, response.text
    dataset_id = response.json()["id"]
    switched = client.post(f"/api/settings/datasets/{dataset_id}/activate")
    assert switched.status_code == 200, switched.text
    created = client.post("/api/jobs", json={"title": name, "note": "original"})
    assert created.status_code == 201, created.text
    return dataset_id, created.json()["id"]


def test_stale_tab_cannot_write_matching_id_in_other_dataset(client):
    _, job_a = _create(client, "synthetic A")
    scope_a = client.get("/api/dataset-scope")
    assert scope_a.status_code == 200, scope_a.text
    token = scope_a.json()["scope"]
    _, job_b = _create(client, "synthetic B")
    assert job_a == job_b
    result = client.put(
        f"/api/jobs/{job_a}", json={"note": "stale draft"}, headers={"X-Dataset-Scope": token}
    )
    assert result.status_code == 409
    assert client.get(f"/api/jobs/{job_b}").json()["note"] == "original"
    assert dataset_scope.leases_pending() == 0


def test_scope_from_before_a_b_a_is_still_stale(client):
    dataset_a, job_id = _create(client, "synthetic ABA A")
    token = client.get("/api/dataset-scope").json()["scope"]
    _create(client, "synthetic ABA B")
    assert client.post(f"/api/settings/datasets/{dataset_a}/activate").status_code == 200
    response = client.delete(f"/api/jobs/{job_id}", headers={"X-Dataset-Scope": token})
    assert response.status_code == 409
    assert client.get(f"/api/jobs/{job_id}").status_code == 200


def test_browser_write_requires_initialized_scope(client):
    response = client.post(
        "/api/jobs", json={"title": "no bootstrap"}, headers={"X-ResumeForge-Client": "browser"}
    )
    assert response.status_code == 409
    assert client.get("/api/jobs").json()["total"] == 0


def test_scope_mismatch_reports_current_scope_and_logs_it(client, caplog):
    """409 必须自带"当前身份"和一条日志。

    没有响应头，页面只能整页刷新才能继续（用户看到的就是"切换数据集失败"）；
    没有日志，用户反馈的那串编号在后端查不到任何东西。
    """
    _, job_a = _create(client, "synthetic header A")
    stale = client.get("/api/dataset-scope").json()["scope"]
    _, job_b = _create(client, "synthetic header B")
    assert job_a == job_b
    current = client.get("/api/dataset-scope").json()["scope"]
    assert current != stale

    with caplog.at_level(logging.WARNING, logger="app.middleware.dataset_request"):
        response = client.put(
            f"/api/jobs/{job_a}",
            json={"note": "stale draft"},
            headers={"X-Dataset-Scope": stale},
        )

    assert response.status_code == 409
    assert response.json()["code"] == "dataset_scope_changed"
    # 客户端据此自助重同步：头里必须是**当前**身份，而不是它刚发来的旧 token。
    assert response.headers["X-Dataset-Scope"] == current
    assert "dataset scope mismatch" in caplog.text
    # 旧 token 也要落进日志：那是"页面手里拿的是哪份身份"的唯一线索。
    assert stale in caplog.text
    assert client.get(f"/api/jobs/{job_b}").json()["note"] == "original"
    assert dataset_scope.leases_pending() == 0
