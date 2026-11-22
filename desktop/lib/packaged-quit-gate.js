// SPDX-License-Identifier: Apache-2.0
"use strict";

// 打包冒烟的退出判据（A3）：显式退出必须真的退干净，后端端口必须跟着放掉。
//
// 为什么需要这个模块：`scripts/verify-packaged-startup.js` 在 2.3.0 之前是靠
// `process.kill(-pid, "SIGKILL")` 收场的——那条路径**只证明了"我们能杀掉它"**，
// 从来没有证明过"应用自己能退出"。2.2.3 的两次应用内更新（12:34 / 12:37）就是
// 这么漏过去的：根进程退出了，uvicorn 还占着端口，而冒烟是绿的。所以判据改成走
// **显式退出**：
//
//   window.splash.quitApp()            （preload.js 暴露的唯一退出桥）
//     → ipcMain "app:quit-request"     （main.js 只发 app.quit()，绝不另开退出路径）
//       → app.quit() → before-quit     （lib/quit-lifecycle.js 唯一停止点：停后端）
//
// 也就是用户点「退出应用」走的同一条路。窗口 × 不在判据里：× 是
// lib/close-behavior.js 的"询问 / 最小化到托盘"分支，它只解释"点了叉为什么还在"，
// **不能**解释"点了退出为什么还在"。
//
// 判据（写在这里，省得下次又有人把托盘驻留当成合法解释）：
//
//   任何平台都不存在「显式退出了还驻留」的预期行为。
//
// close-behavior.js 的托盘只作用于窗口 ×：`setQuitting(true)` 之后的 close 一律
// 放行（那是它自己第 1 条不变量），而 quitApp → before-quit 的第一件事就是
// `setQuitting(true)`。所以 macOS 的 Dock/菜单栏图标、Windows 与 Linux 的托盘图标，
// 都不能在显式退出后继续活着——那是缺陷，不是平台差异。
//
// 预算 45s（不是 10s）：安装路径停后端的上限是 15s（quit-lifecycle.js 的
// INSTALL_STOP_TIMEOUT_MS，OS 卡顿时真实能吃到），加上端口探测的 drain（监听 socket
// 的 FIN/TIME_WAIT 不是瞬时消失），再加上 Linux AppImage 托盘收场明显偏慢
// （见 scripts/verify-packaged-startup.js 里那条 SIGKILL 收尾的历史注释）。
// 45s 是"慢但合法"的上界；超过它就不是慢，是没退。
//
// 两条硬断言：
//   ① quitApp 之后 45s 还在运行 → 抛错，并带 platform / pid / exitCode / signalCode /
//      后端健康的诊断（不然 CI 日志只有一句"没退出"，没法定位）；
//   ② 进程退了但后端端口仍可连接 → 抛错，并点名这是 2.2.3 那次
//      "backend stop not verified" 的形态。
//
// 判定逻辑全部下沉在这里，是为了能**离线**跑：scripts/test-packaged-quit-gate.js
// 用真 socket + 假进程句柄走完全部七条分支，不需要 Electron、不需要打包、不联网。
// 本模块因此不 require("electron")、不 require("@playwright/test")，只依赖 node:net
// 与全局 fetch（两者都可注入）。

const net = require("node:net");

// 显式退出的总预算：见文件头"预算 45s"那一段（15s 停后端 + 端口 drain + 慢平台收场）。
const EXPLICIT_QUIT_BUDGET_MS = 45_000;
// 单次 HTTP 健康探测预算：它只用于**失败时的诊断**，不该把失败再拖长多少。
const HEALTH_PROBE_TIMEOUT_MS = 5_000;
// 进程退出后等端口释放的上限与轮询间隔：Linux 上 AppIndicator 收尾偏慢，实测能吃 1-2s。
const PORT_DRAIN_TIMEOUT_MS = 5_000;
const PORT_DRAIN_INTERVAL_MS = 250;
// 一次 TCP connect 的预算。本机回环上连不上是立刻 RST，1s 已经非常宽。
const PORT_CONNECT_TIMEOUT_MS = 1_000;
// 判定为"已释放"的错误码：只有明确的**对方拒绝**才算证明（本机回环上关掉 listener
// 就是立刻 RST）。EHOSTUNREACH / ETIMEDOUT 这类"到不了"不在此列——它们说明不了
// 端口上有没有监听者，按 fail-closed 一律当"没证明"（与 lib/port-listener.js
// 「查不清就不放行」同一条口径）。
const RELEASED_ERROR_CODES = new Set(["ECONNREFUSED", "ECONNRESET"]);

