// SPDX-License-Identifier: Apache-2.0
"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { BackendManager } = require("../backend-manager");
const { resolveRuntimePython } = require("../lib/backend-runtime");
const { makeTempRoot } = require("./testkit");

test("an asynchronous backend spawn error is handled and ends startup with a useful error", async () => {
  const root = makeTempRoot("spawn-error");
  const interpreter = resolveRuntimePython(path.join(root, "runtime"));
  fs.mkdirSync(path.dirname(interpreter), { recursive: true });
  fs.writeFileSync(interpreter, "synthetic interpreter path; never executed");
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = undefined;
  child.exitCode = null;
  child.signalCode = null;
  const manager = new BackendManager(root, path.join(root, "runtime"), {
    spawnFn: () => child,
    killFn: () => assert.fail("a failed spawn has no verified process to signal"),
  });
  let emitted = false;
  manager.isHealthy = async () => {
    if (!emitted) {
      emitted = true;
      assert.doesNotThrow(() => child.emit("error", new Error("synthetic ENOENT")));
    }
    return false;
  };
  try {
    await assert.rejects(manager.start(), /spawn failed.*synthetic ENOENT/i);
  } finally {
    manager.closeLog();
    // Keep the tiny isolated diagnostic fixture for inspection, no user data involved.
  }
});
