// SPDX-License-Identifier: Apache-2.0
/**
 * 双语**字段对照 / 翻译候选**的 v2 生成规则（W16 / D07、D15）。
 *
 * ## 从 v1 到 v2 的口径变化
 *
 * v1 的行是"分区数组下标 + 字段名"（`experience.0.company`）；v2 的正文是一份
 * `ResumeDocument`，行必须落在 **item 路径**上（`header.{itemId}` /
 * `{sectionKey}.{entryId}.{itemId}`）——这正是后端 `adopt` 能接收的路径格式，
 * 所以"对照"与"采纳"共用同一份路径，不再需要把下标翻译成路径。
 *
 * ## 哪些字段可以逐项采纳
 *
 * - `FieldItem` / `TextItem`：可以（值是一段文本，采纳接口按路径写回）；
 * - `ListItem` / `AuthorsItem`：**只读展示**——采纳接口一次只接受一段文本，
 *   把整条列表压成一段会丢元素（课程/技术栈/作者名），所以不生成候选；
 * - **自建板块 / 自定义字段**：只读展示并提示——服务端的翻译路径只覆盖系统字段目录，
 *   自建内容不在候选里，硬按路径采纳会整批被拒；
 * - 姓名/机构/时间/数字等身份字段：界面标"事实锁"并禁用（真正拒写在服务端）。
 */
import type {
  HeaderItem,
  ResumeDocument,
  ResumeEntry,
  ResumeItem,
  ResumeSection,
} from "../../types/resumeDocument";
import { headerPath, itemPath } from "../resume-document/paths";
import type { BilingualPair, TranslationCandidate } from "./types";

/** 组件提供的标签解析（目录/板块标题）；纯函数测试可传 `defaultPairLabels()`。 */
export interface PairLabels {
  item: (sectionKey: string, item: ResumeItem | HeaderItem) => string;
  group: (sectionKey: string, sectionTitle: string) => string;
}

export function defaultPairLabels(): PairLabels {
  return {
    item: (_sectionKey, item) => {
      if ("label" in item && item.label) return item.label;
      return "key" in item ? item.key : "";
    },
    group: (sectionKey, sectionTitle) => sectionTitle || sectionKey,
  };
}

export function isCustomKey(key: string): boolean {
  return key.startsWith("custom:");
}

/** 自建板块（`custom:<uuid>`）：对照里展示，但不参与逐项采纳。 */
export function isCustomSection(sectionKey: string): boolean {
  return isCustomKey(sectionKey);
}

/** 身份/事实类字段的界面锁定表（按板块；与 v1 的事实锁口径一致，最终由服务端拒写）。 */
const LOCKED_BY_SECTION: Record<string, readonly string[]> = {
  header: ["name", "phone"],
  education: ["school", "major", "gpa", "period", "degree"],
  experience: ["company", "period"],
  projects: ["name", "period"],
  campus_experience: ["organization", "period"],
  awards: ["date"],
  publications: ["title", "venue", "year"],
  research_projects: ["period"],
  patents: ["patent_number", "country", "filed_date", "granted_date"],
  credentials: ["issuer", "issue_date", "expiry_date"],
};
const LOCKED_FORMATS = new Set(["date", "date_range", "number"]);

export function isLockedItem(sectionKey: string, item: ResumeItem | HeaderItem): boolean {
  if (item.kind !== "field") return false;
  const lockedKeys = LOCKED_BY_SECTION[sectionKey] ?? [];
  return lockedKeys.includes(item.key) || LOCKED_FORMATS.has(item.format);
}

/** item 能否逐项采纳：只有单段文本（字段 / 文本块）可以。 */
export function isAdoptableItem(sectionKey: string, item: ResumeItem | HeaderItem): boolean {
  if (isCustomSection(sectionKey)) return false;
  if (item.kind === "field") return !isCustomKey(item.key);
  return item.kind === "text";
}

/**
 * 照片 / 二进制内容不是可翻译文本（Q23）。
 *
 * 页眉里的 `photo` 字段值是图片的 data URL（base64 一整串），翻译接口也从不把它列为
 * translatable path；对照表若照常展开，用户会在"中文 vs 英文"两列里看到几万字符的
 * base64。凡是 key 是 photo、或值以 `data:` 开头的 item 一律不进对照。
 */
