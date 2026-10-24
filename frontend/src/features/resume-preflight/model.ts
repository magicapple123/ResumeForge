// SPDX-License-Identifier: Apache-2.0
/**
 * 检查结果的纯规则：分组、计数、过滤、快照比对、修复按钮文案。
 *
 * 与组件分开的理由：这些判定是"面板显示得对不对"的全部来源（三层分组/三级排序/
 * 只显示必须解决/过时结果标识），组件只负责画。
 */
import type { MessageKey } from "../../i18n";
import {
  CHECK_LAYER_ORDER,
  CHECK_SEVERITY_ORDER,
  type CheckFix,
  type CheckFixAction,
  type CheckIssue,
  type CheckLayer,
  type CheckSeverity,
  type PreflightSnapshot,
} from "./types";

/** 快照指纹（前端侧的比较键）：只用响应里出现的稳定字段，不掺界面状态。 */
export function snapshotKey(snapshot: PreflightSnapshot | null | undefined): string {
  if (!snapshot) return "";
  return [
    snapshot.content_sha256,
    snapshot.render_config_sha256,
    snapshot.template,
    String(snapshot.page_limit),
    snapshot.font_scale,
    snapshot.language,
    snapshot.document_mode,
  ].join("|");
}

/** 回包是否属于当前版本（不属于 → 丢弃，不显示旧结果）。 */
export function isSnapshotStale(
  responseSnapshot: PreflightSnapshot | null | undefined,
  currentSnapshot: PreflightSnapshot | null | undefined,
): boolean {
  if (!responseSnapshot || !currentSnapshot) return true;
  return snapshotKey(responseSnapshot) !== snapshotKey(currentSnapshot);
}

export interface SeverityCounts {
  blocker: number;
  verify: number;
  suggestion: number;
  total: number;
}

export function countBySeverity(issues: readonly CheckIssue[]): SeverityCounts {
  const counts: SeverityCounts = { blocker: 0, verify: 0, suggestion: 0, total: 0 };
  for (const issue of issues) {
    counts[issue.severity] += 1;
    counts.total += 1;
  }
  return counts;
}

/** 严重度排序权重（blocker 最前）。 */
function severityRank(severity: CheckSeverity): number {
  return CHECK_SEVERITY_ORDER.indexOf(severity);
}

/**
 * 按三层分组并组内按严重度排序。
 *
 * 组内保持后端顺序作为第二关键字（"同一优先级，后端认为重要的在前"），不按标题重排——
 * 重排会让"复检前后同一条问题换位置"，用户找不到刚才那条。
 */
export function groupIssues(issues: readonly CheckIssue[]): {
  layer: CheckLayer;
  issues: CheckIssue[];
}[] {
  return CHECK_LAYER_ORDER.map((layer) => ({
    layer,
    issues: issues
      .filter((issue) => issue.layer === layer)
      .map((issue, index) => ({ issue, index }))
      .sort((left, right) => {
        const diff = severityRank(left.issue.severity) - severityRank(right.issue.severity);
        return diff !== 0 ? diff : left.index - right.index;
      })
      .map((item) => item.issue),
  })).filter((group) => group.issues.length > 0);
}

/** 「只显示必须解决」过滤。 */
export function filterBlockersOnly(
  issues: readonly CheckIssue[],
  blockersOnly: boolean,
): CheckIssue[] {
  return blockersOnly ? issues.filter((issue) => issue.severity === "blocker") : [...issues];
}

/** 复检比对：按 issue.id 列出新增 / 仍存在 / 已解决（复检结果与上次比对）。 */
export function compareRecheck(
  previous: readonly CheckIssue[],
  next: readonly CheckIssue[],
): { added: CheckIssue[]; remaining: CheckIssue[]; resolved: CheckIssue[] } {
  const previousIds = new Set(previous.map((issue) => issue.id));
  const nextIds = new Set(next.map((issue) => issue.id));
  return {
    added: next.filter((issue) => !previousIds.has(issue.id)),
    remaining: next.filter((issue) => previousIds.has(issue.id)),
    resolved: previous.filter((issue) => !nextIds.has(issue.id)),
  };
}

