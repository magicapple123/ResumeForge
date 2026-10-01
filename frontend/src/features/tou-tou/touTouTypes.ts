/** 投投悬浮球的状态与跨组件事件契约。 */

export const TOU_TOU_SETTING_EVENT = "resumeforge:assistant-orb-setting";

export type TouTouStatus = "idle" | "curious" | "thinking" | "done" | "error" | "sleep";
export type TouTouEdge = "left" | "right" | "top" | "bottom";

export interface TouTouSettingEventDetail {
  enabled: boolean;
}
