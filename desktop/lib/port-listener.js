// SPDX-License-Identifier: Apache-2.0
"use strict";

// "谁在监听这个端口？"——fail-closed 停止流程里此前缺的那一半（A1）。
//
// lib/backend-stop.js 能证明**有东西**还在后端端口上应答，但在 2.3.0 之前从来没有问过
// **是谁**。2026-11-21 的两次应用内更新（12:34 / 12:37，都被
// 「根进程已退出，但后端端口仍可连接」挡住）证明这不是假想的边界：早前一次启动交接留下
// 的孤儿 uvicorn 一直占着端口几十秒到几分钟，而壳只能"再多等 4.5 秒"然后放弃。
//
// 本模块**只读**：不杀、不发信号、不拉服务。它给出的 pid 只是候选，必须再过
// lib/process-identity.js 的身份校验（命令行 + 启动时刻），只有 STATUS_VERIFIED 才允许
// 终止（裁决在 backend-stop.js，本模块不持有这个权力）。
//
// 三个平台各有一支反查，拿不到就如实返回 null（调用方据此保持 blocked，绝不因为
// "查不出来"放手）：
//   Windows → netstat -ano 的最后一列（原生、实测 58ms）；读不出来再退到
//             Get-NetTCPConnection 的 OwningProcess（PowerShell 冷启动实测 5.5s，
//             所以它不是首选项，见 windowsListenerPid 的注释）；
//   macOS   → lsof -nP -iTCP:<port> -sTCP:LISTEN -t；
//   Linux   → ss -ltnp，按本地地址列尾部匹配端口后解析 pid=（与
//             scripts/linux/lib/common.sh::rf_print_listeners 同一判据），拿不到再退到 lsof。
//
// **验证边界（改动前请先读这一段）**：这三支里只有 Windows 在真机上跑过（netstat 实测
// 58ms、身份读取 ~0.9s、反查 pid 命中持有 socket 的进程）。macOS / Linux 的 ss / lsof
// 分支**只有解析用例**（scripts/test-port-listener.js 喂真实格式的输出），没有在真机上
// 执行过——CI runner 上 ss 存在时会真的跑到，但那是"能跑通"，不等于"在目标发行版/版本上
// 验证过"。改这里的命令行或输出解析时，请至少跑一次目标平台的真机/容器再提交。

const processIdentity = require("./process-identity");

// 反查预算。挂住的 PowerShell / CIM 查询绝不能把退出流程当人质：实测每次查询都在 1s 内，
// 5s 既留足余量，又远低于退出流程自身的 stop 上限。
const LISTENER_LOOKUP_TIMEOUT_MS = 5_000;

// 日志里命令行片段的长度。完整命令行可能几千字符，真正有用的是 `... -m uvicorn
// app.main:app ...` 这一段。
const COMMAND_EXCERPT_CHARS = 120;

const WINDOWS_QUERY = [
  "$ErrorActionPreference = 'SilentlyContinue';",
  "$c = Get-NetTCPConnection -State Listen -LocalPort $PORT_VALUE -ErrorAction SilentlyContinue | Select-Object -First 1;",
  "if ($null -eq $c) { Write-Output 'none' } else { Write-Output $c.OwningProcess }",
].join(" ");

/** 空答案（"没查到"），形状与查到时一致，调用方不必分支。 */
function emptyAnswer(reason) {
  return {
    pid: null,
    startedAtUnix: null,
    startSignature: null,
    commandLine: null,
    reason,
  };
}

/**
 * 带预算地等一个 Promise：超时或抛错都落回 `fallback`。
 *
 * 计时器 unref：一份反查不该让进程（或离线用例）多活 5 秒。
 */
function withDeadline(promise, timeoutMs, fallback) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(fallback), timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    }),
  ]);
}

/** 命令行片段：去掉首尾空白并截断，仅供日志与错误信息使用。 */
function commandExcerpt(commandLine) {
  const text = String(commandLine || "").trim().replace(/\s+/g, " ");
  if (text.length <= COMMAND_EXCERPT_CHARS) return text;
  return `${text.slice(0, COMMAND_EXCERPT_CHARS)}…`;
}

/** `netstat -ano` 的本地地址列里精确匹配端口（151152 不能算 51152）。 */
function parseNetstatListener(text, port) {
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    //   TCP    127.0.0.1:51152    0.0.0.0:0    LISTENING    4321
    const match = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
    if (!match) continue;
    if (Number(match[2]) !== port) continue;
    const pid = Number(match[3]);
    if (Number.isInteger(pid) && pid > 0) return pid;
  }
  return null;
}

/**
 * `ss -ltnp` 里按端口取 pid。
 *
 * 与 scripts/linux/lib/common.sh::rf_print_listeners 同一套判据：只比**本地地址列**
 * 的尾部（`127.0.0.1:51152` / `*:51152` / `[::]:51152` 三种写法都命中，`:511520` 不会
 * 被误判成 51152），命中之后才在那一行里找 `users:(("python",pid=6512,fd=7))`。
 *
 * `port` 省略时退化成"第一个 pid="，只给解析用例用。
 */
function parseSsListener(text, port) {
  for (const line of String(text || "").split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5 || columns[0] !== "LISTEN") continue;
    if (Number.isInteger(port) && !columns[3].endsWith(`:${port}`)) continue;
    const match = /pid=(\d+)/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    if (Number.isInteger(pid) && pid > 0) return pid;
  }
  return null;
}

/** `lsof -t` 每行一个 pid；多个进程共享端口时取第一个。 */
function parseLsofPids(text) {
  for (const line of String(text || "").split(/\r?\n/)) {
    const pid = Number(line.trim());
    if (Number.isInteger(pid) && pid > 0) return pid;
  }
  return null;
}

