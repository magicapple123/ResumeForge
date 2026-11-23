// SPDX-License-Identifier: Apache-2.0
"use strict";

// T4-b：GitHub 匿名额度用尽时的备用探测（第 12 条）。
//
// 现场证据（2026-11-23 23:18）：桌面「检查更新」报失败，后端同一秒返回「已是最新」。
// 差别只有一处——后端在 `api.github.com` 返回 403 之后会改走
// `github.com/<repo>/releases/latest` 的 302（不消耗 API 额度），桌面没有这条分支。
//
// 全部离线：fetch 是替身，一次真实网络请求都不会发生（与 test-desktop-update-session.js
// 同一份 harness：scripts/updater-harness.js）。
//
// 三条判据与 02-tasks.md 的验收矩阵逐条对应：
//   1. 主路径 403 + remaining 0 → 走备用；备用 302 到 v0.19.0 → 只有版本号，走 missing；
//   2. 主路径 403 + 备用也 403 → 失败，且 errorDetail 里两个状态码都在；
//   3. 主路径 200 → 备用一次都不发（断言只发生一次请求）。
//
// Run with: node --test scripts/test-updater-fallback.js

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const { createDesktopUpdateSession: createSession } = require("../lib/desktop-update-session");
const {
  combinedFailureText,
  describeFailure,
  failureFacts,
  rawFailureText,
  recoveryMinutes,
} = require("../lib/update-failure-text");
const { INSTALLER_NAME, UP_TO_DATE_RELEASE, loadUpdater } = require("./updater-harness");

const API = "https://api.github.com/repos/magicapple123/ResumeForge/releases/latest";
const REDIRECT = "https://github.com/magicapple123/ResumeForge/releases/latest";
const TAG_URL = `https://github.com/magicapple123/ResumeForge/releases/tag/v${"0.19.0"}`;

/** 响应头替身：`get` 大小写敏感，所以调用方一律传小写名。 */
function headerStub(values = {}) {
  return {
    get: (name) => (Object.prototype.hasOwnProperty.call(values, name) ? values[name] : null),
  };
}

/** 一次 fetch 响应替身（`ok` 由状态码推出，与真实 Response 一致）。 */
function respond({ status, values = {}, location = "", json = null }) {
  const merged = location ? { ...values, location } : values;
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "",
    headers: headerStub(merged),
    json: async () => json,
  };
}

/** 按 URL 前缀分派的 fetch 替身，并记录每一次请求（用来断言"备用一次都没发"）。 */
function router(routes) {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = String(input);
    calls.push(url);
    const route = routes.find((candidate) => url.startsWith(candidate.prefix));
    if (!route) throw new Error(`unexpected request: ${url}`);
    return route.respond();
  };
  return { calls, fetchImpl };
}

/** 会话：只关心 phase / error / errorDetail，install 一旦被调用就是用例写错了。 */
function sessionFor(loaded, logs = []) {
  return createSession({
    current: "0.18.0",
    inspect: loaded.exports.inspectRelease,
    install: () => assert.fail("降级/失败的检查不该走到安装"),
    publish: () => {},
    log: (line) => logs.push(line),
  });
}

