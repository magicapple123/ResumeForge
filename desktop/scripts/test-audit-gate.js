// SPDX-License-Identifier: Apache-2.0
"use strict";

// Tests for scripts/check-npm-audit.js (audit PR-06, 2026-10-13).
// Pure-function tests against fixture audit reports -- no npm/network access.
//
// Coverage:
//   1. A critical/high entry absent from the baseline -> exit 1 (via main()).
//   2. A report whose critical/high entries are all registered -> exit 0.
//   3. An expired waiver -> exit 1 (expiry forces re-review).
//   4. A NEW advisory id on a registered package -> exit 1.
//   5. Moderate findings require an explicit reviewed waiver; escalation fails.
//   6. Registry input is never interpreted by a Windows command shell.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");

const { collectFailures, advisoryId, main } = require("./check-npm-audit");

const REPO_DESKTOP = path.join(__dirname, "..");

test("Windows audit registry input is passed as data, never through a command shell", () => {
  const root = makeTempRoot("argument-safety");
  const baselineFile = writeBaseline(root, { reviewedAt: "2026-10-14", packages: [] });
  const npmCli = path.join(root, "npm-cli.js");
  fs.writeFileSync(npmCli, "// inert CLI fixture; subprocess invocation is intercepted\n");
  const registry = "https://registry.invalid/&echo INJECTION_SENTINEL";
  const probe = `
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.npm_execpath = process.env.RF_NPM_CLI;
    require("node:child_process").spawnSync = (command, args, options) => {
      console.log("INVOCATION=" + JSON.stringify({ command, args, options }));
      return { stdout: '{"vulnerabilities":{}}', status: 0 };
    };
    const gate = require(process.env.RF_AUDIT_GATE);
    process.exitCode = gate.main(["--baseline", process.env.RF_BASELINE, "--registry", process.env.RF_REGISTRY]);
  `;
  const child = spawnSync(process.execPath, ["-e", probe], {
    encoding: "utf8", timeout: 10_000,
    env: { ...process.env, RF_NPM_CLI: npmCli, RF_AUDIT_GATE: path.join(__dirname, "check-npm-audit.js"),
      RF_BASELINE: baselineFile, RF_REGISTRY: registry },
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  const invocation = JSON.parse(child.stdout.split(/\r?\n/).find((line) => line.startsWith("INVOCATION=")).slice(11));
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.command, process.execPath);
  assert.equal(invocation.args[0], npmCli);
  assert.equal(invocation.args.at(-1), `--registry=${registry}`);
  // Fixtures are retained: this probe never executes npm or deletes existing files.
});

function makeTempRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `rf-audit-gate-${label}-`));
}

const BASELINE = {
  reviewedAt: "2026-10-13",
  packages: [
    {
      package: "tar",
      severity: "critical",
      category: "build",
      until: "2027-01-31",
      advisories: ["GHSA-aaa"],
    },
    {
      package: "electron",
      severity: "high",
      category: "runtime",
      until: "2027-01-31",
      advisories: ["GHSA-bbb"],
    },
    {
      package: "glob",
      severity: "high",
      category: "build",
      until: "2026-01-01", // deliberately expired
      advisories: ["GHSA-ccc"],
    },
    {
      package: "some-lib",
      severity: "moderate",
      category: "runtime",
      until: "2027-01-31",
      advisories: [],
    },
  ],
};

function writeBaseline(root, baseline = BASELINE) {
  const file = path.join(root, "baseline.json");
  fs.writeFileSync(file, JSON.stringify(baseline));
  return file;
}

