// SPDX-License-Identifier: Apache-2.0
/**
 * `format_config` 的 **v1 域协议**（wave2 契约 §1）：一个顶层键 = 一个"域"，域值必须是
 * 含 `version` 的 object。W07 的 `roles` / `objects`、W08 的 `pagination`、W15 的
 * `photo_crop` 都走这一份读写实现，禁止各处自己 `config["roles"]` 裸读。
 *
 * ## 四条硬规则的落地
 *
 * | 规则 | 这里怎么实现 |
 * | --- | --- |
 * | R1 域键固定 | `FORMAT_DOMAIN_KEYS` 白名单 |
 * | R2 缺 version 按 1；`>1` 整域丢弃 | `readFormatDomain` 返回 `null`（与后端"丢弃 + INFO"同口径） |
 * | R3 空域不落库 | `withFormatDomain` 与 `pruneStaleDomainEntries` 都会删掉只剩 version 的域 |
 * | R4 域内只允许标量与短枚举 | 本模块只保证形状；属性白名单在各域自己的类型里（如 `styleOverrides`） |
 *
 * ## 为什么不改 `types/resumeFormat.ts` 的宽松值类型
 *
 * 那份类型是全仓 60+ 处共用的（`Record<string, number | string | string[]>`）。扩成含
 * `object` 会把类型压力扩散到别人负责的文件；本模块在边界处收窄一次，返回值仍是原类型
 * ——运行时完全一样，等 wb-core/lead 统一放宽时不用再动这里。
 */
import type { ResumeFormatConfig } from "../../types/resumeFormat";

/** 本端支持的域协议版本；`version > 1` 的域整域丢弃（与后端一致）。 */
export const FORMAT_DOMAIN_VERSION = 1;

/**
 * 域键白名单（R1；新增域必须先在契约文档增补）。
 *
 * `object_roles`（W3：文字级别按选中字段/角色生效）追加在既有四个键之后；顺序本身
 * 不影响读写，但保持"旧键在前"让 diff 与后端 `DOMAIN_KEYS` 对得上。
 */
export const FORMAT_DOMAIN_KEYS = [
  "roles",
  "objects",
  "pagination",
  "photo_crop",
  "object_roles",
  // W4 条目字段排版（承载区补充字段分行/位置可调）。
  "field_layout",
] as const;

export type FormatDomainKey = (typeof FORMAT_DOMAIN_KEYS)[number];

/** 读出来的域：`version` 已归一化，其余键是域内条目。 */
export interface FormatDomain {
  version: number;
  [entry: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 域版本：缺 version / 非整数 / <=0 一律按 1 读（宽容），与 R2 的"宽容读"一致。 */
export function domainVersion(raw: unknown): number {
  if (!isRecord(raw)) return FORMAT_DOMAIN_VERSION;
  const value = raw["version"];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return FORMAT_DOMAIN_VERSION;
  }
  return value;
}

/**
 * 读一个域：形状不对、或版本高于本端支持 → `null`（整域丢弃）。
 *
 * 读侧**不做属性白名单**：那是各域自己的事（本模块只管协议形状），而且"读宽容"是
 * W00 §3.2 的既有约定。
 */
export function readFormatDomain(
  config: ResumeFormatConfig | undefined | null,
  key: FormatDomainKey,
): FormatDomain | null {
  const raw: unknown = config?.[key];
  if (!isRecord(raw)) return null;
  const version = domainVersion(raw);
  if (version > FORMAT_DOMAIN_VERSION) return null;
  return { ...raw, version };
}

/** 域内条目（去掉 `version`；值原样保留，由调用方各自收窄）。 */
export function domainEntries(
  domain: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!domain) return {};
  const entries: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(domain)) {
    if (key === "version") continue;
    entries[key] = value;
  }
  return entries;
}

