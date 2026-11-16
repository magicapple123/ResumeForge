// SPDX-License-Identifier: Apache-2.0
"use strict";

// Tests for scripts/check-pnpm-audit.js (audit PR-06, 2026-10-13).
// Pure-function tests against fixture audit reports -- no pnpm/npm/network access.
//
// Coverage:
//   1. An unregistered critical entry absent from the baseline -> exit 1 (via main()).
//   2. A report whose critical/high entries are all registered -> exit 0.
//   3. An expired waiver -> exit 1 (expiry forces re-review).
//   4. A NEW advisory id on a registered package -> exit 1.
//   5. Moderate findings require an explicit reviewed waiver; escalation fails.
//   6. An unrecognized report shape (pnpm writes `advisories`, not `vulnerabilities`)
//      -> non-zero exit. This is the guard against the gate silently no-op'ing.
//      Arrays (`{"advisories":[]}`) and a bare `null` are rejected too: `typeof`
//      says "object" for an array, and an empty array must not read as "clean".
//
// Fixtures use pnpm's audit report shape: `{ advisories, metadata }`, keyed by
// advisory id with `module_name` / `severity` / `url` on each entry. There is no
// `vulnerabilities` key in a pnpm report, which is why the shape guard exists.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");

const { collectFailures, advisoryId, main } = require("./check-pnpm-audit");

const REPO_DESKTOP = path.join(__dirname, "..");

function makeTempRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `rf-audit-gate-${label}-`));
}

/**
 * Builds a pnpm-shaped audit report from compact advisory descriptors.
 *
 * @param {Array<{id: number, module: string, severity: string, ghsa: string, title?: string}>} entries
 * @param {object=} metadata optional `metadata` block (severity counters)
 */
