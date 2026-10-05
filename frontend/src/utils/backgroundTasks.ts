/**
 * 后台任务登记表：让"关掉窗口也继续跑"这件事真的有结果。
 *
 * **为什么需要它**：简历生成的轮询原本写在生成弹窗里（`GenerateResumeModal` 的 useEffect）。
 * 用户点「后台继续（关闭弹窗）」之后组件卸载，**轮询也跟着停了**——任务在后端还在跑，但
 * 前端再也没人去问它结果，于是"完成后会提醒你"成了一句空话（用户反馈"当前后台任务完成后
 * 并没有弹窗和完成音提醒"）。
 *
 * 所以把轮询搬到模块级：进程内的单例，与任何组件生命周期无关。它同时提供两件事：
 * 1. **完成/失败时用统一出口提醒**（弹窗 + 提示音，见 utils/taskNotify）；
 * 2. **一份可订阅的任务列表**，让页头能显示"正在进行的任务 + 进度 + 取消"。
 *
 * 跨页面刷新：任务元数据（id / label / 登记时间，**不含回调**）在登记时写进 localStorage；
 * 刷新后应用挂载时调用 `restoreBackgroundTasks()` 恢复——已完成的补发完成提醒、仍在运行的
 * 重新拉起轮询。后端任务记录本身不受刷新影响（它有自己的记录），这里补的只是前端这一侧的
 * 提醒与追踪。localStorage 不可用（隐私模式等）时全部静默降级为原来的行为。
 */
import { cancelResumeGenerateTask, getResumeGenerateTask } from "../api/resumes";
import { ApiError } from "../api/client";
import type { ResumeGenerateTask, ResumeGenerateTaskStatus } from "../types";
import { notifyTaskDone } from "./taskNotify";
import { isDocumentHidden, onVisibilityChange } from "./visibility";

/** 界面要显示的运行时快照（不直接暴露后端原始对象，避免组件依赖它的全部字段）。 */
export interface BackgroundTask {
  id: number;
  /** 人话说明这是谁的任务，例如「为「前端开发」生成简历」。 */
  label: string;
  status: ResumeGenerateTaskStatus;
  /** 后端给的进度文案（"正在写第 2 段…"）。 */
  message: string;
  receivedChars: number;
  resumeId: number | null;
  error: string;
  /**
   * 连续轮询失败（或后端明确返回 404）后置真：后端重启 / 记录被清理时任务永远不会有
   * 终态，页头会永久转圈。置真后**不**触发成功/失败提醒（结果真的不知道），界面显示
   * 「状态未知」并给「移除」按钮；之后某轮轮询成功则自动恢复。
   */
  unknown: boolean;
}

type Listener = (tasks: BackgroundTask[]) => void;

/** 轮询间隔：与原来的弹窗内轮询一致，1.5s 足够跟手又不至于太吵。 */
export const POLL_INTERVAL_MS = 1500;

/** 跨刷新持久化的 localStorage 键：只存元数据，不存回调。 */
const STORAGE_KEY = "rf.backgroundTasks.v1";

interface PersistedTaskEntry {
  taskId: number;
  label: string;
  registeredAt: string;
}

/** localStorage 的读写全部 try/catch：隐私模式 / 配额满都不能影响主流程。 */
function readPersistedEntries(): PersistedTaskEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PersistedTaskEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as PersistedTaskEntry).taskId === "number" &&
        typeof (entry as PersistedTaskEntry).label === "string",
    );
  } catch {
    return [];
  }
}

function writePersistedEntries(entries: PersistedTaskEntry[]): void {
  try {
    if (entries.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    }
  } catch {
    // 写不进去就当没有持久化能力，行为退回刷新即丢。
  }
}

function persistAddTask(taskId: number, label: string): void {
  const entries = readPersistedEntries();
  if (entries.some((entry) => entry.taskId === taskId)) return;
  entries.push({ taskId, label, registeredAt: new Date().toISOString() });
  writePersistedEntries(entries);
}

function persistRemoveTask(taskId: number): void {
  const entries = readPersistedEntries();
  const next = entries.filter((entry) => entry.taskId !== taskId);
  if (next.length === entries.length) return;
  writePersistedEntries(next);
}

