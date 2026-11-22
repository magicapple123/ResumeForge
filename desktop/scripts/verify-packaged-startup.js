// SPDX-License-Identifier: Apache-2.0
"use strict";

// 打包冒烟：起得来 + 页面可用 + 后端健康 + 用户数据还在 + **退得干净**（A3）。
//
// 最后一段以前是 `process.kill(-pid, "SIGKILL")`：它只证明了「我们能杀掉它」，
// 从没证明过「应用自己退得干净」。2.2.3 的两次应用内更新（12:34 / 12:37，都被
// 「根进程已退出，但后端端口仍可连接」挡住）就是从这个缺口漏过去的——壳退了，
// uvicorn 还占着端口，而冒烟是绿的。
//
// 判据改成走**显式退出**：window.splash.quitApp() → ipcMain "app:quit-request" →
// app.quit() → before-quit（lib/quit-lifecycle.js 的唯一停止点），也就是用户点
// 「退出应用」的同一条路。判定逻辑与诊断文案在 lib/packaged-quit-gate.js，
// 七条离线用例在 scripts/test-packaged-quit-gate.js——这里只负责把它接到真包上。
//
// 收尾（2026-11-22，run 45014630409）：Linux 四个矩阵在 10:57:57 就打出了判据错误
// （「后端端口在进程退出后仍被占用」），然后 **28 分钟没有任何输出**，直到作业被取消。
// 判据早就有结论了，挂着的是这个 Node 进程本身——而判据失败恰恰就是"应用没退干净"
// 的情形：Playwright 的连接与壳进程句柄这时**可能**永远不 settle（未实测到确定的那一个
// 句柄，见 releaseProcessPipes 的限制说明），旧代码却只设 `process.exitCode = 1`，
// 退不退出全看事件循环能不能自己空掉。于是：
//   ① finally 里 application.close() 改成有界等待（到点只记一行，不改判据）；
//   ② verify() 一有结论就显式 process.exit()（先 flush，别把日志丢在管道里）。
// 退出码语义一个字没变：判绿 0、抛错 1。理由与反证见下面几处注释。
//
// Usage (与 scripts/tests/Test-*PackageUpgrade.* 的调用保持一致):
//   node scripts/verify-packaged-startup.js \
//     <executable> <win32|darwin|linux> <version> <profile-dir> <write|verify> <marker-value>

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
// 退出判据：显式退出（45s 预算，理由见该文件的头注释）+ 后端端口释放。
const { EXPLICIT_QUIT_BUDGET_MS, verifyExplicitQuit } = require("../lib/packaged-quit-gate");
// 判据失败时把应用自己的日志尾部打进 job 日志（路径规则见该文件头注释）。
const { candidateLogDirs, formatLogTailReport, readLogTail } = require("../lib/log-tail");
const playwright = require(require.resolve("@playwright/test", {
  paths: [path.resolve(__dirname, "../../frontend")],
}));

// `application.close()` 的等待上限。健康路径上它几十毫秒就完成；上限存在的唯一理由
// 是判据失败那条路：壳进程可能刚被杀掉，而 Playwright 的 close 要等子进程的收尾
// （它等的是 `close` 事件而非 `exit`），只要还有什么东西捏着壳的继承管道，那个事件
// 就可能永远不来。没有上限 = 收尾可以无限长 = xvfb-run 跟着无限等 = 作业挂到
// timeout-minutes（这正是 2026-11-22 那 28 分钟的形态）。
const CLOSE_BUDGET_MS = 8_000;

// 退出前把 stdout/stderr 交出去的兜底上限。管道读端已经没了时（CI 取消作业很常见），
// write 的回调可能永远不来——那样"确定性退出"就变成一个新的挂死点。
const EXIT_FLUSH_BUDGET_MS = 2_000;

/**
 * 清掉壳进程留下的标准流，让事件循环有机会变空。
 *
 * 为什么需要：electron 的 stdout/stderr 是 Playwright 用 `stdio: "pipe"` 建的管道，
 * 读端在本进程里；后端（uvicorn）是壳的**孙**进程，继承了那两个写端。判据失败时
 * 壳退了、后端还在（那正是断言②在报的事），写端就一直不关，我们的读端也永远等不到
 * EOF —— 而"永远不来的 EOF"正是"事件循环永不空"的经典来源之一。
 *
 * 限制（不要把它当成已验证的根因）：本地 Windows 复现不出"孙进程持有写端导致父进程
 * 不退出"（Node 对子进程 stdio 的 socket 会 unref，见 2026-11-22 的对照实验），
 * Linux 上是否同样 unref 未实测。所以这是一条**廉价的防御性清理**：判定已经落地，
 * 它不改任何结论，最坏情况只是没效果。真正保证退出的是上面的 exitWithFlush。
 *
 * @param {object} processHandle Playwright 给出的壳进程句柄（真 ChildProcess）。
 */
function releaseProcessPipes(processHandle) {
  for (const stream of [processHandle && processHandle.stdout, processHandle && processHandle.stderr]) {
    if (stream && typeof stream.destroy === "function" && !stream.destroyed) {
      try {
        stream.destroy();
      } catch {
        // 已经关掉的流再 destroy 会抛；收尾阶段没有"再失败一次"的必要。
      }
    }
  }
}