/**
 * 读渲染进程里的退出桥surface。
 *
 * 这个函数会被 `page.evaluate` 序列化后**在页面里**执行，所以它必须自包含：
 * 不引用本模块作用域的任何变量，只读 `globalThis.window`（离线用例里把假 window
 * 挂到 globalThis 上，就能用同一个函数跑通，不必为测试另写一份判断）。
 *
 * @returns {{present: boolean, isDesktop: boolean, hasQuitApp: boolean}}
 */
function readQuitBridgeSurface() {
  const splash = globalThis.window && globalThis.window.splash;
  return {
    present: Boolean(splash),
    isDesktop: Boolean(splash && splash.isDesktop === true),
    hasQuitApp: typeof (splash && splash.quitApp) === "function",
  };
}

/**
 * 在页面里读一次退出桥，并给出"能不能用"的裁决。
 *
 * @param {{evaluate: function(Function): Promise<any>}} page Playwright 页面。
 * @returns {Promise<{present: boolean, isDesktop: boolean, hasQuitApp: boolean,
 *   usable: boolean}>}
 */
async function readQuitBridge(page) {
  const surface = await page.evaluate(readQuitBridgeSurface);
  return { ...surface, usable: surface.isDesktop && surface.hasQuitApp };
}

/**
 * 走显式退出：桥缺失就直接红，不做任何等待。
 *
 * 桥缺失意味着**整个退出链路没有任何东西可测**——这时如果照旧等 45s 再说"进程还在"，
 * 失败信息会指向"应用没退出"，而真正的原因是 preload 没暴露 quitApp。区分这两者是
 * 这条用例存在的唯一理由，所以它在等预算之前抛。
 *
 * @param {{evaluate: function(Function): Promise<any>}} page Playwright 页面。
 * @returns {Promise<{present: boolean, isDesktop: boolean, hasQuitApp: boolean,
 *   usable: boolean}>} 确认可用之后的桥快照。
 */
async function requestExplicitQuit(page) {
  const surface = await readQuitBridge(page);
  if (!surface.usable) {
    throw new Error(
      `preload 没有可用的退出桥：window.splash=${surface.present ? "存在" : "缺失"}、` +
        `isDesktop=${surface.isDesktop}、quitApp=${surface.hasQuitApp ? "函数" : "缺失"}。` +
        "desktop/preload.js 必须暴露 `isDesktop: true` 与 `quitApp: () => ipcRenderer.send(\"app:quit-request\")`，" +
        "否则前端的「退出应用」按钮没有任何东西可调，打包冒烟也就无从验证退出链路。",
    );
  }
  try {
    await page.evaluate(() => globalThis.window.splash.quitApp());
  } catch (err) {
    // 退出请求发出后页面可能立刻被销毁（Electron 在主进程处理 app.quit），Playwright
    // 这时会报 "Execution context was destroyed" —— 那是**退出生效的证据**，不是失败。
    // 只有明确是"上下文没了"才放过；别的错误（桥里抛、序列化失败）必须冒出去。
    const text = String((err && err.message) || err);
    if (!/context was destroyed|Target closed|Cannot find context/i.test(text)) throw err;
  }
  return surface;
}

/**
 * 进程句柄的当前状态。只用公共字段（ChildProcess 与 Playwright 的句柄都有），
 * 且**不**调用 kill/exited 之类会改变状态的方法：本模块只观测。
 *
 * @param {{pid?: number, exitCode?: (number|null), signalCode?: (string|null)}} processHandle
 * @returns {{pid: (number|null), exitCode: (number|null), signalCode: (string|null),
 *   running: boolean}}
 */