function advisoryReport(entries, metadata) {
  const advisories = {};
  for (const entry of entries) {
    advisories[String(entry.id)] = {
      id: entry.id,
      module_name: entry.module,
      severity: entry.severity,
      title: entry.title || `${entry.module} advisory`,
      url: `https://github.com/advisories/${entry.ghsa}`,
      vulnerable_versions: "*",
      patched_versions: ">=1.0.1",
    };
  }
  return metadata === undefined ? { advisories } : { advisories, metadata };
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

function writeReport(root, report) {
  const file = path.join(root, "report.json");
  fs.writeFileSync(file, JSON.stringify(report));
  return file;
}

/** Runs `main` while swallowing its stderr, so diagnostics can be asserted. */
function runGateCapturingStderr(argv) {
  const originalError = console.error;
  const lines = [];
  console.error = (...args) => { lines.push(args.join(" ")); };
  try {
    return { code: main(argv), output: lines.join("\n") };
  } finally {
    console.error = originalError;
  }
}

test("an unregistered critical entry fails the gate", () => {
  const root = makeTempRoot("unregistered");
  try {
    const report = advisoryReport([
      { id: 1, module: "brand-new-pkg", severity: "critical", ghsa: "GHSA-xxx", title: "bad" },
    ]);
    const { failures, checked } = collectFailures(report, BASELINE, "2026-10-13");
    assert.strictEqual(checked, 1);
    assert.strictEqual(failures.length, 1);
    assert.ok(failures[0].includes("brand-new-pkg"));
    assert.ok(failures[0].includes("GHSA-xxx"));

    const baselineFile = writeBaseline(root);
    assert.strictEqual(main(["--baseline", baselineFile, "--file", writeReport(root, report)]), 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a report fully covered by (unexpired) waivers passes", () => {
  const report = advisoryReport([
    { id: 11, module: "tar", severity: "critical", ghsa: "GHSA-aaa", title: "t" },
    { id: 12, module: "electron", severity: "high", ghsa: "GHSA-bbb", title: "e" },
  ]);
  const { failures, checked } = collectFailures(report, BASELINE, "2026-10-13");
  assert.deepStrictEqual(failures, []);
  assert.strictEqual(checked, 2);
});

test("an expired waiver fails the gate (forces scheduled re-review)", () => {
  const report = advisoryReport([
    { id: 21, module: "glob", severity: "high", ghsa: "GHSA-ccc", title: "g" },
  ]);
  const { failures } = collectFailures(report, BASELINE, "2026-10-13");
  assert.ok(failures.some((failure) => failure.includes("expired")));
});

test("a new advisory id on a registered package fails the gate", () => {
  const report = advisoryReport([
    { id: 31, module: "electron", severity: "high", ghsa: "GHSA-brand-new", title: "fresh" },
  ]);
  const { failures } = collectFailures(report, BASELINE, "2026-10-13");
  assert.ok(failures.some((failure) => failure.includes("GHSA-brand-new")));
});

test("a second advisory on an already-waived package is not swallowed by aggregation", () => {
  // Both advisories affect `tar`; the aggregation must keep both links so that the
  // unregistered one (GHSA-ddd) still surfaces.
  const report = advisoryReport([
    { id: 41, module: "tar", severity: "critical", ghsa: "GHSA-aaa", title: "known" },
    { id: 42, module: "tar", severity: "moderate", ghsa: "GHSA-ddd", title: "extra" },
  ]);
  const { failures, checked } = collectFailures(report, BASELINE, "2026-10-13");
  assert.strictEqual(checked, 1, "one package entry is gated, not one advisory");
  assert.ok(failures.some((failure) => failure.includes("GHSA-ddd")));
});

test("moderate findings require a reviewed waiver; escalation to high fails", () => {
  const moderateOnly = advisoryReport([
    { id: 51, module: "some-lib", severity: "moderate", ghsa: "GHSA-zzz", title: "m" },
  ]);
  assert.ok(
    collectFailures(moderateOnly, BASELINE, "2026-10-13").failures
      .some((failure) => failure.includes("GHSA-zzz")),
  );
  const reviewed = {
    ...BASELINE,
    packages: BASELINE.packages.map((entry) => entry.package === "some-lib"
      ? { ...entry, advisories: ["GHSA-zzz"] } : entry),
  };
  assert.deepStrictEqual(collectFailures(moderateOnly, reviewed, "2026-10-13").failures, []);

  const escalated = advisoryReport([
    { id: 52, module: "some-lib", severity: "high", ghsa: "GHSA-zzz", title: "m" },
  ]);
  const { failures } = collectFailures(escalated, BASELINE, "2026-10-13");
  assert.ok(failures.some((failure) => failure.includes("escalated")));
});

test("a new low-severity finding cannot silently bypass the zero-waiver baseline", () => {
  const report = advisoryReport([
    { id: 61, module: "new-low-package", severity: "low", ghsa: "GHSA-low" },
  ]);
  const { failures } = collectFailures(report, { packages: [] }, "2026-10-14");
  assert.ok(failures.some((failure) => failure.includes("new-low-package")));
});

test("an unrecognized report shape fails the gate instead of silently passing", () => {
  const root = makeTempRoot("shape-guard");
  try {
    const baselineFile = writeBaseline(root, { reviewedAt: "2026-10-14", packages: [] });
    for (const bogus of [{}, { foo: 1 }, { advisories: "nope" }, { advisories: [] }]) {
      const reportFile = writeReport(root, bogus);
      const code = main(["--baseline", baselineFile, "--file", reportFile]);
      assert.notStrictEqual(
        code,
        0,
        `report ${JSON.stringify(bogus)} must not pass the gate`,
      );
    }
    assert.throws(
      () => collectFailures({}, { packages: [] }, "2026-10-14"),
      /unrecognized audit report shape/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an advisory map trimmed to empty while metadata still counts findings is rejected", () => {
  const trimmed = { advisories: {}, metadata: { vulnerabilities: { low: 0, high: 2 } } };
  assert.throws(
    () => collectFailures(trimmed, BASELINE, "2026-10-13"),
    /internally inconsistent/,
  );

  // A genuinely clean report still passes: empty advisories + zero counters.
  const clean = { advisories: {}, metadata: { vulnerabilities: { low: 0, high: 0 } } };
  assert.deepStrictEqual(collectFailures(clean, BASELINE, "2026-10-13").failures, []);
});

test("an advisory list (array) is rejected instead of reading as a clean report", () => {
  // `typeof [] === "object"`, so a naive shape check let `{"advisories":[]}`
  // through: Object.entries([]) is empty, checked stayed 0 and the gate printed OK.
  const root = makeTempRoot("array-shape");
  try {
    const baselineFile = writeBaseline(root, { reviewedAt: "2026-10-14", packages: [] });
    const reportFile = writeReport(root, { advisories: [] });
    const { code, output } = runGateCapturingStderr(["--baseline", baselineFile, "--file", reportFile]);
    assert.notStrictEqual(code, 0, "an empty advisory ARRAY must not pass the gate");
    assert.match(output, /unrecognized audit report shape/);
    assert.throws(
      () => collectFailures({ advisories: [] }, { packages: [] }, "2026-10-14"),
      /unrecognized audit report shape/,
    );

    // The legitimate clean report keeps working: `{}` (a map) with no metadata.
    assert.deepStrictEqual(
      collectFailures({ advisories: {} }, { packages: [] }, "2026-10-14").failures,
      [],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a null report fails cleanly instead of throwing an uncaught TypeError", () => {
  const root = makeTempRoot("null-report");
  try {
    const baselineFile = writeBaseline(root, { reviewedAt: "2026-10-14", packages: [] });
    const reportFile = writeReport(root, null);
    const { code, output } = runGateCapturingStderr(["--baseline", baselineFile, "--file", reportFile]);
    assert.notStrictEqual(code, 0, "a null report must not pass the gate");
    assert.match(output, /unrecognized audit report shape/,
      "a null report must be reported as an unrecognized shape, not crash on .error");
    assert.doesNotMatch(output, /TypeError/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the report is mandatory: --file cannot be omitted", () => {
  assert.strictEqual(main(["--baseline", "baseline.json"]), 2);
});

test("advisoryId falls back to the numeric source when no GHSA url exists", () => {
  assert.strictEqual(advisoryId({ url: "https://github.com/advisories/GHSA-abc-123" }), "GHSA-abc-123");
  assert.strictEqual(advisoryId({ source: 1124279, title: "x" }), "1124279");
});

test("the npm v7 vulnerabilities shape is still accepted", () => {
  const legacy = {
    vulnerabilities: {
      tar: { severity: "critical", via: [{ url: "https://github.com/advisories/GHSA-aaa", title: "t" }] },
    },
  };
  const { failures, checked } = collectFailures(legacy, BASELINE, "2026-10-13");
  assert.deepStrictEqual(failures, []);
  assert.strictEqual(checked, 1);
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
  const { failures } = collectFailures({ advisories: {} }, baseline, "2026-10-13");
  assert.deepStrictEqual(failures, []);
});
