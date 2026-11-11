# SPDX-License-Identifier: Apache-2.0
"""自动投递中心的请求/响应结构：配置、浏览器状态、队列、批次与记录。

状态/失败分类等字符串取值与 ``models/apply`` 里的常量**逐字一致**（前端再镜像一份），
改一处必须同步另一处。
"""

from .base import (
    BROWSER_PATH_MAX_CHARS as BROWSER_PATH_MAX_CHARS,
)
from .base import (
    COLLECT_FILTER_CODE_MAX_CHARS as COLLECT_FILTER_CODE_MAX_CHARS,
)
from .base import (
    COLLECT_FILTER_KEY_MAX_CHARS as COLLECT_FILTER_KEY_MAX_CHARS,
)
from .base import (
    DEFAULT_BREAKER_THRESHOLD as DEFAULT_BREAKER_THRESHOLD,
)
from .base import (
    DEFAULT_BROWSER_CHOICE as DEFAULT_BROWSER_CHOICE,
)
from .base import (
    DEFAULT_BROWSER_PORT as DEFAULT_BROWSER_PORT,
)
from .base import (
    DEFAULT_COLLECT_INTERVAL_JITTER_SECONDS as DEFAULT_COLLECT_INTERVAL_JITTER_SECONDS,
)
from .base import (
    DEFAULT_COLLECT_INTERVAL_SECONDS as DEFAULT_COLLECT_INTERVAL_SECONDS,
)
from .base import (
    DEFAULT_COLLECT_KEYWORDS as DEFAULT_COLLECT_KEYWORDS,
)
from .base import (
    DEFAULT_COLLECT_PER_TASK_LIMIT as DEFAULT_COLLECT_PER_TASK_LIMIT,
)
from .base import (
    DEFAULT_DAILY_LIMIT as DEFAULT_DAILY_LIMIT,
)
from .base import (
    DEFAULT_GREETING as DEFAULT_GREETING,
)
from .base import (
    DEFAULT_INTERVAL_JITTER_SECONDS as DEFAULT_INTERVAL_JITTER_SECONDS,
)
from .base import (
    DEFAULT_INTERVAL_SECONDS as DEFAULT_INTERVAL_SECONDS,
)
from .base import (
    DEFAULT_PER_TASK_LIMIT as DEFAULT_PER_TASK_LIMIT,
)
from .base import (
    GREETING_INPUT_MAX_CHARS as GREETING_INPUT_MAX_CHARS,
)
from .base import (
    GREETING_RECORD_MAX_CHARS as GREETING_RECORD_MAX_CHARS,
)
from .base import (
    MAX_BACKFILL_JOBS as MAX_BACKFILL_JOBS,
)
from .base import (
    MAX_BACKFILL_REQUEST_ITEMS as MAX_BACKFILL_REQUEST_ITEMS,
)
from .base import (
    MAX_COLLECT_FILTERS as MAX_COLLECT_FILTERS,
)
from .base import (
    MAX_COLLECT_KEYWORDS as MAX_COLLECT_KEYWORDS,
)
from .base import (
    MAX_QUEUE_BATCH as MAX_QUEUE_BATCH,
)
from .base import (
    MAX_TASK_TARGETS as MAX_TASK_TARGETS,
)
from .base import (
    BrowserChoice as BrowserChoice,
)
from .base import (
    BrowserState as BrowserState,
)
from .base import (
    FailureCategory as FailureCategory,
)
from .base import (
    QueueStatus as QueueStatus,
)
from .base import (
    TaskItemStatus as TaskItemStatus,
)
from .base import (
    TaskKind as TaskKind,
)
from .base import (
    TaskStatus as TaskStatus,
)
from .base import (
    _check_failure_category as _check_failure_category,
)
from .base import (
    default_site_key as default_site_key,
)
from .browser_site import (
    BrowserStatusOut as BrowserStatusOut,
)
from .browser_site import (
    CollectRunSummaryOut as CollectRunSummaryOut,
)
from .browser_site import (
    SiteHealthListOut as SiteHealthListOut,
)
from .browser_site import (
    SiteHealthOut as SiteHealthOut,
)
from .browser_site import (
    SiteListOut as SiteListOut,
)
from .browser_site import (
    SiteOptionOut as SiteOptionOut,
)
from .collect import (
    CollectBackfillIn as CollectBackfillIn,
)
from .collect import (
    CollectConfigIn as CollectConfigIn,
)
from .collect import (
    CollectConfigOut as CollectConfigOut,
)
from .collect import (
    CollectFilterGroupOut as CollectFilterGroupOut,
)
from .collect import (
    CollectFilterOptionOut as CollectFilterOptionOut,
)
from .collect import (
    CollectFilterOptionsOut as CollectFilterOptionsOut,
)
from .collect import (
    CollectFilterTestIn as CollectFilterTestIn,
)
from .collect import (
    CollectFilterTestItemOut as CollectFilterTestItemOut,
)
from .collect import (
    CollectFilterTestResultOut as CollectFilterTestResultOut,
)
from .collect import (
    CollectFilterVisibleWhenOut as CollectFilterVisibleWhenOut,
)
from .collect import (
    CollectTaskCreateIn as CollectTaskCreateIn,
)
from .config import (
    ApplyConfigIn as ApplyConfigIn,
)
from .config import (
    ApplyConfigOut as ApplyConfigOut,
)
from .extras import (
    ApplyBlocklistIn as ApplyBlocklistIn,
)
from .extras import (
    ApplyBlocklistOut as ApplyBlocklistOut,
)
from .extras import (
    ApplyPreflightIn as ApplyPreflightIn,
)
from .extras import (
    ApplyPreflightIssue as ApplyPreflightIssue,
)
from .extras import (
    ApplyPreflightItemOut as ApplyPreflightItemOut,
)
from .extras import (
    ApplyPreflightOut as ApplyPreflightOut,
)
from .extras import (
    ApplyPreflightSummary as ApplyPreflightSummary,
)
from .extras import (
    ApplyStaleListOut as ApplyStaleListOut,
)
from .extras import (
    ApplyStaleRecordOut as ApplyStaleRecordOut,
)
from .extras import (
    ApplySummaryOut as ApplySummaryOut,
)
from .extras import (
    ApplyTrackLinkOut as ApplyTrackLinkOut,
)
from .extras import (
    GreetingTemplateIn as GreetingTemplateIn,
)
from .extras import (
    GreetingTemplateListOut as GreetingTemplateListOut,
)
from .extras import (
    GreetingTemplateOut as GreetingTemplateOut,
)
from .extras import (
    GreetingTemplateSaveIn as GreetingTemplateSaveIn,
)
from .insights import (
    ApplyHistoryOut as ApplyHistoryOut,
)
from .insights import (
    ApplyJdChangeOut as ApplyJdChangeOut,
)
from .insights import (
    ApplyJobInspectOut as ApplyJobInspectOut,
)
from .insights import (
    ApplyResumeFitItemOut as ApplyResumeFitItemOut,
)
from .insights import (
    ApplyResumeFitOut as ApplyResumeFitOut,
)
from .insights import (
    ApplySalaryInspectOut as ApplySalaryInspectOut,
)
from .insights import (
    ApplySameCompanyOut as ApplySameCompanyOut,
)
from .insights import (
    ApplyStoppingPointOut as ApplyStoppingPointOut,
)
from .insights import (
    ApplyStoppingWeekOut as ApplyStoppingWeekOut,
)
from .queue import (
    ApplyQueueAddItem as ApplyQueueAddItem,
)
from .queue import (
    ApplyQueueAddRequest as ApplyQueueAddRequest,
)
from .queue import (
    ApplyQueueItemOut as ApplyQueueItemOut,
)
from .queue import (
    ApplyQueueItemUpdate as ApplyQueueItemUpdate,
)
from .queue import (
    ApplyQueueListOut as ApplyQueueListOut,
)
from .queue import (
    ApplyQueueReorderRequest as ApplyQueueReorderRequest,
)
from .records import (
    ApplyFailureCountOut as ApplyFailureCountOut,
)
from .records import (
    ApplyRecordBatchDeleteRequest as ApplyRecordBatchDeleteRequest,
)
from .records import (
    ApplyRecordBatchDeleteResult as ApplyRecordBatchDeleteResult,
)
from .records import (
    ApplyRecordBatchOut as ApplyRecordBatchOut,
)
from .records import (
    ApplyRecordOut as ApplyRecordOut,
)
from .records import (
    ApplyRecordRetryBatchRequest as ApplyRecordRetryBatchRequest,
)
from .records import (
    ApplyRecordRetryBatchResult as ApplyRecordRetryBatchResult,
)
from .records import (
    GreetingPreviewOut as GreetingPreviewOut,
)
from .records import (
    GreetingPreviewRequest as GreetingPreviewRequest,
)
from .tasks import (
    ApplyTaskCreate as ApplyTaskCreate,
)
from .tasks import (
    ApplyTaskDetailOut as ApplyTaskDetailOut,
)
from .tasks import (
    ApplyTaskItemOut as ApplyTaskItemOut,
)
from .tasks import (
    ApplyTaskOut as ApplyTaskOut,
)