/**
 * Windows：netstat 优先，Get-NetTCPConnection 兜底。
 *
 * 顺序与直觉相反，是量出来的：`netstat -ano` 是原生程序，实测 58ms；而
 * `Get-NetTCPConnection` 要先把 PowerShell 拉起来，冷启动在低完整性/繁忙的机器上实测
 * **5.5 秒**——那已经超过本模块 5s 的反查预算，等于把补救步骤做成摆设（实测判成
 * "超时"）。两个解析器都保留：netstat 输出读不出 pid 时（被过滤、格式变了）再退到 CIM。
 */
async function windowsListenerPid(port, exec) {
  const netstat = await exec("netstat.exe", ["-ano"]);
  const fromNetstat = parseNetstatListener(netstat.stdout, port);
  if (fromNetstat) return { pid: fromNetstat, reason: "" };
  const script = WINDOWS_QUERY.replace(/\$PORT_VALUE/g, String(port));
  const result = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  const answer = String(result.stdout || "").trim();
  if (answer === "none") {
    return { pid: null, reason: `netstat 与 Get-NetTCPConnection 都没报告端口 ${port} 的监听进程` };
  }
  const fromConnection = Number(answer);
  if (Number.isInteger(fromConnection) && fromConnection > 0) {
    return { pid: fromConnection, reason: "" };
  }
  return { pid: null, reason: `netstat 与 Get-NetTCPConnection 都读不出端口 ${port} 的监听进程` };
}

/**
 * POSIX：Linux 先试 ss（与 scripts/linux/lib/common.sh 同一套判据：ss 是 base 包、
 * 不需要 root 就能看到监听者，容器里也不会像 lsof 那样静默返回空），lsof 兜底；
 * macOS 只有 lsof。
 *
 * 两支都失败时返回 pid=null —— 调用方据此保持 blocked，不能因为"工具没装"就放行。
 */
async function posixListenerPid(port, exec, platform) {
  if (platform === "linux") {
    const ss = await exec("ss", ["-ltnp"]);
    const fromSs = parseSsListener(ss.stdout, port);
    if (fromSs) return { pid: fromSs, reason: "" };
  }
  const lsof = await exec("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  const fromLsof = parseLsofPids(lsof.stdout);
  if (fromLsof) return { pid: fromLsof, reason: "" };
  const tools = platform === "linux" ? "ss 与 lsof" : "lsof";
  return { pid: null, reason: `${tools} 都读不出端口 ${port} 的监听进程` };
}

/**
 * 反查监听某端口的进程，并顺手取回身份证据（命令行程、启动时刻）。
 *
 * 一次返回两样东西是刻意的：pid 本身不是身份（OS 会回收 pid），而"现在的命令行与启动
 * 时刻"只有这次查询的现场才有；丢掉它就得再查一次，那反而给了 pid 被回收的窗口。
 *
 * @param {number} port 端口号（1-65535）。
 * @param {object} [options]
 * @param {string} [options.platform] 平台名（可注入，macOS 分支否则无处可测）。
 * @param {function(string, string[]): Promise<{stdout: string}>} [options.execFileFn] 命令执行器。
 * @param {number} [options.timeoutMs] 反查预算。
 * @returns {Promise<{pid: number|null, startedAtUnix: number|null, startSignature: string|null,
 *   commandLine: string|null, reason: string}>} 查不到时 pid 为 null，`reason` 说明原因。
 */
async function findPortListener(
  port,
  { platform = process.platform, execFileFn, timeoutMs = LISTENER_LOOKUP_TIMEOUT_MS } = {},
) {
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    return emptyAnswer("端口号不可用，无法反查监听进程");
  }
  const exec =
    execFileFn ?? ((file, args) => processIdentity.defaultExecFile(file, args, { timeoutMs }));
  // 两步**共用**一份预算：反查（netstat/ss/lsof）与身份读取（get-process / ps）加起来才
  // 是"反查一次"的代价。各给一份 5s 会让最坏情况变成 10s，足够把退出流程的 stop 上限
  // （普通退出 6s / 安装 15s）吃掉。第二步至少留 1s，否则第一步刚好用满时它永远读不到。
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(deadline - Date.now(), 1_000);
  const unanswered = emptyAnswer(`反查端口 ${port} 超时（${timeoutMs}ms）`);
  const found = await withDeadline(
    platform === "win32" ? windowsListenerPid(port, exec) : posixListenerPid(port, exec, platform),
    remaining(),
    unanswered,
  );
  if (!found || !Number.isInteger(found.pid)) {
    return emptyAnswer((found && found.reason) || `反查端口 ${port} 时没有返回可用的 pid`);
  }
  const info = await withDeadline(
    processIdentity.readProcessInfo(found.pid, { execFileFn: exec, platform }),
    remaining(),
    processIdentity.PROBE_UNREADABLE,
  );
  if (info === processIdentity.PROBE_UNREADABLE || info === null) {
    return {
      ...emptyAnswer(`读不到 pid ${found.pid} 的命令行与启动时刻`),
      pid: found.pid,
    };
  }
  return {
    pid: found.pid,
    startedAtUnix: info.startedAtUnix,
    startSignature: info.startSignature,
    commandLine: info.commandLine,
    reason: "",
  };
}

module.exports = {
  LISTENER_LOOKUP_TIMEOUT_MS,
  commandExcerpt,
  findPortListener,
  parseLsofPids,
  parseNetstatListener,
  parseSsListener,
};
