// SPDX-License-Identifier: Apache-2.0
/**
 * Brand-mark gestures (P5-1 / P5-2 / P5-3 · 13-1·13-2·13-3·13-4).
 *
 * Only the keyboard-fallback action names remain (Alt+R / Alt+Home, read by the shortcut
 * table and the settings page).
 *
 * The brand-mark gestures (click / double-click / triple-click) are an easter egg and, by
 * product decision, carry no visible hint, so `shellGestures.brand.tooltip` was removed (#22).
 * Keep the keys in sync with `zh-CN.shellGestures.ts`.
 */
const shellGestures = {
  /** Action name in the shortcut table (Alt+R). */
  "shellGestures.action.refresh": "Refresh this page's data",
  /** Action name in the shortcut table (Alt+Home). */
  "shellGestures.action.goHome": "Go to the home page",
} as const;

export default shellGestures;
