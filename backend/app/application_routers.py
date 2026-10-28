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
    ai_tasks,
    analytics,
    apply,
    assistant,
    assistant_proposals,
    ats,
    attachments,
    candidate_jobs,
    career_scenarios,
    claims,
    datasets,
    drill,
    interview,
    interview_answer_review,
    interview_experiences,
    interview_history,
    job_match,
    jobs,
    jobs_analysis,
    knowledge,
    manual_backups,
    materials,
    profile,
    profile_definitions,
    profile_facts,
    profile_groups,
    profile_workspace,
    referrals,
    reminders,
    resume_risk,
    resume_writing,
    resumes,
    search,
    settings_llm_global,
    settings_locale,
    share_packages,
    skills,
    stats,
    tracker,
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
    jobs.router,
    jobs_analysis.router,
    resumes.router,
    resume_writing.router,
    # A1/A3：职业场景与补充事实（独立前缀，不与 /api/resumes、/api/profile 抢路径）。
    career_scenarios.router,
    profile_facts.router,
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
    assistant_proposals.router,
    trash.router,
    # 附件预览（PDF 首页渲染）：独立前缀 /api/attachments，与识别链路无耦合。
    attachments.router,
    user_files.router,
    manual_backups.router,
)


def install_routers(app: FastAPI) -> None:
    """按固定顺序注册全部子路由（顺序有意义，见 ROUTERS 内的行内注释）。"""
    for router in ROUTERS:
        app.include_router(router)
