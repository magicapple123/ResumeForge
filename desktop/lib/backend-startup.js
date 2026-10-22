// SPDX-License-Identifier: Apache-2.0
"use strict";

// Child event wiring for backend startup. A failed spawn emits "error" rather
// than throwing from spawn(), so startup must own both paths and bound its wait.

// The shell has to be able to explain an early exit in words a user can act on
// ("运行时缺少依赖（安装可能损坏）：pypdfium2..."), but the full stderr must
// never be buffered: the backend logs every request, so a long-lived install
// would hold megabytes in memory and, worse, would keep growing while the
// process is healthy. Keep the last 8 KiB only -- Python tracebacks put the
// interesting lines (the ImportError and the module name) at the end.
const STDERR_TAIL_LIMIT = 8 * 1024;

// appendStderrTail(text, chunk) -> bounded text.
//
// Pure and exported so the truncation boundary can be tested without a child
// process: the failure mode of a naive implementation (unbounded growth) is
// invisible in a short test run.
function appendStderrTail(text, chunk, limit = STDERR_TAIL_LIMIT) {
  const incoming = Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk ?? "");
  const combined = `${text}${incoming}`;
  if (combined.length <= limit) return combined;
  return combined.slice(combined.length - limit);
}

// Child event wiring for backend startup. A failed spawn emits "error" rather
// than throwing from spawn(), so startup must own both paths and bound its wait.
function attachBackendChild(manager) {
  const child = manager.child;
  manager.earlyExit = null;
  manager.startupError = null;
  // Reset per launch: a tail left over from a previous run would misdiagnose
  // the new one (an old ImportError would blame the wrong module).
  manager.stderrTail = "";
  const write = (chunk) => {
    if (manager.logStream && !manager.logStream.destroyed) manager.logStream.write(chunk);
  };
  child.stdout.on("data", write);
  child.stderr.on("data", (chunk) => {
    // Capture BEFORE writing: the diagnosis must work even when the log stream
    // is already gone (unwritable log directory, permission error, ...).
    manager.stderrTail = appendStderrTail(manager.stderrTail, chunk);
    write(chunk);
  });
  child.on("error", (error) => {
    manager.startupError = error;
    write(`Backend spawn failed: ${error.message}\n`);
  });
  child.on("exit", (code, signal) => manager.onChildExit(code, signal));
  if (!manager.usingLauncher && Number.isInteger(child.pid)) {
    manager.recordSpawnedChild(child.pid).catch(() => {});
  }
}

module.exports = { STDERR_TAIL_LIMIT, appendStderrTail, attachBackendChild };
