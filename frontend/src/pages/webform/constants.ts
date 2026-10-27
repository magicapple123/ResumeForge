// SPDX-License-Identifier: Apache-2.0
/**
 * 网申填表页的共享常量。
 * （自 WebFormPage 拆出，逐字搬运。）
 */
import type { MessageKey } from "../../i18n";

/** URL 里记住当前这次读取的参数名。 */
export const SNAPSHOT_PARAM = "snapshot";
/** AI 开关也一起记住：重放预览时要用同一个值，否则"读的时候开了 AI、回来却重算成规则版"。 */
export const AI_PARAM = "ai";
export const WEB_FORM_STATUS_POLL_INTERVAL_MS = 600;

/**
 * 浏览器窗口里正在发生什么，在这边如实显示——不然用户不知道模式开着没有。
 *
 * labelKey 是语言包 key（模块作用域不能求值 t()，否则语言被钉死在加载那一刻），
 * 渲染处写成 t(labelKey)；color 仍是 antd 的语义色名。
 */
export const LIVE_STATUS_META: Record<string, { labelKey: MessageKey; color: string }> = {
  thinking: { labelKey: "webFormPage.liveStatus.thinking", color: "processing" },
  ai_thinking: { labelKey: "webFormPage.liveStatus.aiThinking", color: "processing" },
  matched: { labelKey: "webFormPage.liveStatus.matched", color: "success" },
  blocked: { labelKey: "webFormPage.liveStatus.blocked", color: "default" },
  unmatched: { labelKey: "webFormPage.liveStatus.unmatched", color: "warning" },
  filled: { labelKey: "webFormPage.liveStatus.filled", color: "success" },
  failed: { labelKey: "webFormPage.liveStatus.failed", color: "error" },
  "": { labelKey: "webFormPage.liveStatus.waiting", color: "processing" },
};

/** 页面级 busy 联合态：任何一个动作在跑，其余入口都按各自规则禁用。 */
export type WebFormBusyState =
  "start" | "read" | "fill" | "stop" | "end" | "live" | "refresh" | "diagnostics" | null;
