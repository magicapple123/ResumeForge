// SPDX-License-Identifier: Apache-2.0
"use strict";

// Child event wiring for backend startup. A failed spawn emits "error" rather
// than throwing from spawn(), so startup must own both paths and bound its wait.
function attachBackendChild(manager) {
  const child = manager.child;
  manager.earlyExit = null;
  manager.startupError = null;
  const write = (chunk) => {
    if (manager.logStream && !manager.logStream.destroyed) manager.logStream.write(chunk);
  };
  child.stdout.on("data", write);
  child.stderr.on("data", write);
  child.on("error", (error) => {
    manager.startupError = error;
    write(`Backend spawn failed: ${error.message}\n`);
  });
  child.on("exit", (code, signal) => manager.onChildExit(code, signal));
  if (!manager.usingLauncher && Number.isInteger(child.pid)) {
    manager.recordSpawnedChild(child.pid).catch(() => {});
  }
}

module.exports = { attachBackendChild };
