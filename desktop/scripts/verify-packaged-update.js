// SPDX-License-Identifier: Apache-2.0
"use strict";

// Run by Test-DesktopUpdateHandoff.ps1 against its freshly installed baseline.
// Before publication the release transport serves the actual candidate bytes
// from disk. With no candidate path the installed app uses its public feed.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
// 版本号来自命令行参数，造正则这件事收在 lib/update-version-match.js 里
// （CodeQL #137 js/regex-injection：只转 "." 不够，整串转义）。
const { versionDialogMatcher } = require("../lib/update-version-match");
const playwright = require(require.resolve("@playwright/test", { paths: [path.resolve(__dirname, "../../frontend")] }));

async function serveCandidate(app, version, candidate, notesFile) {
  const name = path.basename(candidate);
  const body = notesFile ? fs.readFileSync(notesFile, "utf8").trim() :
    "## Windows release test\n\n- Verified in app\n\n<details>\n<summary>中文版</summary>\n\n## Windows 更新验证\n\n- 应用内校验\n</details>";
    await app.evaluate(({ net }, fixture) => {
      const files = process.getBuiltinModule("node:fs");
      const { Readable } = process.getBuiltinModule("node:stream");
      const base = "https://github.com/magicapple123/ResumeForge/releases/download/v" + fixture.version + "/";
      const api = "https://api.github.com/repos/magicapple123/ResumeForge/releases/latest";
      const actualFetch = net.fetch.bind(net);
      net.fetch = async (url, init) => {
        if (url === api) {
          const assets = [fixture.name, fixture.name + ".sha256"].map(asset => ({
            name: asset, browser_download_url: base + asset,
            size: files.statSync(asset === fixture.name ? fixture.candidate : fixture.candidate + ".sha256").size,
          }));
          return Response.json({tag_name: "v" + fixture.version, assets, body: fixture.body});
        }
        if (url === base + fixture.name + ".sha256") return new Response(files.readFileSync(fixture.candidate + ".sha256"));
        if (url !== base + fixture.name) return actualFetch(url, init);
        async function* chunks() {
          let first = true;
          for await (const chunk of files.createReadStream(fixture.candidate, { highWaterMark: 8 * 1024 * 1024 })) {
            yield chunk;
            if (first) {
              first = false;
              await new Promise(resolve => setTimeout(resolve, 1200));
            }
          }
        }
        return new Response(Readable.toWeb(Readable.from(chunks())), {
          headers: { "Content-Length": String(files.statSync(fixture.candidate).size) },
        });
      };
    }, { version, candidate, name, body });
}

async function drive(executablePath, baselineVersion, version, work, candidate, notesFile) {
  const app = await playwright._electron.launch({ executablePath, timeout: 90000 });
  const child = app.process();
  try {
    const baseline = await app.evaluate(({ app }) => ({ version: app.getVersion(), data: app.getPath("userData") }));
    assert.equal(baseline.version, baselineVersion, "unexpected installed upgrade baseline");
    console.log(`Launched baseline ${baseline.version}; expecting ${version} via ${candidate ? "candidate fixture" : "public GitHub Releases"}`);
    if (candidate) await serveCandidate(app, version, candidate, notesFile);
    const page = await app.firstWindow();
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 180000 });
    await page.evaluate(() => localStorage.setItem("resumeforge.user-guide.seen", "1"));
    await page.goto(new URL("/settings?tab=about", page.url()).href);
    const check = page.getByRole("button", { name: /检查更新|Check for updates/i });
    await check.waitFor({ timeout: 90000 });
    const marker = path.join(baseline.data, "data", `handoff-${randomUUID()}.txt`);
    const value = randomUUID();
    fs.writeFileSync(marker, value, { flag: "wx" });
    fs.writeFileSync(path.join(work, "baseline.json"), JSON.stringify({
      marker, value, pid: child.pid,
    }), { flag: "wx" });

    // A previous interrupted rehearsal or first-run guide can be visible on
    // startup. Dismiss it before exercising the Settings button.
    const startupDialog = page.getByRole("dialog");
    const dismissStartup = async () => {
      console.log("Dismissing startup dialog:", await startupDialog.getAttribute("aria-labelledby"));
      await page.keyboard.press("Escape");
    };
    const openFromSettings = async () => {
      await page.addLocatorHandler(startupDialog, dismissStartup);
      await check.click();
      await page.removeLocatorHandler(startupDialog);
    };
    await openFromSettings();
    const targetName = versionDialogMatcher(version);
    const offer = page.getByRole("dialog", { name: targetName });
    const readNotes = async () => {
      const notes = offer.locator("section[aria-label]");
      await notes.getByRole("heading").first().waitFor();
      assert.equal(await page.getByRole("dialog").count(), 1);
      const text = await notes.innerText();
      assert.doesNotMatch(text, /<\/?(?:details|summary)\b/i);
      const locale = await page.locator("html").getAttribute("lang");
      if (locale.startsWith("zh")) assert.match(text, /\p{Script=Han}/u);
      else assert.match(text, /[A-Za-z]{3}/);
      await offer.screenshot({path: path.join(work, "notice-" + locale + ".png")});
      const unrendered = await notes.locator("strong").evaluateAll(bold => bold.some(element =>
        Array.from(element.childNodes).some(node => node.nodeType === Node.TEXT_NODE && /`[^`]+`/.test(node.textContent))));
      assert.equal(unrendered, false, "nested inline code in the release must be rendered");
      const nested = notes.locator("strong code").first();
      if (await nested.count()) {
        await nested.scrollIntoViewIfNeeded();
        await offer.screenshot({path: path.join(work, "nested-" + locale + ".png")});
      }
      return {locale, text};
    };
    const first = await readNotes();
    await page.keyboard.press("Escape");
    await page.goto(new URL("/settings?tab=appearance", page.url()).href);
    await page.addLocatorHandler(startupDialog, dismissStartup);
    const other = first.locale.startsWith("zh") ? "English" : "中文";
    const saved = page.waitForResponse(r => r.url().endsWith("/settings/locale") && r.request().method() === "PUT" && r.ok());
    await page.getByRole("radio", {name: other, exact:true}).click();
    await saved;
    await page.removeLocatorHandler(startupDialog);
    await page.goto(new URL("/settings?tab=about", page.url()).href);
    await openFromSettings();
    const second = await readNotes();
    assert.notEqual(second.locale, first.locale);
    assert.notEqual(second.text, first.text, "both interface languages must have their own release notes");
    await Promise.all([
      app.waitForEvent("close", { timeout: candidate ? 120000 : 300000 }),
      (async () => {
        await offer.getByRole("button", { name: /立即更新|Update now/i }).click();
        // Public transfer speed and Content-Length vary. The controlled fixture
        // makes the intermediate progress state observable.
        if (candidate) {
          await offer.getByRole("progressbar").waitFor({ timeout: 30000 });
          await offer.screenshot({ path: path.join(work, "download-progress.png") });
        }
      })(),
    ]);
    console.log("Observed Chinese and English release notes and the updater handed off to the installer");
  } finally {
    if (child.exitCode === null && child.signalCode === null) await app.close().catch(() => {});
  }
}

drive(...process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
