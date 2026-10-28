// SPDX-License-Identifier: Apache-2.0
/**
 * 后台任务的**适配层**：把每种任务的后端形状翻译成统一的 `BackgroundTaskUpdate`。
 *
 * 为什么需要它：本仓已有 4 套前端任务登记（`utils/backgroundTasks`、
 * `utils/jobMatchBackgroundTasks`、`jobAnalysisStore`、`riskScanStore`）——它们各写一套
 * 轮询、各写一套提醒，于是"有的地方响、有的地方不响"。本轮起**新代码只能进统一的那一套**：
 * `utils/backgroundTasks.ts` 是唯一登记表，`BackgroundTasksIndicator` 是唯一状态展示。
 *
 * 本文件就是"怎么把新任务塞进去"的扩展点：给一种任务写一个适配器（拉一次状态 +
 * 取消一次 + 一组通知文案 + 深链怎么算），登记进表，主循环与页面**一行都不用改**。
 * 目前六种：
 * - `resume_generate`：走既有 `resume_generate_task` 三个端点；
 * - `job_match` / `job_analysis` / `resume_risk` / `resume_rewrite` / `webform_fill`：
 *   全部走 `/ai-tasks`（通用任务表）。后四种共用 `aiTaskAdapter` 工厂——它们之间
 *   唯一该有差别的地方就是 `kind` 与文案。
 */
import { cancelAiTask, getAiTask } from "../api/aiTasks";
import { cancelResumeGenerateTask, getResumeGenerateTask } from "../api/resumes";
import { t, type MessageKey } from "../i18n";
import type { AiTaskSnapshot, AiTaskStatus } from "../types";
import type { ResumeGenerateTask, ResumeGenerateTaskStatus } from "../types";
import { dispatchAiTaskResult } from "./aiTaskResultSink";
import { jobAnalysisDeepLink, jobDeepLink, resumeDeepLink, taskDeepLink } from "./taskDeepLinks";
import type {
  BackgroundTaskKind,
  BackgroundTaskNotices,
  BackgroundTaskStatus,
  BackgroundTaskUpdate,
} from "./backgroundTasks.types";

/** 一种任务类型的适配器。四个成员就是"新任务要接进来必须回答的四个问题"。 */
export interface BackgroundTaskAdapter {
  kind: BackgroundTaskKind;
  /** 拉一次最新状态（抛错由主循环按"暂时不可用"处理，不假装完成）。 */
  fetch(id: number): Promise<BackgroundTaskUpdate>;
  /** 请求取消（后端协作式停掉执行体，不只是改状态）。 */
  cancel(id: number): Promise<BackgroundTaskUpdate>;
  /** 通知文案（函数而不是常量：切语言后要重新取）。 */
  notices(): BackgroundTaskNotices;
}

/** 把任意"可能是字符串的数字"收敛成正整数；不合法返回 `null`（宁可少个按钮也不跳错页）。 */
function positiveRef(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!/^\d+$/.test(text)) return null;
    const parsed = Number(text);
    return parsed > 0 ? parsed : null;
  }
  return null;
}

/** 简历任务状态 → 统一状态（两套词表在这里合流，其它地方只认统一词）。 */
function resumeStatusToTaskStatus(status: ResumeGenerateTaskStatus): BackgroundTaskStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    case "running":
      return "running";
    default:
      return "pending";
  }
}

/** 通用 AI 任务状态 → 统一状态（`succeeded`/`canceled` 是后端通用任务的写法）。 */
function aiStatusToTaskStatus(status: AiTaskStatus): BackgroundTaskStatus {
  switch (status) {
    case "succeeded":
      return "completed";
    case "canceled":
      return "cancelled";
    case "failed":
      return "failed";
    case "running":
      return "running";
    default:
      return "pending";
  }
}

/** 简历生成任务 → 统一更新（深链在这里算，组件不要手拼地址）。 */
export function updateFromResumeTask(task: ResumeGenerateTask): BackgroundTaskUpdate {
  return {
    status: resumeStatusToTaskStatus(task.status),
    message: task.message,
    // 简历生成的总长未知，没有可信百分比；用已接收字数单独展示。
    progressPercent: null,
    receivedChars: task.received_chars,
    resumeId: task.resume_id,
    refId: task.resume_id,
    deepLink: resumeDeepLink(task.resume_id),
    // 简历生成的结果就在 `resume_generate_task` 里（id + 字数），没有第二份负载。
    resultData: null,
    error: task.error,
  };
}

/**
 * 通用 AI 任务 → 完成后该跳哪。**一张表**：新增入口只在这里加一行，
 * 通知、页头任务条、常驻任务条都无需知道地址长什么样。
 */
