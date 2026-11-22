// SPDX-License-Identifier: Apache-2.0
"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const identity = require("../lib/process-identity");
const { probeBackendPort, stopBackend } = require("../lib/backend-stop");

test("a missing observed timestamp never verifies a recorded PID", async () => {
  const verdict = await identity.verifyProcessRecord({ pid: 999999999, startedAtUnix: 2000000000 }, {
    platform: "win32",
    commandPatterns: ["uvicorn\\s+app\\.main:app"],
    execFileFn: async () => ({ code: 0, stdout: JSON.stringify({ process_id: 999999999, started_at_unix: null, command_line: "python -m uvicorn app.main:app" }), stderr: "" }),
  });
  assert.equal(verdict.status, identity.STATUS_UNVERIFIABLE);
});

test("unverifiable spawned child survives and repeated stop remains unconfirmed", async () => {
  let kills = 0;
  const child = { pid: 999999999, exitCode: null, signalCode: null };
  const manager = {
    child, childIdentity: { pid: child.pid, startedAtUnix: 2000000000 }, usingLauncher: false,
    verifyProcessFn: async () => ({ status: identity.STATUS_UNVERIFIABLE, reason: "unreadable evidence" }),
    spawnFn: () => { kills += 1; return { on(event, cb) { if (event === "exit") cb(1); return this; } }; },
    processExistsFn: () => true, exitConfirmTimeoutMs: 0,
  };
  assert.equal((await stopBackend(manager)).ok, false);
  assert.equal(manager.child, child);
  assert.equal((await stopBackend(manager)).ok, false);
  assert.equal(kills, 0);
});

test("root PID disappearance does not mean stopped when its backend port still answers", async () => {
  const manager = {
    child: null, usingLauncher: false,
    adoptedRecord: { pid: 999999999, startedAtUnix: 2000000000 },
    verifyProcessFn: async () => ({ status: identity.STATUS_GONE }),
    url: "http://127.0.0.1:59999", portOpenFn: async () => true,
    // 端口还通 → A1 会去反查监听进程。这条用例问的是"根没了不等于停了"，反查必须
    // 是注入的空答案：否则会在测试里真的去跑一次 netstat / ss / lsof。
    listenerLookupFn: async () => ({ pid: null, reason: "测试注入：端口上没有可反查的进程" }),
    spawnFn: () => assert.fail("no signals against a missing root or unidentified descendants"),
  };
  assert.equal((await stopBackend(manager)).ok, false);
});

// --- R3: the three-state port probe -------------------------------------------

// A manager whose stop is already "clean" (no child, no record, nothing to
// kill), so the only thing left to decide is what the port probe says.
//
// A1 之后"端口仍 OPEN"还会触发一次监听进程反查：这里给注入的空答案（测试不跑
// netstat / ss / lsof），`sleepFn` 同理只是把探测序列的等待抹平——
// 断言仍然盯着状态与次数，等待时长从来不是被断言的对象。
function quietManager(extra) {
  return {
    child: null, usingLauncher: false, url: "http://127.0.0.1:59999",
    spawnFn: () => assert.fail("nothing to kill"),
    processExistsFn: () => false,
    listenerLookupFn: async () => ({ pid: null, reason: "测试注入：端口上没有可反查的进程" }),
    sleepFn: async () => {},
    ...extra,
  };
}

test("port probe: an injected boolean portOpenFn is still honoured, once, without retries", async () => {
  let calls = 0;
  const manager = quietManager({
    portOpenFn: async () => {
      calls += 1;
      return false;
    },
  });
  const probe = await probeBackendPort(manager);
  assert.equal(probe.state, "closed");
  assert.equal(calls, 1, "the boolean contract must not be retried");
  const outcome = await stopBackend(manager);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.verified, true);
});

test("port probe: undefined results stay unknown instead of 'definitely open'", async () => {
  // Only injection-free probing can produce unknown; the injected attempt
  // below is the same answer a timed-out socket gives.
  const probe = await probeBackendPort(quietManager({}), () => "unknown");
  assert.equal(probe.state, "unknown");
  assert.match(probe.detail, /第 3 次探测/, "all three attempts must be made");
});

test("stopBackend reports an unknown probe as ok with a warning, not as a blocker (R3)", async () => {
  const outcome = await stopBackend(quietManager({ portProbeFn: () => "unknown" }));
  assert.equal(outcome.ok, true, "an unreadable probe must not fail an ordinary quit");
  assert.equal(outcome.verified, false, "but the stop is still unverified");
  assert.ok(outcome.warning, "the caller needs something to log");
  assert.match(outcome.warning, /未能确认/);
});

