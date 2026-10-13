"use strict";

// Probes for desktop/lib/backend-runtime.js.
//
// These exist because the line-budget split once moved `extractZip` into a new
// module WITHOUT its `child_process` import: every call threw
// `ReferenceError: spawn is not defined`, and the rest of the suite stayed
// green because every test injects a fake extractFn. The first case below is
// the guard for exactly that regression (it must fail with tar's own error,
// never with a ReferenceError).

const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { test } = require("node:test");
const { makeTempRoot } = require("./testkit");

const { RUNTIME_ZIP_NAME, extractZip, rotateLogFile, tarExecutable } = require("../lib/backend-runtime");

test("extractZip is callable with spawn in scope (module-split regression)", async () => {
  const root = makeTempRoot("runtime-zip-missing");
  try {
    const missing = path.join(root, "missing.zip");
    const target = path.join(root, "out");
    fs.mkdirSync(target, { recursive: true });
    await assert.rejects(
      () => extractZip(missing, target),
      (err) => !(err instanceof ReferenceError),
      "spawn must resolve inside backend-runtime.js",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("extractZip spawns tar with the zip and the target directory", async () => {
  const calls = [];
  const fakeSpawn = (file, args, options) => {
    calls.push({ file, args, options });
    const child = {
      on(event, handler) {
        if (event === "exit") setImmediate(() => handler(0));
        return child;
      },
    };
    return child;
  };
  const root = makeTempRoot("runtime-zip-args");
  try {
    await extractZip(path.join(root, "r.zip"), path.join(root, "out"), fakeSpawn);
    assert.strictEqual(calls.length, 1);
    // Same resolver production uses: on Windows that is the system bsdtar by
    // absolute path (PATH may lead with Git's GNU tar, which cannot read zip),
    // elsewhere the PATH `tar`.
    assert.strictEqual(calls[0].file, tarExecutable());
    assert.ok(/^tar(\.exe)?$/.test(path.basename(calls[0].file)), "must be a tar executable");
    assert.deepStrictEqual(calls[0].args.slice(0, 1), ["-xf"]);
    assert.ok(calls[0].args[1].endsWith("r.zip"), "the zip path must be passed through");
    assert.ok(calls[0].args.includes("-C"), "extraction must be rooted at the target dir");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("extractZip unpacks a real archive when the platform tar can read zip", async (t) => {
  const root = makeTempRoot("runtime-zip-real");
  try {
    const source = path.join(root, "payload.txt");
    fs.writeFileSync(source, "runtime payload");
    const zipPath = path.join(root, RUNTIME_ZIP_NAME);
    try {
      // Build the archive with the *same* tar production extracts with:
      // bsdtar writes zip from the -a suffix, GNU tar cannot. Using one
      // resolver for both halves means the case runs exactly where the
      // packaged shell can unpack -- previously it took PATH's tar to create
      // and fell back to skipping on a Git-for-Windows PATH.
      execFileSync(tarExecutable(), ["-a", "-c", "-f", zipPath, path.basename(source)], {
        cwd: root,
        stdio: "ignore",
      });
    } catch {
      t.skip("the platform tar cannot create zip archives");
      return;
    }
    // Production creates the runtime dir before extracting
    // (backend-manager prepareRuntime); mirror that here instead of leaving
    // `tar -C` to fail on a missing directory.
    const target = path.join(root, "out");
    fs.mkdirSync(target, { recursive: true });
    await extractZip(zipPath, target);
    assert.strictEqual(
      fs.readFileSync(path.join(target, "payload.txt"), "utf-8"),
      "runtime payload",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rotateLogFile is defined exactly once (duplicate definition regression)", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "backend-runtime.js"), "utf-8");
  const definitions = source.match(/function rotateLogFile\(/g) ?? [];
  assert.strictEqual(definitions.length, 1, "a duplicated definition shadows silently");
  assert.strictEqual(typeof rotateLogFile, "function");
});
