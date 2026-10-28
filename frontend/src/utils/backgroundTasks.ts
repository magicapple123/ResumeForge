// SPDX-License-Identifier: Apache-2.0
/**
 * 后台任务登记表：让"关掉窗口也继续跑"这件事真的有结果。
 *
 * **为什么需要它**：简历生成的轮询原本写在生成弹窗里（`GenerateResumeModal` 的 useEffect）。
 * 用户点「后台继续（关闭弹窗）」之后组件卸载，**轮询也跟着停了**——任务在后端还在跑，但
 * 前端再也没人去问它结果，于是"完成后会提醒你"成了一句空话。
 *
 * 所以把轮询搬到模块级：进程内的单例，与任何组件生命周期无关。它同时提供三件事：
 * 1. **完成/失败时用统一出口提醒**（弹窗 + 提示音，见 utils/taskNotify）；
 * 2. **一份可订阅的任务列表**，让页头能显示"正在进行的任务 + 进度 + 取消"；
 * 3. **唯一的一份登记表**——本轮起新接入的 AI 入口都进这里，不再新建第 5 套 store。
 *
 * 三种任务类型的差异（怎么拉状态、怎么取消、通知文案、深链怎么算）全部关在
 * `backgroundTasks.adapters.ts` 里；本文件只负责轮询循环、持久化与提醒出口，
 * 所以加一种新任务**不需要改这个文件**。
 *
 * 跨页面刷新：任务元数据（id / kind / label，**不含回调**）在登记时写进 localStorage；
 * 刷新后应用挂载时调用 `restoreBackgroundTasks()` 恢复——已完成的补发完成提醒、仍在运行的
 * 重新拉起轮询；同时向 `/ai-tasks/active` 兜一次底（localStorage 被清掉也还能恢复）。
 * localStorage 不可用（隐私模式等）时全部静默降级为原来的行为。
 */
import { ApiError } from "../api/client";
import { listActiveAiTasks } from "../api/aiTasks";
import { t } from "../i18n";
import type { AiTaskSnapshot, ResumeGenerateTask } from "../types";
import {
  backgroundTaskKey,
  isTerminalTaskStatus,
  POLL_INTERVAL_MS,
  UNKNOWN_AFTER_FAILURES,
  type BackgroundTask,
  type BackgroundTaskKind,
  type BackgroundTaskListener,
  type BackgroundTaskUpdate,
  type PersistedTaskEntry,
} from "./backgroundTasks.types";
import {
  getBackgroundTaskAdapter,
  updateFromAiTask,
  updateFromResumeTask,
  type BackgroundTaskAdapter,
} from "./backgroundTasks.adapters";
import {
  clearPersistedTasks,
  persistAddTask,
  persistRemoveTask,
  readPersistedEntries,
} from "./backgroundTasks.persist";
import { notifyTaskDone } from "./taskNotify";
import { isDocumentHidden, onVisibilityChange } from "./visibility";

export type {
  BackgroundTask,
  BackgroundTaskKind,
  BackgroundTaskStatus,
  BackgroundTaskUpdate,
} from "./backgroundTasks.types";
export { backgroundTaskKey, POLL_INTERVAL_MS, resumeTaskKey } from "./backgroundTasks.types";

const tasks = new Map<string, BackgroundTask>();
/** 每个登记任务的连续轮询失败计数（成功一轮即清零）。 */
const failureCounts = new Map<string, number>();
/** 任务终态时要通知谁（弹窗打开时要刷新预览；关掉之后没人需要）。 */
const finishHandlers = new Map<string, (task: BackgroundTask) => void>();
/** 哪些任务当前"有界面在看"，决定完成时是右上角卡片还是居中弹窗。 */
const attached = new Set<string>();
const listeners = new Set<BackgroundTaskListener>();
let timer: number | null = null;

// 快照必须有稳定的引用：`useSyncExternalStore` 用 `Object.is` 比较前后值，
// 每次返回新数组会被判成"一直在变"，于是组件无限重渲染（真实踩到过
// "Maximum update depth exceeded"）。内容没变就复用同一个数组。
let cached: BackgroundTask[] = [];
let cacheDirty = true;

function snapshot(): BackgroundTask[] {
  if (cacheDirty) {
    cached = [...tasks.values()];
    cacheDirty = false;
  }
  return cached;
}

function emit(): void {
  cacheDirty = true;
  const current = snapshot();
  for (const listener of listeners) listener(current);
}

function stopPollingIfIdle(): void {
  if (tasks.size > 0 || timer === null) return;
  window.clearInterval(timer);
  timer = null;
}

