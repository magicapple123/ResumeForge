// SPDX-License-Identifier: Apache-2.0
/**
 * W09「内容精简」候选的**纯规则层**（P1-04：内容精简需要差异候选，不能自动删）。
 *
 * ## 为什么不在后端算
 *
 * 三个候选都只依赖**当前内容本身**：重复条目、同一条目里的重复要点、连续的短要点。
 * 做成纯函数就能在 jsdom 之外单测；候选项只描述"删/并哪几条"，写回由宿主走统一历史
 * （一次采纳 = 一步撤销）。
 *
 * ## 边界
 *
 * - **只产出候选，不改入参**：每个候选自带一份新 `content`；用户采纳才写回。
 * - **"低相关"不猜**：判断要点与岗位的相关性需要后端数据。后端把
 *   `content_hints.low_relevance` 挂在 `/layout/analyze` 上（可选字段）；缺省时本模块
 *   不生成这类候选（fail-soft，绝不按关键词自己猜）。
 * - **测量可表达时才给 `measureCss`**：删条目/删要点可以用 `display:none` 在预览里
 *   真实量一次；"合并短要点"无法用 CSS 表达合并，标 null，界面如实说"应用后重新诊断"。
 * - **身份/要点对齐**：删/并要点时 `point_ids` 同步维护，否则保存会被 W01 校验 422。
 */
import type { ResumeContent } from "../../types/resume";
import { ENTRY_POINT_FIELDS, type EntryField } from "../resume-document/types";
import { isObjectId } from "../resume-document/identity";
import { entriesOf, entryIdOf, pointFieldsFor, pointIdsOf } from "../resume-outline/model";
import type {
  ContentCandidateItem,
  ContentCandidateStats,
  OptimizerContentCandidate,
  OptimizerContentHint,
} from "./types";

export const MAX_CONTENT_CANDIDATES = 3;
/** 短要点的字符上限（按字符数，规则简单可解释）。 */
export const SHORT_POINT_MAX_CHARS = 24;
/** 候选卡片里最多列出几条被改动对象（其余用"等 N 条"折叠）。 */
export const MAX_LISTED_ITEMS = 6;

type RawEntry = Record<string, unknown>;

const ENTRY_FIELDS = Object.keys(ENTRY_POINT_FIELDS) as EntryField[];

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

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function titleOf(entry: RawEntry, field: EntryField): string {
  return asText(entry[TITLE_FIELD[field]]).trim();
}

function metaOf(entry: RawEntry): string {
  return META_FIELDS.map((key) => asText(entry[key]).trim())
    .filter(Boolean)
    .join(" | ");
}

function withEntries(
  content: ResumeContent,
  field: EntryField,
  entries: RawEntry[],
): ResumeContent {
  return { ...content, [field]: entries } as unknown as ResumeContent;
}

