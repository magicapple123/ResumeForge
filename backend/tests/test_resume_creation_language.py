# SPDX-License-Identifier: Apache-2.0
"""New records persist an explicitly selected language without altering content."""

import json

import pytest
from app.services.resume.resume_generate_runner import reset_resume_generate_runner
from tests.resume_generate_task_support import (
    SuccessfulProvider,
    _configure,
    _job,
    _seed_profile,
    _wait_terminal,
)


@pytest.mark.parametrize("language", ["zh-CN", "en-US", None])
def test_manual_creation_persists_language_and_keeps_old_default(client, language):
    content = {"name": "Alex", "summary": "Original content"}
    payload = {"title": "My Resume", "content": content}
    if language is not None:
        payload["language"] = language

    response = client.post("/api/resumes/manual", json=payload)

    assert response.status_code == 201, response.text
    record = response.json()
    assert record["language"] == (language or "zh-CN")
    assert record["content"]["summary"] == content["summary"]
    assert client.get(f"/api/resumes/{record['id']}").json()["language"] == (language or "zh-CN")


@pytest.mark.parametrize("language", ["en", "english", "", None])
@pytest.mark.parametrize("endpoint", ["/api/resumes/manual", "/api/resumes/generate/tasks"])
def test_creation_rejects_invalid_language(client, endpoint, language):
    payload = (
        {"content": {"name": "Alex"}, "language": language}
        if endpoint.endswith("manual")
        else {"options": {"language": language}}
    )
    assert client.post(endpoint, json=payload).status_code == 422
    assert client.get("/api/resumes").json()["total"] == 0


@pytest.mark.parametrize("language", ["en-US", None])
def test_background_generation_persists_language(client, monkeypatch, language):
    reset_resume_generate_runner()
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda config: SuccessfulProvider(config),
    )
    try:
        payload = {"job_id": job["id"], "options": {}}
        if language is not None:
            payload["options"]["language"] = language
        started = client.post("/api/resumes/generate/tasks", json=payload)
        assert started.status_code == 201, started.text
        task = _wait_terminal(client, started.json()["id"])
        assert task["status"] == "completed", task
        record = client.get(f"/api/resumes/{task['resume_id']}").json()
        assert record["language"] == (language or "zh-CN")
    finally:
        reset_resume_generate_runner()


def test_streaming_generation_persists_english_language(client, monkeypatch):
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    monkeypatch.setattr(
        "app.api.resumes.create_provider", lambda config: SuccessfulProvider(config)
    )

    response = client.post(
        "/api/resumes/generate",
        json={"job_id": job["id"], "options": {"language": "en-US"}},
    )

    assert response.status_code == 200
    events = [
        json.loads(line.removeprefix("data: "))
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]
    saved = next(event for event in events if event["type"] == "saved")
    assert client.get(f"/api/resumes/{saved['record_id']}").json()["language"] == "en-US"