/** 域里除了 version 之外一个键都没有（R3：这种域不落库）。 */
export function domainIsEmpty(domain: Record<string, unknown> | null | undefined): boolean {
  return Object.keys(domainEntries(domain)).length === 0;
}
/** 条目内的一层清理：去掉 null / undefined；清空后的对象条目整个丢掉。 */
function compactEntry(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const cleaned: Record<string, unknown> = {};
  for (const [nestedKey, nestedValue] of Object.entries(value)) {
    if (nestedValue === null || nestedValue === undefined) continue;
    cleaned[nestedKey] = nestedValue;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

/** 去掉值为 \`null\` / \`undefined\` 的条目（前端永不写 null，见契约 §2.3）。 */
function compactDomain(domain: Record<string, unknown>): Record<string, unknown> {
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(domain)) {
    if (value === null || value === undefined) continue;
    const entry = compactEntry(value);
    if (entry === null) continue;
    compacted[key] = entry;
  }
  return compacted;
}

/**
 * 写一个域：`value === null` = **删域**（恢复继承）；空域同样删域（R3）。
 *
 * 写进来的版本统一成 1：v1 客户端只会产出 v1 数据，保留旧版本号只会制造歧义。
 */
export function withFormatDomain(
  config: ResumeFormatConfig | undefined | null,
  key: FormatDomainKey,
  value: Record<string, unknown> | null,
): ResumeFormatConfig {
  const next: Record<string, unknown> = { ...(config ?? {}) };
  if (value === null) {
    delete next[key];
    return next as ResumeFormatConfig;
  }
  const compacted = compactDomain(value);
  if (domainIsEmpty(compacted)) {
    delete next[key];
    return next as ResumeFormatConfig;
  }
  next[key] = { ...compacted, version: FORMAT_DOMAIN_VERSION };
  return next as ResumeFormatConfig;
}
/**
 * 改域里的**一个条目**（\`value === null\` = 删该条）；\`reservedKeys\` 是域内非条目键
 * （\`pagination\` 的 \`sections\` / \`continuation\`），原样保留。
 */
export function withFormatDomainEntry(
  config: ResumeFormatConfig | undefined | null,
  key: FormatDomainKey,
  entryKey: string,
  value: unknown,
  reservedKeys: readonly string[] = [],
): ResumeFormatConfig {
  const domain = readFormatDomain(config, key);
  const current = domainEntries(domain);
  const reserved: Record<string, unknown> = {};
  for (const reservedKey of reservedKeys) {
    if (reservedKey === entryKey) continue;
    if (current[reservedKey] !== undefined) reserved[reservedKey] = current[reservedKey];
    delete current[reservedKey];
  }
  if (value === null || value === undefined) {
    delete current[entryKey];
  } else if (reservedKeys.includes(entryKey)) {
    reserved[entryKey] = value;
  } else {
    current[entryKey] = value;
  }
  return withFormatDomain(config, key, { ...reserved, ...current });
}

/**
 * 裁掉指向已不存在对象的域条目（契约 §1.6 的 `prune_overrides` 前端对应物）。
 *
 * 与后端一样**只在明确的内容变更点调用**（对象面板删除条目、内容重建），不做读侧裁剪：
 * 读侧裁剪会让"看到的"与"库里存的"不一致。
 *
 * 没有可裁的条目时返回**原对象引用**，调用方据此判断"不必写库"。
 */
export function pruneStaleDomainEntries(
  config: ResumeFormatConfig | undefined | null,
  key: FormatDomainKey,
  validKeys: readonly string[],
  reservedKeys: readonly string[] = [],
): ResumeFormatConfig {
  const domain = readFormatDomain(config, key);
  if (!domain) return (config ?? {}) as ResumeFormatConfig;
  const valid = new Set(validKeys);
  const kept: Record<string, unknown> = {};
  let removed = false;
  for (const [entryKey, value] of Object.entries(domainEntries(domain))) {
    if (reservedKeys.includes(entryKey) || valid.has(entryKey)) {
      kept[entryKey] = value;
    } else {
      removed = true;
    }
  }
  if (!removed) return config as ResumeFormatConfig;
  return withFormatDomain(config, key, kept);
}

/** `objects` 域的裁剪便捷入口（W07 对象级覆盖用；W08 的 pagination.entries 走通用版）。 */
export function pruneStaleObjectOverrides(
  config: ResumeFormatConfig | undefined | null,
  validObjectIds: readonly string[],
): ResumeFormatConfig {
  return pruneStaleDomainEntries(config, "objects", validObjectIds);
}
