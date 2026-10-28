// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位广场的批量 AI 动作执行器：一次只跑一个岗位，跑完再跑下一个。
 *
 * 为什么串行：这两个动作各自会打一次大模型。并发发出去时，本地小模型往往只能排队，
 * 用户看到的是"全都卡住"，失败时也分不清是哪一个岗位坏了。串行还有一个好处——中途
 * 可以停：当前岗位跑完就不再取下一个（已经发出去的请求不强行取消，避免留下半份数据）。
 *
 * 状态放在模块级而不是组件里：用户切到别的页面再回来，进度还在；跑完后统一弹通知。
 * 与 `jobMatchBackgroundTasks` 的区别是这里没有服务端任务表，进度只存在于本进程。
 */
import { useSyncExternalStore } from "react";
import { getJobAnalysisState, startJobAnalysis } from "./jobAnalysisStore";
import { getResumeGenerateTask, startResumeGeneration } from "../../api/resumes";
import type { BatchGenerationConfig } from "../../api/settingsBatch";
import { newResumeLayout } from "../resume-document/newResumeLayout";
import { t } from "../../i18n";
import { notifyTaskDone } from "../../utils/taskNotify";

export type BulkAiKind = "resume" | "analysis";

export interface BulkAiJob {
  id: number;
  title: string;
  company?: string;
}

export interface BulkAiState {
  running: boolean;
  kind: BulkAiKind | null;
  total: number;
  done: number;
  failed: number;
  currentTitle: string;
  /** 已请求停止：当前岗位跑完就收尾。 */
  stopRequested: boolean;
}

const IDLE: BulkAiState = Object.freeze({
  running: false,
  kind: null,
  total: 0,
  done: 0,
  failed: 0,
  currentTitle: "",
  stopRequested: false,
});

const POLL_INTERVAL_MS = 2_000;
const RESUME_TIMEOUT_MS = 15 * 60_000;
const ANALYSIS_TIMEOUT_MS = 5 * 60_000;

let state: BulkAiState = IDLE;
let stopped = false;
const listeners = new Set<() => void>();

function emit(next: Partial<BulkAiState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function subscribeBulkAi(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getBulkAiState(): BulkAiState {
  return state;
}

export function useBulkAiState(): BulkAiState {
  return useSyncExternalStore(subscribeBulkAi, getBulkAiState);
}

export function stopBulkAi(): void {
  if (!state.running) return;
  stopped = true;
  emit({ stopRequested: true });
}

function labelOf(kind: BulkAiKind): string {
  return t(kind === "resume" ? "jobsPage.bulkAi.resumeLabel" : "jobsPage.bulkAi.analysisLabel");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** 轮询一次生成任务直到终态；超时按失败算（任务本身可能仍在服务端跑）。 */
async function waitForResumeTask(taskId: number): Promise<boolean> {
  const deadline = Date.now() + RESUME_TIMEOUT_MS;
  while (Date.now() < deadline && !stopped) {
    await sleep(POLL_INTERVAL_MS);
    const task = await getResumeGenerateTask(taskId);
    if (task.status === "completed") return true;
    if (task.status === "failed" || task.status === "cancelled") return false;
  }
  return false;
}

async function generateResumeFor(
  job: BulkAiJob,
  config: BatchGenerationConfig | null,
): Promise<boolean> {
  const layout = newResumeLayout();
  // 参数来自「设置 → 批量操作」（调用方已确认配置过）；拿不到时退回新简历默认值，
  // 而不是猜一套"看起来合理"的版式。
  const started = await startResumeGeneration({
    job_id: job.id,
    options: {
      enhance: config?.enhance ?? false,
      enhancement_level: config?.enhancement_level ?? "balanced",
      page_limit: config?.page_limit ?? layout.page_limit,
      font_scale: config?.font_scale ?? layout.font_scale,
      language: config?.language ?? layout.language,
      template: config?.template ?? layout.template,
      format_name: config?.format_name ?? layout.format_name,
      format_config: {},
      custom_instruction: config?.custom_instruction ?? "",
    },
  });
  return waitForResumeTask(started.id);
}

/** 岗位解读走模块级 store：详情页的「需求解读」会直接显示这次的结果。 */
async function analyzeJobFor(job: BulkAiJob): Promise<boolean> {
  // force=false：已有解读直接复用（与手动打开详情再点「需求解读」看到的缓存一致），
  // 不因为"批量"就无条件重烧一次 token。
  startJobAnalysis({ jobId: job.id, title: job.title, company: job.company ?? "", force: false });
  const deadline = Date.now() + ANALYSIS_TIMEOUT_MS;
  while (Date.now() < deadline && !stopped) {
    await sleep(POLL_INTERVAL_MS);
    const status = getJobAnalysisState(job.id).status;
    if (status === "done") return true;
    if (status === "error" || status === "idle") return false;
  }
  return false;
}

async function run(
  kind: BulkAiKind,
  jobs: BulkAiJob[],
  config: BatchGenerationConfig | null,
): Promise<void> {
  stopped = false;
  emit({
    running: true,
    kind,
    total: jobs.length,
    done: 0,
    failed: 0,
    currentTitle: jobs[0]?.title ?? "",
    stopRequested: false,
  });
  let ok = 0;
  let failed = 0;
  for (const job of jobs) {
    if (stopped) break;
    emit({ currentTitle: job.title });
    try {
      const success =
        kind === "resume" ? await generateResumeFor(job, config) : await analyzeJobFor(job);
      if (success) {
        ok += 1;
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
    emit({ done: ok + failed, failed });
  }
  const label = labelOf(kind);
  const skipped = jobs.length - (ok + failed);
  emit({ running: false, kind: null, currentTitle: "", stopRequested: false });
  notifyTaskDone({
    kind: failed > 0 ? "warning" : "success",
    title: t("jobsPage.bulkAi.doneTitle", { label, ok, failed }),
    description: skipped > 0 ? t("jobsPage.bulkAi.skippedHint", { count: skipped }) : undefined,
  });
}

/** 启动一批；已有任务在跑时直接忽略（按钮侧也会禁用）。 */
export function startBulkAi(
  kind: BulkAiKind,
  jobs: BulkAiJob[],
  config: BatchGenerationConfig | null = null,
): void {
  if (state.running || jobs.length === 0) return;
  void run(kind, jobs, config);
}
