// SPDX-License-Identifier: Apache-2.0
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

const {
  RUNTIME_ZIP_NAME,
  diagnoseRuntimeFailure,
  extractZip,
  readBundledManifest,
  rotateLogFile,
  runtimeManifestPath,
  runtimeMarkerPath,
  runtimeMatchesManifest,
  tarExecutable,
} = require("../lib/backend-runtime");

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

// --- runtime manifest (report task 10) -----------------------------------------
//
// The manifest is the only thing that can tell "this runtime tree matches the
// requirements.txt this build shipped" apart from "the tree came from this zip".
// The 1.0.1 incident was exactly that gap: the zip digest matched perfectly
// because the cached zip *was* the shipped one -- it just predated a new pin.

function manifestFixture(overrides = {}) {
  return {
    schema: 1,
    pythonVersion: "3.12.10",
    requirementsSha256: "a".repeat(64),
    createdUtc: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("readBundledManifest: missing, corrupt or non-object sidecars give no fingerprint", () => {
  const root = makeTempRoot("manifest-read");
  try {
    assert.strictEqual(readBundledManifest(root), null, "missing sidecar -> null");

    fs.writeFileSync(runtimeManifestPath(root), "{ this is not json");
    assert.strictEqual(readBundledManifest(root), null, "corrupt sidecar -> null");

    fs.writeFileSync(runtimeManifestPath(root), JSON.stringify(["not", "an", "object"]));
    assert.strictEqual(readBundledManifest(root), null, "array sidecar -> null");

    const manifest = manifestFixture();
    fs.writeFileSync(runtimeManifestPath(root), JSON.stringify(manifest));
    assert.deepStrictEqual(readBundledManifest(root), manifest, "valid sidecar round-trips");

    // PowerShell 5.1's `-Encoding UTF8` prefixes a BOM; JSON.parse throws on it,
    // so without the strip the check would silently switch itself off.
    fs.writeFileSync(runtimeManifestPath(root), `\uFEFF${JSON.stringify(manifest)}`);
    assert.deepStrictEqual(readBundledManifest(root), manifest, "BOM-prefixed sidecar still reads");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runtimeMatchesManifest: only a recorded disagreement is a mismatch", () => {
  const root = makeTempRoot("manifest-match");
  try {
    const runtimeDir = path.join(root, "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const manifest = manifestFixture();

    // No manifest at all (mac payloads carry no zip, dev trees before the
    // guard existed): nothing to compare, so nothing is reported.
    assert.strictEqual(runtimeMatchesManifest(runtimeDir, null), true, "no manifest -> no opinion");

    // Marker absent: the caller (prepareRuntime) has already rejected this, but
    // the function must not claim agreement it cannot verify.
    assert.strictEqual(runtimeMatchesManifest(runtimeDir, manifest), false, "no marker -> false");

    // Legacy marker (pre-fingerprint builds): must NOT trigger a re-unpack,
    // otherwise every 0.9.x upgrade re-downloads and re-installs for nothing.
    fs.writeFileSync(
      runtimeMarkerPath(runtimeDir),
      JSON.stringify({ sha256: "b".repeat(64), createdAt: "2025-01-01T00:00:00.000Z" }),
    );
    assert.strictEqual(runtimeMatchesManifest(runtimeDir, manifest), true,
      "legacy marker without fingerprint fields -> unknown -> true");

    // Fingerprint recorded and agreeing.
    fs.writeFileSync(
      runtimeMarkerPath(runtimeDir),
      JSON.stringify({
        sha256: "b".repeat(64),
        python: manifest.pythonVersion,
        requirementsSha256: manifest.requirementsSha256,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(runtimeMatchesManifest(runtimeDir, manifest), true, "agreeing marker -> true");

    // Same zip digest, different requirements fingerprint: the exact shape of
    // the 1.0.1 incident. This is the case the digest check cannot see.
    assert.strictEqual(
      runtimeMatchesManifest(runtimeDir, manifestFixture({ requirementsSha256: "c".repeat(64) })),
      false,
      "requirements fingerprint changed -> false",
    );
    assert.strictEqual(
      runtimeMatchesManifest(runtimeDir, manifestFixture({ pythonVersion: "3.12.14" })),
      false,
      "interpreter version changed -> false",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("diagnoseRuntimeFailure: only missing-dependency exits get a user-facing cause", () => {
  // Nothing to say.
  assert.strictEqual(diagnoseRuntimeFailure(""), null);
  assert.strictEqual(diagnoseRuntimeFailure(undefined), null);
  assert.strictEqual(
    diagnoseRuntimeFailure("INFO: Started server process [123]\nINFO: Waiting for application startup."),
    null,
    "a healthy log tail must not be diagnosed as a broken install",
  );

  const moduleNotFound = [
    "Traceback (most recent call last):",
    '  File "/opt/rf/backend/app/main.py", line 12, in <module>',
    "    import pypdfium2",
    "ModuleNotFoundError: No module named 'pypdfium2'",
  ].join("\n");
  const message = diagnoseRuntimeFailure(moduleNotFound);
  assert.match(message, /运行时缺少依赖/, "the cause is stated in plain Chinese");
  assert.match(message, /pypdfium2/, "the missing module is named");
  assert.match(message, /请重新安装本软件/, "the user is told what to do");
  assert.doesNotMatch(message, /ENOENT|Traceback|ModuleNotFoundError/, "no raw stderr is leaked");

  // Python 2 style / third-party re-raise.
  assert.match(
    diagnoseRuntimeFailure("ImportError: No module named 'docx'"),
    /docx/,
    "ImportError without ModuleNotFoundError still names the module",
  );

  // An ImportError that carries no module name must still produce an actionable
  // message rather than swallowing the failure.
  const unnamed = diagnoseRuntimeFailure("ImportError: cannot import name 'X' from 'y'");
  assert.match(unnamed, /运行时缺少依赖/);
  assert.match(unnamed, /未知模块/);

  // Two failures in one tail: the LAST one is the one that killed the process.
  const twoErrors = [
    "ModuleNotFoundError: No module named 'first'",
    "ModuleNotFoundError: No module named 'second'",
  ].join("\n");
  assert.match(diagnoseRuntimeFailure(twoErrors), /second/, "the most recent failure wins");
});

test("prepareRuntime re-unpacks when the bundled manifest no longer matches", async () => {
  // Lives here (not with the other manager probes) because it pins the
  // runtime-manifest contract: manifest missing / matching / changed.
  const { BackendManager } = require("../backend-manager");
  const root = makeTempRoot("manifest-prepare");
  try {
    // Packaged layout: <root>/python-runtime.zip + <root>/runtime-manifest.json.
    const zipPath = path.join(root, RUNTIME_ZIP_NAME);
    fs.writeFileSync(zipPath, "zip-bytes-v1");
    const runtimeDir = path.join(root, "runtime");
    const extractCalls = [];
    const extractFn = async (_zip, target) => {
      extractCalls.push(target);
      const interpreter = path.join(
        target,
        "python",
        process.platform === "win32" ? "python.exe" : path.join("bin", "python3"),
      );
      fs.mkdirSync(path.dirname(interpreter), { recursive: true });
      fs.writeFileSync(interpreter, "py");
    };
    const manager = new BackendManager(root, runtimeDir, { packaged: true, extractFn });

    // 1. Manifest present on the first launch (a build that ships both): the
    //    tree is unpacked and the marker records the fingerprint it came from.
    const manifest = manifestFixture({ pythonVersion: "3.12.10" });
    fs.writeFileSync(runtimeManifestPath(root), JSON.stringify(manifest));
    await manager.prepareRuntime(() => {});
    assert.strictEqual(extractCalls.length, 1, "first launch unpacks the runtime");
    let marker = JSON.parse(fs.readFileSync(runtimeMarkerPath(runtimeDir), "utf-8"));
    assert.strictEqual(marker.python, manifest.pythonVersion,
      "the marker stamps the bundled interpreter version");
    assert.strictEqual(marker.requirementsSha256, manifest.requirementsSha256,
      "the marker stamps the requirements fingerprint the tree was built from");

    // 2. Nothing changed: no re-unpack.
    await manager.prepareRuntime(() => {});
    assert.strictEqual(extractCalls.length, 1, "matching fingerprint skips extraction");

    // 3. requirements.txt changed between two builds: re-unpack once, then quiet.
    fs.writeFileSync(
      runtimeManifestPath(root),
      JSON.stringify(manifestFixture({ requirementsSha256: "d".repeat(64) })),
    );
    await manager.prepareRuntime(() => {});
    assert.strictEqual(extractCalls.length, 2, "a changed fingerprint forces a re-unpack");
    marker = JSON.parse(fs.readFileSync(runtimeMarkerPath(runtimeDir), "utf-8"));
    assert.strictEqual(marker.requirementsSha256, "d".repeat(64),
      "the marker records the fingerprint the tree was unpacked from");

    await manager.prepareRuntime(() => {});
    assert.strictEqual(extractCalls.length, 2, "matching fingerprint skips extraction");

    // 4. Legacy payload (no manifest sidecar): the digest-only behaviour must be
    //    preserved, and the marker must not invent fingerprint fields.
    fs.rmSync(runtimeManifestPath(root), { force: true });
    fs.writeFileSync(zipPath, "zip-bytes-v2");
    await manager.prepareRuntime(() => {});
    assert.strictEqual(extractCalls.length, 3, "a new zip digest still triggers a re-unpack");
    marker = JSON.parse(fs.readFileSync(runtimeMarkerPath(runtimeDir), "utf-8"));
    assert.strictEqual(marker.python, undefined, "no manifest -> no python stamp");
    assert.strictEqual(marker.requirementsSha256, undefined,
      "no manifest -> no fingerprint stamp");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("appendStderrTail keeps the tail bounded (stderr is never fully resident)", () => {
  const { STDERR_TAIL_LIMIT, appendStderrTail } = require("../lib/backend-startup");

  let tail = "";
  for (let index = 0; index < 500; index += 1) {
    tail = appendStderrTail(tail, `line ${index} of a chatty backend stderr\n`);
  }
  assert.ok(tail.length <= STDERR_TAIL_LIMIT, "the buffer never exceeds the limit");
  assert.match(tail, /line 499/, "the most recent output is what survives");

  // A single oversized chunk (a big traceback) is trimmed, not kept whole.
  const huge = "x".repeat(STDERR_TAIL_LIMIT * 3);
  assert.strictEqual(appendStderrTail("", huge).length, STDERR_TAIL_LIMIT);
  // Buffers are decoded, not stringified into "Buffer(...)".
  assert.strictEqual(appendStderrTail("", Buffer.from("缺依赖\n", "utf-8")), "缺依赖\n");
});
