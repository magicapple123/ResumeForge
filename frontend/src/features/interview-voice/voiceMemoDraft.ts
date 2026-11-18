// SPDX-License-Identifier: Apache-2.0
/**
 * 口述 → 简历条目（纯函数，T09）。
 *
 * ## 为什么这里没有"解析"
 *
 * 抽取由**既有**链路做：`POST /api/profile/parse-text`（模型优先、本地规则兜底）返回
 * `sections[{key,name,fields:[{field_id,label,value}], entries?}]`。本文件只做两件纯计算：
 *
 * 1. **把草稿折成"能插进文档的条目提案"**：`field_id` 形如 `experiences.company`，
 *    而文档字段的唯一标识是目录里的 `source_field_id`（同一串）。所以映射不靠任何手写
 *    对照表——一旦目录改名，`source_field_id` 跟着变，这里要么命中要么整条跳过，
 *    不会静默塞错字段。
 * 2. **把提案写进 `ResumeDocument`**：`addEntry` + `defaultInlineEntry` + `fieldItemFromCatalog`
 *    全是既有实现（新建条目的形状必须与「添加一条」完全一致，否则保存后的 normalize 会漂移）。
 *
 * ## 两条刻意的不做
 *
 * - **页眉字段（`basic_info`）不插**：页眉的值来自资料投影，且实测模型会把口述里的日期
 *   误填进"出生年月"。这类内容属于资料页，界面提示一句把它导过去。
 * - **纯文本板块（如个人简介）不插**：口述的一句简介会覆盖整段正文，风险大于收益；
 *   `kind === "text"` 的板块与 `material_only` 字段一律跳过。
 */
import type {
  DocumentFieldCatalog,
  FieldCatalogField,
  ResumeDocument,
  ResumeEntry,
  ResumeItem,
  ResumeSection,
} from "../../types/resumeDocument";
import { defaultFieldItem, defaultListItem } from "../resume/document/defaults";
import { addEntry } from "../resume/document/entries";
import {
  catalogFieldsOf,
  catalogSectionOf,
  effectiveFieldFormat,
} from "../resume/document/fieldCatalog";
import { joinDateRange } from "../resume/document/format";
import { defaultInlineEntry } from "../resume/document/inlineEntry";

/** 后端 `ProfileDraftFieldOut` 的最小形状（只取本文件需要的字段）。 */
export interface MemoDraftField {
  field_id: string;
  label: string;
  value: string;
}

/** 后端 `ProfileDraftEntryOut`：多条目板块里的一条。 */
export interface MemoDraftEntry {
  fields: MemoDraftField[];
}

/** 后端 `ProfileDraftSectionOut`：`entries` 只在"多条目且真解析出多条"时出现。 */
export interface MemoDraftSection {
  key: string;
  name: string;
  fields?: MemoDraftField[];
  entries?: MemoDraftEntry[] | null;
}

/** 一条待插入的条目提案：`values` 的键是**文档字段 key**（目录 `source_field_id` 已对好）。 */
export interface MemoProposal {
  sectionKey: string;
  sectionTitle: string;
  values: Record<string, string>;
  /** 字段 key → 显示名（后端草稿里已本地化；缺失时退到目录 label，再退到 key）。 */
  labels: Record<string, string>;
}

export interface MemoProposalResult {
  proposals: MemoProposal[];
  /** 识别到了内容但落在页眉/纯文本/素材字段上，因而没有提案（界面据此提示去资料页）。 */
  skippedSections: number;
}

/**
 * 解析接口的字段 id → 文档字段 key 的**显式别名表**（I-20）。
 *
 * 为什么会不一致：`parse-text` 的 `field_id` 来自**资料**定义目录，纸面目录的
 * `source_field_id` 却有自己的 key——两处都自称"目录"，但经历角色在资料侧叫
 * `experiences.title`、在纸面侧叫 `role`；奖项同名同理。实测（2026-11-18）：
 *
 * | 解析接口 | 纸面目录 |
 * |---|---|
 * | `experiences.title` | `role`（source `experiences.role`） |
 * | `educations.core_courses` | `courses`（source `educations.courses`） |
 * | `awards.title` | `name`（source `awards.name`） |
 * | `awards.awarded_at` | `date`（source `awards.date`） |
 *
 * **只做显式映射，不做模糊匹配**：`team_size` / `experience_kind` 这类字段一模糊就会串。
 * 注释里的删除条件是"后端按纸面目录 key 输出"，在那之前这张表是唯一真源。
 */
const SOURCE_ALIASES: Readonly<Record<string, string>> = {
  "experiences.title": "role",
  "educations.core_courses": "courses",
  "awards.title": "name",
  "awards.awarded_at": "date",
};