export function isBinaryOrPhotoItem(item: ResumeItem | HeaderItem | null | undefined): boolean {
  if (!item) return false;
  if (item.kind === "field" && item.key === "photo") return true;
  return itemText(item).startsWith("data:");
}

/** item 的展示文本：单值原样；列表/作者按换行/逗号连接（只用于对照展示）。 */
export function itemText(item: ResumeItem | HeaderItem | null | undefined): string {
  if (!item) return "";
  switch (item.kind) {
    case "field":
      return (item.value ?? "").trim();
    case "text":
      return (item.text ?? "").trim();
    case "list":
      return (item.values ?? [])
        .map((value) => value.trim())
        .filter(Boolean)
        .join("\n");
    case "authors":
      return item.authors
        .map((author) => author.name.trim())
        .filter(Boolean)
        .join(", ");
    default:
      return "";
  }
}

function pairStatus(primary: string, secondary: string): BilingualPair["status"] {
  if (!primary && !secondary) return "empty";
  return primary === secondary ? "same" : "changed";
}

function pairOf(input: {
  sectionKey: string;
  groupLabel: string;
  path: string;
  labels: PairLabels;
  primaryItem?: ResumeItem | HeaderItem | null;
  secondaryItem?: ResumeItem | HeaderItem | null;
}): BilingualPair {
  const { sectionKey, groupLabel, path, labels, primaryItem, secondaryItem } = input;
  const metaItem = primaryItem ?? secondaryItem ?? null;
  const primary = itemText(primaryItem);
  const secondary = itemText(secondaryItem);
  return {
    id: path,
    sectionKey,
    groupLabel,
    path,
    label: metaItem ? labels.item(sectionKey, metaItem) : "",
    primary,
    secondary,
    status: pairStatus(primary, secondary),
    adoptable: metaItem ? isAdoptableItem(sectionKey, metaItem) : false,
    locked: metaItem ? isLockedItem(sectionKey, metaItem) : false,
  };
}

/** 页眉 item 对照：按 id 并集展开（先在 primary 里的顺序，再接 secondary 独有的）。 */
function headerPairs(
  primary: ResumeDocument | null,
  secondary: ResumeDocument | null,
  labels: PairLabels,
): BilingualPair[] {
  const left = primary?.header.items ?? [];
  const right = secondary?.header.items ?? [];
  const rightById = new Map(right.map((item) => [item.id, item]));
  const rows: BilingualPair[] = [];
  const seen = new Set<string>();
  const groupLabel = labels.group("header", "");
  for (const item of [...left, ...right]) {
    if (seen.has(item.id)) continue;
    // Q23：照片（data URL）不是文本字段，两侧都不展开成对照行。
    if (isBinaryOrPhotoItem(item)) continue;
    seen.add(item.id);
    rows.push(
      pairOf({
        sectionKey: "header",
        groupLabel,
        path: headerPath(item.id),
        labels,
        primaryItem: left.find((candidate) => candidate.id === item.id) ?? null,
        secondaryItem: rightById.get(item.id) ?? null,
      }),
    );
  }
  return rows;
}

function sectionKeys(primary: ResumeDocument | null, secondary: ResumeDocument | null): string[] {
  const keys: string[] = [];
  for (const section of [...(primary?.sections ?? []), ...(secondary?.sections ?? [])]) {
    if (!keys.includes(section.key)) keys.push(section.key);
  }
  return keys;
}

function sectionOf(document: ResumeDocument | null, key: string): ResumeSection | null {
  return document?.sections.find((section) => section.key === key) ?? null;
}

/**
 * 板块内条目对照：**按位置对齐**（不是按 entry id）。
 *
 * 对照的两侧是"当前简历"与"派生出来的语言版本"：派生之后两边可能各自增删过条目，
 * id 未必来自同一次 normalize。按位置展开才能让"第 2 条教育经历 vs 第 2 条"同排显示，
 * 只用于展示与锁定标记；真正采纳用的路径来自候选（同构文档，见 buildTranslationCandidates）。
 */
