// SPDX-License-Identifier: Apache-2.0
/**
 * 服务端投影（`GET /api/profile/current/projection`）的 **v2 解析与合并**（纯函数，唯一实现）。
 *
 * ## 为什么需要它
 *
 * 投影的 `content` 自 v2 批次起是 **`ResumeDocument`**（sections/entries/items，item 自带
 * `source {section_key, field_id}`），候选直接带原生路径与条目。本文件负责：
 * - 候选 → v2 板块/条目（按 path 精确取，不按标题猜）；
 * - 合并进当前文档 = 只填空/补缺失（复用 `mergeProfileItems`），按 `source` 去重；
 *
 * 全部纯函数、不可变；「从资料填入」只有这一份解析/合并实现（ProfileFillMenu 与
 * profileFillOptions 的旧 v1 适配都从这里取）。
 */
import type {
  ResumeDocument,
  ResumeEntry,
  ResumeItem,
  ResumeSection,
} from "../../types/resumeDocument";
import { newId } from "../resume-document/normalize";
import { mergeProfileItems } from "../resume-document/convertFromProfile";
import type { PaperProjectionOut, ProjectionCandidateOut } from "./types";

/** 投影「消费分区键」（v1 资料层）→ v2 文档板块 key。 */
export const PROJECTION_SECTION_MAP: Record<string, string> = {
  education: "education",
  experience: "experience",
  campus_experience: "campus_experience",
  projects: "projects",
  skills: "skills",
  awards: "awards",
  publications: "publications",
  research_projects: "research_projects",
  patents: "patents",
  credentials: "credentials",
  languages: "languages",
};

/** 内容是不是 v2 文档（投影端点已切 v2；旧夹具/旧后端仍可能是 v1）。 */
export function isV2ProjectionContent(content: unknown): content is ResumeDocument {
  return (
    content !== null &&
    typeof content === "object" &&
    (content as { version?: unknown }).version === 2 &&
    Array.isArray((content as { sections?: unknown }).sections)
  );
}

/** 投影的 v2 文档；不是 v2（旧夹具/旧后端）返回 null。 */
export function projectionDocument(
  projection: PaperProjectionOut | null | undefined,
): ResumeDocument | null {
  const content = projection?.content;
  return isV2ProjectionContent(content) ? content : null;
}

/** 一个已解析的候选：v2 板块/条目 + 它对应的当前文档板块 key。 */
export interface ResolvedProjectionCandidate {
  candidate: ProjectionCandidateOut;
  /** v2 文档里的板块 key（系统板块 = education…；自建板块 = custom:<id>）。 */
  sectionKey: string;
  section: ResumeSection;
  entry: ResumeEntry;
  /** 该条目的 v2 items（原引用；合并时会按需克隆/改写）。 */
  items: ResumeItem[];
}

/** 拆 v2 路径：`{section}.{entryId}` / `{section}.{entryId}.{itemId}`。 */
function parseV2Path(
  path: string,
): { sectionKey: string; entryId: string; itemId: string | null } | null {
  const parts = path.split(".");
  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.some((part) => part.length === 0)) return null;
  return { sectionKey: parts[0], entryId: parts[1], itemId: parts[2] ?? null };
}

/**
 * 候选 → v2 板块/条目。
 *
 * 解析顺序（backend-api v2 契约，2026-10-30）：
 * 1. **`candidate.document_entry`**：后端把该条目在 `projection.content` 里的**原样 v2 JSON**
 *    直接下发，拿它即可（不再解析路径；这是新代码的唯一推荐路径）；
 * 2. `candidate.document_path`（v2 路径 `{section}.{v2_entry_id}`）→ 在 content 里定位；
 *
 * 解析不到（空 section / 越界 / 自建板块被删）返回 null；菜单只列能真正填入的候选，
 * 不做点击无反应的死项。
 */
export function resolveProjectionCandidate(
  projection: PaperProjectionOut | null | undefined,
  candidate: ProjectionCandidateOut,
): ResolvedProjectionCandidate | null {
  const document = projectionDocument(projection);
  if (!document) return null;
  const path = candidate.document_path || "";
  const v2 = path.includes(".") ? parseV2Path(path) : null;
  const documentEntry = candidate.document_entry;
  if (documentEntry) {
    // 新契约：entry JSON 原样下发。板块优先按 document_path 定位，缺失时退回 section_key 映射，
    // 再不行按 entry id 全文档找（防御旧后端/夹具）。
    const mappedKey = PROJECTION_SECTION_MAP[candidate.section_key] ?? "";
    const sectionKey = v2?.sectionKey || mappedKey;
    const section =
      document.sections.find((item) => item.key === sectionKey) ??
      document.sections.find((item) => item.entries.some((entry) => entry.id === documentEntry.id));
    if (!section) return null;
    const entry =
      section.entries.find((item) => item.id === documentEntry.id) ??
      (documentEntry as ResumeEntry);
    return { candidate, sectionKey: section.key, section, entry, items: entry.items };
  }
  if (!v2) return null;
  const sectionKey = v2.sectionKey;
  const section = document.sections.find((item) => item.key === v2.sectionKey);
  const entry = section?.entries.find((item) => item.id === v2.entryId);
  if (!section || !entry) return null;
  return { candidate, sectionKey, section, entry, items: entry.items };
}