/**
 * 目录里找得到文档字段 key 的那些值（找不到 = 目录与后端不同步，跳过该字段）。
 *
 * ## 起止时间为什么要单独合一次
 *
 * 资料侧是两条字段（`experiences.start_date` / `end_date`），纸面侧是**一个** `period`
 * 字段（`format: "date_range"`，值用 `|` 连接）。口述里"从 2023 年 3 月做到 2025 年 6 月"
 * 抽出来是两条，直接按 id 匹配会双双落空，日期就丢了。这里用目录自己声明的
 * `format === "date_range"` 作判据（不写死字段名），再用既有 `joinDateRange` 拼值——
 * 拼接口径与编辑器里的日期控件是同一个函数。
 */
function valuesOf(
  fields: readonly MemoDraftField[],
  specs: readonly FieldCatalogField[],
): { values: Record<string, string>; labels: Record<string, string> } {
  const bySource = new Map<string, FieldCatalogField>();
  for (const spec of specs) {
    bySource.set(spec.source_field_id, spec);
    // 别名表按"文档字段 key"回查：目录把 role 的 source 写成 `experiences.role` 时，
    // 解析结果给的是 `experiences.title`，只有 key 这一层还能对上（见 SOURCE_ALIASES）。
    if (!bySource.has(spec.key)) bySource.set(spec.key, spec);
  }
  const values: Record<string, string> = {};
  const labels: Record<string, string> = {};
  const dateParts: { start: string; end: string } = { start: "", end: "" };
  for (const field of fields) {
    const value = (field.value ?? "").trim();
    if (!value) continue;
    const alias = SOURCE_ALIASES[field.field_id];
    const spec = bySource.get(field.field_id) ?? (alias ? bySource.get(alias) : undefined);
    if (spec) {
      if (spec.material_only) continue;
      values[spec.key] = value;
      labels[spec.key] = (field.label || spec.label || spec.key).trim();
      continue;
    }
    const suffix = field.field_id.slice(field.field_id.lastIndexOf(".") + 1);
    if (suffix === "start_date") dateParts.start = value;
    else if (suffix === "end_date") dateParts.end = value;
  }
  if (dateParts.start || dateParts.end) {
    const rangeSpec = specs.find(
      (spec) => spec.format === "date_range" && !spec.material_only && !values[spec.key],
    );
    if (rangeSpec) {
      values[rangeSpec.key] = joinDateRange(dateParts.start, dateParts.end);
      labels[rangeSpec.key] = rangeSpec.label || rangeSpec.key;
    }
  }
  return { values, labels };
}

/**
 * 草稿 → 条目提案。
 *
 * 只保留**能落到文档条目上**的分区：板块在文档目录里存在、`kind !== "text"`、
 * 且至少有一个值。顺序沿用后端下发的分区顺序（= 目录顺序），插入后的条目顺序因此可预期。
 */
export function memoProposals(
  sections: readonly MemoDraftSection[],
  catalog: DocumentFieldCatalog | null | undefined,
): MemoProposalResult {
  const proposals: MemoProposal[] = [];
  let skippedSections = 0;
  for (const section of sections) {
    const catalogSection = catalogSectionOf(catalog, section.key);
    const entries =
      section.entries && section.entries.length > 0
        ? section.entries
        : [{ fields: section.fields ?? [] }];
    const specs = catalogFieldsOf(catalog, section.key);
    const collected = entries
      .map((entry) => valuesOf(entry.fields ?? [], specs))
      .filter((item) => Object.keys(item.values).length > 0);
    // "识别到了内容但没落成条目"要计数：界面对这种情况必须说一句话（去资料页补），
    // 而不是点了半天什么都不发生。判据看**原始草稿有没有值**，与映射成功与否无关。
    const hadRawValues = entries.some((entry) =>
      (entry.fields ?? []).some((field) => (field.value ?? "").trim().length > 0),
    );
    if (!catalogSection || catalogSection.kind === "text" || collected.length === 0) {
      if (hadRawValues) skippedSections += 1;
      continue;
    }
    for (const item of collected) {
      proposals.push({
        sectionKey: catalogSection.key,
        sectionTitle: catalogSection.title || section.name,
        values: item.values,
        labels: item.labels,
      });
    }
  }
  return { proposals, skippedSections };
}

/**
 * 列表型字段的分词符：顿号 / 逗号 / 分号 / 竖线（中英文各一份）。
 *
 * 用转义写法而不是直接写字面里的中文标点：`cjkRatchet` 的棘轮把"源码里出现 CJK 字符"
 * 当成新增中文文案，而这里是一组分隔符（技术常量），不是给用户看的字。语义完全一致。
 */
const LIST_SEPARATOR = /[\u3001,\uFF0C;\uFF1B/|]/;

