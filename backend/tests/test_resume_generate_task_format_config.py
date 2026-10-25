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
from app.services.resume.resume_sections import DEFAULT_SECTION_ORDER
from tests.resume_generate_task_support import (
    SuccessfulProvider,
    _configure,
    _job,
    _seed_profile,
    _start_with_options,
    _wait_terminal,
)


def _materialized_order(translated: list[str]) -> list[str]:
    """资料顺序翻译结果 + 未被资料覆盖的分区按内置默认顺序追加（与实现同向的推导）。

    不在这里钉死分区数量：新增板块只要登记进 DEFAULT_SECTION_ORDER，期望值自动跟上。
    """
    return translated + [key for key in DEFAULT_SECTION_ORDER if key not in translated]


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
    # 数量从分区表推导：以后再加板块不会把这条断言变红（守卫在各分区的渲染测试里）。
    assert len(config["section_order"]) == len(DEFAULT_SECTION_ORDER)
    assert config["font_scale_adjust"] == 0.455
    # 未知键与越界值在落库前就被丢掉：存下来的必须是"渲染时真的生效"的那一份。
    assert "page_padding" not in config
    assert "evil_key" not in config


def test_generation_without_format_config_materializes_the_profile_order(client, monkeypatch):
    """不传 `format_config` 时，板块顺序按「我的资料」**物化**一次（P0-5），而不是留空。

    旧断言是 `== {}`（"这份简历没有自己的版式覆盖"）。P0-5 之后那种形态**不再想要**：
    卡片（「调整板块顺序」）与四个渲染器读的都是 `format_config.section_order`，留空就会
    出现"卡片显示内置默认、资料顺序只在生成那一刻临时生效"的两套结果，而"显示的顺序必须
    等于渲染的顺序"正是这条需求的目的。

    这里先把资料顺序调成与内置默认不同（项目在最前），再生成：期望值 = 资料顺序翻译成
    正文分区键的结果，即 ``projects → education → experience → skills → campus_experience
    → awards → summary``。
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
    assert record["format_config"] == {
        "section_order": _materialized_order(
            ["projects", "education", "experience", "skills", "campus_experience", "awards", "summary"]
        )
    }


def test_generation_materializes_missing_sections_at_the_end_when_profile_matches_the_old_default(
    client, monkeypatch
):
    """资料页（旧七分区）默认顺序 → 物化时把资料页无法表达的板块补在末尾。

    W14/A4 之前"资料顺序 == 内置默认就不写键"；现在资料页无法表达科研三栏目与资格证照，
    翻译结果不再等于内置默认，因此会写一份显式顺序——旧七项先后不变，新板块按默认顺序
    补在最后（期望值用 _materialized_order 推导，不在这里钉死板块数量）。
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
    assert record["format_config"]["section_order"] == _materialized_order(
        ["education", "experience", "projects", "skills", "campus_experience", "awards", "summary"]
    )


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