test("主路径 403 且额度为 0：改走备用探测，只拿到版本号，绝不假装可安装", async () => {
  const { calls, fetchImpl } = router([
    { prefix: API, respond: () => respond({ status: 403, values: { "x-ratelimit-remaining": "0" } }) },
    { prefix: REDIRECT, respond: () => respond({ status: 302, location: TAG_URL }) },
  ]);
  const loaded = loadUpdater({ fetchImpl });
  try {
    const offer = await loaded.exports.inspectRelease();
    assert.deepEqual(calls, [API, REDIRECT], "主路径失败后必须补一次不消耗额度的备用探测");
    assert.equal(offer.latest, "0.19.0", "版本号来自 302 的 location");
    assert.equal(offer.notes, "", "备用探测拿不到更新说明，不许编");
    assert.equal(offer.size, null, "拿不到附件大小");
    assert.equal(offer.missing, INSTALLER_NAME, "没有附件就必须走 missing（error:incomplete）");
    assert.notEqual(offer.upToDate, true);
    assert.match(offer.failureDetail, /releases\/latest returned 403/, "降级原因要带出去");
    assert.match(offer.failureDetail, /x-ratelimit-remaining: 0/);

    // 会话层的契约：错误码仍是既有的 incomplete（码集合不新增），原因挂在 errorDetail。
    const session = sessionFor(loaded);
    await session.check(true);
    const state = session.snapshot();
    assert.equal(state.phase, "failed");
    assert.equal(state.error, "incomplete");
    assert.equal(state.latest, "0.19.0");
    assert.match(state.errorDetail, /releases\/latest returned 403/);
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("主路径 403、备用也 403：失败并带出两个状态码，日志里给中文归因", async () => {
  const { calls, fetchImpl } = router([
    { prefix: API, respond: () => respond({ status: 403, values: { "x-ratelimit-remaining": "0" } }) },
    { prefix: REDIRECT, respond: () => respond({ status: 403 }) },
  ]);
  const loaded = loadUpdater({ fetchImpl });
  try {
    const logs = [];
    const session = sessionFor(loaded, logs);
    await session.check(true);
    const state = session.snapshot();
    assert.equal(state.phase, "failed");
    assert.equal(state.error, "check", "error 码集合不新增：仍是 check");
    assert.match(state.errorDetail, /releases\/latest returned 403/, "主路径原文要留下");
    assert.match(state.errorDetail, /fallback probe failed/, "要指出备用也试过了");
    assert.match(state.errorDetail, /releases\/latest redirect returned 403/, "备用那一路的状态码要留下");
    assert.equal(calls.length, 2, "主路径 + 备用各一次，不许重试风暴");
    // 中文结论只进 desktop-main.log（壳层对话框是双语的）：它要能区分"等一会儿"和"换网络"。
    assert.ok(
      logs.some((line) => /desktop update check failed:/.test(line) && /匿名额度已用完/.test(line)),
      `日志里缺归因：${JSON.stringify(logs)}`,
    );
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("主路径 200：备用探测一次都不许发", async () => {
  const { calls, fetchImpl } = router([
    { prefix: API, respond: () => respond({ status: 200, json: UP_TO_DATE_RELEASE }) },
  ]);
  const loaded = loadUpdater({ fetchImpl });
  try {
    const offer = await loaded.exports.inspectRelease();
    assert.equal(offer.upToDate, true);
    assert.deepEqual(calls, [API], "主路径成功时不许碰备用（省一次请求，也就不会多一次误判的机会）");
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("备用探测到的版本不比当前新：按「已是最新」收场，不报失败", async () => {
  const sameVersion = "https://github.com/magicapple123/ResumeForge/releases/tag/v0.18.0";
  const { fetchImpl } = router([
    { prefix: API, respond: () => respond({ status: 403, values: { "x-ratelimit-remaining": "0" } }) },
    { prefix: REDIRECT, respond: () => respond({ status: 302, location: sameVersion }) },
  ]);
  const loaded = loadUpdater({ fetchImpl });
  try {
    const offer = await loaded.exports.inspectRelease();
    assert.equal(offer.upToDate, true, "版本 ≤ 当前 → 已是最新");
    const session = sessionFor(loaded);
    await session.check(true);
    const state = session.snapshot();
    assert.equal(state.phase, "current");
    assert.equal(state.error, "");
    assert.equal(state.errorDetail, "", "「已是最新」不是失败，不该挂原因");
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("备用探测指向白名单外的主机：拒绝，不放宽 ALLOWED_HOSTS", async () => {
  const hostile = "https://evil.example/releases/tag/v9.9.9";
  const { fetchImpl } = router([
    { prefix: API, respond: () => respond({ status: 403, values: { "x-ratelimit-remaining": "0" } }) },
    { prefix: REDIRECT, respond: () => respond({ status: 302, location: hostile }) },
  ]);
  const loaded = loadUpdater({ fetchImpl });
  try {
    await assert.rejects(
      () => loaded.exports.inspectRelease(),
      (err) => {
        assert.match(err.message, /update host not allowed: evil\.example/);
        // 那个地址**不会被请求**：只从 location 里取 tag，取之前先过白名单。
        assert.match(err.message, /fallback probe failed/);
        return true;
      },
    );
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("归因口径与后端 describe_failure / _github_error_message 一致", () => {
  // 固定"当前时刻"，用例不随时钟抖动（重置时刻是 UTC epoch 秒，不是毫秒）。
  const now = 1_800_000_000;
  const limited = failureFacts(
    403,
    headerStub({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(now + 28 * 60) }),
  );
  assert.equal(limited.rateLimited, true, "403 + remaining 0 = 额度用完");
  assert.equal(recoveryMinutes(limited.resetAt, now), 28);
  assert.match(describeFailure(limited, now), /匿名额度已用完，约 28 分钟后恢复/);
  assert.equal(
    rawFailureText(limited),
    `releases/latest returned 403 (x-ratelimit-remaining: 0, x-ratelimit-reset: ${now + 28 * 60})`,
  );

  // 403 但额度还在 = 网络里有人拦了 api.github.com：等多久都没用，必须换网络。
  const blocked = failureFacts(403, headerStub({ "x-ratelimit-remaining": "57" }));
  assert.equal(blocked.rateLimited, false);
  assert.match(describeFailure(blocked), /有人拦了 api\.github\.com/);

  // 429 一定算限额（后端 build_api_error 同一判据）。
  assert.equal(failureFacts(429, headerStub({})).rateLimited, true);
  // 一个头都没有时也只能说状态码。
  assert.equal(rawFailureText(failureFacts(404, undefined)), "releases/latest returned 404");
  // 不足一分钟按一分钟说；超过一天宁可不报数字。
  assert.equal(recoveryMinutes(now + 1, now), 1);
  assert.equal(recoveryMinutes(now + 3 * 86400, now), null);

  const both = combinedFailureText(limited, new Error("releases/latest redirect returned 403"));
  assert.match(both, /^releases\/latest returned 403/);
  assert.match(both, /fallback probe failed: releases\/latest redirect returned 403$/);
});