function entryPairs(
  primarySection: ResumeSection | null,
  secondarySection: ResumeSection | null,
  sectionKey: string,
  labels: PairLabels,
): BilingualPair[] {
  const groupLabel = labels.group(
    sectionKey,
    primarySection?.title ?? secondarySection?.title ?? "",
  );
  const leftEntries = primarySection?.entries ?? [];
  const rightEntries = secondarySection?.entries ?? [];
  const count = Math.max(leftEntries.length, rightEntries.length);
  const rows: BilingualPair[] = [];
  for (let index = 0; index < count; index += 1) {
    const left = leftEntries[index] ?? null;
    const right = rightEntries[index] ?? null;
    const leftItems = left?.items ?? [];
    const rightItems = right?.items ?? [];
    const itemCount = Math.max(leftItems.length, rightItems.length);
    for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
      const leftItem = leftItems[itemIndex] ?? null;
      const rightItem = rightItems[itemIndex] ?? null;
      rows.push(
        pairOf({
          sectionKey,
          groupLabel,
          path: itemPathFor(sectionKey, left ?? right, leftItem ?? rightItem, index, itemIndex),
          labels,
          primaryItem: leftItem,
          secondaryItem: rightItem,
        }),
      );
    }
  }
  return rows;
}

function itemPathFor(
  sectionKey: string,
  entry: ResumeEntry | null,
  item: ResumeItem | null,
  entryIndex: number,
  itemIndex: number,
): string {
  const entryId = entry?.id ?? "entry_" + (entryIndex + 1);
  const itemId = item?.id ?? "item_" + (itemIndex + 1);
  return itemPath(sectionKey, entryId, itemId);
}

/**
 * 生成字段对照行：页眉 → 各板块（按位置展开）。
 *
 * 空 section / 空 entry 不产生行；某一侧条目更多时，多出的行另一侧为空串
 * （"英文版还没翻这条"的可见状态）。
 */
export function buildBilingualPairs(
  primary: ResumeDocument | null,
  secondary: ResumeDocument | null,
  labels: PairLabels = defaultPairLabels(),
): BilingualPair[] {
  const rows = headerPairs(primary, secondary, labels);
  for (const key of sectionKeys(primary, secondary)) {
    rows.push(...entryPairs(sectionOf(primary, key), sectionOf(secondary, key), key, labels));
  }
  return rows;
}

/** 只保留有内容或有差异的行（对照视图的默认展开集合）。 */
export function changedPairs(pairs: readonly BilingualPair[]): BilingualPair[] {
  return pairs.filter((pair) => pair.status !== "empty");
}

/** 整份文档是否含自建板块/自定义字段（对照里提示"这些不参与逐项采纳"）。 */
export function hasCustomContent(document: ResumeDocument | null): boolean {
  if (!document) return false;
  return document.sections.some(
    (section) =>
      isCustomSection(section.key) ||
      section.entries.some((entry) =>
        entry.items.some((item) => item.kind === "field" && isCustomKey(item.key)),
      ),
  );
}

/** v1 分析路径 → 该路径是否命中一个 v2 item（blocked_fields 的兼容映射）。 */
function blockedMatches(
  blocked: ReadonlySet<string>,
  sectionKey: string,
  entryIndex: number,
  item: ResumeItem | HeaderItem | null,
): boolean {
  if (blocked.size === 0 || !item) return false;
  if (sectionKey === "header") {
    const key = item.kind === "field" ? item.key : "";
    return blocked.has(key) || blocked.has("header." + key);
  }
  const key = item.kind === "field" ? item.key : "";
  const prefixes = [sectionKey, sectionKey + "." + entryIndex];
  if (key) prefixes.push(sectionKey + "." + entryIndex + "." + key);
  return prefixes.some((path) => blocked.has(path));
}

/** 同构文档里按 item id（找不到再按位置）配对另一侧的 item。 */
function counterpartItem(
  entry: ResumeEntry | null,
  item: ResumeItem | null,
  index: number,
): ResumeItem | null {
  if (!entry) return null;
  if (item) {
    const byId = entry.items.find((candidate) => candidate.id === item.id);
    if (byId) return byId;
  }
  return entry.items[index] ?? null;
}