function aiTaskDeepLink(
  kind: string,
  jobId: number | null,
  resumeId: number | null,
): string | null {
  switch (kind) {
    case "job_match":
      return jobDeepLink(jobId);
    case "resume_generate":
      return resumeDeepLink(resumeId);
    // 岗位解读：落到"自动打开解读弹窗"的深链，而不是只停在岗位上。
    case "job_analysis":
      return jobAnalysisDeepLink(jobId);
    // 风险扫描、岗位化建议：结果都挂在简历上，落到简历中心并定位那条简历。
    case "resume_risk":
    case "resume_rewrite":
      return resumeDeepLink(resumeId);
    // 网申预览是整页型结果（页面本身就是落点，没有可定位的记录 id）。
    case "webform_fill":
      return taskDeepLink("webform");
    default:
      // 未知类型不猜地址：宁可少一颗按钮，也不要跳到一条不存在的记录上。
      return null;
  }
}

/** 通用 AI 任务 → 统一更新（落点标识按 `kind` 决定跳简历、跳岗位还是跳整页）。 */
export function updateFromAiTask(task: AiTaskSnapshot): BackgroundTaskUpdate {
  const ref = task.result_ref ?? null;
  const resumeId = positiveRef(ref?.resume_id);
  const jobId = positiveRef(ref?.job_id);
  const status = aiStatusToTaskStatus(task.status);
  return {
    status,
    message: task.message,
    progressPercent: status === "completed" ? 100 : Math.max(0, Math.min(100, task.progress)),
    receivedChars: 0,
    resumeId,
    refId: jobId ?? resumeId,
    deepLink: aiTaskDeepLink(task.kind, jobId, resumeId),
    // `result_ref` 原样带走：没有业务表的那几种入口，结果就在这里面。
    resultData: ref,
    error: task.error,
  };
}

/** 简历生成：复用既有三个端点（不新造任务表）。 */
export const resumeTaskAdapter: BackgroundTaskAdapter = {
  kind: "resume_generate",
  async fetch(id) {
    return updateFromResumeTask(await getResumeGenerateTask(id));
  },
  async cancel(id) {
    return updateFromResumeTask(await cancelResumeGenerateTask(id));
  },
  notices() {
    return {
      doneTitle: t("backgroundTasks.resume.done.title"),
      doneDescription: t("backgroundTasks.resume.done.description"),
      restoredDescription: t("backgroundTasks.resume.restored.description"),
      failedTitle: t("backgroundTasks.resume.failed.title"),
      failedDescription: t("backgroundTasks.resume.failed.description"),
      cancelledTitle: t("backgroundTasks.resume.cancelled.title"),
      viewLabel: t("backgroundTasks.resume.action.viewResume"),
    };
  },
};

/** 单条岗位适配度分析：走新的 `/ai-tasks`（可真取消、可离开页面）。 */
export const jobMatchTaskAdapter: BackgroundTaskAdapter = {
  kind: "job_match",
  async fetch(id) {
    return updateFromAiTask(await getAiTask(id));
  },
  async cancel(id) {
    return updateFromAiTask(await cancelAiTask(id));
  },
  notices() {
    return {
      doneTitle: t("backgroundTasks.aiTask.jobMatch.done.title"),
      doneDescription: t("backgroundTasks.aiTask.jobMatch.done.description"),
      failedTitle: t("backgroundTasks.aiTask.jobMatch.failed.title"),
      failedDescription: t("backgroundTasks.aiTask.jobMatch.failed.description"),
      cancelledTitle: t("backgroundTasks.aiTask.jobMatch.cancelled.title"),
      viewLabel: t("backgroundTasks.aiTask.jobMatch.action.viewJob"),
    };
  },
};

const ADAPTERS = new Map<BackgroundTaskKind, BackgroundTaskAdapter>();

/**
 * 本轮接入的四种入口共用**同一个形状**：走 `/ai-tasks` 的拉/停，只有文案不同。
 * 用一个工厂而不是四份复制品：它们之间唯一该有差别的地方就是 `kind` 与文案，
 * 复制四遍只会让"下次改轮询/取消语义要改四处"的历史重演。
 *
 * 文案 key 逐个显式列出来（而不是用模板串拼）：`t()` 的入参是字面量联合类型，
 * 拼出来的字符串会让"写错一个 key"重新变成运行期才发现的空文案。
 */
interface AiTaskNoticeKeys {
  doneTitle: MessageKey;
  doneDescription: MessageKey;
  failedTitle: MessageKey;
  failedDescription: MessageKey;
  cancelledTitle: MessageKey;
  viewLabel: MessageKey;
}

