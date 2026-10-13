"use strict";

// Shared helpers for the desktop offline test suites (node:test).
//
// Named without the ``test-`` prefix on purpose: ``node --test "scripts/test-*.js"``
// must not pick this file up as a suite of its own.

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

function makeTempRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `rf-${label}-`));
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeRel(rootDir, rel, content) {
  const full = path.join(rootDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function relInventory(rootDir) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(path.relative(rootDir, full));
    }
  };
  walk(rootDir);
  return files.sort();
}

function hashAll(rootDir) {
  const map = {};
  for (const rel of relInventory(rootDir)) map[rel] = sha256(path.join(rootDir, rel));
  return map;
}

const IS_WIN = process.platform === "win32";

module.exports = {
  IS_WIN,
  assert,
  flush,
  hashAll,
  makeTempRoot,
  relInventory,
  sha256,
  writeRel,
};
