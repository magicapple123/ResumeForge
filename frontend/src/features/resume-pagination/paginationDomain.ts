// SPDX-License-Identifier: Apache-2.0
/**
 * W08 分页意图的**数据层**：`format_config.pagination` 域（wave2 契约 §3.2）。
 *
 * ## 只用语义锚点，不用坐标
 *
 * 条目意图的键是 **稳定对象 id**（W00/W01 的 `document_identity` 形状），板块意图的键是
 * 板块键（`experience` 等）。**禁止**存数组下标、像素 Y、页码：排一次版就全错位
 * （plan §10.1「显式分页以语义对象为锚点」）。
 *
 * ## 三态与默认值
 *
 * 每一项都是"未设置 = 用默认行为"：`break_before` 未设置 = 不强制断页；
 * `keep_with_next` 未设置 = 0；`allow_split` 未设置 = 保持整条不跨页（等于今天的行为）；
 * `continuation.*` 未设置 = false。恢复默认一律**删键**，不写回默认值。
 *
 * ## 与后端的分工
 *
 * 本模块只读写域数据；"这一页到底断在哪"由后端真实排版决定（W08-BE 的
 * `resume_pagination.py` + 分页报告端点）。前端**不模拟分页**，也不画假分页线。
 */
import type { ResumeFormatConfig } from "../../types/resumeFormat";
import { readFormatDomain, withFormatDomain } from "../resume-layout/formatDomains";

/** 域键（与后端 `_DOMAIN_VALIDATORS` 的 `pagination` 逐字相等）。 */
export const PAGINATION_DOMAIN_KEY = "pagination" as const;

/** 分页支持的最小版本（>1 整域丢弃，与 R2 同口径）。 */
export const PAGINATION_DOMAIN_VERSION = 1;

/** 断页意图：只认 `"page"`（其余值丢弃）。 */
export type BreakBefore = "page";

export interface EntryBreak {
  break_before?: BreakBefore;
  /** 跟随行数 1–3；未设置 = 不跟随。 */
  keep_with_next?: 1 | 2 | 3;
  /** 允许跨页；未设置 = 保持整条不跨页（默认行为）。 */
  allow_split?: true;
}

export interface PaginationContinuation {
  repeat_name?: boolean;
  page_numbers?: boolean;
}

export interface PaginationDomain {
  entries: Record<string, EntryBreak>;
  sections: Record<string, EntryBreak>;
  continuation: PaginationContinuation;
}

/** 对象 id 形状（与 W00/W01 同一正则）。 */
const OBJECT_ID = /^[A-Za-z0-9_-]{8,32}$/;
/** 板块键形状（后端板块键都是小写蛇形；未知键在 UI 侧不展示）。 */
const SECTION_KEY = /^[a-z][a-z_]{1,31}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 把任意输入收成合法的断页意图（越界/未知键丢弃）。 */
export function readEntryBreak(raw: unknown): EntryBreak {
  if (!isRecord(raw)) return {};
  const result: EntryBreak = {};
  if (raw["break_before"] === "page") result.break_before = "page";
  const keep = raw["keep_with_next"];
  if (typeof keep === "number" && Number.isInteger(keep) && keep >= 1 && keep <= 3) {
    result.keep_with_next = keep as 1 | 2 | 3;
  }
  if (raw["allow_split"] === true) result.allow_split = true;
  return result;
}

function readEntries(raw: unknown): Record<string, EntryBreak> {
  if (!isRecord(raw)) return {};
  const entries: Record<string, EntryBreak> = {};
  for (const [objectId, value] of Object.entries(raw)) {
    if (!OBJECT_ID.test(objectId)) continue;
    const entry = readEntryBreak(value);
    if (Object.keys(entry).length > 0) entries[objectId] = entry;
  }
  return entries;
}

function readSections(raw: unknown): Record<string, EntryBreak> {
  if (!isRecord(raw)) return {};
  const sections: Record<string, EntryBreak> = {};
  for (const [sectionKey, value] of Object.entries(raw)) {
    if (!SECTION_KEY.test(sectionKey)) continue;
    const entry = readEntryBreak(value);
    if (Object.keys(entry).length > 0) sections[sectionKey] = entry;
  }
  return sections;
}

function readContinuation(raw: unknown): PaginationContinuation {
  if (!isRecord(raw)) return {};
  const continuation: PaginationContinuation = {};
  if (raw["repeat_name"] === true) continuation.repeat_name = true;
  if (raw["page_numbers"] === true) continuation.page_numbers = true;
  return continuation;
}

/** 读分页意图域；没有 / 版本过高 → `null`（与后端整域丢弃同口径）。 */
export function readPaginationDomain(
  config: ResumeFormatConfig | undefined | null,
): PaginationDomain | null {
  const domain = readFormatDomain(config, PAGINATION_DOMAIN_KEY);
  if (!domain) return null;
  return {
    entries: readEntries(domain["entries"]),
    sections: readSections(domain["sections"]),
    continuation: readContinuation(domain["continuation"]),
  };
}

