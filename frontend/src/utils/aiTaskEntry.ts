// SPDX-License-Identifier: Apache-2.0
/**
 * 一个 AI 生成入口接入统一任务地基的**唯一入口**（「接一个新入口要改 5 处」里前端那一处）。
 *
 * 它把三件必须一起做的事收进一次调用：
 * 1. `POST /ai-tasks` 建任务（立刻返回，不等模型跑完——连接断了任务照样跑）；
 * 2. `watchAiTask` 登记进唯一任务表（页头进度 + 常驻任务条 + 统一通知出口，刷新后能恢复）；
 * 3. 结果回传：成功时由 `aiTaskResultSink` 交回领域 store（**这条也覆盖刷新恢复**），
 *    失败/取消由调用方在 `onFinished` 里收尾。
 *
 * 为什么值得多一层：四个入口如果各写一遍"建任务 + 登记 + 附着 + 失败收尾"，第三次就会有
 * 一处漏掉，表现成"用户明明在看结果，右上角还是弹了一张卡片"，或者"取消了但页头还在转"。
 *
 * **不要**在这里做通知：通知与提示音统一由 `backgroundTasks.finish` 一个出口负责，
 * 调用方只管把结果搬到它该在的地方。
 */
import { createAiTask } from "../api/aiTasks";
import type { AiTaskKind } from "../types";
import {
  attachTaskUi,
  backgroundTaskKey,
  cancelBackgroundTask,
  watchAiTask,
} from "./backgroundTasks";
import type { BackgroundTask } from "./backgroundTasks.types";

export interface StartAiTaskInput {
  kind: AiTaskKind;
  /** 输入摘要：只放标识与选项，**不放**完整 JD / 简历正文 / 资料正文。 */
  payload: Record<string, unknown>;
  /** 人话说明（页头任务面板直接显示）。 */
  label: string;
  /**
   * 终态回调。**成功不必在这里处理**（结果由 `aiTaskResultSink` 交回领域 store），
   * 这里只收失败与取消两种"没有结果要交回"的收尾。
   */
  onFinished?: (task: BackgroundTask) => void;
}

/** 起一个任务后的把手：`key` 是登记表主键，附着与取消都用它。 */
export interface StartedAiTask {
  id: number;
  key: string;
}

/**
 * 建任务并登记轮询。抛错（后端未就绪 / 类型未注册 / 数据集正在切换）由调用方接住
 * 并落到自己的错误态——那一步不该被这里吞掉。
 */
export async function startAiTask(input: StartAiTaskInput): Promise<StartedAiTask> {
  const snapshot = await createAiTask({
    kind: input.kind,
    payload: input.payload,
    label: input.label,
  });
  const key = backgroundTaskKey(input.kind, snapshot.id);
  watchAiTask(snapshot, input.label, input.onFinished);
  return { id: snapshot.id, key };
}

/**
 * 声明"这个任务的界面正开着"；返回 detach。
 *
 * 语义与 `attachTaskUi` 一致：有人在看时完成提醒不弹居中弹窗（结果已经画在他眼前），
 * 没人在看才"叫住他"。**重复 attach 前先 detach**——调用方负责，别在这里攒引用计数
 * （计数交给 registry 的 Set 会互相抵消，反而漏掉通知）。
 */
export function attachAiTaskUi(key: string): () => void {
  return attachTaskUi(key);
}

/** 取消一个任务（后端协作式停下执行体，不只是改状态）。 */
export async function cancelAiTaskEntry(key: string): Promise<void> {
  await cancelBackgroundTask(key);
}

/** 登记表主键的转发（调用方少 import 一处）。 */
export function aiTaskKey(kind: AiTaskKind, id: number): string {
  return backgroundTaskKey(kind, id);
}
