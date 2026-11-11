// SPDX-License-Identifier: Apache-2.0
/**
 * 品牌图标手势（P5-1 / P5-2 / P5-3 · 13-1·13-2·13-3·13-4）。
 *
 * 这里只剩键盘兜底动作名（`Alt+R` / `Alt+Home` 的显示名，快捷键表与设置页都读它）。
 *
 * 品牌图标的手势（单击/双击/三击）是**彩蛋**，按产品决定不提供任何可见提示，因此
 * `shellGestures.brand.tooltip` 已删除（#22）。不要为了"更好发现"把它加回来——
 * 若哪天要折中，正确做法是首次使用的一次性 toast，而不是常驻悬停提示。
 * 命名空间本身仍然保留：`SHELL_GESTURE_LABEL_KEYS` 还被 `features/shortcuts/registry.ts` 使用。
 *
 * 命名空间由 `features/shell/shellGestureMessages.ts` 在模块加载时登记——本批次不许改
 * `messages/zh-CN.ts` / `messages/en-US.ts` 这两张聚合表（它们由别的批次独占写入），
 * 所以这里走"自带登记"而不是加进聚合表。别把键挪去别的命名空间，否则登记会重复。
 */
const shellGestures = {
  /** 快捷键表里的动作名（Alt+R）。 */
  "shellGestures.action.refresh": "刷新当前页数据",
  /** 快捷键表里的动作名（Alt+Home）。 */
  "shellGestures.action.goHome": "回到首页",
} as const;

export default shellGestures;