test("stopBackend waits for a listener that drains just after its root exits", async () => {
  const states = ["open", "closed", "closed"];
  const outcome = await stopBackend(quietManager({ portProbeFn: (_, index) => states[index] }));
  assert.equal(outcome.verified, true, "two refused connections after the final open confirm shutdown");
  assert.equal(outcome.ok, true);
});

test("stopBackend still fails closed when the listener stays open", async () => {
  const outcome = await stopBackend(quietManager({ portProbeFn: () => "open" }));
  assert.equal(outcome.ok, false);
  assert.equal(outcome.verified, false);
  assert.match(outcome.reason, /端口仍可连接/);
});

test("a transient reset is retried instead of being read as 'still open' (R3)", async () => {
  const answers = ["closed", "closed", "open"];
  let attempts = 0;
  const outcome = await stopBackend(
    quietManager({
      portProbeFn: () => {
        const answer = answers[Math.min(attempts, answers.length - 1)];
        attempts += 1;
        return answer;
      },
    }),
  );
  assert.equal(attempts, 3, "the probe must retry, not decide on one attempt");
  assert.equal(outcome.ok, false, "the third attempt really did connect -> fail closed");
});

test("all three attempts refusing the connection is a clean, verified stop", async () => {
  let attempts = 0;
  const outcome = await stopBackend(
    quietManager({
      portProbeFn: () => {
        attempts += 1;
        return "closed";
      },
    }),
  );
  assert.equal(attempts, 3);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.verified, true);
  assert.equal(outcome.warning, undefined);
});

test("an unknown backend URL is 'unknown', never 'definitely gone' (fail-closed)", async () => {
  // 2026-11-23（2.3.1 门禁 run 45017991307）：这里以前返回 "closed"，于是
  // stopBackend 的 `if (outcome.ok)` 一拿到 CLOSED 就整条链路"确认已停"——
  // 壳 177ms 退出，而 uvicorn 还在 127.0.0.1:38223 上 accept。
  // "没有地址"是**不知道**，不是"已停止"：三态里 UNKNOWN 就是为这件事存在的。
  const probe = await probeBackendPort({ url: null });
  assert.equal(probe.state, "unknown", "缺少地址只能得出「无法探测」");
  assert.match(probe.detail, /地址未知/, "日志里要能看出是哪一种无法确认");
});

test("stopBackend with an unknown URL does not report a confirmed stop", async () => {
  // 同一个洞在 stopBackend 层的形状：进程树那边"没有任何可杀的东西"，端口那边
  // "不知道在哪" —— 结论必须是 ok:true（普通退出不该被卡住）+ verified:false
  // （这次停止没有证据，安装更新会被拦住）。
  const manager = quietManager({ url: null, portProbeFn: () => assert.fail("没有地址就不该去探测") });
  const outcome = await stopBackend(manager);
  assert.equal(outcome.ok, true, "普通退出不因为「不知道」卡住");
  assert.equal(outcome.verified, false, "但绝不能报成「已确认停止」");
  assert.ok(outcome.warning, "要留一行可写进 desktop-main.log 的证据");
});

// --- A1：永远不排空的监听者（2026-11-21） -------------------------------------
//
// 「等它排空」的语义在上面几条里已经钉死，尤其是：
//
//   stopBackend still fails closed when the listener stays open        ← 查不到 / 不是我们的
//
// 这一段补的是另一半：端口上的**确实是我们的后端**时，反查 → 身份校验 → 补杀一次 →
// 再探测，停得住。两条一起才构成完整语义，谁都不能改红：
//
//   上面那条 : 反查不到或不是我们的 → ok:false（fail-closed）
//   下面几条 : 反查得到且校验通过     → 补杀后正常放行
//
// 现场（2026-11-21 12:34 / 12:37 的 desktop-main.log）：根进程已经退出，端口却一直有人
// 应答（"第 1 次探测 open"），2.3.0 的缓解只是"再多等 4.5 秒"，从来没查过是谁在听
// （那时 grep OwningProcess / netstat / ss / lsof 零命中）。两次应用内更新都被它挡住。
//
// 全部离线：反查（listenerLookupFn）、进程表、终止（spawnFn=taskkill / killFn=信号）、
// 等待（sleepFn）都是注入的替身 —— **测试绝不真的给任何 pid 发信号**（评审发现过：
// 在 macOS/Linux 上会真的 SIGTERM 掉 4321）。

