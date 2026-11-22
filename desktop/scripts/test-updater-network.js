// SPDX-License-Identifier: Apache-2.0
"use strict";

// 系统代理 / 下载停滞 / 单飞锁（2026-11-21；从 test-updater-manual.js 拆出）。
//
// 三条都对应一个**用户实测到**的缺陷形态，而不是假想的边界：
//   1. 全局 fetch 在系统代理下收不到正文（HTTP 206 + 0 字节）→ 更新静默失败；
//   2. 连接假活时没有任何超时能收场 → 窗口弹出、进度条永远停在 0；
//   3. 连点两次会并发两个下载 → %TEMP% 留下两个 0 字节的 .part 目录。
//
// 拆出来的原因只有一条：原文件贴在 500 行预算上（496/500，零豁免），而这批用例与
// 「发布资产不全」那批毫无共享状态，唯一共享的是 scripts/updater-harness.js 里的
// VM + 桩 harness（本来就该只有一份）。
//
// Run with: node --test scripts/test-updater-network.js

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");
const {
  ASSET_URL,
  INSTALLER_NAME,
  UP_TO_DATE_RELEASE,
  loadUpdater,
} = require("./updater-harness");

test("元数据请求走 net.fetch（Chromium 网络栈才认系统代理）", async () => {
  const netCalls = [];
  let globalFetchCalls = 0;
  const netStub = {
    fetch: async (input, init) => {
      netCalls.push({ input, init });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => UP_TO_DATE_RELEASE,
        body: null,
      };
    },
  };
  const loaded = loadUpdater({
    netStub,
    fetchImpl: async () => {
      globalFetchCalls += 1;
      assert.fail("代理环境里全局 fetch 拿不到正文，不允许再走它");
    },
  });
  try {
    await loaded.exports.checkAndOfferUpdate(null, {});
    assert.equal(netCalls.length, 1, "releases 元数据必须走 net.fetch");
    assert.equal(globalFetchCalls, 0, "有 net 时一次都不许碰全局 fetch");
    // 逐跳白名单的前提没变：仍要手动跟随重定向，且每跳都带真的 AbortSignal。
    assert.equal(netCalls[0].init.redirect, "manual");
    assert.ok(netCalls[0].init.signal instanceof AbortSignal, "信号必须是 AbortSignal");
    assert.equal(loaded.events.errors.length, 0);
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("下载停滞：看门狗中止并抛 STALL，且清掉 0 字节的 .part 暂存文件", async () => {
  const loaded = loadUpdater({
    // 正文永不产出（连接假活）：headers 有 Content-Length，body 一个 chunk 都不来。
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "1048576" },
      body: new Readable({ read() {} }),
    }),
  });
  const dest = path.join(loaded.tmpRoot, INSTALLER_NAME);
  // 看门狗定时器是 unref 的（生产里事件循环由 Electron 与真实套接字撑着，见
  // downloadToFile 的注释）。这里的替身流没有任何 handle，事件循环会先一步清空、
  // 进程直接退出，50ms 的定时器永远等不到——用例必须自己 hold 住事件循环。
  const keepAlive = setTimeout(() => {}, 5_000);
  try {
    await assert.rejects(
      () => loaded.exports.downloadToFile(ASSET_URL, dest, { stallTimeoutMs: 50 }),
      (err) => {
        assert.equal(err.code, "STALL", `停滞必须有专属错误码（实际：${err && err.message}）`);
        assert.match(err.message, /stalled/, "错误信息要能自己说明是停滞");
        return true;
      },
    );
    // 失败路径必须收干净：留下 0 字节的 .part 正是用户在 %TEMP% 里看到的东西。
    assert.equal(fs.existsSync(`${dest}.part`), false, "停滞失败后不能留下暂存文件");
  } finally {
    clearTimeout(keepAlive);
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("连点两次「立即更新」：复用同一个 Promise，元数据只查一次，结束后锁复位", async () => {
  let metadataFetches = 0;
  const loaded = loadUpdater({
    fetchImpl: async () => {
      metadataFetches += 1;
      // 让第一次请求"在飞"，第二次调用才一定落在 in-flight 窗口里。
      await new Promise((resolve) => setImmediate(resolve));
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => UP_TO_DATE_RELEASE,
        body: null,
      };
    },
  });
  try {
    const deps = { manual: false };
    const p1 = loaded.exports.checkAndOfferUpdate(null, deps);
    const p2 = loaded.exports.checkAndOfferUpdate(null, deps);
    assert.strictEqual(p1, p2, "并发调用必须拿到同一个 Promise（否则会并发两个下载）");
    await p1;
    assert.equal(metadataFetches, 1, "第二次调用不该再发一次请求");
    // 锁不能永久卡住：上一次结束后，下一次点击必须真的重新走一遍流程。
    await loaded.exports.checkAndOfferUpdate(null, deps);
    assert.equal(metadataFetches, 2, "流程结束（成功或失败）后锁必须复位");
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("元数据用 manual 逐跳校验，资产下载必须用 follow（electron#43715）", async () => {
  // electron#43715：net.fetch 在 redirect:"manual" 下遇到 302 直接抛
  // `Redirect was cancelled`（stale 关闭、无确认修复；QA 在 45.3.2 上实测复发），而
  // github.com 的资产地址必然 302 到 release-assets.githubusercontent.com——下载用
  // manual 就等于装不上。元数据那条仍在用 manual（逐跳校验 ALLOWED_HOSTS）。
  //
  // 两次请求都必须走 **net.fetch**（Chromium 网络栈才认系统代理）：下载那次若退回全局
  // fetch，代理环境下正文一个字节都收不到。所以这里 net 桩接管全部请求，全局 fetch 一旦
  // 被调用就失败。
  const redirectModes = [];
  let globalFetchCalls = 0;
  const netStub = {
    fetch: async (_input, init = {}) => {
      redirectModes.push(init.redirect);
      if (redirectModes.length === 1) {
        // 元数据：同版本，检查在"已是最新"处结束，不进下载。
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => UP_TO_DATE_RELEASE,
          body: null,
        };
      }
      // 下载：一个能一次读完的最小正文。
      return {
        ok: true,
        status: 200,
        headers: { get: () => "5" },
        body: Readable.from(["hello"]),
      };
    },
  };
  const loaded = loadUpdater({
    netStub,
    fetchImpl: async () => {
      globalFetchCalls += 1;
      assert.fail("有 net 时下载也不许回落全局 fetch（代理环境里它收不到正文）");
    },
  });
  const dest = path.join(loaded.tmpRoot, INSTALLER_NAME);
  try {
    await loaded.exports.checkAndOfferUpdate(null, {});
    const { size } = await loaded.exports.downloadToFile(ASSET_URL, dest);
    assert.equal(size, 5);
    assert.equal(globalFetchCalls, 0, "两次请求都必须走 net.fetch");
    assert.equal(redirectModes[0], "manual", "元数据仍要逐跳校验（ALLOWED_HOSTS）");
    assert.equal(
      redirectModes[1],
      "follow",
      "下载不能再用 manual：net.fetch 遇 302 会抛 Redirect was cancelled",
    );
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("拿响应头也计入停滞预算：代理接受连接但永不回响应头时按 STALL 收场", async () => {
  // QA 实测的 third 形态：连上了、但响应头永远不来（mode=no-headers 3 秒内没有任何中止
  // 迹象）。它只靠 60 分钟整程上限时等于不设防，所以拿头阶段必须按 stallTimeoutMs 计时。
  // 替身必须**响应 signal**（真实 fetch 会），否则这里等的是一个永不 settle 的 Promise。
  const loaded = loadUpdater({
    fetchImpl: (_input, init = {}) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      }),
  });
  const dest = path.join(loaded.tmpRoot, INSTALLER_NAME);
  const keepAlive = setTimeout(() => {}, 5_000);
  // 拿头预算若没生效，这个 Promise 会一直 pending——事件循环里没有任何 handle，整份用例
  // 会以"pending 到进程退出"这种难读的形态失败。加一个 2 秒的护栏，把它变成一条能读的
  // 断言失败（反证时正是靠它精确变红）。
  let guardTimer = null;
  const guard = new Promise((_resolve, reject) => {
    guardTimer = setTimeout(
      () => reject(new Error("拿响应头阶段没有任何中止迹象：stallTimeoutMs 预算没有生效")),
      2_000,
    );
  });
  try {
    await assert.rejects(
      () =>
        Promise.race([
          loaded.exports.downloadToFile(ASSET_URL, dest, { stallTimeoutMs: 50 }),
          guard,
        ]),
      (err) => {
        assert.equal(err.code, "STALL", `拿头阶段超时也必须是 STALL（实际：${err && err.message}）`);
        assert.match(err.message, /response headers/, "错误信息要说清卡在哪一段");
        return true;
      },
    );
    assert.equal(fs.existsSync(`${dest}.part`), false, "拿头阶段失败也不许留下暂存文件");
  } finally {
    clearTimeout(guardTimer);
    clearTimeout(keepAlive);
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("手动检查遇到 STALL：弹「下载没有进展」，不是笼统的「检查更新失败」", async (t) => {
  // 自动安装链路只在 win32 上走（runManualUpdateCheck 的平台判定），别的平台上这条
  // 出口是"请手动下载"，断言不适用。
  if (process.platform !== "win32") {
    t.skip("installer protocol is Windows-only (see runManualUpdateCheck)");
    return;
  }
  // 这里只需要 code 为 STALL 的失败：真实停滞由"下载停滞"那条用例负责（它跑的是
  // downloadToFile，必须毫秒级超时，走不到 runManualUpdateCheck 的 catch）。
  // 两条用例合起来才是完整契约：真实停滞一定产出 STALL，STALL 一定给专属文案。
  const loaded = loadUpdater({
    fetchImpl: async () => {
      throw Object.assign(new Error("download stalled: no bytes for 45000 ms"), { code: "STALL" });
    },
  });
  const lines = [];
  try {
    loaded.exports.runManualUpdateCheck(null, (line) => lines.push(line));
    // catch 是异步的：等它把对话框弹出来。
    for (let i = 0; i < 50 && loaded.events.errors.length === 0; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(loaded.events.errors.length, 1, "停滞必须让用户看见一句话");
    assert.equal(loaded.events.errors[0].title, "下载没有进展", "停滞不能退化成通用失败提示");
    assert.match(loaded.events.errors[0].message, /45 秒/, "要说清是多久没有收到数据");
    assert.match(loaded.events.errors[0].message, /代理/, "要给「确认代理」这条出路");
    assert.ok(
      lines.some((line) => /manual update check failed: .*stalled/.test(line)),
      `日志里也要留痕（实际：${JSON.stringify(lines)}）`,
    );
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});

test("后台检查在飞时点「立即更新」：手动那次必须自己走一遍，不能被「已是最新」静默吞掉", async () => {
  // 后台定时检查（manual:false，启动 30 秒后首次、之后每 6 小时）在飞时用户点了
  // 「立即更新」。两次若复用同一个 Promise，用户拿到的是后台那条**没有 onUpToDate**
  // 的执行流：结论若是「已是最新」，它按设计一声不响，用户看到的就是"点了没反应"——
  // 2.2.2 刚修掉的症状会从这里复发。第一次请求挂在可控的 deferred 上，好在窗口里操作。
  let openGate;
  const gate = new Promise((resolve) => { openGate = resolve; });
  let metadataFetches = 0;
  const loaded = loadUpdater({
    fetchImpl: async () => {
      metadataFetches += 1;
      if (metadataFetches === 1) await gate;
      const json = async () => UP_TO_DATE_RELEASE;
      return { ok: true, status: 200, headers: { get: () => null }, json, body: null };
    },
  });
  const upToDate = [];
  try {
    const background = loaded.exports.checkAndOfferUpdate(null, { manual: false });
    const manual = loaded.exports.checkAndOfferUpdate(null, {
      manual: true,
      onUpToDate: (current, latest) => upToDate.push([current, latest]),
    });
    assert.notStrictEqual(manual, background, "手动那次不得并进后台的执行流");
    assert.equal(metadataFetches, 1, "手动那次要等后台收场，不能与它并发发请求");
    openGate();
    await background;
    await manual;
    assert.equal(metadataFetches, 2, "后台收场后手动那次必须自己再查一次");
    assert.equal(upToDate.length, 1, "手动那次要拿到自己应有的结果（「已是最新」回调）");
  } finally {
    fs.rmSync(loaded.tmpRoot, { recursive: true, force: true });
  }
});