/** 候选里能解析到 v2 条目的那些（菜单只列能真正填入的）。 */
export function resolvableProjectionCandidates(
  projection: PaperProjectionOut | null | undefined,
): ResolvedProjectionCandidate[] {
  const result: ResolvedProjectionCandidate[] = [];
  for (const candidate of projection?.candidates ?? []) {
    const resolved = resolveProjectionCandidate(projection, candidate);
    if (resolved) result.push(resolved);
  }
  return result;
}

/** item 的资料来源键（`section_key.field_id`）；text item 没有 source → null。 */
export function itemSourceKey(item: ResumeItem): string | null {
  // 只有 FieldItem 带 source（后端 schema：list / authors / text 没有来源字段）。
  if (item.kind !== "field") return null;
  const source = item.source;
  if (!source || !source.section_key || !source.field_id) return null;
  return `${source.section_key}.${source.field_id}`;
}

/** 深拷贝并换新 id（把投影条目搬进当前文档时避免 id 冲突）。 */
function cloneItemsWithNewIds(items: readonly ResumeItem[]): ResumeItem[] {
  return items.map((item) => JSON.parse(JSON.stringify({ ...item, id: newId() })) as ResumeItem);
}

function cloneEntryWithNewIds(entry: ResumeEntry): ResumeEntry {
  return {
    ...JSON.parse(JSON.stringify(entry)),
    id: newId(),
    items: cloneItemsWithNewIds(entry.items),
  } as ResumeEntry;
}

/** 按 key 找板块；找不到时用源板块的骨架补一个空板块（自建板块/可选板块首次填入）。 */
function ensureSection(document: ResumeDocument, source: ResumeSection): ResumeDocument {
  if (document.sections.some((section) => section.key === source.key)) return document;
  return {
    ...document,
    sections: [
      ...document.sections,
      {
        key: source.key,
        title: source.title,
        kind: source.kind,
        layout: JSON.parse(JSON.stringify(source.layout)),
        entries: [],
      } as ResumeSection,
    ],
  };
}

export interface MergeProjectionCandidateResult {
  document: ResumeDocument;
  /** 实际补入/补空的 item 数量（0 = 没有可填的，宿主据此不写历史）。 */
  filled: number;
  /** 是否补入了「仅素材」字段（hidden + source），宿主据此提示"不上纸面"。 */
  materialOnly: boolean;
}

/**
 * 把一条已解析候选合并进当前文档（**只做加法**）：
 *
 * - 目标板块不存在 → 用源板块骨架补板块，并把整条来源条目作为新条目追加；
 * - 目标板块存在但该条没有条目 → 追加克隆条目；
 * - 否则填充**同一位置的条目**（源条目在来源板块里的下标；越界退回第一条）：
 *   - field/list/authors：同 key 且当前为空 → 用来源值补齐；缺失的 item 按 source 去重后追加；
 *   - text：目标条目还没有文本块时才追加（避免覆盖用户手写正文）；
 * - 全部 item 深拷贝并换新 id，不改来源投影、也不改入参文档。
 */
export function mergeProjectionCandidate(
  document: ResumeDocument,
  resolved: ResolvedProjectionCandidate,
): MergeProjectionCandidateResult {
  const withSection = ensureSection(document, resolved.section);
  const targetSection = withSection.sections.find((section) => section.key === resolved.sectionKey);
  if (!targetSection) return { document, filled: 0, materialOnly: false };

  const incoming = cloneItemsWithNewIds(resolved.items);
  const nonText = incoming.filter((item) => item.kind !== "text");
  const texts = incoming.filter((item) => item.kind === "text");
  const sourceIndex = resolved.section.entries.findIndex((entry) => entry.id === resolved.entry.id);
  const targetEntry = targetSection.entries[Math.max(0, sourceIndex)] ?? targetSection.entries[0];

  if (!targetEntry) {
    const entry = cloneEntryWithNewIds(resolved.entry);
    const sections = withSection.sections.map((section) =>
      section.key === resolved.sectionKey
        ? { ...section, entries: [...section.entries, entry] }
        : section,
    );
    return {
      document: { ...withSection, sections },
      filled: entry.items.length,
      materialOnly: entry.items.some(
        (item) => item.kind === "field" && item.placement === "hidden" && item.source !== null,
      ),
    };
  }

  const existingSources = new Set(
    targetEntry.items.map(itemSourceKey).filter((key): key is string => key !== null),
  );
  const pending = nonText.filter((item) => {
    const key = itemSourceKey(item);
    return key === null || !existingSources.has(key);
  });
  const merged = mergeProfileItems(targetEntry.items, pending);
  const hasText = merged.items.some((item) => item.kind === "text");
  const items = hasText ? merged.items : [...merged.items, ...texts];
  const filled = merged.filled + (hasText ? 0 : texts.length);
  const sections = withSection.sections.map((section) =>
    section.key !== resolved.sectionKey
      ? section
      : {
          ...section,
          entries: section.entries.map((entry) =>
            entry.id === targetEntry.id ? { ...entry, items } : entry,
          ),
        },
  );
  const materialOnly = pending.some(
    (item) => item.kind === "field" && item.placement === "hidden" && item.source !== null,
  );
  return { document: { ...withSection, sections }, filled, materialOnly };
}

/** 一步到位：解析 + 合并；候选解析不到返回 null。 */
export function applyProjectionCandidate(
  document: ResumeDocument,
  projection: PaperProjectionOut | null | undefined,
  candidate: ProjectionCandidateOut,
): MergeProjectionCandidateResult | null {
  const resolved = resolveProjectionCandidate(projection, candidate);
  if (!resolved) return null;
  return mergeProjectionCandidate(document, resolved);
}
