# SPDX-License-Identifier: Apache-2.0
"""集中导入全部模型，保证 Base.metadata 注册完整（create_all 依赖此注册）。"""

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
from .assistant import AssistantSkill, AssistantSkillFile, ChatConversation, ChatMessage
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
from .profile_fact import PROFILE_FACT_KINDS, ProfileFact
from .profile_fact_field_pref import ProfileFactFieldPref
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
from .setting import AppSetting, LLMConfigRecord
from .share_package import SHARE_PERMISSIONS, SharePackage
from .tracker import (
    CHANNELS,
    EVENT_SOURCES,
    SOURCES,
    STATUSES,
    ApplicationTrack,
    ApplicationTrackEvent,
)
from .usage_pricing import UsagePricingRecord
from .user_file import UserFile
from .versions import (
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
    "Job",
    "JobMatchBatch",
    "ChatConversation",
    "ChatMessage",
    "AssistantSkill",
    "AssistantSkillFile",
    "UserProfile",
    "ProfilePhoto",
    "ProfileFact",
    "ProfileFactFieldPref",
    "PROFILE_FACT_KINDS",
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
