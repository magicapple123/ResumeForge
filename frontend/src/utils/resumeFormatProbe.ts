// SPDX-License-Identifier: Apache-2.0
/**
 * 版式探针 CSS（项 6 / D10）：把"用户正在拖的值"即时注入预览 iframe，零网络往返。
 *
 * **必须与后端逐字一致**。后端 `FORMAT_FIELDS` 的 `css_rule` 由
 * `backend/app/services/resume/resume_template_format.py` 的 `format_css()`
 * （同文件 `:106`）用 `f"{value:g}"` 格式化：
 *
 * - `line_height` → `"body { line-height: %s !important; }"`（`:36`）
 * - `page_padding` → `"body { padding: %smm !important; }"`（`:45`）
 *
 * 为什么不省事写成 `line-height: 1.7`：存储走的是同一条 `css_rule`，一旦两边的
 * 数字格式不同（`1.7` vs `1.70000`、`14` vs `14.0`），用户会看到"松手后跳一下"
 * ——探针说一套、真实渲染说另一套。**两端各钉一次**（前端本文件 + 后端
 * `tests/test_export_format_config.py`）。
 */

/**
 * 复刻 Python 的 `f"{value:g}"`：6 位有效数字，去掉无意义尾零与小数点。
 *
 * `:g` 的行为就是"按 6 位有效数字四舍五入，然后按最短形式输出"，所以
 * `Number(value.toPrecision(6))` + `String(...)` 是它的等价物：
 * `1.7 → "1.7"`、`1.70 → "1.7"`、`14 → "14"`、`1.23456789 → "1.23457"`。
 */
export function formatG(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Number(value.toPrecision(6)));
}

/**
 * 行距探针：(value 是倍数，如 1.7)。
 *
 * 与后端 `FORMAT_FIELDS` 的 `line_height.css_rule` 逐字一致
 * （`backend/app/services/resume/resume_template_format.py:36`）——空格、分号、
 * `!important` 的位置都不能改，否则"拖动中看到的"与"松手后存下的"是两条规则。
 */
export function lineHeightProbeCss(value: number): string {
  return `body { line-height: ${formatG(value)} !important; }`;
}

/**
 * 页边距探针：(value 是毫米，如 14)。
 *
 * 与后端 `FORMAT_FIELDS` 的 `page_padding.css_rule` 逐字一致
 * （`backend/app/services/resume/resume_template_format.py:45`）。
 */
export function pagePaddingProbeCss(value: number): string {
  return `body { padding: ${formatG(value)}mm !important; }`;
}