test("an unregistered critical entry fails the gate", () => {
  const root = makeTempRoot("unregistered");
  try {
    const report = {
      vulnerabilities: {
        "brand-new-pkg": {
          severity: "critical",
          via: [{ url: "https://github.com/advisories/GHSA-xxx", title: "bad" }],
        },
      },
    };
    const { failures } = collectFailures(report, BASELINE, "2026-10-13");
    assert.strictEqual(failures.length, 1);
    assert.ok(failures[0].includes("brand-new-pkg"));
    assert.ok(failures[0].includes("GHSA-xxx"));

    const baselineFile = writeBaseline(root);
    const reportFile = path.join(root, "report.json");
    fs.writeFileSync(reportFile, JSON.stringify(report));
    assert.strictEqual(main(["--baseline", baselineFile, "--file", reportFile]), 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a report fully covered by (unexpired) waivers passes", () => {
  const report = {
    vulnerabilities: {
      tar: { severity: "critical", via: [{ url: "https://github.com/advisories/GHSA-aaa", title: "t" }] },
      electron: { severity: "high", via: ["tar", { url: "https://github.com/advisories/GHSA-bbb", title: "e" }] },
    },
  };
  const { failures } = collectFailures(report, BASELINE, "2026-10-13");
  assert.deepStrictEqual(failures, []);
});

test("an expired waiver fails the gate (forces scheduled re-review)", () => {
  const report = {
    vulnerabilities: {
      glob: { severity: "high", via: [{ url: "https://github.com/advisories/GHSA-ccc", title: "g" }] },
    },
  };
  const { failures } = collectFailures(report, BASELINE, "2026-10-13");
  assert.ok(failures.some((f) => f.includes("expired")));
});

test("a new advisory id on a registered package fails the gate", () => {
  const report = {
    vulnerabilities: {
      electron: { severity: "high", via: [{ url: "https://github.com/advisories/GHSA-brand-new", title: "fresh" }] },
    },
  };
  const { failures } = collectFailures(report, BASELINE, "2026-10-13");
  assert.ok(failures.some((f) => f.includes("GHSA-brand-new")));
});

test("moderate findings require a reviewed waiver; escalation to high fails", () => {
  const moderateOnly = {
    vulnerabilities: {
      "some-lib": { severity: "moderate", via: [{ url: "https://github.com/advisories/GHSA-zzz", title: "m" }] },
    },
  };
  assert.ok(collectFailures(moderateOnly, BASELINE, "2026-10-13").failures.some((failure) => failure.includes("GHSA-zzz")));
  const reviewed = {
    ...BASELINE,
    packages: BASELINE.packages.map((entry) => entry.package === "some-lib"
      ? { ...entry, advisories: ["GHSA-zzz"] } : entry),
  };
  assert.deepStrictEqual(collectFailures(moderateOnly, reviewed, "2026-10-13").failures, []);

  const escalated = {
    vulnerabilities: {
      "some-lib": { severity: "high", via: [] },
    },
  };
  const { failures } = collectFailures(escalated, BASELINE, "2026-10-13");
  assert.ok(failures.some((f) => f.includes("escalated")));
});

test("a new low-severity finding cannot silently bypass the zero-waiver baseline", () => {
  const { failures } = collectFailures({ vulnerabilities: {
    "new-low-package": { severity: "low", via: [{ url: "https://github.com/advisories/GHSA-low" }] },
  } }, { packages: [] }, "2026-10-14");
  assert.ok(failures.some((failure) => failure.includes("new-low-package")));
});

test("advisoryId falls back to the numeric source when no GHSA url exists", () => {
  assert.strictEqual(advisoryId({ url: "https://github.com/advisories/GHSA-abc-123" }), "GHSA-abc-123");
  assert.strictEqual(advisoryId({ source: 1124279, title: "x" }), "1124279");
});

test("the real repo baseline is loadable and internally consistent", () => {
  const baseline = JSON.parse(
    fs.readFileSync(path.join(REPO_DESKTOP, "scripts", "audit-baseline.json"), "utf-8"),
  );
  assert.ok(Array.isArray(baseline.packages),
    "the waiver list must be an array (empty after genuine remediation)");
  assert.match(baseline.reviewedAt, /^\d{4}-\d{2}-\d{2}$/);
  const names = new Set();
  for (const entry of baseline.packages) {
    assert.ok(entry.package && entry.severity && entry.until, `entry incomplete: ${entry.package}`);
    assert.ok(Array.isArray(entry.advisories), `${entry.package} needs an advisory list`);
    assert.ok(!names.has(entry.package), `duplicate waiver: ${entry.package}`);
    names.add(entry.package);
  }
  // The real gate must accept the real baseline with an empty report.
  const { failures } = collectFailures({ vulnerabilities: {} }, baseline, "2026-10-13");
  assert.deepStrictEqual(failures, []);
});