function describeProcess(processHandle) {
  const pid = typeof (processHandle && processHandle.pid) === "number" ? processHandle.pid : null;
  const exitCode = processHandle && processHandle.exitCode !== undefined ? processHandle.exitCode : null;
  const signalCode =
    processHandle && processHandle.signalCode !== undefined ? processHandle.signalCode : null;
  return { pid, exitCode, signalCode, running: exitCode === null && signalCode === null };
}

/**
 * 等进程退出，**唯一的判据**就是它（"退没退出"只有一处实现）。
 *
 * 已经在跑的句柄上挂一次 `exit` 监听，与预算赛跑：到点还没事件就返回 false——
 * 注意是返回 false，不是抛错。抛错属于调用方（verifyExplicitQuit）的措辞责任：
 * 它要带 platform / pid / 后端健康一起说，而这一层只有句柄。
 *
 * 预算计时器**故意不 unref**：这一层的唯一职责就是等出结论，宿主进程在判据落地前
 * 退出等于把结论丢掉（冒烟会变成"绿着退出的空跑"）。而它在 finish 时一定被 clearTimeout，
 * 所以真退了的那次不会被多拖 45s——"不退就是失败"这个语义要求计时器必须撑住事件循环。
 *
 * @param {object} processHandle 假句柄也可（只需 EventEmitter 的 once/removeListener）。
 * @param {object} [options]
 * @param {number} [options.timeoutMs] 预算，默认 EXPLICIT_QUIT_BUDGET_MS。
 * @returns {Promise<boolean>} true = 已退出；false = 预算内没退出。
 */
function waitForExit(processHandle, { timeoutMs = EXPLICIT_QUIT_BUDGET_MS } = {}) {
  if (!describeProcess(processHandle).running) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let onExit = null;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (onExit && typeof processHandle.removeListener === "function") {
        processHandle.removeListener("exit", onExit);
      }
      resolve(exited);
    };
    onExit = () => finish(true);
    timer = setTimeout(() => finish(false), timeoutMs);
    processHandle.once("exit", onExit);
  });
}

/**
 * 一次 TCP connect：端口上还有没有东西 accept。
 *
 * 为什么用 connect 而不是 HTTP：判据是"端口通不通"（2.2.3 的现象正是端口还通），
 * HTTP 层可能因为 5xx / 无路由而看不出"有人在听"。connect 成功 = 有监听者。
 *
 * 三态而不是二态：**连不上**和**证明没人听**不是一回事。只有明确的拒绝
 * （RELEASED_ERROR_CODES）才算"已释放"；超时与未知错误都标 conclusive:false，
 * 调用方据此保持 fail-closed（查不清就不算释放）。
 *
 * @param {object} options
 * @param {number} options.port 端口。
 * @param {string} [options.host] 默认 127.0.0.1（打包壳只监听本机）。
 * @param {number} [options.timeoutMs] connect 预算。
 * @returns {Promise<{listening: boolean, conclusive: boolean, detail: string}>}
 */
function probeTcpPort({ port, host = "127.0.0.1", timeoutMs = PORT_CONNECT_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    let settled = false;
    const done = (listening, conclusive, detail) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve({ listening, conclusive, detail });
    };
    socket.setTimeout(timeoutMs, () => done(false, false, `connect timeout ${timeoutMs}ms`));
    socket.once("connect", () => done(true, true, "accept"));
    socket.once("error", (err) => {
      const code = (err && err.code) || String(err);
      done(false, RELEASED_ERROR_CODES.has(code), code);
    });
  });
}

/**
 * 读一次后端健康（只为失败诊断）。
 *
 * @param {object} options
 * @param {string} [options.healthUrl] 后端 /api/health 的绝对地址。
 * @param {number} [options.timeoutMs] 预算。
 * @param {function} [options.fetchImpl] 注入点（离线用例不联网）。
 * @returns {Promise<{reachable: boolean, status: (number|null), version: (string|null),
 *   detail: string}>}
 */
