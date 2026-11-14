// SPDX-License-Identifier: Apache-2.0
/**
 * Shared pure-rule helpers and the duplicate candidates (entries / points) for the
 * content-slimming candidates. Split out of `./contentCandidates.ts` to keep both
 * files under the line budget; pure move, no behaviour change.
 */
import type { ResumeContent } from "../../../types/resume";
import { ENTRY_POINT_FIELDS, type EntryField } from "../document/types";
import { isObjectId } from "../document/identity";
import { entriesOf, entryIdOf, pointFieldsFor, pointIdsOf } from "../outline/model";
import type {
  ContentCandidateItem,
  ContentCandidateStats,
  OptimizerContentCandidate,
} from "./types";

/** 候选卡片里最多列出几条被改动对象（其余用"等 N 条"折叠）。 */
export const MAX_LISTED_ITEMS = 6;
export type RawEntry = Record<string, unknown>;

export const ENTRY_FIELDS = Object.keys(ENTRY_POINT_FIELDS) as EntryField[];

const TITLE_FIELD: Record<EntryField, string> = {
  education: "school",
  experience: "company",
  campus_experience: "organization",
  projects: "name",
  skills: "name",
  awards: "name",
};

/** 判重用的元信息字段（与 duplicateEntries 的口径同型：标题 + 时间/角色）。 */
const META_FIELDS = ["start_date", "end_date", "date", "role", "major", "degree", "level"];

export function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function titleOf(entry: RawEntry, field: EntryField): string {
  return asText(entry[TITLE_FIELD[field]]).trim();
}

function metaOf(entry: RawEntry): string {
  return META_FIELDS.map((key) => asText(entry[key]).trim())
    .filter(Boolean)
    .join(" | ");
}

export function withEntries(
  content: ResumeContent,
  field: EntryField,
  entries: RawEntry[],
): ResumeContent {
  return { ...content, [field]: entries } as unknown as ResumeContent;
}

/** 按 id 删条目；没有合法 id 的条目不动（无法可靠定位就不猜）。 */
export function removeEntriesById(
  content: ResumeContent,
  field: EntryField,
  drop: ReadonlySet<string>,
): ResumeContent {
  return withEntries(
    content,
    field,
    entriesOf(content, field).filter((entry) => !drop.has(entryIdOf(entry))),
  );
}

function hiddenOf(entry: RawEntry): boolean {
  return entry.hidden === true;
}

/** 写回一个要点字段，并同步 `point_ids`（长度必须与文本数组等长，W01 校验）。 */
export function withPointField(
  entry: RawEntry,
  pointField: string,
  values: unknown[],
  keepIndexes: number[],
): RawEntry {
  const next: RawEntry = { ...entry, [pointField]: values };
  const ids = pointIdsOf(entry, pointField);
  if (ids.length > 0) {
    const keptIds = keepIndexes.map((index) => ids[index]).filter(isObjectId);
    const source = (entry.point_ids as Record<string, unknown> | undefined) ?? {};
    next.point_ids = { ...source, [pointField]: keptIds };
  }
  return next;
}

export function emptyStats(): ContentCandidateStats {
  return { entriesRemoved: 0, pointsRemoved: 0, pointsMerged: 0, charsSaved: 0, visibleRemoved: 0 };
}

export function candidateItems(items: ContentCandidateItem[]): ContentCandidateItem[] {
  return items.slice(0, MAX_LISTED_ITEMS);
}