const RECORDED_PID = 1111; // 记录里的 pid：已经退出
const ORPHAN_PID = 2222; // 端口上真正在听的那个 uvicorn
const BACKEND_PORT = 51152; // 现场日志里的端口
const UVICORN_COMMAND =
  "D:\\ResumeForge\\desktop\\python-runtime\\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 51152";

// 一次 OPEN 结论至少要走满 7 步（3 次 + 端口 OPEN 时追加的 4 个 drain 间隔）；
// 补杀后的第二次探测要 3 次 CLOSED 才算确信。sleepFn 是空实现，所以不花时间。
const OPEN_THEN_CLOSED = [...Array(7).fill("open"), "closed", "closed", "closed"];
const ALWAYS_OPEN = Array(14).fill("open");

/** 按出现顺序回答端口探测（用尽后重复最后一个答案）。 */
function probeScript(answers) {
  let index = 0;
  return () => answers[Math.min(index++, answers.length - 1)];
}

/** taskkill 替身：记下被要求终止的 pid，然后立刻报告"退出码 0"。 */
function spawnSpy(kills) {
  return (file, args) => {
    kills.push({ pid: Number(args && args[1]), file });
    return {
      on(event, callback) {
        if (event === "exit") setImmediate(() => callback(0));
        return this;
      },
    };
  };
}

/**
 * 「根已退出、端口另有监听」的管理器。
 *
 * 注入点与真机一致：`verifyProcessFn` 是身份校验、`listenerLookupFn` 是端口反查、
 * `spawnFn` / `killFn` 是终止（Windows 走 taskkill，POSIX 走信号）——所以两个平台的
 * 用例是同一份断言，不会"只在 Windows 上被测过"。
 */
function orphanManager(overrides = {}) {
  const kills = [];
  const manager = {
    child: null,
    usingLauncher: false,
    adoptedRecord: { pid: RECORDED_PID, startedAtUnix: 2000000000 },
    url: `http://127.0.0.1:${BACKEND_PORT}`,
    exitConfirmTimeoutMs: 0,
    sleepFn: async () => {},
    // 默认：记录里的 pid 已经没了（这条路径本来就走到"端口还通"），其余一律拒绝。
    verifyProcessFn: async (record) =>
      record.pid === RECORDED_PID
        ? { status: identity.STATUS_GONE }
        : { status: identity.STATUS_MISMATCH, reason: "命令行与后端不符（PID 已被复用）" },
    listenerLookupFn: async () => ({ pid: null, reason: "测试注入：端口上没有可反查的进程" }),
    portProbeFn: probeScript(OPEN_THEN_CLOSED),
    spawnFn: spawnSpy(kills),
    killFn: (pid) => kills.push({ pid, file: "signal" }),
    processExistsFn: () => false,
    ...overrides,
  };
  return { manager, kills };
}

/** 端口上确实是我们的 uvicorn：反查拿到 pid + 现场身份证据。 */
function orphanLookup() {
  return async (port) => ({
    pid: ORPHAN_PID,
    startedAtUnix: 2000000100,
    startSignature: null,
    commandLine: UVICORN_COMMAND,
    reason: "",
    port,
  });
}

/** 身份校验：记录里的 pid 已退出，端口上的那个是**我们**的后端。 */
function verifyOrphan(captured) {
  return async (record) => {
    if (record.pid === RECORDED_PID) return { status: identity.STATUS_GONE };
    if (captured) captured.push(record);
    return { status: identity.STATUS_VERIFIED, info: {} };
  };
}

