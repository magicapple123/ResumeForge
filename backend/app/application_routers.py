# SPDX-License-Identifier: Apache-2.0
"""路由装配：把 app/api 下的全部子路由按固定注册顺序装进 FastAPI 应用。

**为什么从 application.py 拆出来**（计划 §10.1 的等价拆分，F0）：application.py 同时
承担生命周期、日志、中间件、异常处理与静态资产挂载，接入 3 个资料大字段路由后越过
500 行生产代码预算（test_file_size_budget 守卫）。把 import 与注册元组原样搬到这里后，
注册顺序成为一份可整体审阅的清单，application.py 只负责调用。

**行为必须等价**：本文件只做位置搬迁——导入顺序、元组顺序、行内顺序约束注释都与
拆分前逐字一致；install_routers() 在 application.py 中的调用时机不变。
"""

from __future__ import annotations

from fastapi import FastAPI

from .api import (
    agent_tasks,
    ai_tasks,
    analytics,
    apply,
    assistant,
    assistant_breadth,
    assistant_memory,
    assistant_permission,
    assistant_proposal_status,
    assistant_proposals,
    assistant_side_ask,
    assistant_skill_learning,
    assistant_tools_api,
    ats,
    attachments,
    candidate_jobs,
    career_scenarios,
    claims,
    datasets,
    drill,
    external_resumes,
    followups,
    interview,
    interview_answer_review,
    interview_experiences,
    interview_history,
    job_favorites,
    job_import_url,
    job_match,
    job_preferences,
    jobs,
    jobs_analysis,
    knowledge,
    manual_backups,
    materials,
    profile,
    profile_definitions,
    profile_groups,
    profile_workspace,
    referrals,
    reminders,
    resume_risk,
    resume_writing,
    resumes,
    search,
    settings_embedding,
    settings_embedding_profiles,
    settings_llm_global,
    settings_locale,
    share_packages,
    skills,
    stats,
    tracker,
    transcribe,
    trash,
    user_files,
    webform,
)
from .api import (
    font_builtin as font_builtin_api,
)
from .api import (
    fonts as fonts_api,
)
from .api import (
    glossary_routes as glossary_api,
)
from .api import (
    outbound as outbound_api,
)
from .api import (
    provenance as provenance_api,
)
from .api import (
    resume_phrases as resume_phrases_api,
)
from .api import (
    resume_templates as resume_templates_api,
)
from .api import (
    review_annotations_routes as review_annotations_api,
)
from .api import (
    settings as settings_api,
)
from .api import (
    system as system_api,
)
from .api import (
    update as update_api,
)
from .api import (
    usage as usage_api,
)

