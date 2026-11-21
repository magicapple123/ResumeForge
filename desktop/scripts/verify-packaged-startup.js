// SPDX-License-Identifier: Apache-2.0
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const playwright = require(require.resolve("@playwright/test", {
  paths: [path.resolve(__dirname, "../../frontend")],
}));

async function verify(executablePath, platform, expectedVersion, profile, markerMode, markerValue) {
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

  try {
    const identity = await application.evaluate(({ app }) => ({
      version: app.getVersion(),
      userData: app.getPath("userData"),
    }));
    assert.equal(identity.version, expectedVersion, "installed app version");

    const page = await application.firstWindow();
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 180_000 });
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
    console.log(`PASS: ${platform} desktop ${expectedVersion}, UI, API health, and data marker ${markerMode}`);

    const exited = () =>
      processHandle.exitCode !== null || processHandle.signalCode !== null
        ? Promise.resolve(true)
        : Promise.race([
            new Promise(resolve => processHandle.once("exit", () => resolve(true))),
            new Promise(resolve => setTimeout(() => resolve(false), 10_000)),
          ]);
    await page.evaluate(() => window.splash?.quitApp?.());
    if (!(await exited())) {
      console.warn("App stayed resident after the smoke test. Stopping its isolated process group.");
      try {
        process.kill(-processHandle.pid, "SIGTERM");
      } catch {
        processHandle.kill("SIGTERM");
      }
      if (!(await exited())) {
        try {
          process.kill(-processHandle.pid, "SIGKILL");
        } catch {
          processHandle.kill("SIGKILL");
        }
      }
    }
    assert.ok(await exited(), "the isolated packaged app process must terminate before replacing its bundle");
  } finally {
    if (processHandle.exitCode === null && processHandle.signalCode === null) {
      await application.close().catch(() => {});
    }
  }
}

verify(...process.argv.slice(2)).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