function ensurePolling(): void {
  if (timer !== null || typeof window === "undefined") return;
  timer = window.setInterval(() => {
    // 页面在后台时跳过本轮：标签页不可见时秒级轮询纯属浪费；
    // 回到前台由下面的 visibilitychange 订阅立即补一次。
    if (isDocumentHidden()) return;
    void tick();
  }, POLL_INTERVAL_MS);
}

// 回到前台立即补一轮：隐藏期间 interval 被跳过，进度不该等下一个 1.5s。
// 模块级单例与页面同生命周期，无需退订。
onVisibilityChange(() => {
  if (!isDocumentHidden() && tasks.size > 0) void tick();
});

async function tick(): Promise<void> {
  if (tasks.size === 0) {
    stopPollingIfIdle();
    return;
  }
  await Promise.all(
    [...tasks.values()].map(async (entry) => {
      const adapter = getBackgroundTaskAdapter(entry.kind);
      if (!adapter) return;
      try {
        const latest = await adapter.fetch(entry.id);
        // 这一轮成功了：失败计数清零，「状态未知」也随真实进度恢复为正常显示。
        failureCounts.delete(entry.key);
        applyUpdate(entry.key, latest);
      } catch (error) {
        // 单次失败不打断（后端短暂不可用，等下一轮自愈）；但连着失败或明确 404 时
        // 必须承认"状态未知"，否则任务永不终态，页头永久转圈、取消每次 404。
        if (error instanceof ApiError && error.status === 404) {
          markTaskUnknown(entry.key);
          return;
        }
        const count = (failureCounts.get(entry.key) ?? 0) + 1;
        failureCounts.set(entry.key, count);
        if (count >= UNKNOWN_AFTER_FAILURES) markTaskUnknown(entry.key);
      }
    }),
  );
}

/** 把条目标成「状态未知」：不触发成功/失败提醒（结果真的不知道），只更新界面。 */
function markTaskUnknown(key: string): void {
  const entry = tasks.get(key);
  if (!entry || entry.unknown) return;
  tasks.set(key, { ...entry, unknown: true, message: t("backgroundTasks.status.unknownDetail") });
  emit();
}

function applyUpdate(key: string, latest: BackgroundTaskUpdate): void {
  const existing = tasks.get(key);
  if (!existing) return;
  const next: BackgroundTask = {
    ...existing,
    status: latest.status,
    message: latest.message,
    progressPercent: latest.progressPercent,
    receivedChars: latest.receivedChars,
    resumeId: latest.resumeId,
    refId: latest.refId,
    // 结果标识常常在任务跑完之后才拿到（生成成功落库才有 id），所以每轮都重算一次：
    // 否则登记时算出的 `null` 会一直留到完成那一刻，通知里就永远没有跳转按钮。
    deepLink: latest.deepLink ?? existing.deepLink,
    // 结果本身同理：没有业务表的那几种入口（风险扫描 / 建议 / 网申预览）只有完成那一刻
    // 才拿得到，领域 store 在终态回调里从这里取。
    resultData: latest.resultData ?? existing.resultData,
    error: latest.error,
    unknown: false,
  };
  tasks.set(key, next);
  emit();
  if (!isTerminalTaskStatus(latest.status)) return;
  finish(key, next);
}

/** 兜底文案：适配器没登记的任务类型（不该发生）也要能说清"出结果了"。 */
function fallbackNotices(task: BackgroundTask) {
  return {
    doneTitle: t("backgroundTasks.notice.done.title"),
    doneDescription: task.label,
    failedTitle: t("backgroundTasks.announce.failed", { label: task.label }),
    failedDescription: task.error,
    cancelledTitle: t("backgroundTasks.toast.cancelled", { name: task.label }),
    viewLabel: t("backgroundTasks.action.view"),
  };
}

function finish(key: string, task: BackgroundTask): void {
  tasks.delete(key);
  // 任务到终态：持久化条目一并清掉（提醒由下面的统一出口发，恢复逻辑不再管这个任务）。
  persistRemoveTask(task.kind, task.id);
  stopPollingIfIdle();
  // **必须 emit**：`applyUpdate` 在调用这里之前已经 emit 过一次（那一次的列表里还有这个
  // 任务），如果删掉之后不再通知，订阅者看到的永远是"任务还在"，而快照缓存也停在旧值上。
  emit();
  const handler = finishHandlers.get(key);
  finishHandlers.delete(key);
  // **先通知，再回调**：即使业务侧的回调抛错（例如取预览失败），用户也该收到"跑完了"这件事。
  const watchers = attached.has(key);
  attached.delete(key);
  const notices = getBackgroundTaskAdapter(task.kind)?.notices() ?? fallbackNotices(task);
  if (task.status === "completed") {
    notifyTaskDone({
      // 有界面在看就不要再弹一个居中弹窗打断它；用户已经走了才需要"叫住他"。
      modal: !watchers,
      title: notices.doneTitle,
      description: notices.doneDescription,
      confirmLabel: t("backgroundTasks.confirm.gotIt"),
      // 深链让"跑完了"这件事可点：直接落到这条记录上，而不是把用户丢到列表页再自己找。
      deepLink: task.deepLink,
      viewLabel: notices.viewLabel,
    });
  } else if (task.status === "failed") {
    notifyTaskDone({
      kind: "error",
      title: notices.failedTitle,
      description: task.error || notices.failedDescription,
    });
  } else {
    notifyTaskDone({ kind: "warning", title: notices.cancelledTitle });
  }
  handler?.(task);
}

