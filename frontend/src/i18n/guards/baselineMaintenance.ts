// SPDX-License-Identifier: Apache-2.0
import type { ScanResult } from "../cjkScan";
import {
  diffProductCopyBudget,
  validateProductCopyBudget,
  type ProductCopyBudget,
} from "./productCopyBaseline";

export interface I18nBaseline {
  version: number;
  generatedAt: string;
  rule: string;
  src: ScanResult;
  tests: ScanResult;
  productCopy?: ProductCopyBudget;
}

export function countBudgetProblems(current: ScanResult, previous: ScanResult): string[] {
  const problems: string[] = [];
  for (const budget of [current, previous]) {
    const counts = Object.values(budget.files);
    if (counts.some((count) => !Number.isInteger(count) || count < 0)) {
      problems.push("Legacy file counts must be nonnegative integers");
    }
    if (budget.total !== counts.reduce((sum, count) => sum + count, 0)) {
      problems.push("Legacy total does not match file counts");
    }
  }
  if (current.total > previous.total) problems.push("Legacy total increased");
  for (const [file, count] of Object.entries(current.files)) {
    if (count > (previous.files[file] ?? 0)) problems.push(`${file}: legacy count increased`);
  }
  return problems;
}

/** Maintenance can only tighten existing allowances; initial AST capture is explicit. */
export function tightenBaseline(
  previous: I18nBaseline,
  src: ScanResult,
  tests: ScanResult,
  productCopy: ProductCopyBudget,
  initializeAst: boolean,
): I18nBaseline {
  const problems = [
    ...countBudgetProblems(src, previous.src),
    ...countBudgetProblems(tests, previous.tests),
    ...validateProductCopyBudget(productCopy),
  ];
  if (previous.productCopy) {
    if (initializeAst)
      problems.push("AST baseline already exists; initialization is one-time only");
    problems.push(...diffProductCopyBudget(productCopy, previous.productCopy));
  } else if (!initializeAst) {
    problems.push("AST baseline is missing; initialization must be explicit");
  }
  if (problems.length) throw new Error(problems.join("\n"));
  return {
    version: 2,
    generatedAt: new Date().toISOString().slice(0, 10),
    rule: "Legacy CJK ceilings plus language-independent AST product-copy fingerprints",
    src,
    tests,
    productCopy,
  };
}