function aiTaskAdapter(kind: BackgroundTaskKind, keys: AiTaskNoticeKeys): BackgroundTaskAdapter {
  return {
    kind,
    async fetch(id) {
      const update = updateFromAiTask(await getAiTask(id));
      // 结果回传放在**拉状态**这一处而不是"终态回调"里：刷新恢复时没有组件在等回调
      // （`restoreEntry` 只拉一次就补发通知），只有这条路能把结果交回领域 store。
      if (update.status === "completed") {
        dispatchAiTaskResult(kind, id, update.resultData ?? null);
      }
      return update;
    },
    async cancel(id) {
      return updateFromAiTask(await cancelAiTask(id));
    },
    notices() {
      return {
        doneTitle: t(keys.doneTitle),
        doneDescription: t(keys.doneDescription),
        failedTitle: t(keys.failedTitle),
        failedDescription: t(keys.failedDescription),
        cancelledTitle: t(keys.cancelledTitle),
        viewLabel: t(keys.viewLabel),
      };
    },
  };
}

/** 岗位解读：结果写回岗位缓存，通知落到 `/jobs?job_id=<id>&analysis=1`。 */
export const jobAnalysisTaskAdapter = aiTaskAdapter("job_analysis", {
  doneTitle: "backgroundTasks.aiTask.jobAnalysis.done.title",
  doneDescription: "backgroundTasks.aiTask.jobAnalysis.done.description",
  failedTitle: "backgroundTasks.aiTask.jobAnalysis.failed.title",
  failedDescription: "backgroundTasks.aiTask.jobAnalysis.failed.description",
  cancelledTitle: "backgroundTasks.aiTask.jobAnalysis.cancelled.title",
  viewLabel: "backgroundTasks.aiTask.jobAnalysis.action.viewJob",
});

/** 简历风险扫描：报告随 `result_ref` 回来，通知落到 `/resumes?resume_id=<id>`。 */
export const resumeRiskTaskAdapter = aiTaskAdapter("resume_risk", {
  doneTitle: "backgroundTasks.aiTask.risk.done.title",
  doneDescription: "backgroundTasks.aiTask.risk.done.description",
  failedTitle: "backgroundTasks.aiTask.risk.failed.title",
  failedDescription: "backgroundTasks.aiTask.risk.failed.description",
  cancelledTitle: "backgroundTasks.aiTask.risk.cancelled.title",
  viewLabel: "backgroundTasks.aiTask.risk.action.viewResume",
});

/** 岗位优化建议（AI 改写家族里唯一任务化的一支）：通知落到 `/resumes?resume_id=<id>`。 */
export const resumeRewriteTaskAdapter = aiTaskAdapter("resume_rewrite", {
  doneTitle: "backgroundTasks.aiTask.rewrite.done.title",
  doneDescription: "backgroundTasks.aiTask.rewrite.done.description",
  failedTitle: "backgroundTasks.aiTask.rewrite.failed.title",
  failedDescription: "backgroundTasks.aiTask.rewrite.failed.description",
  cancelledTitle: "backgroundTasks.aiTask.rewrite.cancelled.title",
  viewLabel: "backgroundTasks.aiTask.rewrite.action.viewResume",
});

/** 网申字段识别：结果是**暂存**的预览，通知落到整页 `/webform`。 */
export const webformFillTaskAdapter = aiTaskAdapter("webform_fill", {
  doneTitle: "backgroundTasks.aiTask.webform.done.title",
  doneDescription: "backgroundTasks.aiTask.webform.done.description",
  failedTitle: "backgroundTasks.aiTask.webform.failed.title",
  failedDescription: "backgroundTasks.aiTask.webform.failed.description",
  cancelledTitle: "backgroundTasks.aiTask.webform.cancelled.title",
  viewLabel: "backgroundTasks.aiTask.webform.action.viewWebform",
});

/** 登记（或替换）一种任务的适配器——接新入口就调这一个函数。 */
export function registerBackgroundTaskAdapter(adapter: BackgroundTaskAdapter): void {
  ADAPTERS.set(adapter.kind, adapter);
}

/** 取适配器；没登记返回 `null`（主循环据此跳过，而不是崩）。 */
export function getBackgroundTaskAdapter(kind: BackgroundTaskKind): BackgroundTaskAdapter | null {
  return ADAPTERS.get(kind) ?? null;
}

/** 已登记的 kind（"这个任务类型有人认领"的判据，也用于测试断言）。 */
export function registeredBackgroundTaskKinds(): BackgroundTaskKind[] {
  return [...ADAPTERS.keys()];
}

registerBackgroundTaskAdapter(resumeTaskAdapter);
registerBackgroundTaskAdapter(jobMatchTaskAdapter);
registerBackgroundTaskAdapter(jobAnalysisTaskAdapter);
registerBackgroundTaskAdapter(resumeRiskTaskAdapter);
registerBackgroundTaskAdapter(resumeRewriteTaskAdapter);
registerBackgroundTaskAdapter(webformFillTaskAdapter);
