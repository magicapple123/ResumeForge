// SPDX-License-Identifier: Apache-2.0
/** W11 前端测试夹具：统一问题模型/快照/响应（形状与 backend/app/schemas/preflight.py 冻结字段一致）。 */
import type {
  CheckIssue,
  CheckLayer,
  CheckSeverity,
  PreflightOut,
  PreflightSnapshot,
} from "../features/resume-preflight/types";

export function makeSnapshot(overrides: Partial<PreflightSnapshot> = {}): PreflightSnapshot {
  return {
    content_sha256: "content-a",
    render_config_sha256: "config-a",
    template: "classic",
    page_limit: 2,
    font_scale: "standard",
    language: "zh-CN",
    document_mode: "resume",
    ...overrides,
  };
}

let issueSeq = 0;

export function makeIssue(overrides: Partial<CheckIssue> = {}): CheckIssue {
  issueSeq += 1;
  const layer: CheckLayer = overrides.layer ?? "content";
  const severity: CheckSeverity = overrides.severity ?? "blocker";
  return {
    id: overrides.id ?? `issue-${issueSeq}`,
    layer,
    severity,
    code: "incomplete_content",
    title_key: "preflight.issue.untitled",
    detail: "这一段还没有补全",
    impact: "导出的 PDF 会缺少这一段",
    locator: { scope: "object", section: "experience", object_id: "obj-1" },
    fix: null,
    evidence: [],
    ...overrides,
  };
}

export function makePreflightOut(overrides: Partial<PreflightOut> = {}): PreflightOut {
  return {
    snapshot: makeSnapshot(),
    issues: [],
    summary: { blocker: 0, verify: 0, suggestion: 0 },
    capabilities: {},
    disclaimer: "本地规则估计，不代表真实 ATS 解析结果",
    machine_text: [],
    order_diffs: [],
    font_coverage: null,
    ...overrides,
  };
}
