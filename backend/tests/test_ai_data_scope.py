# SPDX-License-Identifier: Apache-2.0
"""#35：AI 数据边界审计——四个入口都必须声明 input_scope / masked / language / budget。

判据来自修复手册 §#35：「补 4 个入口实测；统一 input_scope/masked/language/budget 记录」。
本文件是**代码侧**的把关：
1. 四个入口（后台 AI 任务、HTTP 中间件、助手对话、设置自检）在调用链上真的设置了
   scope（读源码 AST/文本断言，仿 test_detail_copy.py 的手法）；
2. 路径 → 范围映射有明确结论（未登记路径 = unspecified，而不是空）；
3. provider 记账时把四字段写进审计日志（缺声明 = missing，便于筛出漏配入口）。
真实模型调用的人工实测表见 deliverables/software-company/ai-data-boundary-audit-2026-11-01.md。
"""

from pathlib import Path

import pytest
from app.services.llm.usage_tasks import (
    ambient_scope,
    scope_for_path,
    set_ambient_scope,
    set_ambient_task,
)

BACKEND = Path(__file__).resolve().parents[1]


def _read(relative: str) -> str:
    return (BACKEND / relative).read_text(encoding="utf-8")


def test_background_runner_declares_scope() -> None:
    source = _read("app/services/ai_task_runner.py")
    assert "set_ambient_scope(" in source
    for kind in ("resume_generate", "job_analysis", "job_match", "resume_risk", "webform_fill"):
        assert f'"{kind}":' in source, f"{kind} 缺输入范围声明"


def test_middleware_declares_scope() -> None:
    source = _read("app/middleware/dataset_request.py")
    assert "set_ambient_scope(" in source
    assert "scope_for_path(" in source


def test_assistant_declares_scope_with_relaxed_masking() -> None:
    source = _read("app/api/assistant.py")
    assert "set_ambient_scope(" in source
    # 放宽模式开 = 不脱敏，这是 #35 审计表里「脱敏」一列的口径。
    assert "masked=not relaxed_mode" in source


def test_settings_probe_declares_minimal_scope() -> None:
    source = _read("app/api/settings.py")
    assert 'input_scope="none"' in source


def test_scope_roundtrip_and_default() -> None:
    # 未设置时返回空 dict（审计日志里记 missing，而不是假装"已脱敏"）。
    set_ambient_scope(input_scope="x", masked=True)  # 先写一次证明可覆写
    assert ambient_scope()["input_scope"] == "x"
    set_ambient_scope(input_scope="resume+job", masked=False, language="en-US", budget=8000)
    scope = ambient_scope()
    assert scope == {
        "input_scope": "resume+job",
        "masked": False,
        "language": "en-US",
        "budget": 8000,
    }


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/api/resumes/12/generate", "resume+profile+job"),
        ("/api/jobs/3/analysis", "job"),
        ("/api/assistant/chat", "assistant_context"),
        ("/api/webform/fill", "profile+webform"),
        ("/api/settings/llm/test", "none"),
        ("/api/interview/7/answers", "resume+job+interview_material"),
        ("/api/drill/9", "claim+profile"),
        # 真实模型验收发现：双语翻译入口此前落 unspecified。
        ("/api/resumes/3/variants/2/translate", "resume+variant"),
        ("/api/unknown/whatever", "unspecified"),
    ],
)
def test_scope_for_path_mapping(path: str, expected: str) -> None:
    assert scope_for_path(path) == expected


