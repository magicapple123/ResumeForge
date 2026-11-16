# SPDX-License-Identifier: Apache-2.0
"""AI 调用的请求上下文：任务名 + 数据边界四字段 + 纯路径映射。

这里只放"这次调用属于哪个任务、喂了什么范围"的**上下文与映射**，一行数据库代码都没有：

- ``ContextVar`` 接口（:func:`set_ambient_task` / :func:`ambient_task` /
  :func:`set_ambient_scope` / :func:`ambient_scope`）；
- 纯路径映射（:func:`task_for_path` / :func:`scope_for_path`，以及 AI 任务 kind →
  任务名 / 预算的两张小表）。

为什么在 ``app/runtime``：HTTP 中间件（``app/middleware/dataset_request.py``）在每个
``/api/`` 请求入口写这两个 ContextVar，而中间件不该为了"打一个任务标签"反向依赖
``app/services/llm/usage_ledger``——那条回边的代价是中间件把整个账本（SQLAlchemy 模型、
单价、汇总）拉进每个请求的导入链。落库仍然在 ``services/llm``：
:func:`app.services.llm.usage_tasks.record_ambient_usage` 从这里读上下文，再交给账本写入。

**唯一一份实现**：``ContextVar`` 对象只在本模块创建一次，services 侧
（``usage_tasks`` / ``usage_ledger``）全部从这里取，所以中间件写的值和 provider 读的值
必然是同一个对象——不存在"两套 ContextVar 各自为政"。
"""

from __future__ import annotations

import contextvars
import re

# 任务类别（前端按这些值做分组；未知任务原样保留，不丢数据）。
TASK_RESUME_GENERATE = "resume_generate"
TASK_RESUME_REVISE = "resume_revise"
TASK_RESUME_SUGGESTIONS = "resume_suggestions"
TASK_RESUME_TRANSLATE = "resume_translate"
TASK_RESUME_OPTIMIZE = "resume_optimize"
TASK_ASSISTANT = "assistant"
TASK_UNKNOWN = "unknown"
TASK_RESUME_WRITING = "resume_writing"
TASK_RESUME_RISK = "resume_risk"
TASK_RESUME_SCENARIO = "resume_scenario"
TASK_JOB_PARSE = "job_parse"
TASK_JOB_ANALYSIS = "job_analysis"
TASK_JOB_MATCH = "job_match"
TASK_INTERVIEW = "interview"
TASK_WEBFORM = "webform"
TASK_CLAIMS = "claims"
TASK_TRACKER = "tracker"
TASK_PROFILE_PARSE = "profile_parse"
TASK_DRILL = "drill"
TASK_APPLY = "apply"
TASK_TEMPLATE = "resume_template"
# 设置页的「测试连接 / 思考能力检测」会真的发一次最小请求（R40）：这类消耗也必须可见，
# 但它不是用户对某个 AI 功能的使用，单独给一个任务名，避免混进业务任务的统计里。
TASK_SETTINGS_PROBE = "settings_probe"


# ===== 环境任务（R04-补全）：按请求路径确定任务名，provider 每次调用自动落账 =====
#
# 为什么需要在 provider 层兜底：AI 端点分散在生成（SSE/后台任务）、写作增强、岗位解析/
# 匹配、面试、网申、台账、解析等二十余条路径上，逐端点手写记录既容易漏（本轮实测 27 次
# 真实调用只落了 1 条修订记录），也无法覆盖服务层内部的二次调用。这里把"调用发生"的
# 事实收敛成 provider._record_usage() 的一次统一上报：任务名由 HTTP 中间件按路径写入
# 上下文（ContextVar），后台线程（生成任务/批量匹配）启动时复制启动方 contextvars，
# 因此同样能取到任务名。没有环境任务的调用（例如 llm 层单测直接构造 provider）不落账，
# 避免测试污染与"测试连接"之外的意外写入。
_AMBIENT_TASK: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "rf_llm_usage_task", default=None
)


def set_ambient_task(task: str | None) -> None:
    """由 HTTP 中间件/后台运行器在调用链开始处写入本次 AI 任务名。"""
    _AMBIENT_TASK.set(task)


def ambient_task() -> str | None:
    return _AMBIENT_TASK.get()


# ===== #35：AI 数据边界四字段（入口 → 范围 → 脱敏 → 语言/预算）=====
#
# 审计口径：每一次 AI 调用都该能回答四件事——喂了什么范围的数据（input_scope）、
# 是否脱敏（masked）、目标语言（language）、预算上限（budget）。与任务名同源
# （ContextVar，后台线程复制启动方 context），记账时随任务名一并写进审计日志。
_AMBIENT_SCOPE: contextvars.ContextVar[dict[str, object] | None] = contextvars.ContextVar(
    "rf_llm_usage_scope", default=None
)