test("A1：端口上的监听者永远不排空，但反查确认是我们的后端 → 补杀一次后停得住", async () => {
  const captured = [];
  const { manager, kills } = orphanManager({
    listenerLookupFn: orphanLookup(),
    verifyProcessFn: verifyOrphan(captured),
  });

  const outcome = await stopBackend(manager);

  // 与上面 "still fails closed when the listener stays open" 相对的另一半：这一次端口
  // 上确实是我们的后端，所以补杀之后应当放行，而不是继续 blocked。
  assert.equal(outcome.ok, true, `补杀后应当停得住（实际：${outcome.reason} / ${outcome.detail}）`);
  assert.equal(outcome.verified, true, "端口确认关闭之后才算已核验");
  assert.equal(outcome.rescued, true, "结论里要能看出这次是补杀救回来的");

  // 补杀**一次**，而且打的是端口上的那个 pid，不是记录里的旧 pid。
  assert.equal(kills.length, 1, `只允许补杀一次（实际 ${kills.length} 次）`);
  assert.equal(kills[0].pid, ORPHAN_PID, "杀的是反查到的监听进程");

  // 身份校验用的记录必须带上**现场读到的**启动时刻：pid 在"反查"与"校验"之间被回收时，
  // 命令行可能还匹配，只有启动时刻能把它认出来（verifyProcessRecord 也只在有启动证据时
  // 才可能判 VERIFIED）。
  assert.equal(captured.length, 1, "反查到的 pid 必须过一次身份校验");
  assert.equal(captured[0].pid, ORPHAN_PID);
  assert.equal(captured[0].startedAtUnix, 2000000100, "现场启动时刻要带进校验记录");

  // 那一行证据（quit-lifecycle 把它写进 desktop-main.log）：端口 → pid → 命令行 → 结果。
  const rescued = outcome.rescueLog;
  assert.ok(rescued, "补杀成功必须留一行证据");
  assert.match(rescued, new RegExp(`^backend stop rescued listener \\(port=${BACKEND_PORT}`), "格式与既有的 backend stop … 行一致");
  assert.match(rescued, new RegExp(`pid=${ORPHAN_PID}`), "日志要写明 pid");
  assert.match(rescued, /command=".*uvicorn app\.main:app/s, "日志要写明命令行片段");
  assert.match(rescued, /result=已补杀，端口已关闭/, "日志要写明结果");
});

test("A1：端口上是别人的进程（命令行不匹配后端）→ 一个信号都不发，仍然 blocked", async () => {
  const { manager, kills } = orphanManager({
    listenerLookupFn: async (port) => ({
      pid: ORPHAN_PID,
      startedAtUnix: 2000000100,
      startSignature: null,
      commandLine: "node D:\\somewhere\\other-server.js --port 51152",
      reason: "",
      port,
    }),
    verifyProcessFn: async (record) =>
      record.pid === RECORDED_PID
        ? { status: identity.STATUS_GONE }
        : { status: identity.STATUS_MISMATCH, reason: "命令行与后端不符（PID 已被复用）" },
  });

  const outcome = await stopBackend(manager);

  assert.equal(outcome.ok, false, "别人的进程不能靠「补杀」换来一次绿灯");
  assert.equal(outcome.verified, false);
  assert.match(outcome.reason, /端口仍可连接/, "失败原因要保留原来的定位话术");
  assert.match(outcome.reason, /无法确认它是我们的后端/, "还要说明补杀为什么没做");
  assert.equal(kills.length, 0, "身份校验没通过就不许发任何终止信号");

  const skipped = outcome.rescueLog;
  assert.ok(skipped, "跳过补杀也要留一行证据");
  assert.match(skipped, /^backend stop rescue skipped \(/);
  assert.match(skipped, new RegExp(`pid=${ORPHAN_PID}`));
  assert.match(skipped, /node D:\\somewhere\\other-server\.js/, "日志要写清是谁占着端口");
  assert.match(skipped, /result=身份校验未通过/);
});

test("A1：身份证据不足（缺启动时刻）→ 同样不许杀", async () => {
  const { manager, kills } = orphanManager({
    listenerLookupFn: async (port) => ({
      pid: ORPHAN_PID,
      // 读不到启动时刻时反查会给 null：单凭"端口是它的"不够，verifyProcessRecord 会判
      // UNVERIFIABLE（见本文件第一条用例）。
      startedAtUnix: null,
      startSignature: null,
      commandLine: UVICORN_COMMAND,
      reason: "",
      port,
    }),
    verifyProcessFn: async (record) =>
      record.pid === RECORDED_PID
        ? { status: identity.STATUS_GONE }
        : { status: identity.STATUS_UNVERIFIABLE, reason: "缺少可核对的启动时刻，不能仅凭命令行停止进程" },
  });

  const outcome = await stopBackend(manager);

  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /无法确认它是我们的后端/);
  assert.equal(kills.length, 0, "无法核验身份时只能 blocked（RR-02 同一条纪律）");
});

test("A1：反查拿不到 pid（工具缺失/超时）→ 保持 blocked，不能因为查不到就放行", async () => {
  const { manager, kills } = orphanManager({
    listenerLookupFn: async () => ({ pid: null, reason: "反查端口 51152 超时（5000ms）" }),
  });

  const outcome = await stopBackend(manager);

  assert.equal(outcome.ok, false, "查不到监听者 = 无法确认，不是「没事了」");
  assert.match(outcome.reason, /无法反查监听进程/);
  assert.match(outcome.reason, /超时/, "理由要带出来，否则日志里看不出是哪种失败");
  assert.equal(kills.length, 0);
  assert.match(String(outcome.rescueLog), /^backend stop rescue skipped \(port=51152; pid=未知/, "反查失败同样要留痕");
});

test("A1：补杀后端口还通 → 只补杀一次就 blocked（不无限重试）", async () => {
  const { manager, kills } = orphanManager({
    listenerLookupFn: orphanLookup(),
    verifyProcessFn: verifyOrphan([]),
    portProbeFn: probeScript(ALWAYS_OPEN),
  });

  const outcome = await stopBackend(manager);

  assert.equal(outcome.ok, false, "补杀了也还通，仍然是无法确认");
  assert.equal(kills.length, 1, `补杀只有一次机会（实际 ${kills.length} 次）`);
  assert.match(outcome.reason, /已补杀 pid=2222/, "要说明补杀做过、但仍然不通");
  assert.match(outcome.reason, /端口仍可连接/);
});

test("A1：探测结果是 unknown 时不去反查（只对 OPEN 补救）", async () => {
  let lookups = 0;
  const { manager } = orphanManager({
    listenerLookupFn: async () => {
      lookups += 1;
      return { pid: null, reason: "测试注入" };
    },
    portProbeFn: () => "unknown",
  });

  const outcome = await stopBackend(manager);

  assert.equal(lookups, 0, "读不懂的 socket 不是「有人在听」，不该触发补杀");
  assert.equal(outcome.ok, true, "unknown 不卡住普通退出（R3 口径不变）");
  assert.equal(outcome.verified, false);
});

test("A1：反查 + 真实的 verifyProcessRecord 能走通（身份校验不是被用例绕过去的）", async () => {
  // 上面几条都用替身当 verifyProcessFn。这条特意用**生产里的**
  // processIdentity.verifyProcessRecord + 假进程表，证明这条链真的能判出 VERIFIED：
  // 命令行匹配**并且**启动时刻对得上，两者缺一（见本文件第一条用例）就是 UNVERIFIABLE。
  // 换平台也成立：win32 读 started_at_unix，POSIX 读 ps 的 lstart 字符串。
  const signature = "Sat Nov 22 10:00:00 2026";
  // 假进程表：记录里的 pid 已经不存在，端口上的 ORPHAN_PID 才是那个 uvicorn。
  const execFileFn = async (file, args) => {
    if (process.platform === "win32") {
      const script = String(args[args.length - 1] || "");
      const requested = /-Id (\d+)/.exec(script);
      if (!requested || Number(requested[1]) !== ORPHAN_PID) return { code: 0, stdout: "null", stderr: "" };
      return {
        code: 0,
        stderr: "",
        stdout: JSON.stringify({
          process_id: ORPHAN_PID,
          started_at_unix: 2000000100,
          command_line: UVICORN_COMMAND,
        }),
      };
    }
    const requested = Number(args[args.indexOf("-p") + 1]);
    if (requested !== ORPHAN_PID) return { code: 1, stdout: "", stderr: "" };
    if (args.includes("lstart=")) return { code: 0, stdout: `${signature}\n`, stderr: "" };
    if (args.includes("args=")) return { code: 0, stdout: `${UVICORN_COMMAND}\n`, stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const { manager, kills } = orphanManager({
    execFileFn,
    verifyProcessFn: identity.verifyProcessRecord,
    listenerLookupFn: async (port) => ({
      pid: ORPHAN_PID,
      startedAtUnix: 2000000100,
      startSignature: signature,
      commandLine: UVICORN_COMMAND,
      reason: "",
      port,
    }),
  });

  const outcome = await stopBackend(manager);

  assert.equal(outcome.ok, true, `真实身份校验必须认得出自己的后端（实际：${outcome.reason}）`);
  assert.equal(kills.length, 1);
  assert.equal(kills[0].pid, ORPHAN_PID);
});

test("A1：后端地址不是本机 loopback 时，不拿端口去本机进程表里找 listener", async () => {
  // 非 loopback 地址上"端口还通"（probePortOnce 对非本机地址直接按 OPEN 处理）不代表
  // 本机有我们的后端。此时按端口去本机进程表里找 listener 并补杀，可能杀到一台毫不相干
  // 的本地服务，所以这种情况保持 blocked。
  let lookups = 0;
  const { manager, kills } = orphanManager({
    url: "http://192.0.2.10:51152",
    listenerLookupFn: async () => {
      lookups += 1;
      return { pid: null, reason: "测试注入" };
    },
    portProbeFn: probeScript(ALWAYS_OPEN),
  });

  const outcome = await stopBackend(manager);

  assert.equal(lookups, 0, "非本机地址不该触发本机反查");
  assert.equal(kills.length, 0, "更不许杀本机的任何进程");
  assert.equal(outcome.ok, false, "仍然 fail-closed");
  assert.match(outcome.reason, /端口仍可连接/);
});