ROUTERS = (
    # 批量匹配的 `/match-batches` 是岗位路由下的字面量路径，必须先于 jobs.router
    # 的 `/{job_id}` 参数路径注册，否则 FastAPI 会把它尝试解析成整数并返回 422。
    job_match.router,
    # 通用 AI 任务（0068）：独立前缀 /api/ai-tasks，不与其他前缀抢路径。
    ai_tasks.router,
    agent_tasks.router,  # T19：Agent 任务多步计划（独立前缀 /api/agent-tasks）。
    # 期一 T04：跟进巡检决策（独立前缀 /api/followups，不与 /api/agent-tasks 抢路径）。
    followups.router,
    # #28：/api/jobs/favorites* 是 /api/jobs/{job_id} 的字面量兄弟，必须先于 jobs.router
    # 注册，否则会被参数段吞掉（同上面 job_match 的 /match-batches）。
    job_favorites.router,
    # #16 链接导入：独立前缀 /api/jobs/import/from-url，不与 /import、/{job_id} 抢路径。
    job_import_url.router,
    jobs.router,
    jobs_analysis.router,
    resumes.router,
    # 第 21 条：外部简历（只读快照）独立前缀 /api/external-resumes；与 /api/resumes
    # 完全隔离（两表 id 空间独立，不进制作台/导出/版式）。
    external_resumes.router,
    resume_writing.router,
    # A1：职业场景（独立前缀，不与 /api/resumes、/api/profile 抢路径）。
    career_scenarios.router,
    # F1 资料大字段/组（存储层）：/api/profile/workspace|groups|sections|field-preferences。
    # 与 profile.router（/api/profile、/photos、/parse-text…）同前缀但路径互不重叠。
    profile_workspace.router,
    profile_groups.router,
    profile_definitions.router,
    # 全局 AI 润色：前缀是 /api/writing，与上面那条 /api/resumes 不冲突。
    resume_writing.selection_router,
    resume_risk.router,
    ats.router,
    resume_templates_api.router,
    profile.router,
    materials.router,
    knowledge.router,
    candidate_jobs.router,
    claims.router,
    drill.router,
    # 历史路由必须排在 interview.router 之前：它用 /question-banks、/reviews 字面量段，
    # 排在后面会被 interview 的 /{session_id} 参数段抢走。
    interview_history.router,
    interview_answer_review.router,
    interview.router,
    interview_experiences.router,
    reminders.router,
    referrals.router,
    analytics.router,
    apply.router,
    apply.collect_router,
    webform.router,
    tracker.router,
    settings_api.router,
    # RAG v3：语义检索 provider 配置（/api/settings/embedding/*，独立前缀）。
    settings_embedding.router,
    # 同前缀的命名配置写端点（/api/settings/embedding/profiles*）。原先由
    # settings_embedding 内部 include，父子互相依赖形成 2 模块兄弟环；改由装配层
    # 直接挂载后两个模块只剩单向惰性依赖（环复测：含 app.api 的 SCC = 0）。
    settings_embedding_profiles.router,
    settings_llm_global.router,
    settings_locale.router,
    # 必须排在 fonts_api 之前：fonts_api 有 DELETE/PATCH /fonts/{name} 的参数段，
    # 先注册的话 `GET|DELETE /fonts/builtin` 会被它当成"操作一个叫 builtin 的字体"。
    font_builtin_api.router,
    fonts_api.router,
    datasets.router,
    skills.router,
    search.router,
    share_packages.router,
    stats.router,
    system_api.router,
    update_api.router,
    # W12/R04 后端契约：独立前缀 /api/provenance、/api/usage、/api/outbound。
    provenance_api.router,
    usage_api.router,
    outbound_api.router,
    # W17 私有表达资产：独立前缀 /api/resume-phrases（本地操作，不外发）。
    resume_phrases_api.router,
    # W18 离线对象批注：/api/share-packages/{id}/annotations 与 /api/resume-annotations。
    review_annotations_api.router,
    # W16 数据集级术语表：独立前缀 /api/glossary-terms。
    glossary_api.router,
    assistant.router,
    # #31C 助手语义记忆（前缀 /api/assistant/memories，路径不与 assistant.router 重叠）。
    assistant_memory.router,
    # #31D/E/F 技能学习（前缀 /api/assistant/skills/learning）：字面量段必须先于
    # assistant.router 的 /skills/{id} 参数段注册，否则会被参数段吞掉。
    assistant_skill_learning.router,
    # T11 数据权限全局默认（前缀同 /api/assistant，路径 /permission）。
    assistant_permission.router,
    assistant_proposals.router,
    # #27E 投投「顺便问」：一次性、不落库、不调工具的问答端点（/api/assistant/side-ask）。
    assistant_side_ask.router,
    # T01：写操作提案状态列表（前缀同 /api/assistant，路径 /write-proposals 与
    # /write-proposals/{id} 不冲突）。
    assistant_proposal_status.router,
    # #38 工具清单：`GET /api/assistant/tools` 单独一个模块（assistant.py 已贴 500 行预算），
    # 前缀同 /api/assistant，路径 /tools 与既有 /conversations/* 不重叠。
    assistant_tools_api.router,
    # 18B/18C：今日简报与多视角（/api/assistant/digest*、/personas、conversations/{id}/persona）。
    assistant_breadth.router,
    # 期二 求职偏好档（/api/job-preferences，独立前缀；与 /api/assistant 不抢路径）。
    job_preferences.router,
    trash.router,
    # 附件预览（PDF 首页渲染）：独立前缀 /api/attachments，与识别链路无耦合。
    attachments.router,
    user_files.router,
    manual_backups.router,
    # W4 语音听写：独立前缀 /api/transcribe 与 /api/settings/asr（配置 + 转写 + 状态）。
    transcribe.router,
)


def install_routers(app: FastAPI) -> None:
    """按固定顺序注册全部子路由（顺序有意义，见 ROUTERS 内的行内注释）。"""
    for router in ROUTERS:
        app.include_router(router)