__all__ = [
    "ApplyHistoryOut",
    "ApplyJdChangeOut",
    "ApplyJobInspectOut",
    "ApplyResumeFitItemOut",
    "ApplyResumeFitOut",
    "ApplySalaryInspectOut",
    "ApplySameCompanyOut",
    "ApplyStoppingPointOut",
    "ApplyStoppingWeekOut",
    "ApplyBlocklistIn",
    "ApplyBlocklistOut",
    "ApplyPreflightIn",
    "ApplyPreflightIssue",
    "ApplyPreflightItemOut",
    "ApplyPreflightOut",
    "ApplyPreflightSummary",
    "ApplyStaleListOut",
    "ApplyStaleRecordOut",
    "ApplySummaryOut",
    "ApplyTrackLinkOut",
    "GreetingTemplateIn",
    "GreetingTemplateListOut",
    "GreetingTemplateOut",
    "GreetingTemplateSaveIn",
    "ApplyConfigIn",
    "ApplyConfigOut",
    "ApplyQueueAddItem",
    "ApplyQueueAddRequest",
    "ApplyQueueItemOut",
    "ApplyQueueItemUpdate",
    "ApplyQueueListOut",
    "ApplyQueueReorderRequest",
    "ApplyFailureCountOut",
    "ApplyRecordBatchDeleteRequest",
    "ApplyRecordBatchDeleteResult",
    "ApplyRecordBatchOut",
    "ApplyRecordOut",
    "ApplyRecordRetryBatchRequest",
    "ApplyRecordRetryBatchResult",
    "ApplyTaskCreate",
    "ApplyTaskDetailOut",
    "ApplyTaskItemOut",
    "ApplyTaskOut",
    "BrowserChoice",
    "BrowserState",
    "BrowserStatusOut",
    "CollectBackfillIn",
    "CollectConfigIn",
    "CollectConfigOut",
    "CollectFilterGroupOut",
    "CollectFilterOptionOut",
    "CollectFilterOptionsOut",
    "CollectFilterTestIn",
    "CollectFilterTestItemOut",
    "CollectFilterTestResultOut",
    "CollectFilterVisibleWhenOut",
    "CollectRunSummaryOut",
    "CollectTaskCreateIn",
    "DEFAULT_BROWSER_CHOICE",
    "DEFAULT_BROWSER_PORT",
    "DEFAULT_GREETING",
    "FailureCategory",
    "GREETING_INPUT_MAX_CHARS",
    "GREETING_RECORD_MAX_CHARS",
    "GreetingPreviewOut",
    "GreetingPreviewRequest",
    "MAX_BACKFILL_JOBS",
    "MAX_BACKFILL_REQUEST_ITEMS",
    "QueueStatus",
    "SiteHealthListOut",
    "SiteHealthOut",
    "SiteListOut",
    "SiteOptionOut",
    "TaskItemStatus",
    "TaskKind",
    "TaskStatus",
    "_check_failure_category",
    "default_site_key",
]
