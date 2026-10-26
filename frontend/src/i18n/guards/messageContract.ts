// SPDX-License-Identifier: Apache-2.0
import { isEqualityExempt } from "./equalityExemptions";

export type MessagePack = Readonly<Record<string, string>>;
export type ContractProblemCode =
  | "missing-key"
  | "english-cjk"
  | "english-empty"
  | "source-ascii-english"
  | "untranslated"
  | "placeholder-mismatch";

export interface ContractProblem {
  code: ContractProblemCode;
  key: string;
  detail: string;
}

// Includes Han extensions as well as CJK and full-width punctuation.
const CJK =
  /[\p{Script=Han}\u2e80-\u2fff\u3000-\u303f\u3040-\u30ff\u3100-\u312f\u31a0-\u31bf\uff00-\uffef]/u;
const ASCII = /^[\x20-\x7e]*$/;
const SENTENCE_END = /[.!?;:]$/;
const LOWERCASE_CONJUNCTION = /(?:^|[^a-z])(?:and|or|but|nor|for|so|yet)(?:$|[^a-z])/;

// Official format names and established technical units are tokens, not English prose.
const TECHNICAL_TOKENS = new Set([
  "AI",
  "API",
  "ATS",
  "CSV",
  "CSS",
  "DOCX",
  "DOI",
  "GB",
  "GitHub",
  "HTML",
  "HTTP",
  "HTTPS",
  "JD",
  "JSON",
  "KB",
  "MB",
  "Markdown",
  "NSIS",
  "PDF",
  "PNG",
  "SVG",
  "TB",
  "TXT",
  "UI",
  "URL",
  "UTF-8",
  "Word",
  "XML",
  "cm",
  "dpi",
  "mm",
  "ms",
  "pt",
  "px",
]);

/** The short-token rule is intentionally followed by the ASCII prose check below. */
export function isAutomaticEqualityToken(value: string): boolean {
  if (!value || !ASCII.test(value) || /\s/.test(value) || SENTENCE_END.test(value)) {
    return false;
  }
  return TECHNICAL_TOKENS.has(value) || (value.length <= 12 && !LOWERCASE_CONJUNCTION.test(value));
}

function withoutPlaceholders(value: string): string {
  return value.replace(/\{\w+\}/g, "");
}

/** Identifiers, official tokens and quantities are not natural-language source text. */
export function isAsciiEnglishSource(value: string): boolean {
  if (!ASCII.test(value) || TECHNICAL_TOKENS.has(value)) return false;
  const text = withoutPlaceholders(value);
  if (!/[a-zA-Z]/.test(text)) return false;
  if (/^https?:\/\/\S+$/.test(text)) return false;
  if (/^[a-zA-Z]*\d[\w./:%+-]*$/.test(text)) return false;
  return true;
}

export function placeholderSignature(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

/** Validate both complete packs; equality exceptions never bypass empty/CJK checks. */
export function validateMessageContract(zh: MessagePack, en: MessagePack): ContractProblem[] {
  const problems: ContractProblem[] = [];
  const keys = [...new Set([...Object.keys(zh), ...Object.keys(en)])].sort();
  for (const key of keys) {
    const hasZh = Object.prototype.hasOwnProperty.call(zh, key);
    const hasEn = Object.prototype.hasOwnProperty.call(en, key);
    if (!hasZh || !hasEn) {
      problems.push({
        code: "missing-key",
        key,
        detail: `Missing from ${hasZh ? "en-US" : "zh-CN"}`,
      });
      continue;
    }
    const source = zh[key];
    const translated = en[key];
    const exempt = isEqualityExempt(key);
    if (!translated.trim()) {
      problems.push({ code: "english-empty", key, detail: "English value is empty" });
    }
    if (CJK.test(translated)) {
      problems.push({ code: "english-cjk", key, detail: "English value contains CJK" });
    }
    if (!exempt && isAsciiEnglishSource(source)) {
      problems.push({
        code: "source-ascii-english",
        key,
        detail: "ASCII English source requires a documented invariant-key exception",
      });
    }
    if (source === translated && !exempt && !isAutomaticEqualityToken(translated)) {
      problems.push({ code: "untranslated", key, detail: "English equals the source value" });
    }
    if (
      JSON.stringify(placeholderSignature(source)) !==
      JSON.stringify(placeholderSignature(translated))
    ) {
      problems.push({
        code: "placeholder-mismatch",
        key,
        detail: "Placeholder names and occurrence counts must match",
      });
    }
  }
  return problems;
}
