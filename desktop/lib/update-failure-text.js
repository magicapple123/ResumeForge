// SPDX-License-Identifier: Apache-2.0
"use strict";

// 检查更新失败时的归因口径：纯函数，不 require("electron")、不发任何请求。
//
// 为什么单独成文件（同 `lib/update-net.js` 与 `lib/update-release.js` 的理由）：
// `desktop/**/*.js` 有 500 行硬预算（test_file_size_budget.py，零豁免），而"把状态码 +
// 限额头翻译成一句可据以行动的话"与出网、与版本比较都不耦合，可以独立断言。
//
// 口径来源是后端 `backend/app/services/update_check_degrade.py` 的 `build_api_error` /
// `recovery_minutes` / `describe_failure` / `update_check.py` 的 `_github_error_message`
// （**只读它们，不改**，两份实现各自存在，改口径时两边一起改）：
//   - 429，或 403 且 `x-ratelimit-remaining: 0` → 匿名额度用完（等一会儿就好）；
//   - 403 但额度还在 → 网络里有人拦了 api.github.com（等多久都没用，得换网络）；
//   - 其它状态码单列。
// 为什么必须分开：同一件事在设置页卡片（后端口径）与桌面弹窗（本条）里出现两种说法，
// 用户没法判断该信哪个——第 12 条的现场就是"后端同一秒说已是最新、桌面说失败"。
//
// 两个边界（都是刻意的）：
//   1. `rawFailureText` / `combinedFailureText` 产出的**原始技术文本**进 `errorDetail`
//      与日志，中文句子一律不进去：壳层的原生对话框是双语的（lib/shell-locale.js），
//      用户可见的中文归因在渲染层走 i18n（frontend/src/features/updates/updateErrorText.ts）。
//   2. `describeFailure` 返回中文句子，**只进 desktop-main.log**：出问题时它比状态码
//      更容易被人读懂，而日志本来就和后端日志一样是中文。

// 不足一分钟按一分钟说（与后端 `_MIN_RECOVERY_MINUTES` 同义）。
const MIN_RECOVERY_MINUTES = 1;
// 超过一天基本可以确定拿到的不是限额重置时刻（GitHub 的窗口是小时级），
// 这时宁可不报数字（与后端 `_MAX_RECOVERY_MINUTES` 同义）。
const MAX_RECOVERY_MINUTES = 24 * 60;
// 既不是限额、也没有可用状态码时的兜底（与后端 `_GENERIC_RECOVERY` 同义）。
const GENERIC_REASON = "GitHub 接口这次不可用，稍后重试会恢复完整说明";

/**
 * 从响应头取一个整数字段；缺失 / 非数字一律 `null`（绝不抛）。
 *
 * `Headers.get` 大小写不敏感，但离线替身可能只实现 `get`，也可能传普通对象，
 * 所以两种形态都收；取不到就当没有，归因会退到"不给数字"的说法。
 *
 * @param {{get?: (name: string) => (string | null)}} [headers]
 * @param {string} name 小写头名
 * @returns {number | null}
 */
