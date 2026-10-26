// SPDX-License-Identifier: Apache-2.0
// This independent walk detects a broken glob before an empty scan can pass.
// @ts-expect-error Node built-ins are available in Vitest; @types/node is not installed.
import { readdirSync } from "node:fs";
// @ts-expect-error Node built-ins are available in Vitest; @types/node is not installed.
import { join } from "node:path";

export const MINIMUM_SOURCE_FILES = 900;
export const MINIMUM_BASELINE_COVERAGE = 0.95;
const REQUIRED_FILES = ["App.tsx", "main.tsx", "i18n/index.ts"];
const REQUIRED_DIRECTORIES = ["api/", "components/", "features/", "pages/"];
const EXCLUDED_DIRECTORIES = new Set(["node_modules", "dist", "coverage"]);
const EXCLUDED_PREFIXES = ["demo/", "i18n/messages/", "test/"];

interface InventoryEntry {
  name: string;
  isDirectory(): boolean;
}

export type DirectoryReader = (directory: string) => readonly InventoryEntry[];

/** Relative, slash-separated production TS/TSX paths, independent of cjkScan. */
export function collectInventoryFiles(
  root: string,
  readDirectory: DirectoryReader = (directory) => readdirSync(directory, { withFileTypes: true }),
): string[] {
  const files: string[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readDirectory(directory)) {
      const key = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
          walk(join(directory, entry.name), `${key}/`);
        }
      } else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.(test|spec)\.tsx?$/.test(entry.name) &&
        !EXCLUDED_PREFIXES.some((excluded) => key.startsWith(excluded))
      ) {
        files.push(key);
      }
    }
  };
  walk(root, "");
  return files.sort();
}

function normalizedPaths(files: readonly string[]): string[] {
  return files.map((file) => file.replace(/\\/g, "/"));
}

/** Validate scale and coverage separately from any product-copy findings. */
export function validateSourceInventory(
  files: readonly string[],
  baselineFiles: readonly string[],
): string[] {
  const paths = normalizedPaths(files);
  const found = new Set(paths);
  const baseline = new Set(normalizedPaths(baselineFiles));
  const problems: string[] = [];
  if (found.size < MINIMUM_SOURCE_FILES) {
    problems.push(`Source inventory too small: ${found.size} < ${MINIMUM_SOURCE_FILES}`);
  }
  if (found.size !== paths.length) problems.push("Duplicate source inventory paths");
  for (const file of paths) {
    if (/^(?:\/|[a-z]:|\.\.\/)/i.test(file) || file.includes("/../")) {
      problems.push(`Source inventory path must stay relative: ${file}`);
    }
  }
  for (const file of REQUIRED_FILES) {
    if (!found.has(file)) problems.push(`Missing required source: ${file}`);
  }
  for (const directory of REQUIRED_DIRECTORIES) {
    if (!paths.some((file) => file.startsWith(directory))) {
      problems.push(`Missing required source directory: ${directory}`);
    }
  }
  if (baseline.size === 0) {
    problems.push("Source baseline inventory is empty");
  } else {
    const retained = [...baseline].filter((file) => found.has(file)).length;
    const minimum = Math.ceil(baseline.size * MINIMUM_BASELINE_COVERAGE);
    if (retained < minimum) {
      problems.push(`Source baseline coverage too small: ${retained} < ${minimum}`);
    }
  }
  return problems;
}

/** Both paths must describe exactly the same files, including files with zero findings. */
export function compareSourceInventory(
  scanned: readonly string[],
  independentlyEnumerated: readonly string[],
): string[] {
  const scannedPaths = normalizedPaths(scanned);
  const scannedSet = new Set(scannedPaths);
  const enumeratedPaths = normalizedPaths(independentlyEnumerated);
  const enumeratedSet = new Set(enumeratedPaths);
  const problems: string[] = [];
  if (scannedSet.size !== scannedPaths.length || enumeratedSet.size !== enumeratedPaths.length) {
    problems.push("Duplicate paths in source comparison");
  }
  for (const file of [...enumeratedSet].sort()) {
    if (!scannedSet.has(file)) problems.push(`Source missing from product-copy scan: ${file}`);
  }
  for (const file of [...scannedSet].sort()) {
    if (!enumeratedSet.has(file)) problems.push(`Unexpected product-copy source: ${file}`);
  }
  return problems;
}