/**
 * 登记一个正在进行中的任务（所有任务类型的唯一入口）。
 *
 * @param kind 任务类型（决定用哪个适配器轮询/取消/算深链）
 * @param id 后端任务 id
 * @param label 人话说明这是谁的任务
 * @param initial 初始状态（登记时后端刚返回的那一份）
 * @param onFinished 终态回调（用它刷新预览、切界面）；**通知与提示音不在这里做**，
 *   由本模块统一负责，避免"有的地方响、有的地方不响"。
 */
function watchTask(
  kind: BackgroundTaskKind,
  id: number,
  label: string,
  initial: BackgroundTaskUpdate,
  onFinished?: (task: BackgroundTask) => void,
): void {
  const key = backgroundTaskKey(kind, id);
  tasks.set(key, {
    key,
    kind,
    id,
    label,
    ...initial,
    // 初始快照里 `resultData` 是可选的：收敛成 `null`，别让 optional 渗进必需字段。
    resultData: initial.resultData ?? null,
    unknown: false,
  });
  if (onFinished) finishHandlers.set(key, onFinished);
  persistAddTask({ taskId: id, kind, label, registeredAt: new Date().toISOString() });
  ensurePolling();
  emit();
  // 立刻拉一次：刚启动的任务不该等到下一个间隔才有进度。
  void tick();
}

/** 登记一个简历生成任务（既有调用点保持不变）。 */
export function watchResumeTask(
  task: ResumeGenerateTask,
  label: string,
  onFinished?: (task: BackgroundTask) => void,
): void {
  watchTask("resume_generate", task.id, label, updateFromResumeTask(task), onFinished);
}

/**
 * 登记一个通用 AI 任务（`/ai-tasks`）：本轮起接入的新入口都走它。
 *
 * `label` 缺省用后端给的 `label`；再缺省按 kind 兜一句（否则页头会出现一条无名任务）。
 */
export function watchAiTask(
  task: AiTaskSnapshot,
  label?: string,
  onFinished?: (task: BackgroundTask) => void,
): void {
  const fallback =
    task.kind === "job_match" ? t("backgroundTasks.aiTask.jobMatch.label") : task.kind;
  watchTask(
    task.kind,
    task.id,
    label || task.label || fallback,
    updateFromAiTask(task),
    onFinished,
  );
}

/**
 * 手动推进一轮轮询。
 *
 * 两个用途：测试里不必等真实的 1.5s；以及将来"用户回到页面时立刻刷新一次"这类需求。
 */
export async function tickBackgroundTasks(): Promise<void> {
  await tick();
}

/** 声明"这个任务的界面正开着"；返回 detach。没声明的任务完成时用居中弹窗提醒。 */
export function attachTaskUi(key: string): () => void {
  attached.add(key);
  return () => attached.delete(key);
}

export function getBackgroundTasks(): BackgroundTask[] {
  return snapshot();
}

