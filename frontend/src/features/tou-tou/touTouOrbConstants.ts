// SPDX-License-Identifier: Apache-2.0
/** 投投悬浮球的节拍/眨眼/抚摸常量、「助手独占」表情集合与定时器清理小工具。 */

import type { TouTouStatus } from "./touTouTypes";

const HIDE_AFTER_MS = 12_000;
const SLEEP_AFTER_MS = 60_000;
const CURIOUS_MS = 1_500;
const DONE_MS = 2_400;
/** 单击 / 双击的判窗：两次激活落在这个间隔内算双击（开剪贴板）。 */
const DOUBLE_CLICK_WINDOW_MS = 280;
/** 发呆时眨眼的间隔（带抖动，免得像节拍器）与眨眼时长。 */
const BLINK_MIN_MS = 6_000;
const BLINK_MAX_MS = 13_000;
const BLINK_MS = 130;
/** 抚摸判定：节流间隔、计数窗口、触发次数与持续时长。 */
const PET_STROKE_MIN_GAP_MS = 120;
const PET_WINDOW_MS = 700;
const PET_COUNT = 3;
const PET_HOLD_MS = 1_500;

/**
 * 助手的表情优先于本地小动作。
 *
 * 拖拽会切到「好奇」，松手 1.5s 后回到「正常」——如果这时助手正在思考或刚出错，
 * 这两个本地动作会把助手的表情顶掉，而且不会再恢复。这三个状态归助手所有。
 */
const ASSISTANT_OWNED_STATUSES: ReadonlySet<TouTouStatus> = new Set(["thinking", "done", "error"]);

function clearTimer(timerRef: { current: number | null }) {
  if (timerRef.current !== null) {
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

export {
  HIDE_AFTER_MS,
  SLEEP_AFTER_MS,
  CURIOUS_MS,
  DONE_MS,
  DOUBLE_CLICK_WINDOW_MS,
  BLINK_MIN_MS,
  BLINK_MAX_MS,
  BLINK_MS,
  PET_STROKE_MIN_GAP_MS,
  PET_WINDOW_MS,
  PET_COUNT,
  PET_HOLD_MS,
  ASSISTANT_OWNED_STATUSES,
  clearTimer,
};
