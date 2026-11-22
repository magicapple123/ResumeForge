// SPDX-License-Identifier: Apache-2.0
"use strict";

// 打包退出判据的离线用例（A3 的判定逻辑，lib/packaged-quit-gate.js）。
//
// 这一层能离线测，是因为判定全部下沉到了 lib：不需要 Electron、不需要打包、不联网。
// 七条分支对应判据的七种走法——
//
//   1. 显式退出走 quitApp 桥，不借窗口 close/destroy（退出后页面被销毁不算失败）；
//   2. preload 没有 quitApp 桥 → 直接红，且**不等**预算（否则失败信息会指错方向）；
//   3. 已退出的句柄不等预算，立刻判 true；
//   4. 在途句柄只认真正的 exit 事件，事件到了就 true，且不留监听器；
//   5. quitApp 后仍在运行 → 抛错，诊断带 platform/pid/exitCode/signalCode/后端健康；
//   6. 进程退了但端口仍可连接 → 抛错，点名 2.2.3 那次 backend stop not verified 的形态；
//   7. 进程退了、端口也放掉 → 判绿（判绿路径不发健康探测）。
//
// 端口一律用**真 socket**（127.0.0.1:0 让内核挑端口），因为这一层唯一能发现「探测写错」
// 的用例就是「真的有监听者时它必须说 listening」。进程句柄是假句柄（EventEmitter +
// pid/exitCode/signalCode）：真去起一个会退出的子进程只能证明 OS 能退，证明不了判据。
//
// Run with: node --test scripts/test-packaged-quit-gate.js

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const net = require("node:net");
const { test } = require("node:test");
const {
  describeProcess,
  probeTcpPort,
  requestExplicitQuit,
  verifyExplicitQuit,
  waitForExit,
} = require("../lib/packaged-quit-gate");

/**
 * 假进程句柄：形状对齐 ChildProcess 的三个公共字段。
 *
 * `exitCode` / `signalCode` 默认 null = 还在跑；要造「已退出」就传 `exitCode: 0`。
 */
function makeFakeProcess({ pid = 4321, exitCode = null, signalCode = null } = {}) {
  const handle = new EventEmitter();
  handle.pid = pid;
  handle.exitCode = exitCode;
  handle.signalCode = signalCode;
  return handle;
}

/**
 * 假渲染进程页面：evaluate 就是「在本地直接调那个函数」，并把调用过的函数记下来。
 *
 * `destroyAfterQuit: true` 模拟真实竞态：退出请求已经发进主进程，页面随即被销毁，
 * 于是 Playwright 收不到这次 evaluate 的响应——判据必须把这种情况当成「退出生效」，
 * 而不是「退出桥坏了」。
 */
function makeFakePage({ destroyAfterQuit = false } = {}) {
  const calls = [];
  return {
    calls,
    async evaluate(fn) {
      calls.push(fn);
      const result = fn();
      // 只认**调用**形式（`.quitApp()`）：读 surface 那一次的函数体里也出现了
      // `quitApp` 这个标识符，按名字匹配会把它一起当成退出请求。
      if (destroyAfterQuit && /\.quitApp\(\)/.test(String(fn))) {
        throw new Error("Execution context was destroyed, most likely because of a navigation");
      }
      return result;
    },
  };
}

/**
 * 在假 `window` 下跑一段逻辑。
 *
 * readQuitBridgeSurface 读的是 `globalThis.window`（这样同一个函数在 Electron 渲染进程
 * 与离线用例里都是同一份实现），所以这里临时挂上去、跑完按原样还原。
 */
async function withSplash(splash, run) {
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const previous = globalThis.window;
  globalThis.window = { splash };
  try {
    return await run();
  } finally {
    if (hadWindow) globalThis.window = previous;
    else delete globalThis.window;
  }
}

/** preload 正常时暴露的那两个成员 + 一个调用计数（用例要断言「真的调了」）。 */
function makeSplash() {
  const splash = { isDesktop: true, quitCalls: 0 };
  splash.quitApp = () => {
    splash.quitCalls += 1;
  };
  return splash;
}

