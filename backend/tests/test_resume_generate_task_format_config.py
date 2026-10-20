# SPDX-License-Identifier: Apache-2.0
"""R6：生成时定下的版式覆盖（板块顺序 / 字号系数）必须跟着简历落库。

用户理由很直接：在生成界面把「项目经历」拖到最前、字号调到 5px，生成完关掉弹窗、
从简历中心重开，这两项都该还在。所以它们必须进 `format_config` 一起存，而不是只
停留在前端状态里。

从 ``test_resume_generate_task.py`` 拆出（行数预算）；请求辅助与假 Provider 共用
``tests/resume_generate_task_support.py``，用例名与断言原样保留。
"""

import pytest
from app.services.resume.resume_generate_runner import reset_resume_generate_runner
from tests.resume_generate_task_support import (
    SuccessfulProvider,
    _configure,
    _job,
    _seed_profile,
    _start_with_options,
    _wait_terminal,
)


@pytest.fixture(autouse=True)
def _isolate_runner(clean_db):
    """每个用例前释放运行器单例，避免上一个用例的后台线程跨用例残留。"""
    reset_resume_generate_runner()
    yield
    reset_resume_generate_runner()


def test_generation_persists_validated_format_config(client, monkeypatch):
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: SuccessfulProvider(resolved),
    )

    started = _start_with_options(
        client,
        job,
        {
            "format_config": {
                "section_order": ["projects", "summary"],
                # 5px / 最小档 11px ≈ 0.455：放宽后的下限必须能存下这个值。
                "font_scale_adjust": 0.455,
                "page_padding": 999,  # 越界 → 丢弃
                "evil_key": "x",  # 不在白名单 → 丢弃
            }
        },
    )
    assert started.status_code == 201

    final = _wait_terminal(client, started.json()["id"])
    assert final["status"] == "completed"

    record = client.get(f"/api/resumes/{final['resume_id']}").json()
    config = record["format_config"]
    # 顺序归一化成完整排列（缺的键由默认顺序补齐），而不是只存用户动过的那两项。
    assert config["section_order"][:2] == ["projects", "summary"]
    assert len(config["section_order"]) == 7
    assert config["font_scale_adjust"] == 0.455
    # 未知键与越界值在落库前就被丢掉：存下来的必须是"渲染时真的生效"的那一份。
    assert "page_padding" not in config
    assert "evil_key" not in config


def test_generation_without_format_config_stores_an_empty_override(client, monkeypatch):
    """不传 `format_config` 时存的仍是 `{}`：老简历那种"没有自己的版式覆盖"的形态。"""
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: SuccessfulProvider(resolved),
    )

    started = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]})
    final = _wait_terminal(client, started.json()["id"])
    record = client.get(f"/api/resumes/{final['resume_id']}").json()
    assert record["format_config"] == {}


@pytest.mark.parametrize(
    "bad_value",
    [
        ["section_order"],  # 不是对象
        "projects",  # 字符串
        {f"key_{index}": 1 for index in range(33)},  # 键数超上限
    ],
)
def test_generate_options_rejects_malformed_format_config(client, bad_value):
    """形状不对在入口就 422，而不是等落库时才发现——提示要出现在用户按下的那一刻。"""
    _seed_profile(client)
    _configure(client)
    job = _job(client)

    response = _start_with_options(client, job, {"format_config": bad_value})
    assert response.status_code == 422
