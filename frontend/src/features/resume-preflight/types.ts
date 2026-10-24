// SPDX-License-Identifier: Apache-2.0
/**
 * W11 统一检查的前端类型（与后端 `schemas/preflight.py` 逐字对齐）。
 *
 * 契约来源：`deliverables/software-company/ResumeForge-workbench-wave2-contracts-w08-w11-20261024.md` §4.2/§4.3。
 * 后端字段改名 = 这里改；**不要**在组件里临时补字段。
 *
 * 两个 `?` 字段（machine_text / font_coverage）是 D11/D08 展示所需的**接口增补待确认项**：
 * 契约 4.2 的 PreflightOut 只列了 issues/summary/capabilities，而 §4.7 要求"机器读正文视图"
 * 与"缺字卡"。前端按"有就渲染、没有就说明未提供"实现，等 lead 落地 W11-BE 时确认字段名；
 * 全程不伪造数据。
 */

/** 三层：内容 / 排版（含字体） / 产物。 */
export type CheckLayer = "content" | "layout" | "product";

/** 三级：必须解决 / 需核对 / 排版建议（映射表见契约 4.2）。 */
export type CheckSeverity = "blocker" | "verify" | "suggestion";

/** 对象定位的作用域：与模板 data-resume-path / W01 稳定 id 双向对齐。 */
export type CheckScope = "document" | "section" | "object" | "point" | "field" | "page" | "export";

/** 修复入口动作（前端按动作分派到**真实既有入口**，没有 handler 就不渲染按钮）。 */
export type CheckFixAction =
  | "focus_field"
  | "apply_format_config"
  | "add_page"
  | "open_layout_analyze"
  | "open_preflight"
  | "open_settings"
  | "open_preview_exact"
  | "unhide_entry";

export interface CheckLocator {
  scope: CheckScope;
  /** 七个（W14 后十个）板块键。 */
  section?: string | null;
  /** content 里的稳定 id（W01）。 */
  object_id?: string | null;
  point_id?: string | null;
  /** 具体字段名（summary / description / …）。 */
  field?: string | null;
  /** 兼容旧 data-resume-path（experience.0.description.1）。 */
  path?: string | null;
  /** 仅产物层。 */
  page?: number | null;
}

export interface CheckFix {
  action: CheckFixAction;
  payload: Record<string, unknown>;
  /** i18n 词条键（后端不下发中文）；前端有已知映射，未知键走兜底文案。 */
  label_key: string;
}

export interface CheckIssue {
  /** 稳定指纹 = sha1(code + locator 规范化)：复检按 id 比对消失/仍在。 */
  id: string;
  layer: CheckLayer;
  severity: CheckSeverity;
  /** 机器码（见契约 4.3 映射表）。 */
  code: string;
  /** i18n 词条键。 */
  title_key: string;
  /** 已本地化的具体说明（含数字/字段名）。 */
  detail: string;
  /** 影响（"导出的 PDF 会缺少这一段"）。 */
  impact: string;
  locator: CheckLocator;
  fix: CheckFix | null;
  evidence: string[];
}

/** 同一快照：所有层结论必须来自这一组输入；前端据此丢弃过时响应。 */
export interface PreflightSnapshot {
  content_sha256: string;
  render_config_sha256: string;
  template: string;
  page_limit: number;
  font_scale: string;
  language: string;
  document_mode: "resume" | "long_cv";
}

/** D11：机器读到的逐页正文（W11-BE 冻结字段；未跑产物层时为空数组）。 */
export interface MachineTextPage {
  page: number;
  text: string;
}

/** D11：文本顺序差异（双栏顺序差异用 verify 级 issue 表达，kind 仍可为 out_of_order）。 */
export type OrderDiffKind = "missing" | "out_of_order" | "garbled";

export interface OrderDiff {
  kind: OrderDiffKind;
  token: string;
  page: number | null;
  expected_index: number | null;
}

/**
 * D08：缺字与粗体可用性（W11-BE 冻结字段）。
 *
 * `null` = **未检查**（没跑排版层，或没有中文字体）；`checked=false` 时不得显示"通过"。
 */
export interface FontCoveragePayload {
  checked: boolean;
  font: string | null;
  bold_available: boolean;
  /** 各字体角色缺失的字符（regular / bold 两族由后端给出）。 */
  missing: { regular: string[]; bold: string[] };
  /** 缺字列表被截断（只保留前 N 个）时为真：UI 必须说明，不能假装完整。 */
  truncated: boolean;
}

export interface PreflightOut {
  snapshot: PreflightSnapshot;
  issues: CheckIssue[];
  summary: Record<string, number>;
  /** format → 能力等级（或 "format:capability" → 等级），唯一来源是后端能力矩阵。 */
  capabilities: Record<string, string>;
  /** ATS/产物免责声明（逐字复用 ATS_DISCLAIMER）。 */
  disclaimer: string;
  /** 本次实际跑过的层（缺省 = 全部）。 */
  layers_run?: CheckLayer[];
  /** 本次检查耗时（毫秒），仅供参考。 */
  elapsed_ms?: number;
  /** D11 机器读到的逐页正文（W11-BE 冻结；未跑产物层时为空数组）。 */
  machine_text?: MachineTextPage[];
  /** D11 文本顺序差异（W11-BE 冻结；未跑产物层时为空数组）。 */
  order_diffs?: OrderDiff[];
  /** D08 缺字与粗体（null = 未检查）。 */
  font_coverage?: FontCoveragePayload | null;
}

/** 请求体：与 `POST /api/resumes/{id}/preflight` 对齐（content/layout 可为 null = 用记录值）。 */
export interface PreflightRequest {
  content?: Record<string, unknown> | null;
  layout?: {
    template?: string;
    format_name?: string;
    page_limit?: number;
    font_scale?: string;
    language?: string;
    format_config?: Record<string, unknown>;
  } | null;
  layers?: CheckLayer[];
  /** 产物层只做点名的格式，默认 ["pdf"]。 */
  product_formats?: string[];
  /** 浏览器量到的页面高度（排版层用）。 */
  measure?: { used_height: number; page_content_height: number } | null;
  jd_text?: string;
}

/** 检查层/严重度的展示顺序（唯一顺序来源）。 */
export const CHECK_LAYER_ORDER: readonly CheckLayer[] = ["content", "layout", "product"];
export const CHECK_SEVERITY_ORDER: readonly CheckSeverity[] = ["blocker", "verify", "suggestion"];