/** 候选/对照的稳定路径：header 用 header.{itemId}，条目用 section.entry.item（缺 id 时退化为位置）。 */
function pathOfItem(
  sectionKey: string,
  item: ResumeItem | HeaderItem,
  document: ResumeDocument,
  entryIndex: number,
): string {
  if (sectionKey === "header") return headerPath(item.id);
  const section = document.sections.find((candidate) => candidate.key === sectionKey);
  const entry = section?.entries[entryIndex] ?? null;
  return itemPathFor(sectionKey, entry, item as ResumeItem, entryIndex, 0);
}

/**
 * 原文文档 + 翻译候选文档 → 逐字段候选（只列真变了、且可逐项采纳的 item）。
 *
 * 两份文档必须同构（后端 translate 返回的候选就是原文的副本），路径/结构一一对应；
 * `blockedPaths` 是后端 `blocked_fields`（v1 分析路径），命中即禁用采纳。
 */
export function buildTranslationCandidates(
  original: ResumeDocument | null,
  candidate: ResumeDocument | null,
  blockedPaths: readonly string[],
  labels: PairLabels = defaultPairLabels(),
): TranslationCandidate[] {
  if (!original || !candidate) return [];
  const blocked = new Set(blockedPaths);
  const rows: TranslationCandidate[] = [];
  const push = (
    sectionKey: string,
    entryIndex: number,
    beforeItem: ResumeItem | HeaderItem | null,
    afterItem: ResumeItem | HeaderItem | null,
  ): void => {
    if (!beforeItem || !afterItem) return;
    if (!isAdoptableItem(sectionKey, beforeItem)) return;
    const before = itemText(beforeItem);
    const after = itemText(afterItem);
    if (!after || before === after) return;
    const path = pathOfItem(sectionKey, beforeItem, original, entryIndex);
    rows.push({
      path,
      label: labels.item(sectionKey, beforeItem),
      before,
      after,
      tokens: displayTokens(before, after),
      blocked:
        isLockedItem(sectionKey, beforeItem) ||
        blockedMatches(blocked, sectionKey, entryIndex, beforeItem),
    });
  };

  for (const item of original.header.items) {
    push("header", 0, item, candidate.header.items.find((entry) => entry.id === item.id) ?? null);
  }
  for (const section of original.sections) {
    const candidateSection = candidate.sections.find((entry) => entry.key === section.key) ?? null;
    section.entries.forEach((entry, entryIndex) => {
      const candidateEntry =
        candidateSection?.entries.find((candidateItem) => candidateItem.id === entry.id) ??
        candidateSection?.entries[entryIndex] ??
        null;
      entry.items.forEach((item, itemIndex) => {
        push(section.key, entryIndex, item, counterpartItem(candidateEntry, item, itemIndex));
      });
    });
  }
  return rows;
}

/** 逐项采纳的请求体：只带勾选路径的译文。 */
export function adoptItems(
  candidates: readonly TranslationCandidate[],
  paths: readonly string[],
): { path: string; text: string }[] {
  const wanted = new Set(paths);
  return candidates
    .filter((candidate) => wanted.has(candidate.path))
    .map((candidate) => ({ path: candidate.path, text: candidate.after }));
}

/** 撤销采纳：用采纳前的旧文本再采纳一次（同一条变体、只改列出的路径）。 */
export function undoItems(
  candidates: readonly TranslationCandidate[],
  appliedPaths: readonly string[],
): { path: string; text: string }[] {
  const applied = new Set(appliedPaths);
  return candidates
    .filter((candidate) => applied.has(candidate.path) && candidate.before.trim() !== "")
    .map((candidate) => ({ path: candidate.path, text: candidate.before }));
}

/** 单行文本的展示用 token：整段替换（不另写词级 diff，避免第二套高亮口径）。 */
export function displayTokens(before: string, after: string): TranslationCandidate["tokens"] {
  if (!before) return [{ type: "added", text: after }];
  if (!after || before === after) return [{ type: "unchanged", text: before || after }];
  return [
    { type: "removed", text: before },
    { type: "added", text: after },
  ];
}
