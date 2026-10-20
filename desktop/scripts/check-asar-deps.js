// SPDX-License-Identifier: Apache-2.0
"use strict";

// Static integrity gate for the desktop shell bundle (audit PR-04, 2026-10-13).
//
// Background: main.js has a top-level `require("./updater")`, but the
// electron-builder `files:` manifest did not list updater.js, so the packaged
// app.asar shipped without it. A missing top-level require crashes the entry
// module *before* any business error handling runs -> the packaged desktop
// build cannot start at all. This script turns that failure mode into a
// gate that runs (a) statically before packaging and (b) against the real
// app.asar after packaging, in CI and locally.
//
// What it does:
//   1. Builds the local require graph starting from the packaged entry
//      (main.js): every `require("./...")` / `require("../...")` is followed
//      recursively. Non-relative specifiers (electron, node builtins) are
//      external by construction and skipped.
//   2. Verifies every discovered local module actually ships:
//        - --asar / --unpacked: present inside app.asar (or in the sibling
//          app.asar.unpacked directory, which is how electron-builder ships
//          asar-unpacked files);
//        - --source (default): covered by a positive pattern in the
//          electron-builder.yml `files:` manifest.
//
// Missing or unresolvable modules exit non-zero and are listed; a clean run
// prints the verified module list. No new npm dependencies: the asar reader
// is @electron/asar, already present as a transitive dependency of
// electron-builder.
//
// Usage:
//   node scripts/check-asar-deps.js                     # source mode on this repo's desktop/
//   node scripts/check-asar-deps.js --source <dir>      # static check vs electron-builder.yml
//   node scripts/check-asar-deps.js --asar <app.asar>   # check a packaged archive
//   node scripts/check-asar-deps.js --unpacked <dir>    # dir with resources/app.asar, or plain app-root dir
//
// Exit codes: 0 = ok, 1 = integrity failure, 2 = usage/IO error.

const fs = require("fs");
const path = require("path");

const EXIT_OK = 0;
const EXIT_INTEGRITY = 1;
const EXIT_ERROR = 2;

const USAGE = `\
Usage:
  node scripts/check-asar-deps.js [--source <dir>]
      Static check: build the require graph from <dir>/main.js and verify
      every local module is covered by <dir>/electron-builder.yml files:.
      (Default when called with no arguments: this repo's desktop directory.)
  node scripts/check-asar-deps.js --asar <path/to/app.asar>
      Verify every local module required from the archive's main.js exists
      inside the archive (or in the sibling app.asar.unpacked directory).
  node scripts/check-asar-deps.js --unpacked <dir>
      If <dir>/resources/app.asar (or <dir>/app.asar) exists, same as --asar;
      otherwise <dir> is treated as a plain unpacked app-root directory.

Exit codes: 0 = ok, 1 = missing/unresolvable modules, 2 = usage or IO error.`;

