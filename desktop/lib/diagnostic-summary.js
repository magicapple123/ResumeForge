// SPDX-License-Identifier: Apache-2.0
"use strict";

// 「帮助 → 复制诊断信息」（#34D）的主进程侧：从壳的两份日志里挑出最近的 WARN / ERROR 行，
// 先做令牌兜底脱敏，再交给渲染层与版本 / 平台 / 目录 / 模型配置合成一份可贴给支持者的文本。
//
// 三条约束：
//   1. **只读两个固定文件名**（logs/desktop-main.log、logs/desktop-backend.log），不递归
//      目录：那里还有轮转文件（*.log.1 之类）与其它运行产物，整目录扫会把无关内容带出去；
//   2. 按字节窗口读**尾部**：这两份日志每次启动都追加，长的可以到几十 MB；
//   3. 本文件不 require("electron")、也不抛异常：读不到日志只是诊断信息少一段，
//      不能让「复制诊断信息」这个菜单项失败——诊断设施不能反过来把功能弄坏。

const fs = require("fs");
const path = require("path");

/** 进诊断摘要的两份日志（顺序即输出顺序）。 */
const LOG_NAMES = ["desktop-main.log", "desktop-backend.log"];

/** 默认最多带多少条 WARN/ERROR（两份日志按上限均分）。 */
const PROBLEM_LINE_LIMIT = 20;

/** 每份日志只读尾部这么多字节（够覆盖最近若干次启动的告警）。 */
const TAIL_BYTES = 128 * 1024;

/** 单行上限：异常栈的一行也可能很长，粘给支持者时不需要整行。 */
const MAX_LINE_LENGTH = 300;

const PROBLEM_PATTERN = /\b(WARN|WARNING|ERROR|CRITICAL|FATAL)\b|Traceback/;

// 兜底脱敏：业务日志本身不记密钥（AGENTS 约束），但这份文本面向"直接转发给陌生支持者"
// 的场景，多一道闸。与后端诊断包的 _LOG_SECRET_PATTERNS 同一档（这里多了三个键值对形态）。
// 每条规则要么整体替换，要么保留一段前缀（keepGroup），避免 "api_key=xxx" 脱敏后
// 连键名一起消失——保留键名才看得出是哪类配置泄露了。
const SECRET_PATTERNS = [
  { pattern: /sk-[A-Za-z0-9_-]{8,}/g },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi },
  { pattern: /\b[A-Za-z0-9+/]{48,}={0,2}\b/g },
  { pattern: /([?&](?:api[_-]?key|token|secret|password)=)[^&\s]+/gi, keepGroup: true },
  { pattern: /((?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*)[^\s,;"']+/gi, keepGroup: true },
];

/** 单行脱敏 + 压成一行 + 截断（细节见 SECRET_PATTERNS / MAX_LINE_LENGTH 的注释）。 */
function redactDiagnosticLine(line) {
  let text = String(line == null ? "" : line).replace(/\r/g, " ").trim();
  for (const { pattern, keepGroup } of SECRET_PATTERNS) {
    text = text.replace(pattern, (_match, prefix) =>
      keepGroup && prefix ? `${prefix}<redacted>` : "<redacted>",
    );
  }
  return text.length > MAX_LINE_LENGTH ? `${text.slice(0, MAX_LINE_LENGTH)}…` : text;
}

/** 从一段日志行里挑出 WARN/ERROR（保持原有时间顺序，返回最后 limit 条）。 */
function pickProblemLines(lines, limit = PROBLEM_LINE_LIMIT) {
  const picked = [];
  for (const line of lines) {
    if (!PROBLEM_PATTERN.test(line)) continue;
    const clean = redactDiagnosticLine(line);
    if (clean) picked.push(clean);
  }
  return picked.slice(-Math.max(1, limit));
}

/**
 * 读文件尾部若干字节并按行切开。
 *
 * 从中间截断时第一行可能是半行（甚至半个 UTF-8 字符）：丢掉它，宁可少一条也不要把
 * 半条日志当成一条带给用户。文件不存在 / 不可读一律返回空数组。
 */
function readTailLines(filePath, { fsImpl = fs, maxBytes = TAIL_BYTES } = {}) {
  let handle = null;
  try {
    const size = fsImpl.statSync(filePath).size;
    const length = Math.min(size, maxBytes);
    if (length <= 0) return [];
    const buffer = Buffer.alloc(length);
    handle = fsImpl.openSync(filePath, "r");
    const read = fsImpl.readSync(handle, buffer, 0, length, size - length);
    const lines = buffer.subarray(0, read).toString("utf8").split(/\r?\n/);
    if (size > length) lines.shift();
    // 文件通常以换行结尾：split 会多出一个空尾巴，去掉它（否则"最后一条"永远是空串）。
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines;
  } catch {
    return [];
  } finally {
    if (handle !== null) {
      try {
        fsImpl.closeSync(handle);
      } catch {
        // 关闭失败不影响已经读到的内容。
      }
    }
  }
}

/**
 * 最近的 WARN/ERROR 行（带来源文件名前缀）。
 *
 * 两份日志按 limit 均分名额：否则"最近 N 条"会被其中一份刷屏的一份吃光。
 *
 * @param {object} options
 * @param {string|null} options.logDir 壳裁决出来的日志目录（不可写时为 null）
 * @param {number} [options.limit]
 * @param {object} [options.fsImpl] 注入的 fs（用例不需要碰真实文件）
 * @returns {string[]}
 */
function readRecentProblems({ logDir, limit = PROBLEM_LINE_LIMIT, fsImpl = fs } = {}) {
  if (!logDir || typeof logDir !== "string") return [];
  const total = Math.max(1, Math.min(Number(limit) || PROBLEM_LINE_LIMIT, 100));
  const perFile = Math.max(1, Math.ceil(total / LOG_NAMES.length));
  const picked = [];
  for (const name of LOG_NAMES) {
    const lines = readTailLines(path.join(logDir, name), { fsImpl });
    for (const line of pickProblemLines(lines, perFile)) picked.push(`[${name}] ${line}`);
  }
  return picked.slice(-total);
}

module.exports = {
  LOG_NAMES,
  PROBLEM_LINE_LIMIT,
  TAIL_BYTES,
  redactDiagnosticLine,
  pickProblemLines,
  readTailLines,
  readRecentProblems,
};
