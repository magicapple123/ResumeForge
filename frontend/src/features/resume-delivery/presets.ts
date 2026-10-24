// SPDX-License-Identifier: Apache-2.0
/**
 * 导出预设的**归一化与校验**（W19 / D18，契约 §6.3–§6.5）。
 *
 * 预设里不放内容/版式（那些属于文档本身）；这里只处理"怎么导出"：格式组合、命名规则、
 * 水印/脱敏、照片、是否归档原件。保存前校验；导出时只做 fail-soft 渲染（未知 token 不阻断）。
 */
import { validateNamingPattern } from "./naming";
import {
  EXPORT_FORMATS,
  defaultPresetConfig,
  type ExportBundleRequest,
  type ExportFormat,
  type ExportPresetConfig,
} from "./types";

export type PresetIssueCode =
  "no-formats" | "unknown-format" | "duplicate-format" | "bad-naming" | "watermark-too-long";

export interface PresetIssue {
  code: PresetIssueCode;
  /** 出问题的 token（`bad-naming` 时）。 */
  token?: string;
}

export const MAX_WATERMARK_CHARS = 64;

function isFormat(value: unknown): value is ExportFormat {
  return typeof value === "string" && (EXPORT_FORMATS as readonly string[]).includes(value);
}

/** 把接口/旧数据的配置收敛成当前形状（未知字段丢弃、缺失字段用默认）。 */
export function normalizePresetConfig(raw: unknown): ExportPresetConfig {
  const base = defaultPresetConfig();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const source = raw as Record<string, unknown>;
  const formats: ExportFormat[] = Array.isArray(source.formats)
    ? source.formats.filter(isFormat)
    : base.formats;
  return {
    formats: formats.length > 0 ? Array.from(new Set(formats)) : base.formats,
    naming: typeof source.naming === "string" ? source.naming : base.naming,
    watermark: typeof source.watermark === "string" ? source.watermark : base.watermark,
    redact: source.redact === true,
    include_photo: source.include_photo !== false,
    archive_original: source.archive_original === true,
  };
}

/** 保存预设前的校验；任何一条失败即拒绝对应项（导出本身仍可继续用默认配置）。 */
export function validatePresetConfig(
  config: ExportPresetConfig,
): { ok: true } | { ok: false; issues: PresetIssue[] } {
  const issues: PresetIssue[] = [];
  if (config.formats.length === 0) issues.push({ code: "no-formats" });
  if (new Set(config.formats).size !== config.formats.length)
    issues.push({ code: "duplicate-format" });
  for (const format of config.formats) {
    if (!isFormat(format)) issues.push({ code: "unknown-format" });
  }
  if (config.watermark.length > MAX_WATERMARK_CHARS) issues.push({ code: "watermark-too-long" });
  const naming = validateNamingPattern(config.naming);
  if (!naming.ok) {
    for (const token of naming.unknown) issues.push({ code: "bad-naming", token });
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

/** 两份配置是否等价（预设"有未保存修改"提示与默认按钮用）。 */
export function isSamePresetConfig(left: ExportPresetConfig, right: ExportPresetConfig): boolean {
  return (
    JSON.stringify(normalizePresetConfig(left)) === JSON.stringify(normalizePresetConfig(right))
  );
}

/**
 * 把配置翻译成套导出请求。
 *
 * `strictRevision` 为真时带上发起时看到的 revision：服务端比对不一致会 409
 * `resume_revision_changed`（契约 §6.5），前端据此提示"版本已变，请确认"。
 */
export function toBundleRequest(
  config: ExportPresetConfig,
  options: { revision?: number; strictRevision?: boolean } = {},
): ExportBundleRequest {
  return {
    formats: config.formats,
    watermark: config.watermark.trim(),
    redact: config.redact,
    include_photo: config.include_photo,
    archive_original: config.archive_original,
    ...(options.revision !== undefined ? { resume_revision: options.revision } : {}),
    ...(options.strictRevision !== undefined ? { strict_revision: options.strictRevision } : {}),
  };
}

/** 预设列表里的默认项（没有默认时退回第一项；都没有返回 null）。 */
export function pickDefaultPreset<T extends { is_default: boolean }>(
  presets: readonly T[],
): T | null {
  return presets.find((preset) => preset.is_default) ?? presets[0] ?? null;
}
