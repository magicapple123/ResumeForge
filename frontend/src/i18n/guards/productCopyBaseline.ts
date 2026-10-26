// SPDX-License-Identifier: Apache-2.0
// @ts-expect-error Node types are not installed; this module only runs in Vitest.
import { createHash } from "node:crypto";
import type { ProductCopyFinding } from "./productCopyAst";

export interface ProductCopyFileBudget {
  count: number;
  fingerprints: Record<string, number>;
}

export interface ProductCopyBudget {
  total: number;
  files: Record<string, ProductCopyFileBudget>;
}

/** Positions are deliberately excluded: adding imports must not rebaseline a file. */
export function fingerprintFindings(findings: ProductCopyFinding[]): ProductCopyFileBudget {
  const fingerprints: Record<string, number> = {};
  for (const finding of findings) {
    const fingerprint = createHash("sha256").update(finding.fingerprint).digest("hex");
    fingerprints[fingerprint] = (fingerprints[fingerprint] ?? 0) + 1;
  }
  return {
    count: findings.length,
    fingerprints: Object.fromEntries(
      Object.entries(fingerprints).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

/** Both the summary and each fingerprint must agree; counts cannot hide replacements. */
export function validateProductCopyBudget(budget: ProductCopyBudget): string[] {
  const problems: string[] = [];
  let total = 0;
  for (const [file, value] of Object.entries(budget.files)) {
    const counts = Object.values(value.fingerprints);
    if (counts.some((count) => !Number.isInteger(count) || count < 1)) {
      problems.push(`${file}: invalid fingerprint multiplicity`);
    }
    if (value.count !== counts.reduce((sum, count) => sum + count, 0)) {
      problems.push(`${file}: count does not match fingerprints`);
    }
    total += value.count;
  }
  if (budget.total !== total) problems.push("Product copy total does not match file counts");
  return problems;
}

export function diffProductCopyBudget(
  current: ProductCopyBudget,
  baseline: ProductCopyBudget,
): string[] {
  const problems = [...validateProductCopyBudget(current), ...validateProductCopyBudget(baseline)];
  if (current.total > baseline.total) problems.push("Product copy total increased");
  for (const [file, value] of Object.entries(current.files)) {
    const allowed = baseline.files[file];
    if (value.count > (allowed?.count ?? 0)) problems.push(`${file}: product copy count increased`);
    for (const [fingerprint, count] of Object.entries(value.fingerprints)) {
      if (count > (allowed?.fingerprints[fingerprint] ?? 0)) {
        problems.push(`${file}: unregistered product copy ${fingerprint}`);
      }
    }
  }
  return problems;
}
