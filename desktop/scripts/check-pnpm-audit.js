// SPDX-License-Identifier: Apache-2.0
"use strict";

// Desktop supply-chain audit gate (audit PR-06, 2026-10-13).
//
// Reads a saved audit report (read-only; the lockfile is never touched) and fails
// when the report contains any severity entry that is NOT covered by the
// registered waiver baseline (desktop/scripts/audit-baseline.json):
//   - an affected package missing from the baseline,
//   - a new advisory id on a registered package,
//   - a severity escalation beyond the registered one,
//   - a waiver whose `until` date has passed (forces scheduled re-review).
//
// The known moderate dependency chain has been removed. A new low/moderate
// finding now requires the same explicit review as a high/critical finding.
//
// Usage (the report is always produced by the caller and saved to a file):
//   pnpm audit --json > audit.json
//   node scripts/check-pnpm-audit.js --baseline scripts/audit-baseline.json --file audit.json
//
// Why `--file` is mandatory instead of spawning the audit itself: after the pnpm
// migration there is no spawnable "pnpm-cli.js" to run through the Node binary.
// pnpm 12 ships a native `pnpm.exe`, and on Windows `spawn` with `shell:false`
// cannot execute `pnpm.cmd`; the wrapper `bin/pnpm.mjs` is spawned with
// `stdio: "inherit"`, so the parent process cannot capture its stdout either.
// Reading a file keeps this gate free of any shell/argv handling.
//
// Report shapes: pnpm writes the npm v6 `{ advisories, metadata }` shape, which
// has NO `vulnerabilities` key. Reading only `report.vulnerabilities` used to
// silently degrade this gate into a no-op (checked=0, exit 0), so
// `normalizeReport()` now rejects anything it does not recognize instead of
// falling back to `{}`.

const fs = require("fs");
const path = require("path");

const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const GATE_SEVERITIES = new Set(["low", "moderate", "high", "critical"]);

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function advisoryId(viaObject) {
  if (viaObject && viaObject.url) return String(viaObject.url).split("/").pop();
  if (viaObject && viaObject.source !== undefined) return String(viaObject.source);
  return "unknown-advisory";
}

function severityRank(severity) {
  return SEVERITY_RANK[String(severity || "").toLowerCase()] || 0;
}

/** Sums every per-severity counter pnpm/npm put under `metadata.vulnerabilities`. */
function countReportedVulnerabilities(metadata) {
  const counts = metadata && metadata.vulnerabilities;
  if (!counts || typeof counts !== "object") return 0;
  return Object.values(counts).reduce((total, value) => total + (Number(value) || 0), 0);
}

/**
 * Folds pnpm/npm's advisory map into the per-package shape the gate inspects.
 *
 * `advisories` is keyed by advisory id; the gate needs one entry per affected
 * package with the worst severity and every advisory link preserved, otherwise a
 * second advisory on an already-waived package would go unnoticed.
 */
function fromAdvisories(advisories, metadata) {
  const entries = Object.entries(advisories || {});
  if (entries.length === 0) {
    // A report whose advisory map is empty while its own metadata counts findings
    // was trimmed (e.g. by `--audit-level`). Treating that as "clean" would let a
    // filtered report pass the gate.
    const reported = countReportedVulnerabilities(metadata);
    if (reported > 0) {
      throw new Error(
        "audit report is internally inconsistent: metadata reports " +
          `${reported} vulnerabilit(ies) but the advisories map is empty ` +
          "(was the report filtered by --audit-level?)",
      );
    }
    return {};
  }

  const aggregated = new Map();
  for (const [key, advisory] of entries) {
    if (!advisory || typeof advisory !== "object") {
      throw new Error(`audit advisory ${key} is not an object; cannot interpret the report`);
    }
    const name = advisory.module_name;
    if (!name) {
      throw new Error(`audit advisory ${key} has no module_name; cannot attribute the finding`);
    }
    const severity = String(advisory.severity || "info").toLowerCase();
    const via = {
      url: advisory.url || null,
      title: advisory.title || null,
      source: advisory.id !== undefined ? advisory.id : advisory.source,
    };

    const existing = aggregated.get(name);
    if (!existing) {
      aggregated.set(name, { severity, via: [via] });
      continue;
    }
    if (severityRank(severity) > severityRank(existing.severity)) {
      existing.severity = severity;
    }
    existing.via.push(via);
  }
  return Object.fromEntries(aggregated);
}

/**
 * True for a real map/record -- an array is `typeof "object"` as well, but an
 * empty array must never be mistaken for "no findings".
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Returns a `package -> { severity, via }` map, or throws.
 *
 * Never returns an empty object as a fallback for an unknown shape: that is
 * exactly the failure mode this gate must not have.
 */