# #35/A1：入口没显式声明「目标语言 / token 预算」时的审计兜底值。
#
# 为什么必须有兜底：审计要能区分「没声明」与「不限制」，null/空串会让四个入口的
# 记录看起来一样；而用户实际触发的每一次调用都该能回答"喂了什么、给谁看、多少预算"。
# - language 取应用默认界面语言（前端 DEFAULT_LOCALE = zh-CN）。声明了目标语言的
#   入口在调用点覆盖（简历生成按 options.language、助手按用户保存的界面语言）。
# - budget 是本次请求的 **token 预算声明**（审计列），不是硬截断：真正的硬约束是
#   provider 的 max_tokens 配置与整链时间预算。各入口按输出形态覆盖更贴切的值。
DEFAULT_AUDIT_LANGUAGE = "zh-CN"
DEFAULT_AUDIT_BUDGET = 4096
# 岗位解读的输出只有总结 + 要求 + 建议三段，按 2k token 声明足够。
JOB_ANALYSIS_TOKEN_BUDGET = 2048
# 设置自检只发最小探测请求（"只回复两个字"），64 是提示词与回复的合计上界口径。
SETTINGS_PROBE_TOKEN_BUDGET = 64


def set_ambient_scope(
    *,
    input_scope: str,
    masked: bool,
    language: str = "",
    budget: int | None = None,
) -> None:
    """由入口在调用链开始处写入数据边界四字段（缺省空/None = 未声明，审计表会标出）。"""
    _AMBIENT_SCOPE.set(
        {
            "input_scope": input_scope,
            "masked": masked,
            "language": language,
            "budget": budget,
        }
    )


def ambient_scope() -> dict[str, object]:
    """当前上下文的数据边界四字段；未设置时返回空 dict（审计日志里如实记 missing）。"""
    return dict(_AMBIENT_SCOPE.get() or {})


def scope_for_path(path: str) -> str:
    """#35：HTTP 路径 → 输入范围声明（审计表「入口 → 范围」列；未知路径记 unspecified）。"""
    if path.startswith("/api/resumes/") and "generate" in path:
        return "resume+profile+job"
    # 双语变体的翻译候选/采纳：只喂该变体正文 + 术语表（本轮真实模型验收发现的
    # audit 缺口：该路径此前落成 unspecified）。
    if "/variants/" in path:
        return "resume+variant"
    if path.startswith("/api/jobs/"):
        return "job"
    if path.startswith("/api/assistant/"):
        return "assistant_context"
    if path.startswith("/api/webform/"):
        return "profile+webform"
    if path.startswith("/api/settings/"):
        return "none"
    # A2：面试只喂简历 + 岗位 + 用户选定的面试材料；深挖只喂事实台账 + 个人资料。
    if path.startswith("/api/interview"):
        return "resume+job+interview_material"
    if path.startswith("/api/drill"):
        return "claim+profile"
    return "unspecified"


# 路径 → 任务名（只做前缀/正则匹配；未列出的 /api 路径记 unknown，非 API 不落账）。
# 顺序即优先级：更具体的写在前面。
_TASK_ROUTES: tuple[tuple[str, str | None], ...] = (
    (
        r"^/api/resumes/\d+/writing/(star|phrases|polish|rewrite-field|translate)$",
        TASK_RESUME_WRITING,
    ),
    (r"^/api/writing/polish-selection$", TASK_RESUME_WRITING),
    (r"^/api/resumes/\d+/suggestions$", TASK_RESUME_SUGGESTIONS),
    # /revise 由端点手工记账（需要 resume_id 关联），这里返回 None 让自动记账让路。
    (r"^/api/resumes/\d+/revise$", None),
    (r"^/api/resumes/\d+/risk-scan$", TASK_RESUME_RISK),
    (r"^/api/resumes/\d+/variants/\d+/translate$", TASK_RESUME_TRANSLATE),
    (r"^/api/resumes/\d+/scenario-variants", TASK_RESUME_SCENARIO),
    (r"^/api/resumes/generate($|/)", TASK_RESUME_GENERATE),
    (r"^/api/interview", TASK_INTERVIEW),
    (r"^/api/jobs/parse-(text|multiple)$", TASK_JOB_PARSE),
    (r"^/api/jobs/\d+/analysis$", TASK_JOB_ANALYSIS),
    (r"^/api/jobs/\d+/match-analysis$", TASK_JOB_MATCH),
    (r"^/api/jobs/match-batch", TASK_JOB_MATCH),
    (r"^/api/job-match", TASK_JOB_MATCH),
    (r"^/api/webform", TASK_WEBFORM),
    (r"^/api/claims/draft$", TASK_CLAIMS),
    (r"^/api/tracker/parse$", TASK_TRACKER),
    (r"^/api/profile/parse-text$", TASK_PROFILE_PARSE),
    (r"^/api/drill", TASK_DRILL),
    (r"^/api/apply/greeting", TASK_APPLY),
    (r"^/api/resume-templates", TASK_TEMPLATE),
    (r"^/api/assistant", TASK_ASSISTANT),
)


