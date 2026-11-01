// SPDX-License-Identifier: Apache-2.0
/**
 * 一步历史改动 → 一句人能读懂的摘要（R-17）。
 *
 * 输入是**相邻两个快照**：`before` = 这一步之前，`after` = 这一步之后（正文 + 版式）。
 * 输出只保留**一条最能说明问题**的变更，外加"还有几项"的计数；按下面的优先级取：
 *
 * | 优先级 | 类别 | 例子 |
 * | --- | --- | --- |
 * | 1 | 板块 增/删/排序 | 新增板块「项目经历」 |
 * | 2 | 条目 增/删/排序 | 「工作经历」新增条目「字节跳动」 |
 * | 3 | 条目 隐藏/显示 | 「教育经历」隐藏条目「高中」 |
 * | 4 | 条目排版（head/columns/分页） | 「项目经历」调整条目「简历通」的排版 |
 * | 5 | 字段 增/删/移动 | 「工作经历」新增字段「团队规模」 |
 * | 6 | 字段值（聚合成"正文 N 处修改"） | 「工作经历 · 字节跳动」修改「职位」 |
 * | 7 | 版式参数（页数/字号/模板/format_config） | 页数上限改为 2 页 |
 * | 8 | 什么都识别不出 | 回退到调用方给的旧摘要 |
 *
 * 为什么只取一条：历史面板每行只有一行宽度，列三行会把"哪一步"挤没；
 * 其余改动用「等 N 项」带过，需要细节时点那一步看预览。
 *
 * 性能：一次遍历建 id → 位置 的 Map，50 步 × 190 字段也不会退化成 O(n²)。
 * `format_config` 用**按键排序**后的稳定序列化比较——键序不同不算改动。
 */
import type { ResumeDocument, ResumeEntry, ResumeItem } from "../../types/resumeDocument";
import type { ResumeLayout } from "../../types";
import { t } from "../../i18n";
import { sectionDisplayLabel } from "../../components/resume/sectionLabels";

/** 历史快照的形状（与 `useWorkbenchV2History` 的 WorkbenchV2Snapshot 同构）。 */
export interface ChangeSnapshot {
  document: ResumeDocument;
  layout: ResumeLayout;
}

export type ChangeSummary =
  | { kind: "section-add"; section: string; count: number }
  | { kind: "section-remove"; section: string; count: number }
  | { kind: "section-move"; section: string; index: number }
  | { kind: "entry-add"; section: string; entry: string; count: number }
  | { kind: "entry-remove"; section: string; entry: string; count: number }
  | { kind: "entry-move"; section: string; entry: string; index: number }
  | { kind: "entry-hide"; section: string; entry: string }
  | { kind: "entry-show"; section: string; entry: string }
  | { kind: "entry-layout"; section: string; entry: string }
  | { kind: "field-add"; section: string; entry: string; field: string; count: number }
  | { kind: "field-remove"; section: string; entry: string; field: string; count: number }
  | { kind: "field-move"; section: string; entry: string; field: string; index: number }
  | { kind: "value"; section: string; entry: string; field: string; count: number }
  | { kind: "layout-pages"; pages: number }
  | { kind: "layout-font"; scale: string }
  | { kind: "layout-template"; name: string }
  | { kind: "layout-format"; count: number };

export interface ChangeReport {
  main: ChangeSummary;
  /** 除主变更外还有几项（界面加「等 N 项」）。 */
  others: number;
}

const MAX_NAME = 24;

function clip(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.length > MAX_NAME ? `${trimmed.slice(0, MAX_NAME)}…` : trimmed;
}

function valueOf(item: ResumeItem): string {
  switch (item.kind) {
    case "field":
      return item.value;
    case "list":
      return item.values.join(" / ");
    case "authors":
      return item.authors.map((author) => author.name).join(", ");
    case "text":
      return item.text;
  }
}

function labelOf(item: ResumeItem): string {
  if (item.kind === "text") return clip(item.text);
  return clip(item.label) || clip(valueOf(item));
}

/** 条目的展示名：优先标题位置的字段值，其次第一个有内容的字段。 */
function entryName(entry: ResumeEntry): string {
  const title = entry.items.find((item) => item.kind === "field" && item.placement === "title");
  if (title) {
    const text = clip(valueOf(title));
    if (text) return text;
  }
  for (const item of entry.items) {
    const text = clip(valueOf(item));
    if (text) return text;
  }
  return t("workbench.history.change.untitledEntry");
}

/**
 * 板块显示名：系统板块（education / experience…）在文档里的 `title` 是空串，
 * 直接读它会得到一片「未命名板块」。与结构树/变体同步共用同一个映射入口。
 */
function sectionName(section: {
  key: string;
  title: string;
  layout?: { title_override?: string };
}): string {
  return clip(sectionDisplayLabel(section)) || t("workbench.history.change.untitledSection");
}