function normalizeReport(report) {
  // `typeof [] === "object"` too, so an array has to be rejected explicitly:
  // `{"advisories":[]}` would otherwise aggregate to zero entries and read as a
  // clean report -- a filtered/empty array is not the same claim as `{}`.
  if (report && report.advisories && isPlainObject(report.advisories)) {
    return fromAdvisories(report.advisories, report.metadata);
  }
  if (report && report.vulnerabilities && isPlainObject(report.vulnerabilities)) {
    return report.vulnerabilities; // npm v7 shape, kept for historical fixtures
  }
  throw new Error(
    "unrecognized audit report shape: expected pnpm's `advisories` or npm's `vulnerabilities`",
  );
}

function collectFailures(report, baseline, today) {
  const failures = [];
  const entries = new Map(
    (baseline.packages || []).map((entry) => [entry.package, entry]),
  );
  const vulnerabilities = normalizeReport(report);
  let checked = 0;

  for (const [name, finding] of Object.entries(vulnerabilities)) {
    if (!GATE_SEVERITIES.has(finding.severity)) continue;
    checked += 1;

    const entry = entries.get(name);
    if (!entry) {
      const ids = (finding.via || [])
        .filter((via) => typeof via !== "string")
        .map(advisoryId)
        .join(", ");
      failures.push(
        `${name}: new ${finding.severity} vulnerability (${ids || "no advisory link"}) not registered in the baseline`,
      );
      continue;
    }
    if (entry.until && entry.until < today) {
      failures.push(
        `${name}: waiver expired on ${entry.until} -- re-review the finding and refresh the baseline`,
      );
    }
    const registeredRank = SEVERITY_RANK[entry.severity] || 0;
    const currentRank = SEVERITY_RANK[finding.severity] || 0;
    if (currentRank > registeredRank) {
      failures.push(
        `${name}: severity escalated ${entry.severity} -> ${finding.severity} beyond the registered waiver`,
      );
    }
    const registeredIds = new Set(entry.advisories || []);
    for (const via of finding.via || []) {
      if (typeof via === "string") continue; // dependency edge; judged via its own entry
      const id = advisoryId(via);
      if (!registeredIds.has(id)) {
        failures.push(
          `${name}: new advisory ${id} (${via.title || "untitled"}) not in the registered waiver`,
        );
      }
    }
  }
  return { failures, checked };
}

function parseArguments(argv) {
  const options = { baseline: null, file: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--baseline") options.baseline = argv[(i += 1)];
    else if (argv[i] === "--file") options.file = argv[(i += 1)];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!options.baseline) throw new Error("--baseline <audit-baseline.json> is required");
  if (!options.file) {
    throw new Error("--file <audit.json> is required (write `pnpm audit --json` to a file first)");
  }
  return options;
}

function main(argv) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (err) {
    console.error(
      "usage: node scripts/check-pnpm-audit.js --baseline <file> --file <audit.json>\n" +
        `error: ${err.message}`,
    );
    return 2;
  }

  let baseline;
  let report;
  try {
    baseline = JSON.parse(fs.readFileSync(options.baseline, "utf-8"));
  } catch (err) {
    console.error(`cannot read baseline ${options.baseline}: ${err.message}`);
    return 2;
  }
  try {
    report = JSON.parse(fs.readFileSync(options.file, "utf-8"));
  } catch (err) {
    console.error(`cannot read the audit report ${options.file}: ${err.message}`);
    return 2;
  }
  // `report` may be any JSON value (null included): guard before dereferencing so
  // a null report reaches normalizeReport's "unrecognized shape" rejection
  // instead of throwing an uncaught TypeError here.
  if (report && report.error) {
    console.error(
      `audit run failed: ${report.error.summary || report.error.detail || report.error.code || "unknown error"}`,
    );
    return 2;
  }

  const today = todayIso();
  let failures;
  let checked;
  try {
    ({ failures, checked } = collectFailures(report, baseline, today));
  } catch (err) {
    // An unreadable report must fail the gate, never pass it.
    console.error(`desktop pnpm audit gate: FAILED (unreadable report) -- ${err.message}`);
    return 2;
  }
  const registered = (baseline.packages || []).length;

  if (failures.length > 0) {
    console.error(`desktop pnpm audit gate: FAILED (${failures.length} finding(s) beyond the baseline)`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
      "Remediate by upgrading, or register a reviewed waiver with an expiry in " +
        `${path.basename(options.baseline)} (never by weakening this gate).`,
    );
    return 1;
  }

  console.log(
    `desktop pnpm audit gate: OK (${checked} vulnerability finding(s) checked, ` +
      `${registered} registered waiver(s), baseline reviewed ${baseline.reviewedAt || "unknown"})`,
  );
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  collectFailures,
  advisoryId,
  normalizeReport,
  fromAdvisories,
  parseArguments,
  main,
};
