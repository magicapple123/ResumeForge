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
    spawnFn: () => assert.fail("no signals against a missing root or unidentified descendants"),
  };
  assert.equal((await stopBackend(manager)).ok, false);
});

// --- R3: the three-state port probe -------------------------------------------

// A manager whose stop is already "clean" (no child, no record, nothing to
// kill), so the only thing left to decide is what the port probe says.
function quietManager(extra) {
  return {
    child: null, usingLauncher: false, url: "http://127.0.0.1:59999",
    spawnFn: () => assert.fail("nothing to kill"),
    processExistsFn: () => false,
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

test("stopBackend still fails closed when any retry sees an open port", async () => {
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

test("a backend that never started has nothing to probe", async () => {
  const probe = await probeBackendPort({ url: null });
  assert.equal(probe.state, "closed");
});
