// SPDX-License-Identifier: Apache-2.0
"use strict";

// 「对话框标题里出现某个版本号」的匹配器（CodeQL #137 `js/regex-injection`）。
//
// 现场：scripts/verify-packaged-update.js 里曾经是
//
//   new RegExp(`(?:^|[^\\d.])${version.replaceAll(".", "\\.")}(?![\\d.])`)
//
// 只转了 `.` 一个字符，而 `version` 来自命令行参数（Test-DesktopUpdateHandoff.ps1 的
// `$targetVersion`）。其余正则元字符原样进了 RegExp：`2.3.0+build` 里的 `+` 会把前一串
// 变成一个量词 —— 轻则匹配不到（冒烟测试假红/假绿），重则在不友好的输入上变成 ReDoS。
//
// 所以：整串转义，并把"造正则"收进一个函数——调用侧不再有第二处 `new RegExp(...)`。
// 不用 `RegExp.escape`（ES2025，Node 22 的可用性还要看 polyfill），十行长度的转义表更直白，
// 也不引入依赖。
//
// 这不是"防外敌"的输入校验（版本号来自 CI 内部、可信），而是"别让可信输入把正则写坏"。

const REGEXP_METACHARACTERS = /[.*+?^${}()|[\]\\]/g;

/**
 * 把任意字符串变成正则里的字面量（**整串**转义，不只 `.`）。
 *
 * @param {string} value 原始文本。
 * @returns {string} 可以安全插进正则源码的文本。
 */
function escapeRegExp(value) {
  return String(value).replace(REGEXP_METACHARACTERS, "\\$&");
}

/**
 * 「标题里出现完整版本号」的匹配器。
 *
 * 两侧仍要求不是数字或点：`2.3.0` 不能命中 `2.3.01`，也不能命中 `12.3.0`。版本号本身
 * 整串转义，所以 `2.3.0+build.1` 只匹配它自己——不会退化成 `+` 的量词语义。
 *
 * @param {string} version 命令行传进来的目标版本号。
 * @returns {RegExp} 用于 Playwright 的 `getByRole("dialog", { name })`。
 */
function versionDialogMatcher(version) {
  return new RegExp(`(?:^|[^\\d.])${escapeRegExp(version)}(?![\\d.])`);
}

module.exports = { escapeRegExp, versionDialogMatcher };
