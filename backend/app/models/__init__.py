# SPDX-License-Identifier: Apache-2.0
"""集中导入全部模型，保证 Base.metadata 注册完整（create_all 依赖此注册）。"""

from .agent_task import (
    AGENT_TASK_RUNNING_STATUSES,
    AGENT_TASK_SOURCE_FOLLOWUP,
    AGENT_TASK_SOURCE_REF_STALLED_CONFIRM,
    AGENT_TASK_SOURCE_REF_STALLED_FOLLOWUP,
    AGENT_TASK_SOURCE_REFS,
    AGENT_TASK_SOURCES,
    AGENT_TASK_STATUSES,
    AGENT_TASK_STEP_STATUSES,
    AGENT_TASK_TERMINAL_STATUSES,
    AgentTask,
    AgentTaskStep,
)
from .ai_task import (
    AI_TASK_ACTIVE_STATUSES,
    AI_TASK_KINDS,
    AI_TASK_STATUS_CANCELED,
    AI_TASK_STATUS_FAILED,
    AI_TASK_STATUS_PENDING,
    AI_TASK_STATUS_RUNNING,
    AI_TASK_STATUS_SUCCEEDED,
    AI_TASK_STATUSES,
    AI_TASK_TERMINAL_STATUSES,
    AiTask,
)
from .apply import (
    ADMISSIONS,
    FAILURE_CATEGORIES,
    FAILURE_CATEGORY_LABELS,
    HARD_GATES,
    ITEM_STATUSES,
    MATCH_STATUSES,
    QUEUE_STATUSES,
    STOP_REASONS,
    TASK_KINDS,
    TASK_STATUSES,
    TASK_STEPS,
    ApplyQueueItem,
    ApplyTask,
    ApplyTaskItem,
    JobMatchAnalysis,
)
from .assistant import (
    AssistantSkill,
    AssistantSkillFile,
    AssistantWriteProposal,
    ChatConversation,
    ChatMessage,
)
from .assistant_memory import (
    MEMORY_KIND_AVOID_COMPANY,
    MEMORY_KIND_CITY,
    MEMORY_KIND_CONSTRAINT,
    MEMORY_KIND_LABELS,
    MEMORY_KIND_SALARY_FLOOR,
    MEMORY_KIND_SKILL_TAG,
    MEMORY_KIND_TARGET_ROLE,
    MEMORY_KIND_WORK_MODE,
    MEMORY_KINDS,
    MEMORY_SOURCE_EXTRACTED,
    MEMORY_SOURCE_MANUAL,
    MEMORY_SOURCES,
    MEMORY_STATUS_ACTIVE,
    MEMORY_STATUS_DELETED,
    MEMORY_STATUS_SUPERSEDED,
    MEMORY_STATUSES,
    AssistantMemory,
)
from .assistant_memory_event import AssistantMemoryEvent
from .career_scenario import CareerScenario
from .claim import (
    CLAIM_CATEGORIES,
    RESPONSIBILITY_LEVELS,
    VERIFICATION_STATUSES,
    ClaimRecord,
)
from .drill import (
    DRILL_STATUS_ACTIVE,
    DRILL_STATUS_FINISHED,
    EVIDENCE_STATUSES,
    REHEARSE_KINDS,
    DrillContract,
    DrillSession,
    DrillTurn,
)
from .external_resume import ExternalResume
from .followup import (
    FOLLOWUP_DECISION_CONTACTED,
    FOLLOWUP_DECISION_REPLIED,
    FOLLOWUP_DECISION_STOPPED,
    FOLLOWUP_DECISIONS,
    ApplicationFollowUp,
)
from .glossary import (
    GLOSSARY_CATEGORIES,
    GLOSSARY_LANGUAGES,
    ResumeGlossaryTerm,
)
from .interview import (
    INTERVIEW_DIFFICULTIES,
    INTERVIEW_STATUS_ACTIVE,
    INTERVIEW_STATUS_FINISHED,
    INTERVIEW_TYPES,
    INTERVIEWER_STYLES,
    InterviewMessage,
    InterviewSession,
)
from .interview_experience import (
    EXPERIENCE_ROUND_TYPES,
    EXPERIENCE_SOURCES,
    InterviewExperience,
)
from .interview_review_record import InterviewReviewRecord
from .job import Job
from .job_match_batch import JobMatchBatch
from .job_preference import (
    PREF_SOURCE_IMPORTED,
    PREF_SOURCE_USER_EDITED,
    PREF_SOURCE_USER_STATED,
    PREF_SOURCES,
    PREF_STATE_ACTIVE,
    PREF_STATE_SUPERSEDED,
    PREF_STATE_UNDONE,
    PREF_STATES,
    PREF_VALUE_KIND_LIST,
    PREF_VALUE_KIND_SCALAR,
    PREF_VALUE_KINDS,
    JobPreference,
)
from .job_seen import JobSeen
from .knowledge_entry import KnowledgeEntry
from .llm_usage import LLMUsageRecord
from .material import MATERIAL_CATEGORIES, CandidateJob, Material
from .phrase import PHRASE_KINDS, PHRASE_LANGUAGES, ResumePhrase
from .profile import (
    Award,
    CampusExperience,
    Education,
    Experience,
    ProfilePhoto,
    Project,
    Skill,
    UserProfile,
)
from .profile_definition import (
    ProfileCustomField,
    ProfileCustomSection,
    ProfileFieldPreference,
)
from .profile_entry import ProfileEntry
from .profile_group import ProfileGroup, ProfileGroupMember, ProfileWorkspaceState
from .profile_usage_snapshot import ProfileUsageSnapshot
from .provenance import (
    FACT_LOCK_KINDS,
    SOURCE_KINDS,
    ResumeBlockSource,
    ResumeFactLock,
    ResumeSource,
    ResumeSourceRevision,
)
from .question_bank_record import QuestionBankRecord
from .referral import REFERRAL_STATUSES, Referral
from .reminder import REMINDER_KINDS, REMINDER_STATUSES, Reminder
from .resume import (
    GENERATE_ACTIVE_STATUSES,
    GENERATE_STATUSES,
    ResumeGenerateTask,
    ResumeRecord,
)
from .resume_delivery import (
    DELIVERY_SOURCE_APPLY,
    DELIVERY_SOURCE_EXPORT,
    DELIVERY_SOURCE_TRACK,
    DELIVERY_SOURCES,
    ResumeDeliveryRecord,
)
from .resume_export import (
    EXPORT_ARTIFACT_KINDS,
    ResumeExportArtifact,
    ResumeExportPreset,
)
from .resume_template import (
    TEMPLATE_KIND_FORMAT,
    TEMPLATE_KIND_STYLE,
    TEMPLATE_KINDS,
    ResumeTemplate,
)
from .review_annotation import (
    ANNOTATION_STATUSES,
    REVIEW_FORMAT_VERSION,
    REVIEW_KIND,
    ResumeReviewAnnotation,
)
from .schema_epoch import AppSchemaEpoch
from .setting import AppSetting, LLMConfigRecord
from .share_package import SHARE_PERMISSIONS, SharePackage
from .tracker import (
    CHANNELS,
    CONFIRM_SILENCE_DAYS,
    EVENT_SOURCES,
    FOLLOWUP_SILENCE_DAYS,
    SOURCES,
    STATUSES,
    ApplicationTrack,
    ApplicationTrackEvent,
)
from .usage_pricing import UsagePricingRecord
from .user_file import UserFile
from .versions import (
    VERSION_SOURCE_ASSISTANT,
    VERSION_SOURCE_MANUAL,
    VERSION_SOURCE_RESTORE,
    VERSION_SOURCES,
    ResumeVariant,
    ResumeVersion,
)
from .web_form_profile import WebFormProfileEntry
from .web_form_profile_record import WebFormProfileRecord
from .web_form_record import SOURCE_BATCH, SOURCE_LIVE, WebFormFillRecord
from .web_form_url_history import WebFormUrlHistory