const tasks = new Map<number, BackgroundTask>();
/** 每个登记任务的连续轮询失败计数（成功一轮即清零）。 */
const failureCounts = new Map<number, number>();
/** 连续失败多少轮后承认「状态未知」。 */
const UNKNOWN_AFTER_FAILURES = 3;
/** 任务终态时要通知谁（弹窗打开时要刷新预览；关掉之后没人需要）。 */
const finishHandlers = new Map<number, (task: BackgroundTask) => void>();
/** 哪些任务当前"有界面在看"，决定完成时是右上角卡片还是居中弹窗。 */
const attached = new Set<number>();
const listeners = new Set<Listener>();
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

function isTerminal(status: ResumeGenerateTaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

async function tick(): Promise<void> {
  if (tasks.size === 0) {
    stopPollingIfIdle();
    return;
  }
  await Promise.all(
    [...tasks.keys()].map(async (id) => {
      try {
        const latest = await getResumeGenerateTask(id);
        // 这一轮成功了：失败计数清零，「状态未知」也随真实进度恢复为正常显示。
        failureCounts.delete(id);
        applyUpdate(id, latest);
      } catch (error) {
        // 单次失败不打断（后端短暂不可用，等下一轮自愈）；但连着失败或明确 404 时
        // 必须承认"状态未知"，否则任务永不终态，页头永久转圈、取消每次 404。
        const entry = tasks.get(id);
        if (!entry) return;
        if (error instanceof ApiError && error.status === 404) {
          markTaskUnknown(id);
          return;
        }
        const count = (failureCounts.get(id) ?? 0) + 1;
        failureCounts.set(id, count);
        if (count >= UNKNOWN_AFTER_FAILURES) markTaskUnknown(id);
      }
    }),
  );
}

/** 把条目标成「状态未知」：不触发成功/失败提醒（结果真的不知道），只更新界面。 */
function markTaskUnknown(id: number): void {
  const entry = tasks.get(id);
  if (!entry || entry.unknown) return;
  tasks.set(id, {
    ...entry,
    unknown: true,
    message: "任务状态未知：后端可能已重启或记录已被清理",
  });
  emit();
}

function applyUpdate(id: number, latest: ResumeGenerateTask): void {
  const existing = tasks.get(id);
  if (!existing) return;
  const next: BackgroundTask = {
    ...existing,
    status: latest.status,
    message: latest.message,
    receivedChars: latest.received_chars,
    resumeId: latest.resume_id,
    error: latest.error,
    unknown: false,
  };
  tasks.set(id, next);
  emit();
  if (!isTerminal(latest.status)) return;
  finish(id, next);
}

function finish(id: number, task: BackgroundTask): void {
  tasks.delete(id);
  // 任务到终态：持久化条目一并清掉（提醒由下面的统一出口发，恢复逻辑不再管这个任务）。
  persistRemoveTask(id);
  stopPollingIfIdle();
  // **必须 emit**：`applyUpdate` 在调用这里之前已经 emit 过一次（那一次的列表里还有这个
  // 任务），如果删掉之后不再通知，订阅者看到的永远是"任务还在"，而快照缓存也停在旧值上
  // ——页头的任务面板不会消失，`getBackgroundTasks()` 也永远返回它。
  emit();
  const handler = finishHandlers.get(id);
  finishHandlers.delete(id);
  // **先通知，再回调**：即使业务侧的回调抛错（例如取预览失败），用户也该收到"跑完了"这件事。
  const watchers = attached.has(id);
  attached.delete(id);
  if (task.status === "completed") {
    notifyTaskDone({
      // 有界面在看就不要再弹一个居中弹窗打断它；用户已经走了才需要"叫住他"。
      modal: !watchers,
      title: "简历已生成",
      description: "已自动保存到简历中心，可以继续微调或导出。",
      confirmLabel: "知道了",
    });
  } else if (task.status === "failed") {
    notifyTaskDone({
      kind: "error",
      title: "简历生成失败",
      description: task.error || "可以回到简历中心重试。",
    });
  } else {
    notifyTaskDone({ kind: "warning", title: "简历生成已取消" });
  }
  handler?.(task);
}

/**
 * 登记一个正在进行中的生成任务。
 *
 * @param task 后端返回的初始任务（含 id 与状态）
 * @param label 人话说明这是谁的任务
 * @param onFinished 终态回调（用它刷新预览、切界面）；**通知与提示音不在这里做**，
 *   由本模块统一负责，避免"有的地方响、有的地方不响"。
 */
export function watchResumeTask(
  task: ResumeGenerateTask,
  label: string,
  onFinished?: (task: BackgroundTask) => void,
): void {
  tasks.set(task.id, {
    id: task.id,
    label,
    status: task.status,
    message: task.message,
    receivedChars: task.received_chars,
    resumeId: task.resume_id,
    error: task.error,
    unknown: false,
  });
  if (onFinished) finishHandlers.set(task.id, onFinished);
  persistAddTask(task.id, label);
  ensurePolling();
  emit();
  // 立刻拉一次：刚启动的任务不该等到下一个间隔才有进度。
  void tick();
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
export function attachTaskUi(id: number): () => void {
  attached.add(id);
  return () => attached.delete(id);
}

export function getBackgroundTasks(): BackgroundTask[] {
  return snapshot();
}

export function subscribeBackgroundTasks(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 把条目从登记表里移除（页头列表、持久化与轮询一并清理），不触发任何提醒。
 *
 * 两个用途：任务到终态时的清理路径（`finish`），以及「状态未知」条目的手动「移除」。
 */
function removeTaskEntry(id: number): void {
  tasks.delete(id);
  failureCounts.delete(id);
  finishHandlers.delete(id);
  attached.delete(id);
  persistRemoveTask(id);
  stopPollingIfIdle();
  emit();
}

/** 「状态未知」任务的「移除」：结果无从得知，也不再轮询，把条目从页头清掉。 */
export function dismissBackgroundTask(id: number): void {
  removeTaskEntry(id);
}

/**
 * 取消一个后台任务（后端会把任务置为取消，且不保存半成品）。
 *
 * 后端返回 404（任务记录已清理 / 后端重启）时移除条目并抛出「任务记录已不存在」——
 * 调用方的错误提示会原样展示这句话；不抛的话取消按钮会永远转圈。
 */
export async function cancelBackgroundTask(id: number): Promise<void> {
  let latest: ResumeGenerateTask;
  try {
    latest = await cancelResumeGenerateTask(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      removeTaskEntry(id);
      throw new ApiError("任务记录已不存在", 404);
    }
    throw error;
  }
  applyUpdate(id, latest);
}

/** 测试与"换数据集"之类场景用：清空登记表。 */
export function resetBackgroundTasks(): void {
  tasks.clear();
  failureCounts.clear();
  finishHandlers.clear();
  attached.clear();
  stopPollingIfIdle();
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略：localStorage 不可用时本来也没有东西可清。
  }
  emit();
}

/**
 * 刷新后恢复登记表（应用挂载时由 NotifyHostBridge 调一次，不阻塞首屏）。
 *
 * 对每条存留的 localStorage 条目查一次后端状态：
 * - 已完成 / 失败 → 走 `taskNotify` 的统一出口补发提醒（刷新后没有界面"在看"，与常规
 *   流程一样用居中弹窗 / 错误提示），并清掉条目；
 * - 仍在运行 → 重新 `watchResumeTask` 拉起轮询；
 * - 查不到（任务记录已清理 / 后端重启）→ 静默清掉条目，不提醒。
 *
 * 返回 Promise 只为测试可以等到全部恢复完成；调用方 fire-and-forget 即可。
 */
export async function restoreBackgroundTasks(): Promise<void> {
  const entries = readPersistedEntries();
  if (entries.length === 0) return;
  await Promise.all(
    entries.map(async (entry) => {
      try {
        const task = await getResumeGenerateTask(entry.taskId);
        if (task.status === "completed") {
          persistRemoveTask(entry.taskId);
          notifyTaskDone({
            modal: true,
            title: "简历已生成",
            description: "刷新前开始的生成任务已完成，简历已自动保存到简历中心。",
            confirmLabel: "知道了",
          });
        } else if (task.status === "failed") {
          persistRemoveTask(entry.taskId);
          notifyTaskDone({
            kind: "error",
            title: "简历生成失败",
            description: task.error || "可以回到简历中心重试。",
          });
        } else if (isTerminal(task.status)) {
          persistRemoveTask(entry.taskId);
        } else {
          // 仍在运行：重新登记（watchResumeTask 会把条目写回 localStorage，并立即拉一次进度）。
          watchResumeTask(task, entry.label);
        }
      } catch {
        // 任务记录已清理或后端不认识这个 id：静默清掉，不提醒。
        persistRemoveTask(entry.taskId);
      }
    }),
  );
}