/** 按 id 删条目；没有合法 id 的条目不动（无法可靠定位就不猜）。 */
function removeEntriesById(
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
function withPointField(
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

function emptyStats(): ContentCandidateStats {
  return { entriesRemoved: 0, pointsRemoved: 0, pointsMerged: 0, charsSaved: 0, visibleRemoved: 0 };
}

function candidateItems(items: ContentCandidateItem[]): ContentCandidateItem[] {
  return items.slice(0, MAX_LISTED_ITEMS);
}

/** 候选 ①：同板块里标题 + 元信息完全相同的条目（保留第一条，删后面的副本）。 */
function duplicateEntriesCandidate(content: ResumeContent): OptimizerContentCandidate | null {
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
function duplicatePointsCandidate(content: ResumeContent): OptimizerContentCandidate | null {
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

/** 候选 ③：同一条目里连续的短要点并成一行（文字都保留，只换分隔符）。 */
function mergeShortPointsCandidate(content: ResumeContent): OptimizerContentCandidate | null {
  const items: ContentCandidateItem[] = [];
  const stats = emptyStats();
  const updates = new Map<EntryField, Map<string, RawEntry>>();
  for (const field of ENTRY_FIELDS) {
    for (const entry of entriesOf(content, field)) {
      const objectId = entryIdOf(entry);
      if (!isObjectId(objectId)) continue;
      for (const pointField of pointFieldsFor(field)) {
        const base = updates.get(field)?.get(objectId) ?? entry;
        const values = Array.isArray(base[pointField]) ? (base[pointField] as unknown[]) : [];
        if (values.length < 2) continue;
        const ids = pointIdsOf(base, pointField);
        if (ids.length > 0 && ids.length !== values.length) continue;
        const nextValues: unknown[] = [];
        const keepIndexes: number[] = [];
        let run: number[] = [];
        let changed = false;
        const flushRun = () => {
          if (run.length < 2) {
            for (const index of run) {
              nextValues.push(values[index]);
              keepIndexes.push(index);
            }
            run = [];
            return;
          }
          nextValues.push(run.map((index) => asText(values[index]).trim()).join("\uFF1B"));
          keepIndexes.push(run[0]);
          changed = true;
          stats.pointsMerged += 1;
          stats.pointsRemoved += run.length - 1;
          items.push({
            field,
            objectId,
            label: titleOf(base, field) || asText(values[run[0]]).slice(0, 24),
            pointField,
            pointIndex: run[0],
          });
          run = [];
        };
        values.forEach((value, index) => {
          const text = asText(value).trim();
          if (text && text.length <= SHORT_POINT_MAX_CHARS) {
            run.push(index);
            return;
          }
          flushRun();
          nextValues.push(value);
          keepIndexes.push(index);
        });
        flushRun();
        if (!changed) continue;
        const nextEntry = withPointField(base, pointField, nextValues, keepIndexes);
        const byEntry = updates.get(field) ?? new Map<string, RawEntry>();
        byEntry.set(objectId, nextEntry);
        updates.set(field, byEntry);
      }
    }
  }
  if (stats.pointsMerged === 0) return null;
  let next = content;
  for (const [field, byEntry] of updates) {
    next = withEntries(
      next,
      field,
      entriesOf(next, field).map((entry) => byEntry.get(entryIdOf(entry)) ?? entry),
    );
  }
  return {
    key: "content:merge-short-points",
    kind: "merge-short-points",
    content: next,
    stats,
    items: candidateItems(items),
    itemCount: items.length,
    // 合并无法用 CSS 表达；界面必须说"应用后重新诊断"。
    measureCss: null,
  };
}

/** 候选 ④：后端 `content_hints.low_relevance` 指出的要点/条目（字段缺省时不生成）。 */
function lowRelevanceCandidate(
  content: ResumeContent,
  hints: readonly OptimizerContentHint[],
): OptimizerContentCandidate | null {
  const items: ContentCandidateItem[] = [];
  const removePoints = new Map<EntryField, Map<string, Set<string>>>();
  const removeWhole = new Map<EntryField, Set<string>>();
  const removedPaths: string[] = [];
  const removedObjects: string[] = [];
  const stats = emptyStats();
  for (const hint of hints) {
    if (hint.kind !== "low_relevance") continue;
    const field = hint.section as EntryField;
    if (!(field in ENTRY_POINT_FIELDS) || !isObjectId(hint.object_id)) continue;
    const rawEntries = entriesOf(content, field);
    const entryIndex = rawEntries.findIndex((entry) => entryIdOf(entry) === hint.object_id);
    if (entryIndex < 0) continue;
    const entry = rawEntries[entryIndex];
    if (!hint.point_field || !hint.point_id) {
      if (removeWhole.get(field)?.has(hint.object_id)) continue;
      const set = removeWhole.get(field) ?? new Set<string>();
      set.add(hint.object_id);
      removeWhole.set(field, set);
      removedObjects.push(hint.object_id);
      stats.entriesRemoved += 1;
      items.push({ field, objectId: hint.object_id, label: titleOf(entry, field) });
      continue;
    }
    const pointValues = Array.isArray(entry[hint.point_field])
      ? (entry[hint.point_field] as unknown[])
      : [];
    const pointIndex = pointIdsOf(entry, hint.point_field).indexOf(hint.point_id);
    if (pointIndex < 0 || pointIndex >= pointValues.length) continue;
    const byEntry = removePoints.get(field) ?? new Map<string, Set<string>>();
    const set = byEntry.get(hint.object_id) ?? new Set<string>();
    if (set.has(hint.point_id)) continue;
    set.add(hint.point_id);
    byEntry.set(hint.object_id, set);
    removePoints.set(field, byEntry);
    removedPaths.push(`${field}.${entryIndex}.${hint.point_field}.${pointIndex}`);
    stats.pointsRemoved += 1;
    items.push({
      field,
      objectId: hint.object_id,
      label: titleOf(entry, field) || asText(pointValues[pointIndex]).slice(0, 24),
      pointField: hint.point_field,
      pointIndex,
    });
  }
  if (stats.pointsRemoved === 0 && stats.entriesRemoved === 0) return null;
  let next = content;
  for (const [field, ids] of removeWhole) next = removeEntriesById(next, field, ids);
  for (const [field, byEntry] of removePoints) {
    next = withEntries(
      next,
      field,
      entriesOf(next, field).map((entry) => {
        const objectId = entryIdOf(entry);
        const ids = byEntry.get(objectId);
        if (!ids) return entry;
        for (const pointField of pointFieldsFor(field)) {
          const values = Array.isArray(entry[pointField]) ? (entry[pointField] as unknown[]) : [];
          const pointIds = pointIdsOf(entry, pointField);
          if (values.length === 0 || pointIds.length !== values.length) continue;
          const keepIndexes = pointIds
            .map((_, index) => index)
            .filter((index) => !ids.has(pointIds[index]));
          if (keepIndexes.length === values.length) continue;
          return withPointField(
            entry,
            pointField,
            keepIndexes.map((index) => values[index]),
            keepIndexes,
          );
        }
        return entry;
      }),
    );
  }
  return {
    key: "content:low-relevance",
    kind: "low-relevance-points",
    content: next,
    stats,
    items: candidateItems(items),
    itemCount: items.length,
    measureCss: [
      ...removedObjects.map((id) => `[data-object-id="${id}"]{display:none !important;}`),
      ...removedPaths.map((path) => `[data-resume-path="${path}"]{display:none !important;}`),
    ].join("\n"),
  };
}

/**
 * 生成内容精简候选（最多 3 个）。顺序 = 用户价值：岗位低相关 > 重复条目 > 重复要点 >
 * 合并短要点；后端 hints 缺省时自动跳过第一类（fail-soft）。
 *
 * 每个候选都从**原始内容**出发（互不叠加）：应用其中一个后重新生成，再看到剩余候选。
 */
export function buildContentCandidates(
  content: ResumeContent | null | undefined,
  hints: readonly OptimizerContentHint[] = [],
): OptimizerContentCandidate[] {
  if (!content) return [];
  return [
    lowRelevanceCandidate(content, hints),
    duplicateEntriesCandidate(content),
    duplicatePointsCandidate(content),
    mergeShortPointsCandidate(content),
  ]
    .filter((candidate): candidate is OptimizerContentCandidate => candidate !== null)
    .slice(0, MAX_CONTENT_CANDIDATES);
}
