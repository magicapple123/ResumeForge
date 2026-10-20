// SPDX-License-Identifier: Apache-2.0
"use strict";

// Desktop supply-chain audit gate (audit PR-06, 2026-10-13).
//
// Runs `npm audit --json` (read-only; the lockfile is never touched) and fails
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
// Usage:
//   node scripts/check-npm-audit.js --baseline scripts/audit-baseline.json
//   node scripts/check-npm-audit.js --baseline ... --file report.json   (tests)

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SEVERITY_RANK = { low: 1, moderate: 2, high: 3, critical: 4 };
const GATE_SEVERITIES = new Set(["low", "moderate", "high", "critical"]);

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function advisoryId(viaObject) {
  if (viaObject && viaObject.url) return String(viaObject.url).split("/").pop();
  if (viaObject && viaObject.source !== undefined) return String(viaObject.source);
  return "unknown-advisory";
}

function collectFailures(report, baseline, today) {
  const failures = [];
  const entries = new Map(
    (baseline.packages || []).map((entry) => [entry.package, entry]),
  );
  const vulnerabilities = (report && report.vulnerabilities) || {};
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

function runNpmAudit(registry) {
  const args = ["audit", "--json", `--registry=${registry}`];
  let command = "npm";
  if (process.platform === "win32") {
    // Never invoke the .cmd shim with shell:true: --registry is a CLI input,
    // and Node joins shell arguments without making metacharacters safe.
    // Run npm's JavaScript entry through the known Node executable instead.
    const nodeDirectory = path.dirname(process.execPath);
    const candidates = [
      process.env.npm_execpath,
      path.join(nodeDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
      path.join(nodeDirectory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    ];
    const cli = candidates.find((candidate) =>
      candidate && path.basename(candidate) === "npm-cli.js" && fs.existsSync(candidate));
    if (!cli) throw new Error("Cannot locate npm-cli.js; install Node with npm (no shell fallback)");
    command = process.execPath;
    args.unshift(cli);
  }
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`npm audit could not be executed: ${result.error.message}`);
  }
  return result.stdout || "";
}

function parseArguments(argv) {
  const options = {
    baseline: null,
    file: null,
    registry: "https://registry.npmjs.org",
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--baseline") options.baseline = argv[(i += 1)];
    else if (argv[i] === "--file") options.file = argv[(i += 1)];
    else if (argv[i] === "--registry") options.registry = argv[(i += 1)];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!options.baseline) throw new Error("--baseline <audit-baseline.json> is required");
  return options;
}

function main(argv) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (err) {
    console.error(`usage: node scripts/check-npm-audit.js --baseline <file> [--file <audit.json>]\nerror: ${err.message}`);
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
    const raw = options.file ? fs.readFileSync(options.file, "utf-8") : runNpmAudit(options.registry);
    report = JSON.parse(raw);
  } catch (err) {
    console.error(`cannot obtain the npm audit report: ${err.message}`);
    return 2;
  }
  if (report.error) {
    console.error(
      `npm audit failed: ${report.error.summary || report.error.detail || report.error.code || "unknown error"}`,
    );
    return 2;
  }

  const today = todayIso();
  const { failures, checked } = collectFailures(report, baseline, today);
  const registered = (baseline.packages || []).length;

  if (failures.length > 0) {
    console.error(`desktop npm audit gate: FAILED (${failures.length} finding(s) beyond the baseline)`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
      "Remediate by upgrading, or register a reviewed waiver with an expiry in " +
        `${path.basename(options.baseline)} (never by weakening this gate).`,
    );
    return 1;
  }

  console.log(
    `desktop npm audit gate: OK (${checked} vulnerability finding(s) checked, ` +
      `${registered} registered waiver(s), baseline reviewed ${baseline.reviewedAt || "unknown"})`,
  );
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { collectFailures, advisoryId, parseArguments, main };
