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

/**
 * 全局「板块分页方式」的派生值。
 *
 * 只有**列出的板块全部**显式 `break_before = "page"` 才算「每板块新页」；任何一个没设
 * （或只有一部分设了）都显示「自然填充」——后者正是把「部分板块有断页」这个隐藏状态
 * 变可见的地方（界面另有「N 个板块从新页开始」的小结）。
 *
 * 为什么由 `sectionKeys`（宿主给的板块清单）而不是 `domain.sections` 推导：域里可能残留
 * 指向已删板块的键，拿它当分母会出现"设置了 4 个、显示已是全部"的假完成态。
 */
export type SectionPaginationMode = "flow" | "page";

export function sectionPaginationMode(
  domain: PaginationDomain | null,
  sectionKeys: readonly string[],
): SectionPaginationMode {
  if (sectionKeys.length === 0) return "flow";
  const sections = domain?.sections ?? {};
  return sectionKeys.every((key) => sections[key]?.break_before === "page") ? "page" : "flow";
}

/**
 * 全局「每板块新页」：给列出的板块写 `break_before = "page"`。
 *
 * 只加断页、不动各自已有的其它意图（标题跟随等）；不在清单里的板块（含已删板块的残留键）
 * 原样保留，由「自然填充」统一清。
 *
 * 空板块写断页是无害的：后端只在**真的渲染出内容**的板块上应用断页（PDF/Word 的断页
 * 规则挂在渲染出来的节点上，`document_pagination._manual_breaks` 也只统计落进产物的板块），
 * 所以这里不需要（也拿不到）"哪些板块有内容"的信息。
 */
export function setSectionsBreakBefore(
  config: ResumeFormatConfig | undefined | null,
  sectionKeys: readonly string[],
): ResumeFormatConfig {
  const domain = readPaginationDomain(config) ?? emptyDomain();
  for (const sectionKey of sectionKeys) {
    if (!SECTION_KEY.test(sectionKey)) continue;
    domain.sections[sectionKey] = {
      ...(domain.sections[sectionKey] ?? {}),
      break_before: "page",
    };
  }
  return writeDomain(config, domain);
}

/**
 * 全局「自然填充」/「恢复自然分页」：清掉**所有板块**的 `break_before`。
 *
 * 条目级意图（`entries`）与续页信息一律不动——"板块是否按模块断开"和"这一条从新页开始"
 * 是两个层级的决定，全局开关不该越权清掉用户逐条设置的结果。
 * 板块条目里其它意图（如标题跟随）保留；只删了断页后条目变空才移除该板块键。
 */
export function clearSectionsBreakBefore(
  config: ResumeFormatConfig | undefined | null,
): ResumeFormatConfig {
  const domain = readPaginationDomain(config) ?? emptyDomain();
  for (const [sectionKey, value] of Object.entries(domain.sections)) {
    const next: EntryBreak = { ...value };
    delete next.break_before;
    if (Object.keys(next).length === 0) delete domain.sections[sectionKey];
    else domain.sections[sectionKey] = next;
  }
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