/** 候选 ①：同板块里标题 + 元信息完全相同的条目（保留第一条，删后面的副本）。 */
export function duplicateEntriesCandidate(
  content: ResumeContent,
): OptimizerContentCandidate | null {
  const groups = new Map<
    string,
    { field: EntryField; ids: string[]; labels: string[]; raw: RawEntry[] }
  >();
  for (const field of ENTRY_FIELDS) {
    for (const entry of entriesOf(content, field)) {
      const id = entryIdOf(entry);
      const title = normalize(titleOf(entry, field));
      if (!isObjectId(id) || !title) continue;
      const key = `${field}\u0000${title}\u0000${normalize(metaOf(entry))}`;
      const group = groups.get(key) ?? { field, ids: [], labels: [], raw: [] };
      group.ids.push(id);
      group.labels.push(titleOf(entry, field));
      group.raw.push(entry);
      groups.set(key, group);
    }
  }
  const drop = new Map<EntryField, Set<string>>();
  const items: ContentCandidateItem[] = [];
  const stats = emptyStats();
  for (const group of groups.values()) {
    if (group.ids.length < 2) continue;
    for (let index = 1; index < group.ids.length; index += 1) {
      const objectId = group.ids[index];
      const set = drop.get(group.field) ?? new Set<string>();
      set.add(objectId);
      drop.set(group.field, set);
      items.push({ field: group.field, objectId, label: group.labels[index] || group.labels[0] });
      stats.entriesRemoved += 1;
      stats.charsSaved += JSON.stringify(group.raw[index] ?? {}).length;
      if (!hiddenOf(group.raw[index])) stats.visibleRemoved += 1;
    }
  }
  if (items.length === 0) return null;
  let next = content;
  for (const [field, ids] of drop) next = removeEntriesById(next, field, ids);
  return {
    key: "content:duplicate-entries",
    kind: "duplicate-entries",
    content: next,
    stats,
    items: candidateItems(items),
    itemCount: items.length,
    measureCss: items
      .map((item) => `[data-object-id="${item.objectId}"]{display:none !important;}`)
      .join("\n"),
  };
}

/** 候选 ②：同一条目里文本完全相同的要点（保留第一条）。 */
export function duplicatePointsCandidate(content: ResumeContent): OptimizerContentCandidate | null {
  const items: ContentCandidateItem[] = [];
  const removedPaths: string[] = [];
  const stats = emptyStats();
  /** field → objectId → 已改过的 entry（同一条目多个要点字段要基于已改版本继续改）。 */
  const updates = new Map<EntryField, Map<string, RawEntry>>();
  for (const field of ENTRY_FIELDS) {
    const rawEntries = entriesOf(content, field);
    for (let entryIndex = 0; entryIndex < rawEntries.length; entryIndex += 1) {
      const objectId = entryIdOf(rawEntries[entryIndex]);
      if (!isObjectId(objectId)) continue;
      for (const pointField of pointFieldsFor(field)) {
        const base = updates.get(field)?.get(objectId) ?? rawEntries[entryIndex];
        const values = Array.isArray(base[pointField]) ? (base[pointField] as unknown[]) : [];
        if (values.length < 2) continue;
        const ids = pointIdsOf(base, pointField);
        // 要点身份不完整时只按文本去重；有 id 则必须逐位对齐才能可靠删。
        if (ids.length > 0 && ids.length !== values.length) continue;
        const seen = new Set<string>();
        const keepIndexes: number[] = [];
        values.forEach((value, index) => {
          const text = normalize(asText(value));
          if (!text) return;
          if (!seen.has(text)) {
            seen.add(text);
            keepIndexes.push(index);
            return;
          }
          removedPaths.push(`${field}.${entryIndex}.${pointField}.${index}`);
          stats.pointsRemoved += 1;
          stats.charsSaved += asText(value).length;
          items.push({
            field,
            objectId,
            label: titleOf(base, field) || asText(value).slice(0, 24),
            pointField,
            pointIndex: index,
          });
        });
        if (keepIndexes.length === values.length) continue;
        const nextEntry = withPointField(
          base,
          pointField,
          keepIndexes.map((index) => values[index]),
          keepIndexes,
        );
        const byEntry = updates.get(field) ?? new Map<string, RawEntry>();
        byEntry.set(objectId, nextEntry);
        updates.set(field, byEntry);
      }
    }
  }
  if (stats.pointsRemoved === 0) return null;
  let next = content;
  for (const [field, byEntry] of updates) {
    next = withEntries(
      next,
      field,
      entriesOf(next, field).map((entry) => byEntry.get(entryIdOf(entry)) ?? entry),
    );
  }
  return {
    key: "content:duplicate-points",
    kind: "duplicate-points",
    content: next,
    stats,
    items: candidateItems(items),
    itemCount: items.length,
    measureCss: removedPaths
      .map((path) => `[data-resume-path="${path}"]{display:none !important;}`)
      .join("\n"),
  };
}
