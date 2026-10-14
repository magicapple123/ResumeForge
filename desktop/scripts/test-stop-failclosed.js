"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const identity = require("../lib/process-identity");
const { stopBackend } = require("../lib/backend-stop");

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