/**
 * 有界等待 `application.close()`：到点只记一行，绝不抛、绝不无限等。
 *
 * 不 await 的旧写法（`void application.close().catch(() => {})`）在健康路径上没问题，
 * 但在**最需要收场的那条路**（判据失败、壳进程状态可疑）上，它把"等多久"交给了
 * Playwright 内部。这里显式给它一个上限，让收尾时间是常数。
 *
 * @param {object} application Playwright 的 ElectronApplication。
 * @param {function(string): void} stage 阶段日志（与 verify 内部同一个 sink）。
 * @param {number} [budgetMs] 等待上限，默认 CLOSE_BUDGET_MS。
 * @returns {Promise<"closed"|"timeout"|string>} 实际结局，只用于日志。
 */
async function closeApplicationBounded(application, stage, budgetMs = CLOSE_BUDGET_MS) {
  let timer = null;
  // 计时器故意不 unref：它只活到 finish 为止（下面 finally 一定 clearTimeout），
  // 而它的职责就是"在预算用完时给出结论"。
  const budget = new Promise(resolve => {
    timer = setTimeout(() => resolve("timeout"), budgetMs);
  });
  const closed = Promise.resolve()
    .then(() => application.close())
    .then(
      () => "closed",
      error => `failed: ${String((error && error.message) || error)}`,
    );
  try {
    const outcome = await Promise.race([closed, budget]);
    if (outcome === "timeout") stage(`application-close-timeout ${budgetMs}ms`);
    else if (outcome !== "closed") stage(`application-close-${outcome}`);
    return outcome;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 用给定退出码结束进程，先把 stdout/stderr 交出去。
 *
 * 为什么必须显式退出：判据失败时进程里可能还挂着永远关不掉的句柄（见文件头那段
 * 2026-11-22 的记录）。`process.exitCode = 1` 只是"给结论"，兑现与否取决于事件循环
 * 能不能空——空不了就是作业挂到 timeout-minutes。`process.exit()` 是唯一不依赖
 * "所有句柄都已关闭"的收场方式。
 *
 * 为什么要 flush 而不是直接 exit：stdout 对管道是**异步写**，`process.exit()` 会立刻
 * 终止进程，把还没排出去的日志丢掉——CI 里就只剩半行错误信息，那比挂死更难查。
 * 空字符串写的回调排在此前所有输出之后（等于"已交给内核"），用它做栅栏。
 * 兜底定时器不可省：读端没了时那个回调可能永远不来。
 *
 * @param {number} code 退出码（0 = 判绿，1 = 判据失败）。
 */
function exitWithFlush(code) {
  let exited = false;
  const exitNow = () => {
    if (exited) return;
    exited = true;
    process.exit(code);
  };
  setTimeout(exitNow, EXIT_FLUSH_BUDGET_MS);
  try {
    process.stdout.write("", () => {
      try {
        process.stderr.write("", exitNow);
      } catch {
        exitNow();
      }
    });
  } catch {
    exitNow();
  }
}

async function verify(executablePath, platform, expectedVersion, profile, markerMode, markerValue) {
  const stage = name => console.log(`[${platform} ${expectedVersion}] ${name} ${new Date().toISOString()}`);
  const environment = {
    ...process.env,
    HOME: profile,
    XDG_CONFIG_HOME: path.join(profile, ".config"),
    XDG_DATA_HOME: path.join(profile, ".local", "share"),
    APPDATA: path.join(profile, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(profile, "AppData", "Local"),
  };
  fs.mkdirSync(profile, { recursive: true });
  if (platform === "linux") environment.APPIMAGE_EXTRACT_AND_RUN = "1";

  const application = await playwright._electron.launch({
    executablePath,
    timeout: 120_000,
    env: environment,
    args: platform === "linux" ? ["--no-sandbox"] : [],
  });
  const processHandle = application.process();
  const processExited = new Promise(resolve => processHandle.once("exit", resolve));

  try {
    stage("electron-launched");
    const identity = await application.evaluate(({ app }) => ({
      version: app.getVersion(),
      userData: app.getPath("userData"),
    }));
    assert.equal(identity.version, expectedVersion, "installed app version");

    const page = await application.firstWindow({ timeout: 180_000 });
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 180_000 });
    stage("desktop-window-ready");
    await page.evaluate(() => localStorage.setItem("resumeforge.user-guide.seen", "1"));
    await page.waitForTimeout(2_000);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const dialog = page.getByRole("dialog").first();
      if (!(await dialog.isVisible().catch(() => false))) break;
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
    }
    await page.reload();
    await page.goto(new URL("/settings?tab=about", page.url()).href);
    await page.getByText(/软件更新|Software update/).first().waitFor({ timeout: 45_000 });

    const healthResponse = await page.request.get(new URL("/api/health", page.url()).href, {
      timeout: 20_000,
    });
    assert.equal(healthResponse.status(), 200, "packaged backend health");
    const health = await healthResponse.json();
    assert.equal(health.version, expectedVersion, "backend and desktop versions match");
    stage("backend-healthy");

    const indexResponse = await page.request.get(new URL("/", page.url()).href, {
      headers: { Accept: "text/html" },
      timeout: 20_000,
    });
    assert.equal(indexResponse.status(), 200, "packaged frontend entry");
    const index = await indexResponse.text();
    const entry = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(index);
    assert.ok(entry, "index.html references a built frontend entry");
    const entryResponse = await page.request.get(new URL(entry[1], page.url()).href, {
      timeout: 20_000,
    });
    assert.equal(entryResponse.status(), 200, "packaged frontend module");

    const marker = path.join(identity.userData, "data", "ci-package-upgrade-marker.json");
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    if (markerMode === "write") {
      fs.writeFileSync(marker, markerValue, { flag: "wx" });
    } else if (markerMode === "verify") {
      assert.equal(fs.readFileSync(marker, "utf8"), markerValue, "user data survives package replacement");
    } else {
      throw new Error(`Unknown data marker mode: ${markerMode}`);
    }
    await page.screenshot({ path: path.join(profile, `desktop-${platform}-${expectedVersion}.png`) });
    stage("desktop-smoke-passed");
    console.log(`PASS: ${platform} desktop ${expectedVersion}, UI, API health, and data marker ${markerMode}`);

    // 端口与健康地址在**退出前**取：退出之后页面就没了，URL 也会失效。
    const backendUrl = page.url();
    const backendPort = Number(new URL(backendUrl).port);
    const quit = await verifyExplicitQuit({
      page,
      processHandle,
      platform,
      port: backendPort,
      healthUrl: new URL("/api/health", backendUrl).href,
      budgetMs: EXPLICIT_QUIT_BUDGET_MS,
      stage,
    });
    stage("explicit-quit-verified");
    console.log(
      `PASS: ${platform} desktop ${expectedVersion} exited via splash.quitApp() in ${quit.elapsedMs}ms ` +
        `and released backend port ${backendPort}`,
    );
  } finally {
    // 判据失败时进程可能还活着（那正是要报的事），这里只做清理、不做判定：
    // Linux AppImage 的托盘进程会自己挂着，而冒烟跑在一次性 CI profile 上，
    // 不清理就会把候选文件锁住、让下一条用例报一个假错。
    if (processHandle.exitCode === null && processHandle.signalCode === null) {
      stage("stopping-isolated-process-group");
      try {
        process.kill(-processHandle.pid, "SIGKILL");
      } catch {
        try {
          processHandle.kill("SIGKILL");
        } catch {
          // 清理失败不改判据：上面那条断言已经把"应用没退"说清楚了，
          // 而这里抛出去会把真正的失败原因盖掉。
        }
      }
      await Promise.race([processExited, new Promise(resolve => setTimeout(resolve, 10_000))]);
    }
    // 先关连接、再拆管道：反过来的话 Playwright 的 close 会读到半关的流，把一次
    // 正常收尾变成一个假错误。两步都不影响已经落地的判据（这一步在 finally 里，
    // 抛错了反而会盖掉真正的失败原因，所以 close 的异常在内部就被吞掉了）。
    await closeApplicationBounded(application, stage);
    releaseProcessPipes(processHandle);
  }
}

