// SPDX-License-Identifier: Apache-2.0
"use strict";

// 版本号 → 对话框标题匹配器（CodeQL #137 `js/regex-injection` 的守卫）。
//
// 为什么必须有用例：这条告警的输入来自 CI 内部（`Test-DesktopUpdateHandoff.ps1` 的
// `$targetVersion`），本地跑不了 CodeQL（那是推送之后的事）。所以"语义正确"只能靠
// 这里钉住：
//
//   1. 版本号含正则元字符时，匹配器只匹配**它自己**；
//   2. 版本号的边界仍在（`2.3.0` 不命中 `2.3.01` / `12.3.0`）——整串转义不能把边界弄丢；
//   3. 造正则的地方只有 lib/update-version-match.js：脚本里再出现插值的 `new RegExp(`
//      就直接失败（同一个坑第二次出现时，没有人会记得 #137）。
//
// Run with: node --test scripts/test-update-version-match.js

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { escapeRegExp, versionDialogMatcher } = require("../lib/update-version-match");

const SCRIPT = path.join(__dirname, "verify-packaged-update.js");

test("含正则元字符的版本号只匹配它自己（CodeQL #137）", () => {
  // 真实形态：semver 的 build metadata `2.3.0+build.1`。未转义时 `+` 是量词，
  // 匹配器会把 "2.3.0build.1" / "2.3.00buildx1" 之类也算命中。
  const matcher = versionDialogMatcher("2.3.0+build.1");
  assert.ok(matcher.test("ResumeForge 2.3.0+build.1 可用"), "必须命中完整版本号");
  assert.equal(matcher.test("ResumeForge 2.3.0 可用"), false, "不能因为 + 的量词语义命中裸 2.3.0");
  assert.equal(matcher.test("ResumeForge 2.3.0XbuildY1 可用"), false, "X/Y 不是 +，不能命中");
  // `+` 未转义时是"一个或多个前一项"，于是把 `+` 本身当成可选的：这两串都会被误判命中。
  assert.equal(matcher.test("ResumeForge 2.3.0build.1 可用"), false, "丢掉 + 之后不能命中");
  assert.equal(matcher.test("ResumeForge 2.3.00build.1 可用"), false, "`0+` 吃下多余 0 之后不能命中");
});

test("括号 / 方括号 / 美元符这类元字符同样按字面量处理", () => {
  for (const version of ["2.3.0(rc1)", "2.3.0[a]", "2.3.0$", "2.3.0\\1", "2.3.0|9.9.9"]) {
    const matcher = versionDialogMatcher(version);
    assert.ok(matcher.test(`版本 ${version} 可用`), `${version} 自己必须命中`);
    assert.equal(matcher.test("版本 2.3.0 可用"), false, `${version} 不能退化成别的含义`);
  }
  assert.equal(escapeRegExp("a.b+c"), "a\\.b\\+c", "整串转义，不只是点");
  assert.equal(escapeRegExp(""), "", "空串不抛错");
});

test("版本号的边界仍然在：2.3.0 不命中 2.3.01，也不命中 12.3.0", () => {
  const matcher = versionDialogMatcher("2.3.0");
  assert.ok(matcher.test("2.3.0 可用"));
  assert.ok(matcher.test("v2.3.0（最新）"), "前一位是字母/空格都算边界");
  assert.equal(matcher.test("2.3.01 可用"), false, "后面跟着数字 → 不是这个版本");
  assert.equal(matcher.test("12.3.0 可用"), false, "前面跟着数字/点 → 不是这个版本");
});

test("脚本里不再有插值的 new RegExp(...)（同一个坑只许踩一次）", () => {
  const source = fs.readFileSync(SCRIPT, "utf8");
  assert.match(source, /versionDialogMatcher\(version\)/, "必须走 lib 里的构造器");
  const offenders = source
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /new RegExp\(/.test(line) && /\$\{/.test(line));
  assert.deepEqual(
    offenders.map(({ number, line }) => `${number}: ${line.trim()}`),
    [],
    "任何插值的 new RegExp(...) 都必须改成经过 escapeRegExp / versionDialogMatcher",
  );
});
