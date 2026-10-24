// SPDX-License-Identifier: Apache-2.0
/**
 * 导出文件名命名规则（W19 / D18，契约 §6.4）。
 *
 * 后端 `export_naming.render_filename` 是唯一权威实现；前端这里做**同一套规则的预览**
 * （用户输入模板时即时看到"会得到什么文件名"），并在保存预设前做 token 校验。两边口径：
 * - 未知 token **不报错**（导出不该因命名挂掉），原样保留花括号；
 * - 路径分隔符与非法字符替换成 '-'；
 * - 扩展名由格式决定，用户模板不能控制；
 * - stem 超长截断到 120。
 */
import type { ExportFormat } from "./types";

/** 允许的 token（与后端 `NAMED_TOKENS` 逐字一致）。 */
export const NAMED_TOKENS = [
  "name",
  "company",
  "job_title",
  "template",
  "date",
  "revision",
  "language",
] as const;
export type NamingToken = (typeof NAMED_TOKENS)[number];

/** 默认命名与既有 `build_filename` 同口径（无 job_title 时退化为"姓名-日期"）。 */
export const DEFAULT_NAMING = "{name}-{job_title}-{date}";
export const MAX_FILENAME_STEM = 120;

/** 各格式的扩展名（由格式决定，用户不可控）。 */
export const FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
  pdf: "pdf",
  docx: "docx",
  html: "html",
  md: "md",
  txt: "txt",
  json: "json",
};

/** 命名上下文：值来自当前简历/岗位（用户数据，不进 i18n）。 */
export interface NamingContext {
  name: string;
  company: string;
  job_title: string;
  template: string;
  /** YYYYMMDD（与既有默认文件名一致）。 */
  date: string;
  revision: string | number;
  language: string;
}

/** 从模板里抽出 token 和未知 token（保存预设时用后者报 422 的依据）。 */
export function analyzeNamingPattern(pattern: string): {
  tokens: string[];
  unknown: string[];
} {
  const tokens: string[] = [];
  const unknown: string[] = [];
  const matcher = /\{([a-z_]+)\}/g;
  let match: RegExpExecArray | null = matcher.exec(pattern);
  while (match) {
    const token = match[1];
    if ((NAMED_TOKENS as readonly string[]).includes(token)) tokens.push(token);
    else unknown.push(token);
    match = matcher.exec(pattern);
  }
  return { tokens, unknown };
}

/** 文件名消毒：路径分隔符与 Windows 非法字符 → '-'（与后端 sanitize 同量级）。 */
export function sanitizeFilenameStem(stem: string): string {
  return stem
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.-]+|[.-]+$/g, "");
}

function tokenValue(token: string, context: NamingContext): string {
  switch (token) {
    case "name":
      return context.name;
    case "company":
      return context.company;
    case "job_title":
      return context.job_title;
    case "template":
      return context.template;
    case "date":
      return context.date;
    case "revision":
      return String(context.revision);
    case "language":
      return context.language;
    default:
      return `{${token}}`;
  }
}

/**
 * 把命名模板渲染成**文件名预览**（含扩展名）。
 *
 * `pattern` 为空 = 使用既有默认命名（`DEFAULT_NAMING`），所以预览与真实导出零差异。
 */
export function renderFilenamePreview(
  pattern: string,
  context: NamingContext,
  format: ExportFormat,
): string {
  const template = pattern.trim() || DEFAULT_NAMING;
  const rendered = template
    .replace(/\{([a-z_]+)\}/g, (_full, token: string) => tokenValue(token, context))
    // 空 token（如没有关联岗位）会留下相邻分隔符：折叠成单个 '-'，两端不留 '-'——
    // 与后端"无 job_title 时退化为 姓名-日期"的既有口径一致（契约 §6.4）。
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  const stem = sanitizeFilenameStem(rendered).slice(0, MAX_FILENAME_STEM);
  const safeStem = stem || "resume";
  return `${safeStem}.${FORMAT_EXTENSIONS[format]}`;
}

/** 保存预设前的校验：模板只允许已知 token（未知 token → 拒绝保存，导出时 fail-soft）。 */
export function validateNamingPattern(
  pattern: string,
): { ok: true } | { ok: false; unknown: string[] } {
  const { unknown } = analyzeNamingPattern(pattern);
  return unknown.length === 0 ? { ok: true } : { ok: false, unknown };
}
