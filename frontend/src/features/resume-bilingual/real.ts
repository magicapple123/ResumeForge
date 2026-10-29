// SPDX-License-Identifier: Apache-2.0
/**
 * W16 真实 API 响应 → 既有界面模型的**纯映射**（不 import React、不做请求）。
 *
 * ## 为什么 diff 不是逐字段
 *
 * 后端 `ResumeDiffOut` 是**按行**的三态差异（整份文档顺序），没有 path；而采纳接口是
 * 按 path 一次写多个字段。所以候选列表由「原文 vs 候选内容」自己按字段比出来：
 * 路径集合复用 `fieldPairs.buildBilingualPairs`（与对照视图同一份字段表），
 * 被事实锁/术语锁定保留原文的路径由 `blocked_fields` 标记为不可采纳。
 */
import { buildBilingualPairs, HEADER_FIELDS, SECTION_FIELDS } from "./fieldPairs";
import { getByPath } from "../resume/useRichTextOverrides";
import type {
  BilingualPair,
  GlossaryCategory,
  GlossaryTerm,
  LanguageVariant,
  TranslationCandidate,
} from "./types";
import type { VariantDetailOut, GlossaryTermIn } from "./api";

/** 变体 brief → 界面模型（模板/页数从 render_context 兜底）。 */
export function variantToLanguageVariant(
  variant: VariantDetailOut | LanguageVariant,
): LanguageVariant {
  const context = (variant as VariantDetailOut).render_context ?? {};
  return {
    id: variant.id,
    resume_id: variant.resume_id,
    name: variant.name,
    language: variant.language,
    variant_group_id: variant.variant_group_id,
    template: String(context.template ?? (variant as LanguageVariant).template ?? ""),
    page_limit: Number(context.page_limit ?? (variant as LanguageVariant).page_limit ?? 1),
    font_scale: String(context.font_scale ?? (variant as LanguageVariant).font_scale ?? ""),
    created_at: String(variant.created_at ?? ""),
    updated_at: variant.updated_at ?? undefined,
  };
}

/** 术语响应 → 界面模型（category 收窄到白名单，未知按 term）。 */
const CATEGORY_SET = new Set<GlossaryCategory>(["name", "institution", "company", "skill", "term"]);

export function glossaryOutToTerm(term: GlossaryTerm): GlossaryTerm {
  const category = CATEGORY_SET.has(term.category as GlossaryCategory)
    ? (term.category as GlossaryCategory)
    : "term";
  return { ...term, category };
}

