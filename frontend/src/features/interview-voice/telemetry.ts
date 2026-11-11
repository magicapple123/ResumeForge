// SPDX-License-Identifier: Apache-2.0
/**
 * 26H 前端观测：VAD 起止 / 端点耗时 / LLM TTFT / 是否打断 / 打断延迟 / 回滚字数。
 *
 * 走 ``utils/clientDiagnostics``（本机环形缓冲，桌面菜单「复制诊断信息」可导出），
 * **只记数字与状态，不记任何对话内容**；字段名以 ``interview-voice.`` 前缀分组，
 * 便于过滤。
 */

import { recordClientDiagnostic } from "../../utils/clientDiagnostics";

export type VoiceTelemetryEvent =
  | "interview-voice.vad-start"
  | "interview-voice.vad-end"
  | "interview-voice.endpoint"
  | "interview-voice.upload"
  | "interview-voice.llm-ttft"
  | "interview-voice.barge-in"
  | "interview-voice.rollback";

export interface VoiceTelemetryFields {
  /** VAD 开口到说完的语音时长（ms）。 */
  speechMs?: number;
  /** 说完到"决定发出/上传"的静音时长（ms）。 */
  silenceMs?: number;
  /** 说完到端点决策完成的耗时（ms）。 */
  endpointMs?: number;
  /** 端点决策结果：complete / release / deadline / extended-deadline / thinking-timeout。 */
  decision?: string;
  /** 分段上传的 ASR 耗时（ms）。 */
  uploadMs?: number;
  /** LLM 首字（question_delta）延迟（ms）；没测到为 -1。 */
  llmTtftMs?: number;
  /** 插话检测延迟：从开口到硬停（ms）；未硬停为 -1。 */
  interruptLatencyMs?: number;
  /** 是否真的硬停（区别于"短反馈词，继续说完"）。 */
  interrupted?: boolean;
  /** 回滚字数。 */
  rolledBackChars?: number;
  /** 已播出字数。 */
  playedChars?: number;
}

/** 结构化记录一条语音观测（不含对话内容）。 */
export function recordVoiceTelemetry(
  event: VoiceTelemetryEvent,
  fields: VoiceTelemetryFields = {},
): void {
  recordClientDiagnostic(event, { ...fields });
}

/**
 * 一轮语音问答的计时器：在关键节点打点，最后算差值。
 *
 * 只做"打点 → 耗时"，不做判定；判定在 endpoint / bargeIn 里。注入 now 便于测试。
 */
export class VoiceTurnClock {
  private readonly marks = new Map<string, number>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  mark(name: string): number {
    const at = this.now();
    this.marks.set(name, at);
    return at;
  }

  /** 两个打点之间的耗时；任一点缺失返回 undefined。 */
  elapsedMs(from: string, to: string): number | undefined {
    const start = this.marks.get(from);
    const end = this.marks.get(to);
    if (start === undefined || end === undefined) return undefined;
    return Math.max(0, Math.round(end - start));
  }

  has(name: string): boolean {
    return this.marks.has(name);
  }

  reset(): void {
    this.marks.clear();
  }
}