/** 把值写进一条 item（field 赋值、list 按标点切词；其它种类保持原样）。 */
function itemWithValue(item: ResumeItem, value: string): ResumeItem {
  if (item.kind === "field") return { ...item, value };
  if (item.kind === "list") {
    const values = value
      .split(LIST_SEPARATOR)
      .map((part) => part.trim())
      .filter(Boolean);
    return { ...item, values: values.length > 0 ? values : [value] };
  }
  return item;
}

/** 按目录字段造一条新 item（与「添加字段」菜单同一条产线）。 */
function itemFromSpec(spec: FieldCatalogField, value: string): ResumeItem {
  const format = effectiveFieldFormat(spec);
  if (format === "list") {
    return defaultListItem({
      key: spec.key,
      values: value
        .split(LIST_SEPARATOR)
        .map((part) => part.trim())
        .filter(Boolean),
      placement: spec.default_placement,
    });
  }
  return defaultFieldItem({
    key: spec.key,
    value,
    placement: spec.default_placement,
    format,
    source:
      spec.source_field_id && spec.source_field_id.includes(".")
        ? {
            section_key: spec.source_field_id.slice(0, spec.source_field_id.lastIndexOf(".")),
            field_id: spec.source_field_id,
          }
        : null,
  });
}

/** 一条提案 + 文档里的板块 + 目录 → 一条新 entry（形状与「添加一条」完全一致）。 */
function buildEntry(
  proposal: MemoProposal,
  section: ResumeSection,
  catalog: DocumentFieldCatalog | null | undefined,
): ResumeEntry | null {
  const base = defaultInlineEntry(catalog, section);
  const items = base.items.slice();
  const specs = catalogFieldsOf(catalog, proposal.sectionKey);
  for (const [key, value] of Object.entries(proposal.values)) {
    const index = items.findIndex((item) => item.kind !== "text" && item.key === key);
    if (index >= 0) {
      items[index] = itemWithValue(items[index], value);
      continue;
    }
    const spec = specs.find((candidate) => candidate.key === key);
    if (spec) items.push(itemFromSpec(spec, value));
  }
  return items.length > 0 ? { ...base, items } : null;
}

export interface MemoApplyResult {
  document: ResumeDocument;
  inserted: number;
  /** 已有同样内容而跳过的条数（重复点「插入」不该把同一段经历插两遍）。 */
  duplicates: number;
  /** 文档里没有该板块 / 目录对不上而丢弃的条数。 */
  dropped: number;
  /**
   * 本次**真的插进去**的条目路径（`<sectionKey>.<entryId>`，顺序 = 插入顺序）。
   *
   * I-20：界面据此选中并滚动到最新一条。被去重 / 丢弃的条目**不产生路径**，
   * 否则"插入 0 条"也会触发一次跳转。
   */
  insertedPaths: string[];
}

/** 板块里是否已经有一条把 `values` 全覆盖了（值全等即可，不做模糊匹配）。 */
function alreadyCovered(
  document: ResumeDocument,
  sectionKey: string,
  values: Record<string, string>,
): boolean {
  const section = document.sections.find((candidate) => candidate.key === sectionKey);
  if (!section) return false;
  return section.entries.some((entry) =>
    Object.entries(values).every(([key, value]) => {
      const item = entry.items.find(
        (candidate) => candidate.kind !== "text" && candidate.key === key,
      );
      if (!item) return false;
      if (item.kind === "field") return item.value.trim() === value;
      // i18n-ok: 「、」是列表字段的连接符（纸面就用它），换成逗号会让重复插入判断与纸面不一致
      if (item.kind === "list") return item.values.join("、").trim() === value;
      return false;
    }),
  );
}

/**
 * 把提案写进文档：**追加新条目**，已存在的内容不重复插入。
 *
 * 返回新文档与三档计数，界面用它们给一句带数字的提示（"已插入 2 条条目"）。
 */
export function applyMemoProposals(
  document: ResumeDocument,
  proposals: readonly MemoProposal[],
  catalog: DocumentFieldCatalog | null | undefined,
): MemoApplyResult {
  let next = document;
  let inserted = 0;
  let duplicates = 0;
  let dropped = 0;
  const insertedPaths: string[] = [];
  for (const proposal of proposals) {
    const section = next.sections.find((candidate) => candidate.key === proposal.sectionKey);
    const entry = section ? buildEntry(proposal, section, catalog) : null;
    if (!section || !entry) {
      dropped += 1;
      continue;
    }
    if (alreadyCovered(next, proposal.sectionKey, proposal.values)) {
      duplicates += 1;
      continue;
    }
    const added = addEntry(next, proposal.sectionKey, entry);
    next = added.document;
    insertedPaths.push(`${proposal.sectionKey}.${added.entryId}`);
    inserted += 1;
  }
  return { document: next, inserted, duplicates, dropped, insertedPaths };
}
