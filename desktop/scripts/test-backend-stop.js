// SPDX-License-Identifier: Apache-2.0
"use strict";

// R3-04 probes for lib/backend-stop.js + lib/process-identity.js:
//
//   1. the exit-confirmation poll is adaptive (50ms x 4, then 300ms) and the
//      default cadence still belongs to callers that do not opt in;
//   2. every waitForProcessExit call on the stop path actually uses it;
//   3. the stop stages stamp the quit timeline the lifecycle hands down.
//
// No real process is killed: the process table, the taskkill spawn and the
// signals are all injected (same seams as test-stop-failclosed.js).
//
// Run with: node --test scripts/test-backend-stop.js

const assert = require("assert");
const { test } = require("node:test");
const { EventEmitter } = require("node:events");
const { confirmTermination, stopBackend } = require("../lib/backend-stop");
const { waitForProcessExit } = require("../lib/process-identity");

/**
 * Fake clock: `scheduleFn` advances it instead of sleeping, so a 5s timeout
 * costs nothing and the recorded delays are the exact poll cadence.
 */
function fakeClock({ dieAtMs }) {
  const state = { now: 0, delays: [] };
  const nowFn = () => state.now;
  const scheduleFn = (resolve, ms) => {
    state.delays.push(ms);
    state.now += ms;
    setImmediate(resolve);
  };
  const existsFn = () => state.now < dieAtMs;
  return { ...state, state, existsFn, nowFn, scheduleFn };
}

test("adaptive poll: a process that dies at 120ms is confirmed at ~150ms, not 300ms", async () => {
  const clock = fakeClock({ dieAtMs: 120 });
  const gone = await waitForProcessExit(4321, {
    timeoutMs: 5000,
    intervalMs: 300,
    fastIntervalMs: 50,
    fastAttempts: 4,
    existsFn: clock.existsFn,
    scheduleFn: clock.scheduleFn,
    nowFn: clock.nowFn,
  });

  assert.strictEqual(gone, true, "the process really is gone");
  assert.deepStrictEqual(clock.state.delays, [50, 50, 50],
    "three 50ms polls: gone is observed at 150ms instead of waiting for the 300ms tick");
  assert.ok(clock.state.now <= 150, `confirmation must come back within ~150ms (took ${clock.state.now}ms)`);
  assert.ok(clock.state.now < 300, "the old flat cadence would have needed 300ms");
});

test("adaptive poll: the long tail falls back to intervalMs after fastAttempts", async () => {
  const clock = fakeClock({ dieAtMs: 1000 });
  const gone = await waitForProcessExit(4321, {
    timeoutMs: 5000,
    intervalMs: 300,
    fastIntervalMs: 50,
    fastAttempts: 4,
    existsFn: clock.existsFn,
    scheduleFn: clock.scheduleFn,
    nowFn: clock.nowFn,
  });

  assert.strictEqual(gone, true);
  const delays = clock.state.delays;
  assert.deepStrictEqual(delays.slice(0, 4), [50, 50, 50, 50], "the first four polls are fast");
  assert.strictEqual(delays[4], 300, "then the interval goes back to the steady 300ms");
});

test("default cadence is unchanged for callers that do not opt in", async () => {
  const clock = fakeClock({ dieAtMs: 120 });
  const gone = await waitForProcessExit(4321, {
    existsFn: clock.existsFn,
    scheduleFn: clock.scheduleFn,
    nowFn: clock.nowFn,
  });
  assert.strictEqual(gone, true);
  assert.deepStrictEqual(clock.state.delays, [300],
    "without fastIntervalMs/fastAttempts the poll stays at the historical 300ms");
});

test("a process that never exits still fails closed at the deadline", async () => {
  const clock = fakeClock({ dieAtMs: Number.POSITIVE_INFINITY });
  const gone = await waitForProcessExit(4321, {
    timeoutMs: 200,
    fastIntervalMs: 50,
    fastAttempts: 4,
    existsFn: clock.existsFn,
    scheduleFn: clock.scheduleFn,
    nowFn: clock.nowFn,
  });
  assert.strictEqual(gone, false, "an unreadable / surviving process is never reported as gone");
});

// confirmTermination needs both kill seams: win32 spawns taskkill, posix signals.
function makeManager({ alivePolls }) {
  let poll = 0;
  const marks = [];
  const manager = {
    quitTimeline: { marks, mark(label) { marks.push(label); } },
    exitConfirmTimeoutMs: 5000,
    processExistsFn: () => poll++ < alivePolls,
    killFn: () => {},
    spawnFn: () => {
      const killer = new EventEmitter();
      setImmediate(() => killer.emit("exit", 0));
      return killer;
    },
  };
  return manager;
}

test("confirmTermination uses the fast cadence (a tree gone after 3 polls returns in ~150ms)", async () => {
  const manager = makeManager({ alivePolls: 3 });
  const startedAt = Date.now();
  const outcome = await confirmTermination(manager, 4321, null);
  const elapsed = Date.now() - startedAt;

  assert.strictEqual(outcome.ok, true, "the process is confirmed gone");
  assert.ok(elapsed < 300,
    `the stop must not wait for a 300ms tick when the tree is already gone (took ${elapsed}ms)`);
  assert.ok(elapsed >= 100, `three 50ms polls take about 150ms (took ${elapsed}ms)`);
  assert.ok(manager.quitTimeline.marks.includes("process gone"), "the stage is stamped for the quit log");
  if (process.platform === "win32") {
    assert.ok(manager.quitTimeline.marks.includes("taskkill exit"), "the taskkill stage is stamped too");
  }
});

test("stopBackend stamps the port-probe stage and tolerates a manager without a timeline", async () => {
  const manager = makeManager({ alivePolls: 0 });
  manager.child = null;
  manager.usingLauncher = false;
  manager.url = "http://127.0.0.1:59999";
  manager.portOpenFn = async () => false;

  const outcome = await stopBackend(manager);
  assert.strictEqual(outcome.ok, true);
  assert.ok(manager.quitTimeline.marks.includes("port probe"), "the probe stage closes the stop timeline");

  // A stop outside a quit (unit tests, a future caller) has no recorder: it
  // must still work, silently.
  manager.quitTimeline = undefined;
  const again = await stopBackend(manager);
  assert.strictEqual(again.ok, true, "a manager without a quit timeline must not break the stop");
});