# 统一 AI 任务（``/api/ai-tasks``，kind 见 ``models/ai_task.py``）→ 用量任务名。
# 这些任务的 handler 在后台线程里真的调模型，但请求路径本身没有业务语义——不映射的话
# 全部记成 unknown。映射放账本侧（本模块），任务执行器与模型层都不用认识这张表。
# ``resume_rewrite`` 是「岗位化优化建议」的生成（前端 suggestionScanStore），归到建议，
# 不新开任务名，保持「按任务」视图的类别不膨胀。
_AI_KIND_TO_TASK: dict[str, str] = {
    "resume_generate": TASK_RESUME_GENERATE,
    "job_match": TASK_JOB_MATCH,
    "job_analysis": TASK_JOB_ANALYSIS,
    "resume_risk": TASK_RESUME_RISK,
    "resume_rewrite": TASK_RESUME_SUGGESTIONS,
    "webform_fill": TASK_WEBFORM,
}


def task_for_ai_kind(kind: str) -> str:
    """统一 AI 任务 kind → 用量任务名；未登记的 kind 按 unknown 落账（不丢数据）。"""
    return _AI_KIND_TO_TASK.get(kind, TASK_UNKNOWN)


# #35/A1：后台任务 kind → token 预算声明。与上面的任务名映射同源（kind 是同一套枚举），
# 未登记的 kind 用默认预算，避免出现 budget=None 的审计空洞。
_AI_KIND_TO_BUDGET: dict[str, int] = {"job_analysis": JOB_ANALYSIS_TOKEN_BUDGET}


def budget_for_ai_kind(kind: str) -> int:
    """kind → 本次调用的 token 预算声明（不是硬截断）。"""
    return _AI_KIND_TO_BUDGET.get(kind, DEFAULT_AUDIT_BUDGET)


def task_for_path(path: str) -> str | None:
    """HTTP 路径 → 任务名；非 /api 路径返回 None（不落账）。"""
    if not path.startswith("/api/"):
        return None
    # 设置页的「测试连接 / 思考能力检测」是配置自检，不是用户对 AI 功能的消耗，
    # 不进入用量统计（否则每点一次测试就会多一条记录）。
    if path.startswith("/api/settings/"):
        return None
    for pattern, task in _TASK_ROUTES:
        if re.search(pattern, path):
            return task
    return TASK_UNKNOWN


__all__ = [
    "TASK_APPLY",
    "TASK_ASSISTANT",
    "TASK_CLAIMS",
    "TASK_DRILL",
    "TASK_INTERVIEW",
    "TASK_JOB_ANALYSIS",
    "TASK_JOB_MATCH",
    "TASK_JOB_PARSE",
    "TASK_PROFILE_PARSE",
    "TASK_RESUME_GENERATE",
    "TASK_RESUME_OPTIMIZE",
    "TASK_RESUME_REVISE",
    "TASK_RESUME_RISK",
    "TASK_RESUME_SCENARIO",
    "TASK_RESUME_SUGGESTIONS",
    "TASK_RESUME_TRANSLATE",
    "TASK_RESUME_WRITING",
    "TASK_SETTINGS_PROBE",
    "TASK_TEMPLATE",
    "TASK_TRACKER",
    "TASK_UNKNOWN",
    "TASK_WEBFORM",
    "DEFAULT_AUDIT_BUDGET",
    "DEFAULT_AUDIT_LANGUAGE",
    "JOB_ANALYSIS_TOKEN_BUDGET",
    "SETTINGS_PROBE_TOKEN_BUDGET",
    "ambient_scope",
    "ambient_task",
    "budget_for_ai_kind",
    "scope_for_path",
    "set_ambient_scope",
    "set_ambient_task",
    "task_for_ai_kind",
    "task_for_path",
]
