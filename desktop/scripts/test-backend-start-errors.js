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

test("an early exit caused by a missing module is reported in plain Chinese", async () => {
  // The packaged 1.0.1 incident: the runtime unpacked fine but lacked a package
  // the backend imports at startup. Users saw "Backend exited early (code=1)"
  // and could do nothing with it. The stderr tail (bounded, in
  // lib/backend-startup.js) must turn that into an actionable cause -- while a
  // plain crash keeps the original wording.
  const root = makeTempRoot("early-exit-missing-module");
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
    killFn: () => assert.fail("no verified process exists after an early exit"),
  });
  let emitted = false;
  manager.isHealthy = async () => {
    if (!emitted) {
      emitted = true;
      child.stderr.emit(
        "data",
        Buffer.from(
          [
            "Traceback (most recent call last):",
            '  File "/payload/backend/app/main.py", line 12, in <module>',
            "    import pypdfium2",
            "ModuleNotFoundError: No module named 'pypdfium2'",
            "",
          ].join("\n"),
          "utf-8",
        ),
      );
      child.emit("exit", 1, null);
    }
    return false;
  };
  try {
    await assert.rejects(manager.start(), (error) => {
      assert.match(error.message, /运行时缺少依赖/, "the cause replaces the opaque code");
      assert.match(error.message, /pypdfium2/, "the missing module is named");
      assert.match(error.message, /请重新安装本软件/, "the user is told what to do");
      assert.doesNotMatch(error.message, /Backend exited early/, "the raw wording is replaced");
      // The log path must survive: it carries the full traceback.
      assert.match(error.message, /desktop-backend\.log/, "the log path stays in the message");
      return true;
    });
  } finally {
    manager.closeLog();
  }
});

test("an early exit without a dependency error keeps the original wording", async () => {
  const root = makeTempRoot("early-exit-plain");
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
    killFn: () => assert.fail("no verified process exists after an early exit"),
  });
  let emitted = false;
  manager.isHealthy = async () => {
    if (!emitted) {
      emitted = true;
      child.stderr.emit("data", Buffer.from("OSError: [Errno 48] Address already in use\n"));
      child.emit("exit", 3, null);
    }
    return false;
  };
  try {
    await assert.rejects(manager.start(), /Backend exited early \(code=3\)/);
  } finally {
    manager.closeLog();
  }
});
