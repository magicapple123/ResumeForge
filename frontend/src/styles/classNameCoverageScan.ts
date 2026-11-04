// SPDX-License-Identifier: Apache-2.0
/**
 * Static scanners for the CSS class-name existence guard.
 *
 * Split out of `className-coverage.test.ts` so that the guard table (which is Chinese
 * prose written for humans) can stay in the test file while this module keeps the
 * mechanical scanning logic. The test file is subject to a 500-line budget and the
 * i18n ratchet forbids new CJK lines in non-test sources, so comments here stay in
 * English on purpose.
 *
 * Scope rules (mirrored in the test file header):
 * 1. Only statically knowable parts of `className` are collected -- string literals,
 *    static fragments of template strings, and string arguments of `clsx(...)`.
 *    Bare variables (`styles.foo`) are skipped, never guessed.
 * 2. Tokens are split on whitespace and filtered by project-owned prefixes.
 * 3. A token must appear as a selector in project CSS (`.token` not followed by a
 *    word character or `-`).
 * 4. A token ending in a separator is a dynamic modifier; the base class is checked.
 */
// @ts-expect-error Node builtin: @types/node is not installed, but vitest runs in Node.
import { readdirSync } from "node:fs";

/** One exemption entry: why a missing class name is acceptable, and until when. */
export interface Exemption {
  /** Why no style is acceptable -- must point at a concrete mechanism, no "later". */
  reason: string;
  /** Expiry date (ISO). Once past, the guard goes red and forces a re-judgement. */
  expires: string;
}

/** One scanned source file. */
export interface SourceFile {
  file: string;
  text: string;
}

/** Where a token was seen. */
export interface Usage {
  files: Set<string>;
  where: string[];
}

/** Project-owned class name prefixes. Everything else (ant-*, css-*, utilities) is skipped. */
export const PREFIXES = [
  "resume-",
  "profile-",
  "interview-",
  "workbench-",
  "task-",
  "bilingual-",
  "template-",
  "rf-",
  "entry-",
  "document-",
  "chip-",
  "tou-",
];

export function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * Values after `className=`: a quoted string is returned verbatim, a `{...}`
 * expression is captured by bracket matching.
 */
export function classNameValues(source: string): { value: string; literal: boolean; at: number }[] {
  const values: { value: string; literal: boolean; at: number }[] = [];
  const pattern = /className\s*=\s*/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const start = match.index + match[0].length;
    const quote = source[start];
    if (quote === '"' || quote === "'") {
      const end = source.indexOf(quote, start + 1);
      if (end > 0)
        values.push({ value: source.slice(start + 1, end), literal: true, at: match.index });
      continue;
    }
    if (quote !== "{") continue;
    let depth = 0;
    let index = start;
    for (; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    values.push({ value: source.slice(start + 1, index), literal: false, at: match.index });
  }
  return values;
}

/** Statically knowable fragments of an expression: string literals plus template statics. */
export function staticFragments(expression: string): string[] {
  const fragments: string[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (char === '"' || char === "'") {
      let cursor = index + 1;
      let buffer = "";
      while (cursor < expression.length && expression[cursor] !== char) {
        if (expression[cursor] === "\\") {
          buffer += expression[cursor + 1] ?? "";
          cursor += 2;
          continue;
        }
        buffer += expression[cursor];
        cursor += 1;
      }
      fragments.push(buffer);
      index = cursor + 1;
      continue;
    }
    if (char === "`") {
      let cursor = index + 1;
      let buffer = "";
      while (cursor < expression.length && expression[cursor] !== "`") {
        if (expression[cursor] === "$" && expression[cursor + 1] === "{") {
          fragments.push(buffer);
          buffer = "";
          const innerStart = cursor + 2;
          let depth = 1;
          cursor = innerStart;
          while (cursor < expression.length && depth > 0) {
            if (expression[cursor] === "{") depth += 1;
            else if (expression[cursor] === "}") depth -= 1;
            cursor += 1;
          }
          // `${...}` may still hold static class names (ternary / clsx): recurse.
          fragments.push(...staticFragments(expression.slice(innerStart, cursor - 1)));
          continue;
        }
        buffer += expression[cursor];
        cursor += 1;
      }
      fragments.push(buffer);
      index = cursor + 1;
      continue;
    }
    index += 1;
  }
  return fragments;
}

export function isProjectToken(token: string): boolean {
  if (!token) return false;
  const prefix = PREFIXES.find((item) => token.startsWith(item));
  // A bare prefix (`rf-`) is a concatenation leftover, not a class name.
  return Boolean(prefix) && token.length > (prefix as string).length;
}

export function collectUsage(sources: SourceFile[]): Map<string, Usage> {
  const usage = new Map<string, Usage>();
  for (const { file, text } of sources) {
    for (const { value, literal, at } of classNameValues(text)) {
      const fragments = literal ? [value] : staticFragments(value);
      const line = text.slice(0, at).split("\n").length;
      for (const fragment of fragments) {
        for (const token of fragment.split(/\s+/)) {
          if (!isProjectToken(token)) continue;
          const record = usage.get(token) ?? { files: new Set<string>(), where: [] };
          record.files.add(file);
          record.where.push(`${file}:${line}`);
          usage.set(token, record);
        }
      }
    }
  }
  return usage;
}

export function collectClasses(cssText: string): Set<string> {
  const classes = new Set<string>();
  for (const match of cssText.matchAll(/\.([A-Za-z_][\w-]*)/g)) classes.add(match[1]);
  return classes;
}

/** Missing list as `token <- file`. Dynamic modifiers (ending in - or _) check the base. */
export function missingTokens(
  usage: Map<string, Usage>,
  classes: Set<string>,
  exemptions: Record<string, Exemption>,
): string[] {
  const missing: string[] = [];
  for (const [token, record] of [...usage.entries()].sort()) {
    if (exemptions[token]) continue;
    if (classes.has(token)) continue;
    const base = token.replace(/[-_]+$/, "");
    if (base !== token && classes.has(base)) continue;
    missing.push(`${token} <- ${[...record.files].join(", ")}`);
  }
  return missing;
}