/**
 * 判据失败时把壳的运行日志尾部打出来（本次现场：诊断包里只有截图，没有日志）。
 *
 * 只服务诊断：不返回任何东西、绝不抛、不改判据（判据在上面已经落地了）。
 * 打 stdout 与 stderr 都行，这里统一走 stderr：它与 `console.error(error)` 同一条流，
 * 顺序天然挨在真正的失败原因后面。
 *
 * @param {string} platform "win32" | "darwin" | "linux"。
 * @param {string} profile 冒烟用的隔离 profile 目录（日志在那里面的 runtime/logs 下）。
 */
function dumpApplicationLogs(platform, profile) {
  try {
    const report = readLogTail({ dirs: candidateLogDirs({ platform, profile }) });
    for (const line of formatLogTailReport(report)) console.error(line);
  } catch (err) {
    // 诊断失败不能盖掉真正的失败原因。
    console.error(`[log-tail] 读取应用日志失败：${err}`);
  }
}

// 顶层：verify() 有结论之后**显式退出**，不再指望事件循环自己空掉（理由见 exitWithFlush
// 与文件头 2026-11-22 那段）。退出码语义与改动前一致：判绿 0、抛错 1。
const [executablePath, platform, expectedVersion, profile, markerMode, markerValue] =
  process.argv.slice(2);

verify(executablePath, platform, expectedVersion, profile, markerMode, markerValue).then(
  () => exitWithFlush(0),
  error => {
    console.error(error);
    // 日志尾部落在这里：executable/platform/version/profile 都是 verify 的入参，
    // 而 profile 是 `verify()` 里唯一知道日志在哪的那个（env 的 HOME/XDG_* 都指向它）。
    dumpApplicationLogs(platform, profile);
    exitWithFlush(1);
  },
);
