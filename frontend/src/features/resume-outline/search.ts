// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲搜索（D01，W06 面板内）：按姓名/板块/条目/要点文本过滤，并按**树行顺序**给出可
 * 键盘上下选择的命中列表。
 *
 * 为什么单独成纯函数：搜索必须和树用**同一套 id/路径**（否则"搜到条目乙却选中条目甲"
 * 这类串位只在界面上才看得出来），且"匹配 → 过滤后的树"与"当前第几条"是两件事，
 * 分开才能在 jsdom 之外钉住顺序/大小写/空查询。
 *
 * 搜索**不改变任何内容**：它只产出"显示哪些行"，选中/定位仍走 `OutlineSelection`。
 */
import type { ResumeContent } from "../../types/resume";
import { entriesOf, type OutlineModel, type OutlineSection } from "./model";
import type { OutlineSelection } from "./types";

export type OutlineSearchMatchKind = "personal" | "entry" | "point";

/** 一条可键盘上下选择的命中（顺序 = 树里的行顺序）。 */
export interface OutlineSearchMatch {
  kind: OutlineSearchMatchKind;
  /** 命中的原文（用户名/条目标题/要点文本），用于播报与行内高亮。 */
  text: string;
  selection: OutlineSelection;
  /** DOM `data-tree-key`，与树节点同一套键。 */
  treeKey: string;
}

export interface OutlineSearchResult {
  /** 归一化后的查询（空串 = 未搜索）。 */
  query: string;
  /** 键盘上下选择的命中列表（树行顺序）。 */
  matches: OutlineSearchMatch[];
  /** 只保留命中行及其祖先的模型；空查询时是原模型。 */
  model: OutlineModel;
  /** 便于 UI 显示"共 N 条命中"。 */
  matchCount: number;
}

export interface OutlineSearchOptions {
  /** 板块标题的当前语言文案：标题是 i18n key，用户按界面文字搜就必须按文案匹配。 */
  sectionLabel?: (section: OutlineSection) => string;
}

function normalize(query: string): string {
  return (query ?? "").trim().toLowerCase();
}

function hit(text: string, query: string): boolean {
  return query !== "" && text.toLowerCase().includes(query);
}

function personalTexts(content: ResumeContent | null | undefined): string[] {
  if (!content) return [];
  return [
    content.name,
    content.phone,
    content.email,
    content.city,
    content.job_intent,
    content.summary,
  ].filter((value): value is string => typeof value === "string" && value.trim() !== "");
}

function entryTexts(entry: Record<string, unknown>): string[] {
  const texts: string[] = [];
  for (const value of Object.values(entry)) {
    if (typeof value === "string" && value.trim() !== "") texts.push(value);
  }
  return texts;
}

function pointMatchesOf(texts: string[], query: string): number[] {
  const hits: number[] = [];
  texts.forEach((text, index) => {
    if (hit(text, query)) hits.push(index);
  });
  return hits;
}

/** 过滤后的模型（不搜索时原样返回同一个引用，避免无谓重渲染）。 */
export function searchOutline(
  model: OutlineModel,
  content: ResumeContent | null | undefined,
  rawQuery: string,
  options: OutlineSearchOptions = {},
): OutlineSearchResult {
  const query = normalize(rawQuery);
  if (query === "") return { query, matches: [], model, matchCount: 0 };

  const matches: OutlineSearchMatch[] = [];
  const personalMatch = personalTexts(content).some((text) => hit(text, query));
  if (personalMatch) {
    matches.push({
      kind: "personal",
      text: content?.name?.trim() || options.sectionLabel?.(model.sections[0]) || "",
      selection: { kind: "personal" },
      treeKey: "personal",
    });
  }

  const sections = model.sections.map((section) => {
    if (section.field === null) {
      return personalMatch ? section : { ...section, entries: [] };
    }
    const field = section.field;
    const sectionHit = hit(options.sectionLabel?.(section) ?? "", query);
    const entries = entriesOf(content, field);
    const kept = section.entries.map((entry) => {
      const raw = entries[entry.index] ?? {};
      const entryHit =
        hit(entry.title, query) ||
        hit(entry.subtitle, query) ||
        entryTexts(raw).some((text) => hit(text, query));
      const pointHits = new Set(
        pointMatchesOf(
          entry.points.map((point) => point.text),
          query,
        ),
      );
      const pointMatched = pointHits.size > 0;
      if (!sectionHit && !entryHit && !pointMatched) return null;
      if (entryHit) {
        matches.push({
          kind: "entry",
          text: entry.title || entry.subtitle,
          selection: { kind: "entry", field, objectId: entry.objectId },
          treeKey: `entry:${field}:${entry.objectId}`,
        });
      }
      const points = entry.points.filter((_point, index) => {
        if (!pointMatched || entryHit) return true;
        return pointHits.has(index);
      });
      if (pointMatched && !entryHit) {
        for (const point of points) {
          matches.push({
            kind: "point",
            text: point.text,
            selection: {
              kind: "point",
              field,
              objectId: entry.objectId,
              pointField: point.pointField,
              pointId: point.pointId,
            },
            treeKey: `point:${field}:${entry.objectId}:${point.pointField}:${point.pointId}`,
          });
        }
      }
      return { ...entry, points };
    });
    const filtered = kept.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    if (filtered.length === 0 && !sectionHit) return null;
    return { ...section, entries: sectionHit ? section.entries : filtered };
  });

  const nextSections = sections.filter((section): section is OutlineSection => section !== null);
  const nextModel: OutlineModel = {
    sections: nextSections,
    entryCount: nextSections.reduce((sum, section) => sum + section.entries.length, 0),
    pointCount: nextSections.reduce(
      (sum, section) =>
        sum + section.entries.reduce((inner, entry) => inner + entry.points.length, 0),
      0,
    ),
  };
  return { query, matches, model: nextModel, matchCount: matches.length };
}

/** 命中列表里的下/上一个下标（循环；空列表返回 -1）。 */
export function nextMatchIndex(current: number, delta: number, total: number): number {
  if (total <= 0) return -1;
  const base = current < 0 ? (delta > 0 ? -1 : 0) : current;
  return (((base + delta) % total) + total) % total;
}

/** 文本高亮切分：大小写不敏感，连续命中合并；未命中返回单段。 */
export interface HighlightSegment {
  text: string;
  hit: boolean;
}

export function splitHighlight(text: string, rawQuery: string): HighlightSegment[] {
  const query = normalize(rawQuery);
  if (query === "" || text === "") return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const found = lower.indexOf(query, cursor);
    if (found < 0) {
      segments.push({ text: text.slice(cursor), hit: false });
      break;
    }
    if (found > cursor) segments.push({ text: text.slice(cursor, found), hit: false });
    segments.push({ text: text.slice(found, found + query.length), hit: true });
    cursor = found + query.length;
  }
  return segments.length > 0 ? segments : [{ text, hit: false }];
}

/** 命中数文案用不到的字符串常量（渲染层用 i18n 组装，这里只留纯数据）。 */
export function matchTreeKeys(result: OutlineSearchResult): string[] {
  return result.matches.map((match) => match.treeKey);
}