/** 起一个真监听 socket，返回 { server, port, close }。 */
async function listenOnEphemeralPort() {
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** 失败诊断里的健康快照（判据只把它写进错误消息，不该真的去连网络）。 */
function fakeHealth(version = "2.2.3") {
  return async () => ({ reachable: true, status: 200, version, detail: "http" });
}

test("显式退出走 quitApp 桥：页面被销毁不算失败，且不碰窗口 close", async () => {
  const splash = makeSplash();
  const page = makeFakePage();
  const surface = await withSplash(splash, () => requestExplicitQuit(page));

  assert.equal(surface.usable, true, "isDesktop + quitApp 齐全才算可用");
  assert.equal(splash.quitCalls, 1, "必须真的调了一次 quitApp");
  assert.equal(page.calls.length, 2, "先读一次 surface，再发一次退出");
  assert.match(String(page.calls[1]), /quitApp/, "第二次 evaluate 的内容必须是 splash.quitApp()");
  for (const fn of page.calls) {
    // 窗口 × 走的是 close-behavior.js 的询问 / 托盘分支，那是另一条路径：
    // 用它「退出」等于绕过 before-quit 这个唯一停止点。
    assert.doesNotMatch(String(fn), /\.close\(\)|\.destroy\(\)/, "显式退出不能借窗口 close/destroy 完成");
  }

  // 真实竞态：请求已经进主进程，页面当场销毁，Playwright 的响应就丢了。
  // 那不是桥坏了，而是退出真的开始了——判据必须继续往下走（进程 / 端口才是判据）。
  const racingSplash = makeSplash();
  const racingPage = makeFakePage({ destroyAfterQuit: true });
  const racingSurface = await withSplash(racingSplash, () => requestExplicitQuit(racingPage));
  assert.equal(racingSurface.usable, true);
  assert.equal(racingSplash.quitCalls, 1, "上下文销毁不该让「已发出退出」变成失败");
});

test("preload 没有 quitApp 桥 → 直接红，且不等退出预算", async () => {
  const page = makeFakePage();
  const startedAt = Date.now();
  await assert.rejects(
    () => withSplash(undefined, () => requestExplicitQuit(page)),
    (err) => {
      assert.match(err.message, /preload/, "错误必须指向 preload");
      assert.match(err.message, /quitApp/, "错误必须点名缺失的 quitApp");
      assert.match(err.message, /desktop\/preload\.js/, "错误要给出该改哪个文件");
      return true;
    },
  );
  // 桥缺失时若还去等 45s，CI 会先超时、日志里只剩「没退出」，真正的原因被埋掉。
  assert.ok(Date.now() - startedAt < 2_000, "桥缺失必须在等预算之前就失败");
});

test("waitForExit：已退出的句柄立刻判 true，不等预算", async () => {
  const handle = makeFakeProcess({ pid: 555, exitCode: 0 });
  const startedAt = Date.now();
  assert.equal(await waitForExit(handle, { timeoutMs: 30_000 }), true);
  assert.ok(Date.now() - startedAt < 1_000, "已经退出的句柄不该再等 30s");
  assert.deepEqual(describeProcess(handle), {
    pid: 555,
    exitCode: 0,
    signalCode: null,
    running: false,
  });
});

test("waitForExit：在途句柄只认真正的 exit 事件，事件到了返回 true 且摘掉监听器", async () => {
  const handle = makeFakeProcess({ pid: 556 });
  const waiting = waitForExit(handle, { timeoutMs: 5_000 });
  setTimeout(() => {
    handle.exitCode = 0;
    handle.emit("exit", 0, null);
  }, 20);

  assert.equal(await waiting, true);
  assert.equal(handle.listenerCount("exit"), 0, "退出之后不能留着监听器");
});

test("quitApp 后仍在运行 → 抛错，并带 platform/pid/exitCode/signalCode/后端健康", async () => {
  const splash = makeSplash();
  const page = makeFakePage();
  const handle = makeFakeProcess({ pid: 4242 });
  // 端口借用一次再放掉：这条分支在「没退出」就抛，端口只用来满足入参校验。
  const slot = await listenOnEphemeralPort();
  const port = slot.port;
  await slot.close();

  await assert.rejects(
    () =>
      withSplash(splash, () =>
        verifyExplicitQuit({
          page,
          processHandle: handle,
          platform: "linux",
          port,
          healthUrl: "http://127.0.0.1:1/api/health",
          budgetMs: 40,
          drainTimeoutMs: 40,
          drainIntervalMs: 10,
          probeHealth: fakeHealth(),
        }),
      ),
    (err) => {
      assert.match(err.message, /仍在运行/, "失败信息必须说清是「没退出」");
      assert.match(err.message, /platform=linux/, "要带平台");
      assert.match(err.message, /pid=4242/, "要带 pid");
      assert.match(err.message, /exitCode=null/, "要带 exitCode");
      assert.match(err.message, /signalCode=null/, "要带 signalCode");
      assert.match(err.message, /status=200/, "要带后端健康");
      assert.match(err.message, /version=2\.2\.3/, "要带后端版本");
      assert.match(err.message, /setQuitting\(true\)/, "要把「托盘只作用于窗口 ×」写进判据");
      return true;
    },
  );
  assert.equal(splash.quitCalls, 1, "失败路径也必须是先发过显式退出的");
});

test("进程退了但后端端口仍可连接 → 抛错并点名 2.2.3 那次 backend stop not verified", async () => {
  const splash = makeSplash();
  const page = makeFakePage();
  const handle = makeFakeProcess({ pid: 4243, exitCode: 0 });
  // 真监听者：这正是 2.2.3 的形态——壳退了，uvicorn 还在 accept。
  const backend = await listenOnEphemeralPort();

  try {
    await assert.rejects(
      () =>
        withSplash(splash, () =>
          verifyExplicitQuit({
            page,
            processHandle: handle,
            platform: "win32",
            port: backend.port,
            healthUrl: "http://127.0.0.1:1/api/health",
            budgetMs: 40,
            // 端口 drain 调到毫秒级：要验的是判据，不是耐心。
            drainTimeoutMs: 60,
            drainIntervalMs: 20,
            probeHealth: fakeHealth(),
          }),
        ),
      (err) => {
        assert.match(err.message, /backend stop not verified/, "要点名 2.2.3 那次的现象");
        assert.match(err.message, /2\.2\.3/, "要点名版本");
        assert.match(err.message, new RegExp(`127\\.0\\.0\\.1:${backend.port}`), "要点名端口");
        assert.match(err.message, /已经退出/, "要写清进程确实退了，不是「没退出」");
        return true;
      },
    );
  } finally {
    await backend.close();
  }
});

test("进程退了、端口也放掉 → 判绿，且判绿路径不发健康探测", async () => {
  const splash = makeSplash();
  const page = makeFakePage();
  const handle = makeFakeProcess({ pid: 4244, exitCode: 0 });
  const slot = await listenOnEphemeralPort();
  const port = slot.port;
  await slot.close();

  let healthProbes = 0;
  const result = await withSplash(splash, () =>
    verifyExplicitQuit({
      page,
      processHandle: handle,
      platform: "darwin",
      port,
      healthUrl: "http://127.0.0.1:1/api/health",
      budgetMs: 40,
      drainTimeoutMs: 200,
      drainIntervalMs: 20,
      probeHealth: async () => {
        healthProbes += 1;
        return { reachable: false, status: null, version: null, detail: "unused" };
      },
    }),
  );

  assert.equal(result.platform, "darwin");
  assert.equal(result.port.conclusive, true, "判绿意味着有「端口已释放」的确证");
  assert.equal(result.port.listening, false);
  assert.equal(healthProbes, 0, "判绿不该额外发健康探测：它只服务失败诊断");
  assert.equal(splash.quitCalls, 1);

  // 判绿的判据同时也是「真 socket 上探测没写错」的证据：同一个端口在 listener 关掉
  // 之后必须被 probeTcpPort 判成已释放。
  const released = await probeTcpPort({ port });
  assert.equal(released.listening, false);
  assert.equal(released.conclusive, true);
});
