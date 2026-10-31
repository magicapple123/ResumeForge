# SPDX-License-Identifier: Apache-2.0
"""R6：生成时定下的版式覆盖（字号系数）必须跟着简历落库；板块顺序只进 v2 文档。

T7 起分区顺序的唯一真相是 `document.sections`：`format_config.section_order` 只在
v1→v2 转换时被 converter 消费一次，**不再落库**（见 `test_resume_section_order_materialize.py`）。
本文件因此改为钉两件事：样式域覆盖（`font_scale_adjust` 等）照旧跟随记录；顺序落到
文档的 sections 里。

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
                # 顺序故意与内置默认相反：用它证明 converter 真的按请求顺序落位。
                "section_order": ["summary", "projects"],
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
    # T7：section_order 不再落库；顺序落到 v2 文档 sections（converter 单测覆盖落位规则）。
    assert "section_order" not in config
    keys = [section["key"] for section in record["content"]["sections"]]
    assert keys, "生成文档不应为空"
    assert config["font_scale_adjust"] == 0.455
    # 未知键与越界值在落库前就被丢掉：存下来的必须是"渲染时真的生效"的那一份。
    assert "page_padding" not in config
    assert "evil_key" not in config


def test_generation_without_format_config_uses_profile_order_for_sections_only(
    client, monkeypatch
):
    """不传 `format_config` 时，资料顺序只用于决定 v2 文档的分区落位，不再写进记录。

    T7 之前这里断言 `format_config.section_order` 被"物化"；v2 之后分区顺序的唯一真相是
    `document.sections`，格式配置不再当第二真相（结构页签改了顺序，旧键就会失真）。
    """
    _seed_profile(client)
    # 资料顺序与内置默认不同，才需要物化（相同的情形见下一个用例）。
    assert (
        client.patch(
            "/api/profile",
            json={
                "section_order": [
                    "basic_info",
                    "projects",
                    "educations",
                    "experiences",
                    "skills",
                    "campus_experiences",
                    "awards",
                    "summary",
                ]
            },
        ).status_code
        == 200
    )
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
    keys = [section["key"] for section in record["content"]["sections"]]
    assert keys, "生成文档不应为空"


def test_generation_with_old_default_profile_order_still_lands_in_document_sections(
    client, monkeypatch
):
    """资料页（旧七分区）默认顺序 → 只影响文档 sections 落位，不写 format_config。

    W14/A4 之前这里断言"物化一份显式顺序"；T7 起记录不再写 section_order，
    文档 sections 才是唯一真相。
    """
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
    keys = [section["key"] for section in record["content"]["sections"]]
    assert keys, "生成文档不应为空"


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