__all__ = [
    # T19 Agent 任务层：多步计划 + 每步状态 + 等待审批 + 跨重启恢复。
    "AgentTask",
    "AgentTaskStep",
    "AGENT_TASK_STATUSES",
    "AGENT_TASK_STEP_STATUSES",
    "AGENT_TASK_TERMINAL_STATUSES",
    "AGENT_TASK_RUNNING_STATUSES",
    "AGENT_TASK_SOURCES",
    "AGENT_TASK_SOURCE_FOLLOWUP",
    "AGENT_TASK_SOURCE_REFS",
    "AGENT_TASK_SOURCE_REF_STALLED_CONFIRM",
    "AGENT_TASK_SOURCE_REF_STALLED_FOLLOWUP",
    # 期一跟进巡检：应用跟进决策（0006）。
    "ApplicationFollowUp",
    "FOLLOWUP_DECISIONS",
    "FOLLOWUP_DECISION_CONTACTED",
    "FOLLOWUP_DECISION_REPLIED",
    "FOLLOWUP_DECISION_STOPPED",
    # 通用 AI 任务（0068）：所有 AI 入口统一登记，前端只有一个状态出口。
    "AiTask",
    "AI_TASK_KINDS",
    "AI_TASK_STATUSES",
    "AI_TASK_STATUS_PENDING",
    "AI_TASK_STATUS_RUNNING",
    "AI_TASK_STATUS_SUCCEEDED",
    "AI_TASK_STATUS_FAILED",
    "AI_TASK_STATUS_CANCELED",
    "AI_TASK_ACTIVE_STATUSES",
    "AI_TASK_TERMINAL_STATUSES",
    # 2.0 schema epoch 单行表（基线迁移末尾播种 epoch=2）。
    "AppSchemaEpoch",
    "Job",
    "JobMatchBatch",
    # 15A/15B 岗位采样流水（0012）：一次采集一条，见 models/job_seen.py。
    "JobSeen",
    # T10 求职偏好档（0008）：状态 / 来源 / 值形态三轴常量 + 模型。
    "JobPreference",
    "PREF_STATES",
    "PREF_STATE_ACTIVE",
    "PREF_STATE_SUPERSEDED",
    "PREF_STATE_UNDONE",
    "PREF_SOURCES",
    "PREF_SOURCE_USER_STATED",
    "PREF_SOURCE_USER_EDITED",
    "PREF_SOURCE_IMPORTED",
    "PREF_VALUE_KINDS",
    "PREF_VALUE_KIND_LIST",
    "PREF_VALUE_KIND_SCALAR",
    "ChatConversation",
    "ChatMessage",
    "AssistantWriteProposal",
    "AssistantSkill",
    "AssistantSkillFile",
    # 0015 助手语义记忆（#31A / #18D 合并模型）：kind 白名单 + 状态 + 来源 + 模型。
    "AssistantMemory",
    "AssistantMemoryEvent",
    "MEMORY_KINDS",
    "MEMORY_KIND_TARGET_ROLE",
    "MEMORY_KIND_CITY",
    "MEMORY_KIND_SALARY_FLOOR",
    "MEMORY_KIND_AVOID_COMPANY",
    "MEMORY_KIND_WORK_MODE",
    "MEMORY_KIND_SKILL_TAG",
    "MEMORY_KIND_CONSTRAINT",
    "MEMORY_KIND_LABELS",
    "MEMORY_STATUSES",
    "MEMORY_STATUS_ACTIVE",
    "MEMORY_STATUS_SUPERSEDED",
    "MEMORY_STATUS_DELETED",
    "MEMORY_SOURCES",
    "MEMORY_SOURCE_MANUAL",
    "MEMORY_SOURCE_EXTRACTED",
    "UserProfile",
    "ProfilePhoto",
    "ProfileCustomSection",
    "ProfileCustomField",
    "ProfileFieldPreference",
    "ProfileEntry",
    "ProfileGroup",
    "ProfileGroupMember",
    "ProfileWorkspaceState",
    "ProfileUsageSnapshot",
    "CareerScenario",
    "Education",
    "Experience",
    "CampusExperience",
    "Project",
    "Skill",
    "Award",
    "ResumeRecord",
    "ExternalResume",
    "ResumeGenerateTask",
    "ResumeDeliveryRecord",
    "DELIVERY_SOURCES",
    "DELIVERY_SOURCE_APPLY",
    "DELIVERY_SOURCE_EXPORT",
    "DELIVERY_SOURCE_TRACK",
    "GENERATE_STATUSES",
    "GENERATE_ACTIVE_STATUSES",
    "AppSetting",
    "LLMConfigRecord",
    "Material",
    "MATERIAL_CATEGORIES",
    "CandidateJob",
    "ResumeTemplate",
    "TEMPLATE_KINDS",
    "TEMPLATE_KIND_STYLE",
    "TEMPLATE_KIND_FORMAT",
    "InterviewSession",
    "InterviewMessage",
    "INTERVIEW_TYPES",
    "INTERVIEW_DIFFICULTIES",
    "INTERVIEWER_STYLES",
    "INTERVIEW_STATUS_ACTIVE",
    "INTERVIEW_STATUS_FINISHED",
    "JobMatchAnalysis",
    "ApplyQueueItem",
    "ApplyTask",
    "ApplyTaskItem",
    "MATCH_STATUSES",
    "ADMISSIONS",
    "HARD_GATES",
    "QUEUE_STATUSES",
    "TASK_KINDS",
    "TASK_STATUSES",
    "ITEM_STATUSES",
    "FAILURE_CATEGORIES",
    "FAILURE_CATEGORY_LABELS",
    "TASK_STEPS",
    "STOP_REASONS",
    "ClaimRecord",
    "CLAIM_CATEGORIES",
    "RESPONSIBILITY_LEVELS",
    "VERIFICATION_STATUSES",
    "ApplicationTrack",
    "ApplicationTrackEvent",
    # 期一跟进巡检的两个沉默阈值（FOLLOWUP_SILENCE_DAYS 是 STALLED_DAYS 的别名）。
    "FOLLOWUP_SILENCE_DAYS",
    "CONFIRM_SILENCE_DAYS",
    "CHANNELS",
    "EVENT_SOURCES",
    "STATUSES",
    "SOURCES",
    "DrillSession",
    "DrillContract",
    "DrillTurn",
    "EVIDENCE_STATUSES",
    "REHEARSE_KINDS",
    "DRILL_STATUS_ACTIVE",
    "DRILL_STATUS_FINISHED",
    "InterviewExperience",
    "EXPERIENCE_SOURCES",
    "EXPERIENCE_ROUND_TYPES",
    "InterviewReviewRecord",
    "KnowledgeEntry",
    "QuestionBankRecord",
    "Referral",
    "REFERRAL_STATUSES",
    "Reminder",
    "REMINDER_KINDS",
    "REMINDER_STATUSES",
    "SharePackage",
    "SHARE_PERMISSIONS",
    "WebFormFillRecord",
    "WebFormProfileEntry",
    "WebFormProfileRecord",
    "SOURCE_BATCH",
    "SOURCE_LIVE",
    "WebFormUrlHistory",
    "UserFile",
    "LLMUsageRecord",
    "UsagePricingRecord",
    "ResumeSource",
    "ResumeSourceRevision",
    "ResumeBlockSource",
    "ResumeFactLock",
    "FACT_LOCK_KINDS",
    "SOURCE_KINDS",
    "ResumeVersion",
    "ResumeVariant",
    "VERSION_SOURCES",
    "VERSION_SOURCE_ASSISTANT",
    "VERSION_SOURCE_MANUAL",
    "VERSION_SOURCE_RESTORE",
    "ResumePhrase",
    "PHRASE_KINDS",
    "PHRASE_LANGUAGES",
    "ResumeReviewAnnotation",
    "ANNOTATION_STATUSES",
    "REVIEW_FORMAT_VERSION",
    "REVIEW_KIND",
    "ResumeGlossaryTerm",
    "GLOSSARY_CATEGORIES",
    "GLOSSARY_LANGUAGES",
    "ResumeExportPreset",
    "ResumeExportArtifact",
    "EXPORT_ARTIFACT_KINDS",
]