// Matches CommonJS `require("...")` calls. The desktop shell uses only
// static string requires (no template-literal or variable requires), so a
// regex is sufficient here and keeps the script dependency-free.
const REQUIRE_RE = /require\(\s*(['"])([^'"\n]+)\1\s*\)/g;

function isRelativeRequire(spec) {
  return spec === "." || spec === ".." || spec.startsWith("./") || spec.startsWith("../");
}

function extractLocalRequires(source) {
  const specs = [];
  let match;
  REQUIRE_RE.lastIndex = 0;
  while ((match = REQUIRE_RE.exec(source)) !== null) {
    if (isRelativeRequire(match[2])) specs.push(match[2]);
  }
  return specs;
}

// Resolve "./x" or "../x" from the requiring module's directory against the
// app root, trying the same extensions require() itself would try. Returns a
// posix-style root-relative path, or null when nothing matches.
function resolveRelative(fromDir, spec, exists) {
  const base = path.posix.normalize(path.posix.join(fromDir, spec));
  const hasExt = /\.(js|json|node)$/i.test(base);
  const candidates = hasExt
    ? [base]
    : [base, `${base}.js`, `${base}.json`, path.posix.join(base, "index.js"), path.posix.join(base, "index.json")];
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

// Breadth-first walk of the local require graph starting at entryRel.
function walkRequireGraph(readFile, exists, entryRel) {
  const modules = new Set();
  const visited = new Set();
  const problems = [];
  const queue = [entryRel];
  while (queue.length > 0) {
    const rel = queue.shift();
    if (visited.has(rel)) continue;
    visited.add(rel);
    let source;
    try {
      source = readFile(rel).toString("utf-8");
    } catch (err) {
      problems.push(`cannot read entry module "${rel}": ${err.message}`);
      continue;
    }
    const fromDir = path.posix.dirname(rel);
    for (const spec of extractLocalRequires(source)) {
      if (!isRelativeRequire(spec)) continue; // external (electron / builtin / npm)
      const resolved = resolveRelative(fromDir, spec, exists);
      if (resolved === null) {
        problems.push(`unresolvable require "${spec}" in ${rel}: no matching local file`);
        continue;
      }
      modules.add(resolved);
      if (!visited.has(resolved)) queue.push(resolved);
    }
  }
  return { modules: [...modules].sort(), problems };
}

function normalizeArchiveEntry(entry) {
  return entry.replace(/^[\\/]+/, "").replace(/\\/g, "/");
}

// --- electron-builder.yml `files:` manifest parsing -------------------------
// Hand-rolled tiny parser: the desktop config is a flat block list of plain
// names. Supports block lists (`files:` + `  - item`), inline flow lists
// (`files: [a, b]`), quotes, and trailing comments. Negations (`!...`) are
// skipped: a positive coverage requirement cannot be expressed by them.

function cleanManifestEntry(raw) {
  let value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value;
}

function parseFilesManifest(ymlText) {
  const entries = [];
  const lines = ymlText.split(/\r?\n/);
  let inFiles = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, "");
    const inline = line.match(/^files:\s*\[(.+)\]\s*$/);
    if (inline) {
      for (const part of inline[1].split(",")) {
        const entry = cleanManifestEntry(part);
        if (entry && !entry.startsWith("!")) entries.push(entry);
      }
      inFiles = false;
      continue;
    }
    if (/^files:\s*(#.*)?$/.test(line)) {
      inFiles = true;
      continue;
    }
    if (!inFiles) continue;
    const item = line.match(/^\s+-\s+(.+?)\s*$/);
    if (item) {
      const entry = cleanManifestEntry(item[1]);
      if (entry && !entry.startsWith("!")) entries.push(entry);
      continue;
    }
    if (line.trim() === "") continue;
    inFiles = false; // dedent back to top level: block list ended
  }
  return entries;
}

// Minimal glob support matching electron-builder patterns well enough for
// the shell manifest: `*` (one path segment), `**` (any depth), trailing `/`
// (whole directory).
function globToRegex(pattern) {
  let re = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i += 1;
      } else {
        re += "[^/]*";
      }
    } else {
      re += ch.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

function manifestCovers(entries, relModule) {
  return entries.some((entry) => {
    if (entry.includes("*")) return globToRegex(entry).test(relModule);
    if (entry.endsWith("/")) return relModule.startsWith(entry);
    return entry === relModule;
  });
}

// --- Modes -------------------------------------------------------------------

// Packaged-archive mode: files live inside app.asar (plus an optional
// app.asar.unpacked sibling for asar-unpacked files).
function checkAsar(archivePath, options) {
  const asar = require("@electron/asar");
  if (!fs.existsSync(archivePath)) {
    return { ok: false, error: `archive not found: ${archivePath}` };
  }
  const listed = asar
    .listPackage(archivePath)
    .map(normalizeArchiveEntry)
    .filter((entry) => !entry.endsWith("/"));
  const inArchive = new Set(listed);
  const unpackedDir = options.unpackedDir || `${archivePath}.unpacked`;
  const exists = (rel) => inArchive.has(rel) || fs.existsSync(path.join(unpackedDir, rel));
  const readFile = (rel) => {
    if (inArchive.has(rel)) return asar.extractFile(archivePath, rel);
    return fs.readFileSync(path.join(unpackedDir, rel));
  };
  const { modules, problems } = walkRequireGraph(readFile, exists, "main.js");
  const missing = modules.filter((rel) => !exists(rel));
  return { ok: missing.length === 0 && problems.length === 0, modules, missing, problems };
}

// Plain-directory mode (unpacked app root on the normal filesystem).
function checkDirectory(rootDir) {
  if (!fs.existsSync(path.join(rootDir, "main.js"))) {
    return { ok: false, error: `main.js not found in ${rootDir}` };
  }
  const exists = (rel) => fs.existsSync(path.join(rootDir, rel));
  const readFile = (rel) => fs.readFileSync(path.join(rootDir, rel));
  const { modules, problems } = walkRequireGraph(readFile, exists, "main.js");
  const missing = modules.filter((rel) => !exists(rel));
  return { ok: missing.length === 0 && problems.length === 0, modules, missing, problems };
}

// Source mode: static require graph vs the electron-builder.yml manifest.
// This is the pre-packaging gate -- it catches a manifest omission before
// electron-builder ever runs.
function checkSource(sourceDir, options) {
  const ymlPath = options.builderYml || path.join(sourceDir, "electron-builder.yml");
  let ymlText;
  try {
    ymlText = fs.readFileSync(ymlPath, "utf-8");
  } catch (err) {
    return { ok: false, error: `cannot read builder manifest ${ymlPath}: ${err.message}` };
  }
  const entries = parseFilesManifest(ymlText);
  if (entries.length === 0) {
    return { ok: false, error: `no positive patterns parsed from files: in ${ymlPath}` };
  }
  const dirResult = checkDirectory(sourceDir);
  if (dirResult.error) return dirResult;

  const { modules, problems } = walkRequireGraph(
    (rel) => fs.readFileSync(path.join(sourceDir, rel)),
    (rel) => fs.existsSync(path.join(sourceDir, rel)),
    "main.js",
  );
  const missing = modules.filter((rel) => !manifestCovers(entries, rel));
  // Reverse direction: a plain (non-glob, non-directory) manifest entry that
  // does not exist on disk would silently ship nothing for that name.
  const stale = entries.filter(
    (entry) => !entry.includes("*") && !entry.endsWith("/") && !fs.existsSync(path.join(sourceDir, entry)),
  );
  return {
    ok: missing.length === 0 && problems.length === 0 && stale.length === 0,
    modules,
    missing,
    problems,
    stale,
    manifest: entries,
  };
}

function printResult(label, result) {
  if (result.error) {
    console.error(`[${label}] ERROR: ${result.error}`);
    return;
  }
  console.log(`[${label}] verified local modules (${result.modules.length}):`);
  for (const rel of result.modules) console.log(`  ok  ${rel}`);
  if (result.manifest) {
    console.log(`[${label}] manifest patterns: ${result.manifest.join(", ")}`);
  }
  for (const rel of result.missing || []) {
    console.error(`[${label}] MISSING from bundle: ${rel}`);
  }
  for (const problem of result.problems || []) {
    console.error(`[${label}] PROBLEM: ${problem}`);
  }
  for (const entry of result.stale || []) {
    console.error(`[${label}] STALE manifest entry (no such file): ${entry}`);
  }
}

function parseArgs(argv) {
  const args = { mode: null, value: null, unpackedDir: null, builderYml: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.mode = "help";
    else if (arg === "--source") { args.mode = "source"; args.value = argv[++i] || null; }
    else if (arg === "--asar") { args.mode = "asar"; args.value = argv[++i] || null; }
    else if (arg === "--asar-unpacked") args.unpackedDir = argv[++i] || null;
    else if (arg === "--builder-yml") args.builderYml = argv[++i] || null;
    else if (arg === "--unpacked") { args.mode = "unpacked"; args.value = argv[++i] || null; }
    else {
      console.error(`unknown argument: ${arg}\n${USAGE}`);
      process.exit(EXIT_ERROR);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "help") {
    console.log(USAGE);
    process.exit(EXIT_OK);
  }

  try {
    // No explicit mode: default to the static source check on this repo's
    // desktop directory, so CI can call the script bare.
    if (args.mode === null) {
      const result = checkSource(path.join(__dirname, ".."), { builderYml: args.builderYml });
      printResult("source", result);
      process.exit(result.ok ? EXIT_OK : EXIT_INTEGRITY);
    }

    if (args.mode === "source") {
      const dir = path.resolve(args.value || path.join(__dirname, ".."));
      const result = checkSource(dir, { builderYml: args.builderYml });
      printResult(`source ${dir}`, result);
      process.exit(result.ok ? EXIT_OK : EXIT_INTEGRITY);
    }

    if (args.mode === "asar") {
      const archive = path.resolve(args.value);
      if (!fs.existsSync(archive)) {
        console.error(`ERROR: archive not found: ${archive}`);
        process.exit(EXIT_ERROR);
      }
      const result = checkAsar(archive, { unpackedDir: args.unpackedDir });
      printResult(`asar ${archive}`, result);
      process.exit(result.ok ? EXIT_OK : EXIT_INTEGRITY);
    }

    // --unpacked: either a directory that contains the archive
    // (win-unpacked layout) or a plain unpacked app-root directory.
    const dir = path.resolve(args.value);
    if (!fs.existsSync(dir)) {
      console.error(`ERROR: directory not found: ${dir}`);
      process.exit(EXIT_ERROR);
    }
    const candidates = [
      path.join(dir, "resources", "app.asar"),
      path.join(dir, "app.asar"),
    ];
    const archive = candidates.find((p) => fs.existsSync(p));
    if (archive) {
      const result = checkAsar(archive, { unpackedDir: args.unpackedDir });
      printResult(`asar ${archive}`, result);
      process.exit(result.ok ? EXIT_OK : EXIT_INTEGRITY);
    }
    const result = checkDirectory(dir);
    printResult(`dir ${dir}`, result);
    process.exit(result.ok ? EXIT_OK : EXIT_INTEGRITY);
  } catch (err) {
    console.error(`ERROR: ${err && err.stack ? err.stack : err}`);
    process.exit(EXIT_ERROR);
  }
}

main();