export function subscribeBackgroundTasks(listener: BackgroundTaskListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 把条目从登记表里移除（页头列表、持久化与轮询一并清理），不触发任何提醒。
 *
 * 两个用途：任务到终态时的清理路径（`finish`），以及「状态未知」条目的手动「移除」。
 */
function removeTaskEntry(key: string): void {
  const entry = tasks.get(key);
  tasks.delete(key);
  failureCounts.delete(key);
  finishHandlers.delete(key);
  attached.delete(key);
  if (entry) persistRemoveTask(entry.kind, entry.id);
  stopPollingIfIdle();
  emit();
}

/** 「状态未知」任务的「移除」：结果无从得知，也不再轮询，把条目从页头清掉。 */
export function dismissBackgroundTask(key: string): void {
  removeTaskEntry(key);
}

/**
 * 取消一个后台任务（后端协作式停下执行体，且不保存半成品）。
 *
 * 后端返回 404（任务记录已清理 / 后端重启）时移除条目并抛出「任务记录已不存在」——
 * 调用方的错误提示会原样展示这句话；不抛的话取消按钮会永远转圈。
 */
export async function cancelBackgroundTask(key: string): Promise<void> {
  const entry = tasks.get(key);
  if (!entry) return;
  const adapter = getBackgroundTaskAdapter(entry.kind);
  if (!adapter) return;
  let latest: BackgroundTaskUpdate;
  try {
    latest = await adapter.cancel(entry.id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      removeTaskEntry(key);
      throw new ApiError(t("backgroundTasks.error.taskRecordGone"), 404);
    }
    throw error;
  }
  applyUpdate(key, latest);
}

/** 测试与"换数据集"之类场景用：清空登记表。 */
export function resetBackgroundTasks(): void {
  tasks.clear();
  failureCounts.clear();
  finishHandlers.clear();
  attached.clear();
  stopPollingIfIdle();
  clearPersistedTasks();
  emit();
}

/** 刷新后恢复单条持久化条目；返回是否需要继续（无返回值，失败静默）。 */
async function restoreEntry(entry: PersistedTaskEntry): Promise<void> {
  // 旧条目没有 kind（本字段是随第二种任务一起引入的）：按简历生成处理。
  const kind = entry.kind ?? "resume_generate";
  const adapter: BackgroundTaskAdapter | null = getBackgroundTaskAdapter(kind);
  if (!adapter) {
    persistRemoveTask(kind, entry.taskId);
    return;
  }
  try {
    const latest = await adapter.fetch(entry.taskId);
    if (latest.status === "completed") {
      persistRemoveTask(kind, entry.taskId);
      const notices = adapter.notices();
      notifyTaskDone({
        modal: true,
        title: notices.doneTitle,
        description: notices.restoredDescription ?? notices.doneDescription,
        confirmLabel: t("backgroundTasks.confirm.gotIt"),
        deepLink: latest.deepLink,
        viewLabel: notices.viewLabel,
      });
      return;
    }
    if (latest.status === "failed") {
      persistRemoveTask(kind, entry.taskId);
      const notices = adapter.notices();
      notifyTaskDone({
        kind: "error",
        title: notices.failedTitle,
        description: latest.error || notices.failedDescription,
      });
      return;
    }
    if (isTerminalTaskStatus(latest.status)) {
      persistRemoveTask(kind, entry.taskId);
      return;
    }
    // 仍在运行：重新登记（watchTask 会把条目写回 localStorage，并立即拉一次进度）。
    watchTask(kind, entry.taskId, entry.label, latest);
  } catch {
    // 任务记录已清理或后端不认识这个 id：静默清掉，不提醒。
    persistRemoveTask(kind, entry.taskId);
  }
}

/**
 * 兜底恢复：把 `/ai-tasks/active` 里还在跑、但 localStorage 里没有的任务补登记。
 *
 * 为什么需要：localStorage 可能被清（隐私模式、用户清缓存、换浏览器配置），而任务在
 * 后端还在跑——只靠 localStorage 会永远丢掉这批任务的进度与完成提醒。
 */
async function restoreActiveAiTasks(): Promise<void> {
  let active: AiTaskSnapshot[];
  try {
    active = await listActiveAiTasks();
  } catch {
    return; // 后端不可用 / 端点未就绪：不阻塞恢复流程。
  }
  for (const task of active) {
    const key = backgroundTaskKey(task.kind, task.id);
    if (tasks.has(key)) continue;
    watchAiTask(task);
  }
}

/**
 * 刷新后恢复登记表（应用挂载时由 NotifyHostBridge 调一次，不阻塞首屏）。
 *
 * 对每条存留的 localStorage 条目查一次后端状态：
 * - 已完成 / 失败 → 走 `taskNotify` 的统一出口补发提醒（刷新后没有界面"在看"，与常规
 *   流程一样用居中弹窗 / 错误提示），并清掉条目；
 * - 仍在运行 → 重新登记并拉起轮询；
 * - 查不到（任务记录已清理 / 后端重启）→ 静默清掉条目，不提醒。
 *
 * 最后再向 `/ai-tasks/active` 兜一次底，把"localStorage 没有但后端还在跑"的任务补上。
 * 返回 Promise 只为测试可以等到全部恢复完成；调用方 fire-and-forget 即可。
 */
export async function restoreBackgroundTasks(): Promise<void> {
  const entries = readPersistedEntries();
  if (entries.length > 0) {
    await Promise.all(entries.map((entry) => restoreEntry(entry)));
  }
  await restoreActiveAiTasks();
}