function readIntHeader(headers, name) {
  let raw = null;
  try {
    if (headers && typeof headers.get === "function") raw = headers.get(name);
    else if (headers && typeof headers === "object") raw = headers[name];
  } catch {
    return null;
  }
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * 一次非 2xx 响应的归因事实（与后端 `build_api_error` 的字段一一对应）。
 *
 * @param {number} status HTTP 状态码
 * @param {{get?: (name: string) => (string | null)}} [headers]
 * @returns {{status: number, remaining: number | null, resetAt: number | null,
 *   rateLimited: boolean}}
 */
function failureFacts(status, headers) {
  const code = Number.isFinite(status) ? Number(status) : 0;
  const remaining = readIntHeader(headers, "x-ratelimit-remaining");
  const resetAt = readIntHeader(headers, "x-ratelimit-reset");
  // 与后端同一判据：429 一定算额度；403 要看余额是否为 0。
  return {
    status: code,
    remaining,
    resetAt,
    rateLimited: code === 429 || (code === 403 && remaining === 0),
  };
}

/**
 * `x-ratelimit-reset`（UTC epoch **秒**）→ "还有几分钟恢复"；拿不到可信时刻时 `null`。
 *
 * 不要乘 1000、不要加时区：它和 `Date.now() / 1000` 同一基准（后端同名函数同理）。
 *
 * @param {number | null} resetAt UTC epoch 秒
 * @param {number} [nowSeconds]
 * @returns {number | null}
 */
function recoveryMinutes(resetAt, nowSeconds = Date.now() / 1000) {
  if (!resetAt) return null;
  const minutes = Math.ceil((Number(resetAt) - Number(nowSeconds)) / 60);
  if (!Number.isFinite(minutes)) return null;
  if (minutes < MIN_RECOVERY_MINUTES) return MIN_RECOVERY_MINUTES;
  if (minutes > MAX_RECOVERY_MINUTES) return null;
  return minutes;
}

/**
 * 主路径失败时的**原始**技术文本：状态码 + 限额头。
 *
 * 两个字段都必须留在字符串里：它们是 `errorDetail` 里唯一能区分"等一会儿"和"换网络"
 * 的证据，也是渲染层归因（`updateErrorText.ts`）与用户反馈时贴出来的原文。
 *
 * @param {{status: number, remaining: number | null, resetAt: number | null}} facts
 * @returns {string}
 */
function rawFailureText(facts) {
  const head = `releases/latest returned ${facts.status}`;
  const extras = [];
  if (facts.remaining !== null) extras.push(`x-ratelimit-remaining: ${facts.remaining}`);
  if (facts.resetAt !== null) extras.push(`x-ratelimit-reset: ${facts.resetAt}`);
  return extras.length ? `${head} (${extras.join(", ")})` : head;
}

/**
 * 把一次失败压成一句"这是什么情况 + 什么时候能好"（措辞与后端 `describe_failure` 一致）。
 *
 * **只用于 desktop-main.log**，理由见文件头第 2 条边界。
 *
 * @param {{status: number, remaining: number | null, resetAt: number | null,
 *   rateLimited: boolean}} facts
 * @param {number} [nowSeconds]
 * @returns {string}
 */
function describeFailure(facts, nowSeconds = Date.now() / 1000) {
  if (facts.rateLimited) {
    const minutes = recoveryMinutes(facts.resetAt, nowSeconds);
    return minutes === null
      ? "GitHub 匿名额度已用完，稍后会自动恢复"
      : `GitHub 匿名额度已用完，约 ${minutes} 分钟后恢复`;
  }
  if (facts.status === 403) {
    return (
      "GitHub 拒绝了这次匿名请求（HTTP 403）：常见原因是同一网络下匿名调用次数用完，" +
      "或网络内有人拦了 api.github.com"
    );
  }
  if (facts.status === 404) return "发布仓库或 Release 不存在（HTTP 404）";
  if (facts.status) return `GitHub 接口返回 HTTP ${facts.status}，稍后重试会恢复完整说明`;
  return GENERIC_REASON;
}

/**
 * 两条路都失败时的 `errorDetail`：主路径原文 + 备用探测原文。
 *
 * 两个状态码必须在同一个字符串里——"主路径 403、备用也不行"与"主路径 404"对用户
 * 意味着完全不同的事，只留最后一个会把决定性证据吃掉。
 *
 * @param {object} primaryFacts `failureFacts()` 的返回值
 * @param {unknown} fallbackError 备用探测抛出的错误（或它的 message）
 * @returns {string}
 */
function combinedFailureText(primaryFacts, fallbackError) {
  const fallback =
    fallbackError && fallbackError.message ? String(fallbackError.message) : String(fallbackError);
  return `${rawFailureText(primaryFacts)}; fallback probe failed: ${fallback}`;
}

module.exports = {
  GENERIC_REASON,
  combinedFailureText,
  describeFailure,
  failureFacts,
  rawFailureText,
  readIntHeader,
  recoveryMinutes,
};