async function probeBackendHealth({
  healthUrl,
  timeoutMs = HEALTH_PROBE_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
} = {}) {
  const unavailable = (detail) => ({ reachable: false, status: null, version: null, detail });
  if (!healthUrl) return unavailable("没有 health 地址");
  if (typeof fetchImpl !== "function") return unavailable("当前运行时没有 fetch");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === "function") timer.unref();
  try {
    const response = await fetchImpl(healthUrl, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    let version = null;
    try {
      const body = await response.json();
      version = body && body.version ? String(body.version) : null;
    } catch {
      // 健康体读不出来不影响"端口还在应答"这个结论。
    }
    return { reachable: true, status: response.status, version, detail: "http" };
  } catch (err) {
    const detail = err && err.name === "AbortError" ? `timeout ${timeoutMs}ms` : String((err && err.message) || err);
    return unavailable(detail);
  } finally {
    clearTimeout(timer);
  }
}

/** 日志/错误里的一行进程状态。exitCode/signalCode 用 "null" 显式表达"没拿到"。 */
function summarizeProcess(state) {
  const exitCode = state.exitCode === null ? "null" : String(state.exitCode);
  const signalCode = state.signalCode === null ? "null" : String(state.signalCode);
  return `pid=${state.pid === null ? "未知" : state.pid}, exitCode=${exitCode}, signalCode=${signalCode}`;
}

/** 日志/错误里的一行后端状态。 */
function summarizeHealth(health) {
  if (!health) return "未探测";
  if (!health.reachable) return `不可达(${health.detail})`;
  return `可连接(status=${health.status}, version=${health.version === null ? "未知" : health.version})`;
}

/**
 * 断言①的说法：到点还在跑。
 *
 * @param {object} facts 诊断事实（platform / state / elapsedMs / budgetMs / health）。
 * @returns {string} 错误消息（含 platform/pid/exitCode/signalCode/后端健康）。
 */
function explicitQuitResidentMessage({ platform, state, elapsedMs, budgetMs, health }) {
  return (
    `显式退出失败：${platform} 包在 window.splash.quitApp() 之后 ${elapsedMs}ms` +
    `（预算 ${budgetMs}ms）仍在运行；platform=${platform}, ${summarizeProcess(state)}，` +
    `后端健康=${summarizeHealth(health)}。` +
    "任何平台都不存在「显式退出了还驻留」的预期行为：lib/close-behavior.js 的托盘驻留只作用于窗口 ×，" +
    "setQuitting(true) 之后的 close 一律放行；quitApp 到点还在跑，就是退出链路断了。"
  );
}

/**
 * 断言②的说法：进程退了、端口还在。
 *
 * @param {object} facts 诊断事实（platform / state / port / probe / waitedMs / health）。
 * @returns {string} 错误消息（点名 2.2.3 那次 backend stop not verified 的形态）。
 */
function backendOutlivedProcessMessage({ platform, state, port, probe, waitedMs, health }) {
  return (
    `后端端口在进程退出后仍被占用：${platform} 包的 ${summarizeProcess(state)} 已经退出，` +
    `但 127.0.0.1:${port} 在 ${waitedMs}ms 内仍然${probe.listening ? "可连接" : "无法证明已释放"}` +
    `（${probe.detail}）；后端健康=${summarizeHealth(health)}。` +
    "这正是 2.2.3 那次 backend stop not verified 的形态：窗口没了、uvicorn 还占着端口，" +
    "下一次启动或应用内更新会撞端口。"
  );
}

/** 等端口释放（轮询到预算用尽）。返回最后一次探测结果。 */
async function waitForPortRelease({
  port,
  timeoutMs = PORT_DRAIN_TIMEOUT_MS,
  intervalMs = PORT_DRAIN_INTERVAL_MS,
  probePort = probeTcpPort,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}) {
  const deadline = now() + timeoutMs;
  let last = await probePort({ port });
  while ((last.listening || !last.conclusive) && now() < deadline) {
    await delay(intervalMs);
    last = await probePort({ port });
  }
  return last;
}

