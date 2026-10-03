/**
 * 网申填表页的共享常量。
 * （自 WebFormPage 拆出，逐字搬运。）
 */

/** URL 里记住当前这次读取的参数名。 */
export const SNAPSHOT_PARAM = "snapshot";
/** AI 开关也一起记住：重放预览时要用同一个值，否则"读的时候开了 AI、回来却重算成规则版"。 */
export const AI_PARAM = "ai";
export const WEB_FORM_STATUS_POLL_INTERVAL_MS = 600;

/** 浏览器窗口里正在发生什么，在这边如实显示——不然用户不知道模式开着没有。 */
export const LIVE_STATUS_META: Record<string, { label: string; color: string }> = {
  thinking: { label: "正在看这个框", color: "processing" },
  ai_thinking: { label: "AI 正在识别", color: "processing" },
  matched: { label: "已给出建议", color: "success" },
  blocked: { label: "不会自动填", color: "default" },
  unmatched: { label: "没认出来", color: "warning" },
  filled: { label: "已填入", color: "success" },
  failed: { label: "没填进去", color: "error" },
  "": { label: "等待你点某个框", color: "processing" },
};

/** 页面级 busy 联合态：任何一个动作在跑，其余入口都按各自规则禁用。 */
export type WebFormBusyState =
  "start" | "read" | "fill" | "stop" | "end" | "live" | "refresh" | "diagnostics" | null;