function isEmptyDomain(domain: PaginationDomain): boolean {
  return (
    Object.keys(domain.entries).length === 0 &&
    Object.keys(domain.sections).length === 0 &&
    Object.keys(domain.continuation).length === 0
  );
}

/** 写回分页域：空域删键（R3）。 */
function writeDomain(
  config: ResumeFormatConfig | undefined | null,
  domain: PaginationDomain,
): ResumeFormatConfig {
  if (isEmptyDomain(domain)) return withFormatDomain(config, PAGINATION_DOMAIN_KEY, null);
  const payload: Record<string, unknown> = {};
  if (Object.keys(domain.entries).length > 0) payload["entries"] = domain.entries;
  if (Object.keys(domain.sections).length > 0) payload["sections"] = domain.sections;
  if (Object.keys(domain.continuation).length > 0) payload["continuation"] = domain.continuation;
  return withFormatDomain(config, PAGINATION_DOMAIN_KEY, payload);
}

function emptyDomain(): PaginationDomain {
  return { entries: {}, sections: {}, continuation: {} };
}

/** 改一条条目的断页意图：`changes` 里的 null 表示删掉该属性；全删后条目键消失。 */
export function setEntryBreak(
  config: ResumeFormatConfig | undefined | null,
  objectId: string,
  changes: Partial<Record<keyof EntryBreak, unknown>>,
): ResumeFormatConfig {
  const domain = readPaginationDomain(config) ?? emptyDomain();
  const current: EntryBreak = { ...(domain.entries[objectId] ?? {}) };
  applyChanges(current, changes);
  if (Object.keys(current).length === 0) delete domain.entries[objectId];
  else domain.entries[objectId] = current;
  return writeDomain(config, domain);
}

/** 改一个板块的断页意图。 */
export function setSectionBreak(
  config: ResumeFormatConfig | undefined | null,
  sectionKey: string,
  changes: Partial<Record<keyof EntryBreak, unknown>>,
): ResumeFormatConfig {
  const domain = readPaginationDomain(config) ?? emptyDomain();
  const current: EntryBreak = { ...(domain.sections[sectionKey] ?? {}) };
  applyChanges(current, changes);
  if (Object.keys(current).length === 0) delete domain.sections[sectionKey];
  else domain.sections[sectionKey] = current;
  return writeDomain(config, domain);
}

function applyChanges(
  target: EntryBreak,
  changes: Partial<Record<keyof EntryBreak, unknown>>,
): void {
  const next = target as Record<string, unknown>;
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === false || value === 0) {
      delete next[key];
      continue;
    }
    if (key === "break_before" && value === "page") next[key] = "page";
    else if (key === "keep_with_next" && typeof value === "number" && value >= 1 && value <= 3) {
      next[key] = Math.trunc(value);
    } else if (key === "allow_split" && value === true) next[key] = true;
  }
}

/** 改续页信息：true 写入，false = 删键（默认 false）。 */
export function setContinuation(
  config: ResumeFormatConfig | undefined | null,
  changes: Partial<PaginationContinuation>,
): ResumeFormatConfig {
  const domain = readPaginationDomain(config) ?? emptyDomain();
  const continuation: PaginationContinuation = { ...domain.continuation };
  for (const key of ["repeat_name", "page_numbers"] as const) {
    const value = changes[key];
    if (value === undefined) continue;
    if (value) continuation[key] = true;
    else delete continuation[key];
  }
  domain.continuation = continuation;
  return writeDomain(config, domain);
}

/** 裁掉指向已不存在对象/板块的意图（保存时由宿主在内容变更点调用）。 */
export function pruneStalePagination(
  config: ResumeFormatConfig | undefined | null,
  validObjectIds: readonly string[],
  validSectionKeys: readonly string[],
): ResumeFormatConfig {
  const domain = readPaginationDomain(config);
  if (!domain) return (config ?? {}) as ResumeFormatConfig;
  const validIds = new Set(validObjectIds);
  const validSections = new Set(validSectionKeys);
  const entries = Object.fromEntries(
    Object.entries(domain.entries).filter(([objectId]) => validIds.has(objectId)),
  );
  const sections = Object.fromEntries(
    Object.entries(domain.sections).filter(([sectionKey]) => validSections.has(sectionKey)),
  );
  if (
    Object.keys(entries).length === Object.keys(domain.entries).length &&
    Object.keys(sections).length === Object.keys(domain.sections).length
  ) {
    return config as ResumeFormatConfig;
  }
  return writeDomain(config, { entries, sections, continuation: domain.continuation });
}

/** 手动断页计数（界面徽标/说明用）。 */
export function countManualBreaks(domain: PaginationDomain | null): {
  entries: number;
  sections: number;
} {
  if (!domain) return { entries: 0, sections: 0 };
  const count = (items: Record<string, EntryBreak>) =>
    Object.values(items).filter((item) => item.break_before === "page").length;
  return { entries: count(domain.entries), sections: count(domain.sections) };
}