/**
 * 打包冒烟的退出判据（A3）。
 *
 * 调用顺序即判据顺序：先证明"能发出退出请求"，再证明"真的退了"，最后证明"后端跟着
 * 退了"。任一步失败都带齐诊断抛出——CI 日志里只有这一条，它必须能自解释。
 *
 * @param {object} options
 * @param {object} options.page 主窗口页面（渲染进程里有 window.splash）。
 * @param {object} options.processHandle 壳进程句柄（真实 ChildProcess 或假句柄）。
 * @param {string} options.platform "win32" | "darwin" | "linux"（只进诊断文字）。
 * @param {number} options.port 后端端口（从页面 URL 取）。
 * @param {string} [options.healthUrl] 后端 /api/health 绝对地址（诊断用）。
 * @param {number} [options.budgetMs] 显式退出预算。
 * @param {number} [options.drainTimeoutMs] 端口释放的等待上限。
 * @param {number} [options.drainIntervalMs] 端口轮询间隔。
 * @param {function} [options.probePort] TCP 探测注入点。
 * @param {function} [options.probeHealth] 健康探测注入点。
 * @param {function} [options.delay] 轮询等待注入点。
 * @param {function(string): void} [options.stage] CI 阶段日志（与 verify 脚本同一种打法）。
 * @returns {Promise<{platform: string, elapsedMs: number, health: object|null,
 *   port: object}>} 判绿时的事实快照。
 */
async function verifyExplicitQuit({
  page,
  processHandle,
  platform,
  port,
  healthUrl,
  budgetMs = EXPLICIT_QUIT_BUDGET_MS,
  drainTimeoutMs = PORT_DRAIN_TIMEOUT_MS,
  drainIntervalMs = PORT_DRAIN_INTERVAL_MS,
  probePort = probeTcpPort,
  probeHealth = probeBackendHealth,
  delay,
  now = Date.now,
  stage = () => {},
}) {
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`后端端口不可用（${port}）：无法判断退出后端口是否释放`);
  }
  const startedAt = now();
  await requestExplicitQuit(page);
  stage("explicit-quit-requested");

  const exited = await waitForExit(processHandle, { timeoutMs: budgetMs });
  const state = describeProcess(processHandle);
  const elapsedMs = now() - startedAt;
  // 健康探测只服务失败诊断，所以按需触发（判绿路径不额外发一次 HTTP）。
  let health = null;
  const readHealth = async () => {
    if (!health) health = await probeHealth({ healthUrl });
    return health;
  };

  if (!exited) {
    throw new Error(
      explicitQuitResidentMessage({
        platform,
        state,
        elapsedMs,
        budgetMs,
        health: await readHealth(),
      }),
    );
  }
  stage("package-process-exited");

  const portWaitedAt = now();
  const portState = await waitForPortRelease({
    port,
    timeoutMs: drainTimeoutMs,
    intervalMs: drainIntervalMs,
    probePort,
    ...(delay ? { delay } : {}),
    now,
  });
  if (portState.listening || !portState.conclusive) {
    throw new Error(
      backendOutlivedProcessMessage({
        platform,
        state,
        port,
        probe: portState,
        waitedMs: now() - portWaitedAt,
        health: await readHealth(),
      }),
    );
  }
  return { platform, elapsedMs, health, port: portState };
}

module.exports = {
  EXPLICIT_QUIT_BUDGET_MS,
  HEALTH_PROBE_TIMEOUT_MS,
  PORT_CONNECT_TIMEOUT_MS,
  PORT_DRAIN_INTERVAL_MS,
  PORT_DRAIN_TIMEOUT_MS,
  backendOutlivedProcessMessage,
  describeProcess,
  explicitQuitResidentMessage,
  probeBackendHealth,
  probeTcpPort,
  readQuitBridge,
  readQuitBridgeSurface,
  requestExplicitQuit,
  waitForExit,
  waitForPortRelease,
  verifyExplicitQuit,
};
