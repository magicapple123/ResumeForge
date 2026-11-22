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
// Usage (与 scripts/tests/Test-*PackageUpgrade.* 的调用保持一致):
//   node scripts/verify-packaged-startup.js \
//     <executable> <win32|darwin|linux> <version> <profile-dir> <write|verify> <marker-value>

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
// 退出判据：显式退出（45s 预算，理由见该文件的头注释）+ 后端端口释放。
const { EXPLICIT_QUIT_BUDGET_MS, verifyExplicitQuit } = require("../lib/packaged-quit-gate");
const playwright = require(require.resolve("@playwright/test", {
  paths: [path.resolve(__dirname, "../../frontend")],
}));

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
        processHandle.kill("SIGKILL");
      }
      await Promise.race([processExited, new Promise(resolve => setTimeout(resolve, 10_000))]);
    }
    void application.close().catch(() => {});
  }
}

verify(...process.argv.slice(2)).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