def test_provider_audit_log_carries_four_fields(caplog) -> None:
    """provider 记账时输出结构化审计行：四字段齐全（缺声明会落 missing）。"""
    import logging
    import time

    from app.services.llm import base as llm_base

    class _Probe(llm_base.BaseLLMProvider):
        async def chat(self, messages, *, thinking=True):  # pragma: no cover - 不发起请求
            return ""

        async def stream_chat(self, messages, *, thinking=True):  # pragma: no cover
            yield ""

    config = llm_base.LLMConfig(base_url="http://127.0.0.1:9", api_key="k", model="audit-probe")

    set_ambient_task("job_analysis")
    set_ambient_scope(input_scope="job", masked=True, language="zh-CN", budget=2048)
    with caplog.at_level(logging.INFO, logger="app.services.llm.base"):
        provider = _Probe(config)
        provider._record_usage(
            started=time.monotonic(), finish_reason="stop", prompt_tokens=3, completion_tokens=5
        )
    joined = " ".join(record.getMessage() for record in caplog.records)
    assert "task=job_analysis" in joined
    assert "input_scope=job" in joined
    assert "masked=True" in joined
    assert "language=zh-CN" in joined
    assert "budget=2048" in joined


# ===== A1/A2（2026-11-01 返工）：四字段必须有值，面试/深挖不再落 unspecified =====


def test_middleware_defaults_declare_language_and_budget() -> None:
    """中间件默认值不再留空：空串/null 会让审计分不清「没声明」与「不限制」。"""
    source = _read("app/middleware/dataset_request.py")
    assert "DEFAULT_AUDIT_LANGUAGE" in source
    assert "DEFAULT_AUDIT_BUDGET" in source
    assert 'language=""' not in source
    assert "budget=None" not in source


def test_generate_entry_declares_language_and_budget() -> None:
    source = _read("app/api/resumes/generate_routes.py")
    assert "language=payload.options.language" in source
    assert "generation_token_budget(payload.options)" in source


def test_job_analysis_declares_language_and_budget() -> None:
    source = _read("app/api/jobs_analysis.py")
    assert "set_ambient_scope(" in source
    assert "JOB_ANALYSIS_TOKEN_BUDGET" in source
    # 后台任务入口（/api/ai-tasks kind=job_analysis）走 runner 的 kind → 预算映射。
    runner = _read("app/services/ai_task_runner.py")
    assert "budget_for_ai_kind(kind)" in runner


def test_assistant_and_settings_probe_declare_budget() -> None:
    assistant = _read("app/api/assistant.py")
    assert "budget=DEFAULT_AUDIT_BUDGET" in assistant
    settings = _read("app/api/settings.py")
    assert "SETTINGS_PROBE_TOKEN_BUDGET" in settings
    assert settings.count("set_ambient_scope(") >= 2


def test_budget_for_ai_kind_never_returns_none() -> None:
    from app.services.llm.usage_tasks import (
        DEFAULT_AUDIT_BUDGET,
        JOB_ANALYSIS_TOKEN_BUDGET,
        budget_for_ai_kind,
    )

    assert budget_for_ai_kind("job_analysis") == JOB_ANALYSIS_TOKEN_BUDGET
    assert budget_for_ai_kind("resume_rewrite") == DEFAULT_AUDIT_BUDGET


def test_bilingual_translate_entry_is_audited() -> None:
    """双语翻译入口要有任务名与输入范围（真实模型验收发现它此前是 unknown/unspecified）。

    翻译只喂该变体正文 + 术语表；任务名复用已登记的 resume_translate（用量页有标签）。
    """
    from app.services.llm.usage_tasks import task_for_path

    assert scope_for_path("/api/resumes/3/variants/2/translate") == "resume+variant"
    assert task_for_path("/api/resumes/3/variants/2/translate") == "resume_translate"


def test_ai_entries_never_map_to_unspecified() -> None:
    """四个用户可触发的入口 + A2 的面试/深挖都必须能答出输入范围。"""
    for path in (
        "/api/resumes/generate",
        "/api/resumes/generate/tasks",
        "/api/jobs/3/analysis",
        "/api/assistant/conversations/1/messages",
        "/api/settings/llm/test",
        "/api/interview",
        "/api/interview/2/answers",
        "/api/drill",
    ):
        assert scope_for_path(path) != "unspecified", path