/** 界面术语 → 新建请求（补语言对：源语言 = 当前简历语言，目标 = 对侧）。 */
export function termToCreatePayload(
  term: GlossaryTerm,
  languageFrom: "zh-CN" | "en-US",
  languageTo: "zh-CN" | "en-US",
): GlossaryTermIn {
  return {
    source_term: term.source_term,
    target_term: term.target_term,
    language_from: languageFrom,
    language_to: languageTo,
    category: term.category,
    locked: term.locked,
    note: term.note,
  };
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

/**
 * 字段标签：在**字段规格表**里按板块 + 字段名反查 labelKey。
 *
 * 为什么不复用 `buildBilingualPairs(null, null)`：null 内容下**板块行一条都不会生成**
 * （条目数由数据决定），于是所有板块字段都会回落成"个人总结"——这正是候选项标签
 * 全写成"个人总结"的原因。
 *
 * 末段数组下标（`education.0.courses.2`）不参与匹配，所以按「板块 + 字段名」找：
 * 拆出来是 `[array, index, field]`，中间的 index 只是被丢弃。
 */
function labelFor(path: string): string {
  if (path === "summary") return "bilingual.field.summary";
  const header = HEADER_FIELDS.find((item) => item.field === path);
  if (header) return header.labelKey;
  const [array, , field] = path.split(".");
  const section = SECTION_FIELDS.find((item) => item.array === array);
  const spec = section?.fields.find((item) => item.field === field);
  return spec ? spec.labelKey : "bilingual.field.summary";
}

/**
 * 路径是否被后端标记为"保留原文"：**精确命中**或**祖先命中**都算。
 *
 * 后端 `_restore_locked_entries` 会下发条目级路径（如 `education.0`），它的所有子路径
 * （`education.0.courses.0`）同样不能采纳；所以除了整串比对，还要逐级回查前缀。
 */
function isBlockedPath(blocked: ReadonlySet<string>, path: string): boolean {
  if (blocked.has(path)) return true;
  const segments = path.split(".");
  for (let index = segments.length - 1; index > 0; index -= 1) {
    if (blocked.has(segments.slice(0, index).join("."))) return true;
  }
  return false;
}

/** 数组元素当文本读：非字符串（数字/对象/undefined）一律按空串处理，不抛错。 */
function cellText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * 数组字段按**下标展开**成逐条候选。
 *
 * 为什么必须逐条：后端 `adopt` 用 `_read_path` 读路径并写回，读到 list 就整批拒绝
 * （`采纳路径不存在或不是文本：education.0.courses`）。所以提交的路径必须带下标
 * （`education.0.courses.1`），一条失败也不会连累其它条。
 */
function expandArrayPair(
  pair: BilingualPair,
  before: unknown,
  after: unknown,
  blocked: ReadonlySet<string>,
): TranslationCandidate[] {
  const beforeItems: unknown[] = Array.isArray(before) ? before : [];
  const afterItems: unknown[] = Array.isArray(after) ? after : [];
  const count = Math.max(beforeItems.length, afterItems.length);
  const rows: TranslationCandidate[] = [];
  for (let index = 0; index < count; index += 1) {
    const beforeText = cellText(beforeItems[index]);
    const afterText = cellText(afterItems[index]);
    // 译文为空 = 这条还没翻（或后端删了），不产生候选；没变也不必让用户勾。
    if (!afterText || beforeText === afterText) continue;
    const path = pair.path + "." + index;
    rows.push({
      path,
      labelKey: labelFor(path),
      before: beforeText,
      after: afterText,
      tokens: displayTokens(beforeText, afterText),
      blocked: isBlockedPath(blocked, path) || pair.locked,
    });
  }
  return rows;
}

/**
 * 原文内容 + 翻译候选内容 → 逐字段候选（只列真变了的路径）。
 *
 * 标量字段一条候选 = 一个路径；数组字段（courses / description / tech_stack …）
 * 按元素下标展开成多条，路径带下标——这是采纳接口能写库的前提。
 *
 * `blockedPaths` 来自后端 `blocked_fields`：这些路径保留原文，界面上不可勾选采纳。
 */
export function buildTranslationCandidates(
  original: Record<string, unknown> | null,
  candidate: Record<string, unknown> | null,
  blockedPaths: readonly string[],
): TranslationCandidate[] {
  const blocked = new Set(blockedPaths);
  const pairs = buildBilingualPairs(original as never, candidate as never).filter(
    (pair: BilingualPair) => pair.status === "changed",
  );
  const rows: TranslationCandidate[] = [];
  for (const pair of pairs) {
    const before = getByPath(original, pair.path);
    const after = getByPath(candidate, pair.path);
    if (Array.isArray(before) || Array.isArray(after)) {
      rows.push(...expandArrayPair(pair, before, after, blocked));
      continue;
    }
    rows.push({
      path: pair.path,
      labelKey: labelFor(pair.path),
      before: pair.primary,
      after: pair.secondary,
      tokens: displayTokens(pair.primary, pair.secondary),
      blocked: isBlockedPath(blocked, pair.path) || pair.locked,
    });
  }
  return rows;
}

/**
 * 两份内容是否**字节级相同**（键顺序敏感）。
 *
 * 用途：新建语言版本的流程是「先把正文整份复制过来，再翻译」。翻译没跑成/没跑过时
 * 变体的 content 就是当前简历的**原样副本**，对照视图两列一字不差——用户会以为
 * 功能坏了（2026-11 反馈"英文列还是中文"）。界面据此显示"还没翻译"的提示条。
 *
 * 局限：比较用 `JSON.stringify`，**键顺序敏感**。两份内容同源（都来自同一次读库、
 * 同一套序列化）时键顺序一致，判定成立；跨端重新序列化过（键顺序变化）时可能误判
 * 为"不同"，那种情况只是**不显示**提示，不会误报"已翻译"。
 */
export function isSameContent(a: unknown, b: unknown): boolean {
  const empty = (value: unknown) =>
    value === null ||
    value === undefined ||
    (typeof value === "object" && Object.keys(value as Record<string, unknown>).length === 0);
  if (empty(a) || empty(b)) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 采纳时提交给后端的 items：只取选中的路径与候选文本。 */
export function adoptItems(
  candidates: readonly TranslationCandidate[],
  paths: readonly string[],
): { path: string; text: string }[] {
  const wanted = new Set(paths);
  return candidates
    .filter((candidate) => wanted.has(candidate.path) && !candidate.blocked && candidate.after)
    .map((candidate) => ({ path: candidate.path, text: candidate.after }));
}

/**
 * 「撤销采纳」的 items：用采纳前的旧文本再采纳一次。
 *
 * 为什么不是新接口：adopt 只改列出的路径，把旧值写回去就是精确回退；
 * 后端保证任一项失败整批不落，所以回退要么全成要么原文不动。
 */
export function undoItems(
  candidates: readonly TranslationCandidate[],
  appliedPaths: readonly string[],
): { path: string; text: string }[] {
  const applied = new Set(appliedPaths);
  return candidates
    .filter((candidate) => applied.has(candidate.path) && candidate.before)
    .map((candidate) => ({ path: candidate.path, text: candidate.before }));
}

/** translate 响应的源语言/目标语言校验（前端提前拦住"同语言翻译"）。 */
export function sameLanguage(source: string, target: "zh-CN" | "en-US"): boolean {
  return source === target;
}
