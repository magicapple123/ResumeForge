// SPDX-License-Identifier: Apache-2.0
/**
 * 「帮助 → 复制诊断信息」（#34D）的日志侧：lib/diagnostic-summary.js。
 *
 * 这里守三件事：
 *  1. 只挑 WARN/ERROR 行（不是把整份日志贴出去）；
 *  2. 令牌类内容进摘要前被抹掉（这份文本会被用户直接转发给陌生支持者）；
 *  3. 读不到文件时返回空数组、不抛——诊断设施不能反过来把功能弄坏。
 *
 * Run with: node --test "scripts/test-*.js"
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  PROBLEM_LINE_LIMIT,
  TAIL_BYTES,
  pickProblemLines,
  readRecentProblems,
  readTailLines,
  redactDiagnosticLine,
} = require("../lib/diagnostic-summary");

const tempDirs = [];
function makeLogDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-diag-"));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, "utf8");
  }
  return dir;
}

test.after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test("只挑 WARN / ERROR / Traceback，普通 INFO 行不进摘要", () => {
  const lines = [
    "2026-11-11 10:00:00 INFO backend ready",
    "2026-11-11 10:00:01 WARN backend slow",
    "2026-11-11 10:00:02 ERROR connection refused",
    "Traceback (most recent call last):",
    "2026-11-11 10:00:03 DEBUG noise",
  ];
  const picked = pickProblemLines(lines, 10);
  assert.equal(picked.length, 3);
  assert.match(picked[0], /WARN backend slow/);
  assert.match(picked[1], /ERROR connection refused/);
  assert.match(picked[2], /Traceback/);
});

test("挑最近 N 条（不是最前面 N 条）", () => {
  const lines = Array.from({ length: 50 }, (_value, index) => `WARN line-${index}`);
  const picked = pickProblemLines(lines, 3);
  assert.deepEqual(
    picked.map((line) => /line-(\d+)/.exec(line)[1]),
    ["47", "48", "49"],
  );
  assert.ok(PROBLEM_LINE_LIMIT >= 10);
});

test("令牌兜底脱敏：sk- / Bearer / 长随机串 / 键值对形态都不留在摘要里", () => {
  const samples = [
    ["WARN failed with key sk-live-1234567890abcdef", "sk-live-1234567890abcdef"],
    ["WARN Authorization: Bearer abcdefghijklmnop1234", "abcdefghijklmnop1234"],
    ["WARN blob " + "A".repeat(60), "A".repeat(60)],
    ["WARN request https://api.example.com/v1?api_key=supersecretvalue&model=x", "supersecretvalue"],
    ["WARN config api_key=supersecretvalue", "supersecretvalue"],
  ];
  for (const [line, secret] of samples) {
    const redacted = redactDiagnosticLine(line);
    assert.equal(redacted.includes(secret), false, `仍含明文：${redacted}`);
    assert.match(redacted, /<redacted>/);
  }
});

test("保留键名：脱敏后仍看得出是哪一类配置泄露了", () => {
  assert.match(redactDiagnosticLine("WARN config api_key=supersecretvalue"), /api_key/);
  assert.match(
    redactDiagnosticLine("WARN request /x?token=supersecretvalue&page=2"),
    /token=<redacted>/,
  );
});

test("单行压成一行并截断（异常栈的长行不整行带走）", () => {
  // 用带空格的普通单词，避免被"长随机串"那条规则先替换掉，测的是截断本身。
  const long = `ERROR ${"operation failed ".repeat(60)}`;
  const redacted = redactDiagnosticLine(long);
  assert.ok(redacted.length <= 301);
  assert.ok(redacted.endsWith("…"));
});

test("readTailLines：文件不存在 / 空文件返回空数组，不抛", () => {
  const dir = makeLogDir({});
  assert.deepEqual(readTailLines(path.join(dir, "missing.log")), []);
  fs.writeFileSync(path.join(dir, "empty.log"), "", "utf8");
  assert.deepEqual(readTailLines(path.join(dir, "empty.log")), []);
});

test("readTailLines：只读尾部字节窗口，且丢掉被截断的半行", () => {
  const dir = makeLogDir({});
  const file = path.join(dir, "big.log");
  // 前半部分是无关的大段内容；尾部保留一条完整 WARN。
  const filler = `${"INFO filler\n".repeat(2000)}`;
  fs.writeFileSync(file, `${filler}WARN tail-warning\n`, "utf8");
  const lines = readTailLines(file, { maxBytes: 512 });
  assert.ok(lines.length >= 1);
  assert.equal(lines[lines.length - 1], "WARN tail-warning");
  // 字节窗口会从某一行中间切开：那半行必须被丢掉，不能当成一条完整日志带出去。
  assert.equal(
    lines.every((line) => line === "INFO filler" || line === "WARN tail-warning"),
    true,
    `出现了被截断的半行：${JSON.stringify(lines.slice(0, 2))}`,
  );
  assert.ok(TAIL_BYTES > 512);
});

test("readRecentProblems：两份日志都读、带来源前缀、总数不超过 limit", () => {
  const dir = makeLogDir({
    "desktop-main.log": "INFO start\nWARN main-1\nWARN main-2\n",
    "desktop-backend.log": "INFO boot\nERROR backend-1\nWARN backend-2\n",
  });
  const problems = readRecentProblems({ logDir: dir, limit: 2 });
  // limit=2 → 两份日志各 1 条，取各自的最后一条：不会被其中一份刷屏。
  assert.deepEqual(problems, [
    "[desktop-main.log] WARN main-2",
    "[desktop-backend.log] WARN backend-2",
  ]);
  const all = readRecentProblems({ logDir: dir, limit: 4 });
  assert.equal(all.length, 4);
  assert.equal(all.some((line) => line.startsWith("[desktop-main.log]")), true);
  assert.equal(all.some((line) => line.startsWith("[desktop-backend.log]")), true);
});

test("readRecentProblems：日志目录不可用（null）时返回空数组", () => {
  assert.deepEqual(readRecentProblems({ logDir: null }), []);
  assert.deepEqual(readRecentProblems({}), []);
  assert.deepEqual(readRecentProblems({ logDir: "D:/definitely-not-a-dir" }), []);
});