/** 稳定序列化：对象键排序后比较（`format_config` 的键序不该算改动）。 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

interface Slot<T> {
  value: T;
  index: number;
}

function indexBy<T>(
  list: readonly T[],
  keyOf: (value: T, index: number) => string,
): Map<string, Slot<T>> {
  const map = new Map<string, Slot<T>>();
  list.forEach((value, index) => map.set(keyOf(value, index), { value, index }));
  return map;
}

function collectSectionChanges(
  before: ResumeDocument,
  after: ResumeDocument,
  changes: ChangeSummary[],
): void {
  const beforeSections = indexBy(before.sections, (section) => section.key);
  const afterSections = indexBy(after.sections, (section) => section.key);
  const added = after.sections.filter((section) => !beforeSections.has(section.key));
  const removed = before.sections.filter((section) => !afterSections.has(section.key));
  if (added.length > 0) {
    changes.push({ kind: "section-add", section: sectionName(added[0]), count: added.length });
    return;
  }
  if (removed.length > 0) {
    changes.push({
      kind: "section-remove",
      section: sectionName(removed[0]),
      count: removed.length,
    });
    return;
  }
  const moved = after.sections.find(
    (section, index) => beforeSections.get(section.key)?.index !== index,
  );
  if (moved) {
    changes.push({
      kind: "section-move",
      section: sectionName(moved),
      index: (after.sections.findIndex((section) => section.key === moved.key) ?? 0) + 1,
    });
  }
}

function collectEntryChanges(
  before: ResumeDocument,
  after: ResumeDocument,
  changes: ChangeSummary[],
): void {
  const key = (entry: ResumeEntry, index: number) => entry.id ?? `#${index}`;
  const beforeSections = indexBy(before.sections, (section) => section.key);
  // 每个共有板块各查一遍；命中的第一条就是这一步的主变更（按优先级分轮扫描）。
  const views: {
    section: string;
    before: Map<string, Slot<ResumeEntry>>;
    beforeEntries: ResumeEntry[];
    after: ResumeEntry[];
  }[] = [];
  for (const section of after.sections) {
    const previousSection = beforeSections.get(section.key)?.value;
    if (!previousSection) continue;
    views.push({
      section: sectionName(section),
      before: indexBy(previousSection.entries, (entry, index) => entry.id ?? `#${index}`),
      beforeEntries: previousSection.entries,
      after: section.entries,
    });
  }

  // 1) 条目增/删
  for (const view of views) {
    const added = view.after.filter((entry, index) => !view.before.has(key(entry, index)));
    if (added.length > 0) {
      changes.push({
        kind: "entry-add",
        section: view.section,
        entry: entryName(added[0]),
        count: added.length,
      });
      return;
    }
    const removed = view.beforeEntries.filter(
      (entry, index) =>
        !view.after.some((candidate, at) => key(candidate, at) === key(entry, index)),
    );
    if (removed.length > 0) {
      changes.push({
        kind: "entry-remove",
        section: view.section,
        entry: entryName(removed[0]),
        count: removed.length,
      });
      return;
    }
  }

  // 2) 条目排序
  for (const view of views) {
    const moved = view.after.find(
      (entry, index) => view.before.get(key(entry, index))?.index !== index,
    );
    if (moved) {
      changes.push({
        kind: "entry-move",
        section: view.section,
        entry: entryName(moved),
        index: view.after.findIndex((entry) => entry === moved) + 1,
      });
      return;
    }
  }

  // 3) 隐藏 / 显示
  for (const view of views) {
    for (const [index, entry] of view.after.entries()) {
      const previous = view.before.get(key(entry, index))?.value;
      if (!previous || previous.hidden === entry.hidden) continue;
      changes.push({
        kind: entry.hidden ? "entry-hide" : "entry-show",
        section: view.section,
        entry: entryName(entry),
      });
      return;
    }
  }

  // 4) 条目排版（head / 列数 / 对齐 / 分页开关）
  for (const view of views) {
    for (const [index, entry] of view.after.entries()) {
      const previous = view.before.get(key(entry, index))?.value;
      if (!previous) continue;
      if (stableStringify(previous.layout) === stableStringify(entry.layout)) continue;
      changes.push({ kind: "entry-layout", section: view.section, entry: entryName(entry) });
      return;
    }
  }
}

function collectFieldChanges(
  before: ResumeDocument,
  after: ResumeDocument,
  changes: ChangeSummary[],
): void {
  const beforeSections = indexBy(before.sections, (section) => section.key);
  const pairs: {
    section: string;
    entry: string;
    before: Map<string, Slot<ResumeItem>>;
    after: ResumeItem[];
  }[] = [];
  for (const section of after.sections) {
    const previousSection = beforeSections.get(section.key)?.value;
    if (!previousSection) continue;
    const previousEntries = indexBy(
      previousSection.entries,
      (entry, index) => entry.id ?? `#${index}`,
    );
    section.entries.forEach((entry, index) => {
      const previous = previousEntries.get(entry.id ?? `#${index}`)?.value;
      if (!previous) return;
      pairs.push({
        section: sectionName(section),
        entry: entryName(entry),
        before: indexBy(previous.items, (item) => item.id),
        after: entry.items,
      });
    });
  }

  // 5) 字段增 / 删 / 移动（每轮只取命中的第一条）
  for (const pair of pairs) {
    const added = pair.after.filter((item) => !pair.before.has(item.id));
    if (added.length > 0) {
      changes.push({
        kind: "field-add",
        section: pair.section,
        entry: pair.entry,
        field: labelOf(added[0]) || t("workbench.history.change.untitledField"),
        count: added.length,
      });
      return;
    }
    const removed = [...pair.before.values()].filter(
      (slot) => !pair.after.some((next) => next.id === slot.value.id),
    );
    if (removed.length > 0) {
      changes.push({
        kind: "field-remove",
        section: pair.section,
        entry: pair.entry,
        field: labelOf(removed[0].value) || t("workbench.history.change.untitledField"),
        count: removed.length,
      });
      return;
    }
  }
  for (const pair of pairs) {
    const movedIndex = pair.after.findIndex(
      (item, index) => pair.before.get(item.id)?.index !== index,
    );
    if (movedIndex >= 0) {
      const moved = pair.after[movedIndex];
      changes.push({
        kind: "field-move",
        section: pair.section,
        entry: pair.entry,
        field: labelOf(moved) || t("workbench.history.change.untitledField"),
        index: movedIndex + 1,
      });
      return;
    }
  }

  // 6) 字段值：聚合成"正文 N 处修改"，只报第一个改动字段名。
  let count = 0;
  let first: { section: string; entry: string; field: string } | null = null;
  for (const pair of pairs) {
    for (const item of pair.after) {
      const previous = pair.before.get(item.id)?.value;
      if (!previous) continue;
      if (valueOf(previous) === valueOf(item)) continue;
      count += 1;
      if (!first) {
        first = {
          section: pair.section,
          entry: pair.entry,
          field: labelOf(item) || t("workbench.history.change.untitledField"),
        };
      }
    }
  }
  if (first) {
    changes.push({
      kind: "value",
      section: first.section,
      entry: first.entry,
      field: first.field,
      count,
    });
  }
}

function collectLayoutChanges(
  before: ResumeLayout,
  after: ResumeLayout,
  changes: ChangeSummary[],
): void {
  if (before.page_limit !== after.page_limit) {
    changes.push({ kind: "layout-pages", pages: Number(after.page_limit) });
    return;
  }
  if (before.font_scale !== after.font_scale) {
    changes.push({ kind: "layout-font", scale: String(after.font_scale) });
    return;
  }
  if (before.template !== after.template || before.format_name !== after.format_name) {
    changes.push({ kind: "layout-template", name: String(after.format_name || after.template) });
    return;
  }
  const previous = stableStringify(before.format_config ?? {});
  const next = stableStringify(after.format_config ?? {});
  if (previous !== next) {
    const beforeKeys = before.format_config ?? {};
    const afterKeys = after.format_config ?? {};
    const keys = new Set([...Object.keys(beforeKeys), ...Object.keys(afterKeys)]);
    let count = 0;
    for (const key of keys) {
      if (
        stableStringify((beforeKeys as Record<string, unknown>)[key]) !==
        stableStringify((afterKeys as Record<string, unknown>)[key])
      ) {
        count += 1;
      }
    }
    changes.push({ kind: "layout-format", count: Math.max(1, count) });
  }
}

/**
 * 比较两个快照，返回主变更 + 其它项数；完全识别不出时返回 `null`（调用方回退旧摘要）。
 */
export function summarizeChange(
  before: ChangeSnapshot,
  after: ChangeSnapshot,
): ChangeReport | null {
  const changes: ChangeSummary[] = [];
  collectSectionChanges(before.document, after.document, changes);
  collectEntryChanges(before.document, after.document, changes);
  collectFieldChanges(before.document, after.document, changes);
  collectLayoutChanges(before.layout, after.layout, changes);
  if (changes.length === 0) return null;
  return { main: changes[0], others: changes.length - 1 };
}

/**
 * 把结构化变更翻成一句话。
 *
 * 实现在 `changeSummaryCopy.ts`（拆文件是为了守住 500 行预算）；这里再导出一次，
 * 调用方与测试的 import 路径保持不变。
 */
export { describeChange } from "./changeSummaryCopy";