/** 已知修复动作的兜底文案（后端 label_key 未在本前端词条里时使用）。 */
export const FIX_ACTION_LABEL_KEY: Record<CheckFixAction, MessageKey> = {
  focus_field: "preflight.fix.focus_field",
  apply_format_config: "preflight.fix.apply_format_config",
  add_page: "preflight.fix.add_page",
  open_layout_analyze: "preflight.fix.open_layout_analyze",
  open_preflight: "preflight.fix.open_preflight",
  open_settings: "preflight.fix.open_settings",
  open_preview_exact: "preflight.fix.open_preview_exact",
  unhide_entry: "preflight.fix.unhide_entry",
};

/** 后端约定的 fix 词条键全集（key = preflight.fix.<action>，见 zh-CN.preflight.ts）。 */
const KNOWN_FIX_LABEL_KEYS = new Set<string>(Object.values(FIX_ACTION_LABEL_KEY));

/** 修复按钮文案键：动作是枚举，永远能给出一个具体动作（不出现空按钮/「确定」）。 */
export function fixLabelKey(fix: CheckFix): MessageKey {
  if (KNOWN_FIX_LABEL_KEYS.has(fix.label_key)) return fix.label_key as MessageKey;
  return FIX_ACTION_LABEL_KEY[fix.action] ?? "preflight.fix.fallback";
}

/**
 * 问题标题词条键（后端约定 key = preflight.issue.<code>）。
 *
 * `risk_<category>` 的类别是开放集合，共用一句"需要核对事实"；未知机器码返回 null，
 * 由调用方退回 detail/兜底标题——**绝不把机器码直接当界面文案**。
 */
export function issueTitleKey(code: string): MessageKey | null {
  if (code.startsWith("risk_")) return "preflight.issue.risk";
  if (ISSUE_TITLE_KEY[code]) return ISSUE_TITLE_KEY[code];
  return null;
}

const ISSUE_TITLE_KEY: Record<string, MessageKey> = {
  incomplete_marker: "preflight.issue.incomplete_marker",
  ats_format: "preflight.issue.ats_format",
  ats_keyword: "preflight.issue.ats_keyword",
  ats_position: "preflight.issue.ats_position",
  layout_overflow: "preflight.issue.layout_overflow",
  layout_dense: "preflight.issue.layout_dense",
  layout_sparse: "preflight.issue.layout_sparse",
  layout_too_sparse: "preflight.issue.layout_too_sparse",
  layout_suggestion: "preflight.issue.layout_suggestion",
  layout_no_measure: "preflight.issue.layout_no_measure",
  font_missing_glyphs: "preflight.issue.font_missing_glyphs",
  font_bold_missing: "preflight.issue.font_bold_missing",
  product_pdf_text_missing: "preflight.issue.product_pdf_text_missing",
  product_docx_text_missing: "preflight.issue.product_docx_text_missing",
  product_pdf_text_empty: "preflight.issue.product_pdf_text_empty",
  product_pdf_order_diff: "preflight.issue.product_pdf_order_diff",
  product_docx_order_diff: "preflight.issue.product_docx_order_diff",
  product_pdf_overflow: "preflight.issue.product_pdf_overflow",
  product_docx_overflow: "preflight.issue.product_docx_overflow",
  product_hidden_leak: "preflight.issue.product_hidden_leak",
  product_pdf_render_failed: "preflight.issue.product_pdf_render_failed",
  product_docx_render_failed: "preflight.issue.product_docx_render_failed",
  model_not_configured: "preflight.issue.model_not_configured",
};

/** 定位的一句话说明（供行内显示；不含方向词，避免视口变化后失效）。 */
export function locatorSummary(issue: CheckIssue): string {
  const { locator } = issue;
  const parts: string[] = [];
  if (locator.section) parts.push(locator.section);
  if (locator.field) parts.push(locator.field);
  if (locator.path) parts.push(locator.path);
  if (locator.page) parts.push(String(locator.page));
  return parts.join(" · ");
}
