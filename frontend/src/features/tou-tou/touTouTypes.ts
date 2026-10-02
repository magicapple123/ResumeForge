/** 投投悬浮球的状态与跨组件事件契约。 */

export const TOU_TOU_SETTING_EVENT = "resumeforge:assistant-orb-setting";

export type TouTouStatus = "idle" | "curious" | "thinking" | "done" | "error" | "sleep";
export type TouTouEdge = "left" | "right" | "top" | "bottom";

/**
 * 设置页派发的悬浮球设置变更事件。
 *
 * `tips_enabled` 是**可选**字段：缺省时消费方不得改动现值——这保证旧的生产方
 * （只派发 `enabled` 的老代码）不会把标语开关意外打回默认。
 */
export interface TouTouSettingEventDetail {
  enabled: boolean;
  tips_enabled?: boolean;
}
