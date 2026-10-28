// SPDX-License-Identifier: Apache-2.0
/**
 * 后台任务登记表的**类型与常量**（从 `backgroundTasks.ts` 拆出来）。
 *
 * 为什么拆：主文件已 425 行、预算 500，而本轮要接入第二种任务（单条岗位适配）。
 * 拆分策略是"按变化原因分文件"——本文件只放**形状**（谁会被显示、一次轮询回什么），
 * 适配层放各任务类型的差异（`backgroundTasks.adapters.ts`），主文件只剩对外 API 与
 * 轮询循环。这样以后加第四种任务时，只需要在 adapters 里加一个适配器。
 */

/** 后端任务状态，统一成"简历任务"那一套词（`completed` / `cancelled`）。 */
export type BackgroundTaskStatus = "pending" | "running" | "completed" | "cancelled" | "failed";

/** 任务类型：与后端 `ai_task.kind` 同名；简历生成沿用既有的独立任务表。 */
export type BackgroundTaskKind =
  | "resume_generate"
  | "job_match"
  | "job_analysis"
  | "resume_risk"
  | "resume_rewrite"
  | "webform_fill"
  | (string & {});

/** 界面要显示的运行时快照（不直接暴露后端原始对象，避免组件依赖它的全部字段）。 */
export interface BackgroundTask {
  /** 登记表内部主键：`<kind>#<id>`。两种任务各有自己的 id 序列，只用数字会撞车。 */
  key: string;
  kind: BackgroundTaskKind;
  /** 后端任务 id（简历生成任务 id / ai_task.id）。 */
  id: number;
  /** 人话说明这是谁的任务，例如「为「前端开发」生成简历」。 */
  label: string;
  status: BackgroundTaskStatus;
  /** 后端给的进度文案（"正在写第 2 段…"）。 */
  message: string;
  /** 0–100 的粗粒度进度；后端给不出百分比时为 `null`（界面不画进度条）。 */
  progressPercent: number | null;
  /** 简历生成专有：已接收的模型输出字数。其它任务恒为 0。 */
  receivedChars: number;
  /** 简历生成专有：完成后的简历 id（深链已由适配器算好，组件不该再拼地址）。 */
  resumeId: number | null;
  /** 通用结果标识（岗位 id 等）；没有落点时为 `null`。 */
  refId: number | null;
  /**
   * 完成后该跳去哪（由 `utils/taskDeepLinks` 生成，如 `/resumes?resume_id=<id>`）。
   * 结果还没落库（id 为空）时是 `null`——那时没有落点，通知也不该给跳转按钮。
   */
  deepLink: string | null;
  /**
   * 后端的 `result_ref` 原样：落点标识 + **没有业务表**的那几种入口的结果本身
   * （风险扫描报告 / 岗位化建议 / 网申预览）。领域 store 从这里取结果，不必再问一次后端。
   * 没有落点时为 `null`。
   */
  resultData: Record<string, unknown> | null;
  error: string;
  /**
   * 连续轮询失败（或后端明确返回 404）后置真：后端重启 / 记录被清理时任务永远不会有
   * 终态，页头会永久转圈。置真后**不**触发成功/失败提醒（结果真的不知道），界面显示
   * 「状态未知」并给「移除」按钮；之后某轮轮询成功则自动恢复。
   */
  unknown: boolean;
}

/** 订阅者收到的列表（引用稳定：内容没变就复用同一个数组）。 */
export type BackgroundTaskListener = (tasks: BackgroundTask[]) => void;

/**
 * 一次轮询 / 一次取消返回的**归一化**更新。
 *
 * 适配器负责把各家后端形状翻译成它：组件与主循环都只认这一种，新增任务类型不会
 * 让主循环长出分支。
 */
export interface BackgroundTaskUpdate {
  status: BackgroundTaskStatus;
  message: string;
  progressPercent: number | null;
  receivedChars: number;
  resumeId: number | null;
  refId: number | null;
  deepLink: string | null;
  /** 后端的 `result_ref` 原样（见 `BackgroundTask.resultData`）；没有时省略。 */
  resultData?: Record<string, unknown> | null;
  error: string;
}

/** 一组通知文案（按适配器给，因为不同任务的"完成"含义不同）。 */
export interface BackgroundTaskNotices {
  doneTitle: string;
  doneDescription: string;
  /** 刷新后补发完成提醒时的正文（默认退回 `doneDescription`）。 */
  restoredDescription?: string;
  failedTitle: string;
  failedDescription: string;
  cancelledTitle: string;
  /** 「去查看」那颗按钮的文案（例如「查看简历」）。 */
  viewLabel: string;
}

/** 轮询间隔：与原来的弹窗内轮询一致，1.5s 足够跟手又不至于太吵。 */
export const POLL_INTERVAL_MS = 1500;

/** 跨刷新持久化的 localStorage 键：只存元数据，不存回调。 */
export const STORAGE_KEY = "rf.backgroundTasks.v1";

/** 连续失败多少轮后承认「状态未知」。 */
export const UNKNOWN_AFTER_FAILURES = 3;

/** localStorage 里的一条任务元数据。 */
export interface PersistedTaskEntry {
  taskId: number;
  /** 缺省（0055 之前的旧条目）按简历生成处理，见主文件的恢复逻辑。 */
  kind?: BackgroundTaskKind;
  label: string;
  registeredAt: string;
}

/** 登记表内部主键的构造器：两种任务的 id 序列独立，必须带 kind 才不会撞。 */
export function backgroundTaskKey(kind: BackgroundTaskKind, id: number): string {
  return `${kind}#${id}`;
}

/** 简历生成任务的键（`GenerateResumeModal` 用它把"弹窗在看这个任务"告诉登记表）。 */
export function resumeTaskKey(id: number): string {
  return backgroundTaskKey("resume_generate", id);
}

/** 该状态是否已经结束（不会再变）。 */
export function isTerminalTaskStatus(status: BackgroundTaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
