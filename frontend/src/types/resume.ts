// SPDX-License-Identifier: Apache-2.0
/** 简历内容、生成选项和简历建议类型。 */
import type { ResumeFormatConfig } from "./resumeFormat";
import type { ResumeProfileUsageSnapshot } from "./resumeProfileUsage";
import type { TemplateMarketPreset } from "./templateMarket";

// 内容结构（六类条目 + ResumeContent）单列 resumeContent.ts 守住 500 行预算；
// 既有从 "../types/resume" 或 "../types" 导入这些类型的路径由下面的 re-export 保持不变。
export type {
  ResumeEducation,
  ResumeExperience,
  ResumeCampusExperience,
  ResumeProject,
  ResumeSkill,
  ResumeAward,
  ResumeContent,
  ResumeCredential,
  ResumeCredentialStatus,
  ResumeCustomEntry,
  ResumeCustomLine,
  ResumeCustomSection,
} from "./resumeContent";
import type { ResumeContent } from "./resumeContent";

export type EnhancementLevel = "light" | "balanced" | "strong";

/** 字号档位（后端 ResumeFontScale）。 */
export type ResumeFontScale = "small" | "standard" | "large";

/** 纸面固定文案的语言（后端 ResumeLanguage）：只改小节标题与字段名，不翻译正文。 */
export type ResumeLanguage = "zh-CN" | "en-US";

/** 最大篇幅：A4 页数，与后端 MAX_RESUME_PAGES 一致。 */
export const RESUME_PAGE_LIMITS = [1, 2, 3] as const;

export type ResumePageLimit = (typeof RESUME_PAGE_LIMITS)[number];

export interface ResumeTemplateOption {
  name: string;
  label: string;
  description: string;
  /** 用户自制的模板；内置模板为 false。 */
  custom?: boolean;
  id?: number | null;
  /**
   * 这个模板的**标题字族是衬线**（当前 `elegant` / `editorial` 为 true，自制模板恒 false）。
   *
   * 精确预览用的是嵌入 PDF 的那一款中文字体（本机黑体），而草稿里的衬线标题是 CSS 字族，
   * 两条链路在这里**必然不同**。有了这个标志，精确模式才能只在"真的不一样"时给一句说明，
   * 而不是对所有模板都摆一条与事实无关的提示。旧后端不下发时按 `false`（不提示）。
   */
  serif_heading?: boolean;
}

export interface ResumeFontScaleOption {
  name: ResumeFontScale;
  label: string;
  description: string;
  /**
   * 该档位的基准字号（CSS 像素）。无级字号滑块以它为锚点：滑块给绝对 px，提交时
   * 落到最近的档位、用 `font_scale_adjust` 系数补齐差值。由后端下发，前端不写死。
   */
  base_px: number;
}

/** 版式的一项可调参数（后端 FORMAT_FIELDS）。 */
export interface ResumeFormatField {
  key: string;
  label: string;
  type: "color" | "number";
  min?: number;
  max?: number;
  step?: number;
  description?: string;
}

export interface ResumeStyleField {
  key: string;
  label: string;
  type: "color" | "number" | "select";
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  description?: string;
}

export interface ResumeFormatPreset {
  name: string;
  label: string;
  description: string;
  config: ResumeFormatConfig;
  custom?: boolean;
  id?: number | null;
}

export interface ResumeTemplateCatalog {
  templates: ResumeTemplateOption[];
  font_scales: ResumeFontScaleOption[];
  /** 版式的可调参数清单与内置预设。 */
  format_fields: ResumeFormatField[];
  style_fields: ResumeStyleField[];
  format_presets: ResumeFormatPreset[];
  /** 正文分区清单（「调整板块顺序」用）。键名、标签与默认顺序都由后端下发。 */
  section_options: { key: string; label: string }[];
  /** 内置默认顺序：已保存简历没有自己的 `section_order` 时读它（老简历外观不追溯改变）。 */
  default_section_order: string[];
  /**
   * 「我的资料」里排好的顺序，已翻译成正文分区键（后端可能不给，旧目录没有这一项）。
   *
   * 只用于**生成**新简历时的默认值；预览 / 编辑已保存简历时不读它——否则在资料页
   * 拖一下顺序，所有老简历的外观都会跟着变。
   */
  profile_section_order?: string[];
  /**
   * 「我的资料」里**原样**排过的分区键（`educations` / `projects` …，不补齐、不映射）。
   *
   * 与上面的 `profile_section_order` 分工不同：那个是"翻译成简历分区键的完整排列"（给新简历
   * 的默认值用），这个是"资料里到底有没有可排序的分区"这个事实本身——空数组意味着
   * 「按我的资料顺序排列」这个动作**无从谈起**，界面上那颗按钮必须禁用并说明原因。
   * 旧后端不下发时按 `undefined` 处理（与空数组同义：不提供这个动作）。
   */
  profile_section_keys?: string[];
  /** 三个版式参数的默认值由后端下发，前端不写死——改默认值只改一处。 */
  defaults: {
    template: string;
    font_scale: ResumeFontScale;
    page_limit: number;
    format_name?: string;
  };
  /** 系统里是否找到中文字体：决定「直接下载 PDF」是否可用。 */
  pdf_direct_available: boolean;
  /**
   * 每个内置模板的版式默认值（只含用户可调的三项：行距 / 页边距 / 区块间距）。
   *
   * 行距控件在"用户没设过覆盖"时要显示模板的真实默认值，否则滑块会停在一个与实际
   * 渲染不同的数字上。旧后端不下发这一项时前端回退到 `DEFAULT_LINE_HEIGHT`。
   */
  template_layouts?: Record<
    string,
    { line_height: number; padding_mm: number; section_gap: number }
  >;
  /** 模板市场预设（R-19）：映射既有模板 + 版式 + 建议字号。 */
  market: TemplateMarketPreset[];
}

/**
 * 版式参数：模板 + 版式 + 页数 + 字号。
 *
 * 拆成"样式"和"格式"两件事：样式决定长什么样（HTML/CSS），格式决定排得多密
 * （行高、页边距、强调色）。用户常常只想换其中一个。
 */
export interface ResumeLayout {
  template: string;
  format_name: string;
  page_limit: ResumePageLimit | number;
  font_scale: ResumeFontScale;
  /**
   * 纸面固定文案的语言。**可选**：`undefined` = 这次不涉及。
   *
   * `PATCH /resumes/{id}/layout` 是**整体替换**，所以"不传"必须能表达"别动它"——
   * 写成必填带默认值，拖一次字号滑杆就会把英文简历静默改回中文。
   */
  language?: ResumeLanguage;
  /**
   * 按简历的版式覆盖。
   *
   * 三态语义，必须区分开：**不传**（undefined）= 这次不涉及、保持原样；
   * **空对象** = 明确清掉覆盖；**有值** = 写入。
   */
  format_config?: ResumeFormatConfig;
}

/** 简历列表排序（R14）：与后端 `RESUME_SORT_ORDERS` 的键逐字一致。 */
/**
 * 简历列表排序键（与后端 `GET /api/resumes` 的 `sort` Literal **完全一致**）。
 *
 * T2 起每个字段都有升降两个方向：列头三态排序（升序 → 降序 → 取消）需要反向键，
 * 后端没有 `order` 覆盖参数。
 */
export type ResumeSortOrder = "asc" | "desc";

export type ResumeSort =
  | "updated_desc"
  | "updated_asc"
  | "created_desc"
  | "created_asc"
  | "title_asc"
  | "title_desc"
  | "company_asc"
  | "company_desc"
  | "job_title_asc"
  | "job_title_desc";

export interface ResumeBrief {
  id: number;
  title: string;
  job_id: number | null;
  job_title: string;
  company: string;
  source: "ai" | "manual";
  favorite: boolean;
  /** 简历备注（B5）：列表可见、详情可编辑，与后端 ``ResumeRecord.note`` 对齐。 */
  note: string;
  model: string;
  enhancement_enabled: boolean;
  enhancement_level: EnhancementLevel;
  template: string;
  /** 版式（一组排版覆盖）名；空串表示用模板默认的版式。 */
  format_name: string;
  /**
   * 只属于这份简历的版式覆盖（叠加在 format_name 之上）。
   *
   * 「自动一页」试出来的方案写在这里，而不是去改具名版式——那会让所有引用它的
   * 简历一起变，而自动一页的结果只对当前这份内容成立。
   */
  format_config: ResumeFormatConfig;
  page_limit: number;
  font_scale: ResumeFontScale;
  /** 纸面固定文案的语言：后端必有值（列有 `server_default "zh-CN"`），旧记录同样是中文。 */
  language?: ResumeLanguage;
  created_at: string;
  /** 最近修改时间（R14-b）：列表「最近修改」列与默认排序 `updated_desc` 同源；旧数据可能缺失。 */
  updated_at?: string | null;
  /**
   * 保存次数（0052 / W02）：列表页记下它，进制作台保存时当 `expected_revision` 发回。
   * 后端旧版本不返回该字段，前端按 0 兜底（"不知道版本"只影响乐观更新的起点，不影响旧接口可用）。
   */
  revision?: number;
  /**
   * 文档模式（W14）：普通简历 default `resume`（1–3 页）；`long_cv` 为独立长 CV 模式（1–10 页，默认 2）。
   * 与后端 `resume_record.document_mode` 同名（snake_case，和既有 page_limit/format_name 一致）；
   * 旧后端不返回时按 `resume` 处理。
   */
  document_mode?: "resume" | "long_cv";
}

/** 版本血缘（RF-17）：由哪份简历派生而来；null = 独立版本，不做推断。 */
export interface DeliverySummary {
  id: number;
  created_at: string;
  source: string;
  job_title: string;
  company: string;
  resume_title: string;
  export_format: string;
  filename: string;
  pages: number | null;
  content_sha256: string;
  rendered_config_sha256: string;
}

/**
 * 一条交付记录的详情（PR-09 可信交付账本）：独立访问入口
 * `GET /resumes/deliveries/{id}` 的响应体。旧快照缺新列时字段为
 * null/false——UI 据此标注「不可还原」，不编造数据。
 */
export interface DeliveryDetail extends DeliverySummary {
  /** 实际生效的渲染上下文；旧快照为空对象。 */
  render_context: Record<string, unknown>;
  /** 实际生效的导出请求参数；null = 无导出请求（apply/track）或旧快照（不可还原）。 */
  request_params: Record<string, unknown> | null;
  /** 导出前源内容哈希 / 导出产物字节哈希；旧行为 null。 */
  source_content_sha256: string | null;
  artifact_sha256: string | null;
  /** 幂等键（代表哪一次真实投递动作）；旧记录为 null。 */
  idempotency_key: string | null;
  /** 是否可从存档重放导出。 */
  replayable: boolean;
  /** 目的地快照是否完整；false = 旧版本快照没有目的地字段。 */
  destination_recorded: boolean;
}

/** 版式覆盖：键取自 `ResumeFormatField.key`，值都是数值（颜色也是十六进制字符串）。
 *  例外是 `section_order`：它是一串分区键，不是 CSS 数值（见 resumeSectionOrder.ts）。 */
export type { ResumeFormatConfig } from "./resumeFormat";

/** 版式诊断与「自动一页」的类型组：定义在 `resumeLayout.ts`，此处 re-export
 *  保持所有既有 `@/types/resume` 导入路径不变（纯搬迁，未改字段）。 */
export type {
  ResumeFitCandidate,
  ResumeFitRoom,
  ResumeLayoutAnalysis,
  ResumeLayoutDiagnosis,
  ResumeLayoutMeasure,
  ResumeLayoutPageFill,
  ResumeLayoutStatus,
  ResumeLayoutSuggestion,
} from "./resumeLayout";

/** 新建/生成的请求契约（F4-BE）：从 `types/resumeCreation` 提取，此处 re-export 兼容。 */
export type {
  ManualResumeCreatePayload,
  ProfileCreationContext,
  ProfileCreationLayoutItem,
  StartResumeGenerationPayload,
} from "./resumeCreation";

export interface ResumeDetail extends ResumeBrief {
  content: ResumeContent;
  warnings: string[];
  parse_error: string;
  /** 版本血缘（RF-17）：由哪份简历派生而来；null = 独立版本，不做推断。 */
  parent_revision_id: number | null;
  /** 生成说明：这份简历是怎么选出来的（只对 AI 生成的记录有意义，修订/手写为空）。 */
  rationale: string;
  /** "资料里有、但没写进这份简历"的结构化清单（岗位导向筛选的正常结果）。 */
  coverage_notes: ResumeCoverageNote[];
  /** 事实来源标注（RF-13）：每段内容来自哪条资料事实；旧记录为空。 */
  fact_annotations?: FactAnnotation[];
  /**
   * 这是**制作台草稿**（0051）：还没保存过，所以不在简历中心的任何列表里。
   * 制作台靠它把「保存」常驻——一份刚建出来、内容与版式都没动过的草稿没有别的保存
   * 入口，只能靠这个标志知道"有一件事必须被做"。旧后端不返回该字段时按 `false` 处理。
   */
  draft?: boolean;
  /**
   * 这份简历生成时冻结的职业场景快照（契约 §2.5）：null = 未记录（旧简历/未启用）。
   * 只读展示用——**不得按当前场景回填**，历史记录 NULL 就是"当时没有记录"。
   */
  context_snapshot?: GenerationContextSnapshot | null;
  /** 「本次使用」快照（详情端点填充）：含创建时冻结的编辑器视图；旧简历为 null。 */
  profile_usage?: ResumeProfileUsageSnapshot | null;
}

/** 一条"没写进这份简历"的分区级清单。 */
export interface ResumeCoverageNote {
  /** 资料分区键（projects/experience/...），与简历字段同名。 */
  section: string;
  section_label: string;
  /** 全部未写入的条目身份名。 */
  names: string[];
  /** 被岗位筛选/预算拦下的（没进候选资料）。 */
  filtered: string[];
  /** 进了候选但模型没写的。 */
  model_omitted: string[];
  total: number;
}

export type ResumeSuggestionPriority = "high" | "medium" | "low";

/** 一条内容的事实来源标注（RF-13，与后端 FactAnnotation 逐字对齐）。 */
export type FactAnnotationOrigin =
  "grounded" | "restored" | "enhanced_kept" | "ai_rewrite" | "user_added";

export interface FactAnnotation {
  path: string;
  origin: FactAnnotationOrigin;
  claim_id?: number | null;
  source_subject?: string | null;
  source_fact?: string | null;
  responsibility?: string | null;
  boundary?: string | null;
  verification_status?: string | null;
}

/**
 * 一条待审变更（RF-13）：编辑器的 AI 改写 / 手填在落表单前的预检单位。
 * ``before`` / ``after`` 是该栏的完整文本（多行用 \n 连接）。
 */
export interface ResumePendingChange {
  path: string;
  before: string;
  after: string;
  origin: "ai_rewrite" | "user_added";
  instruction?: string;
  /** 变更所属条目的主体名（公司 / 项目名），用于 fact_check_needed 时的台账跳转链接。 */
  subject?: string;
  verdict?: "ok" | "fact_check_needed" | "blocked";
  reasons?: string[];
}

/** 预检结论（RF-13，与后端 ReviewChangeVerdictOut 对齐）。 */
export interface ResumeReviewResult {
  path: string;
  verdict: "ok" | "fact_check_needed" | "blocked";
  reasons: string[];
}

export interface ResumeSuggestion {
  priority: ResumeSuggestionPriority;
  section: string;
  issue: string;
  suggestion: string;
  evidence: string[];
}

export interface ResumeSuggestions {
  job_id: number;
  job_title: string;
  company: string;
  suggestions: ResumeSuggestion[];
}

/**
 * 「用于本次生成」的职业场景上下文（契约 §2.5，字段名与后端逐字一致）。
 *
 * **缺省 / null = 不启用**：请求体里不出现 `career_context` 键，生成路径与旧版本
 * 逐字节一致。`scenario_id` 与 `preset_key` 二选一：已保存场景必须带
 * `expected_revision`，内置快捷场景必须带与目录一致的 `catalog_version`。
 */
export interface CareerContextRequest {
  scenario_id?: number;
  preset_key?: string;
  catalog_version?: string;
  expected_revision?: number;
  include_employment_status?: boolean;
}

/**
 * 生成上下文快照（服务端写进 `context_snapshot` 列的结构，契约 §2.5）。
 *
 * 制作台只读展示用：`display_name` 是「本次场景」的名字，`disclosure` 说明就业状态
 * 是否被允许发送。**不包含姓名/联系方式等私密数据**（服务端裁剪）。
 */
export interface GenerationContextSnapshot {
  schema_version: number;
  scenario_origin: "preset" | "saved";
  scenario_id: number | null;
  preset_key: string | null;
  scenario_revision: number | null;
  catalog_version: string | null;
  display_name: string;
  resolved_dimensions: Record<string, unknown>;
  approved_guidance: string[];
  disclosure: { include_employment_status: boolean };
  resolver_version?: string;
  prompt_fragment_version?: string;
  context_sha256?: string;
  captured_at?: string;
}

export interface GenerateOptions {
  enhance: boolean;
  enhancement_level: EnhancementLevel;
  page_limit: number;
  font_scale: ResumeFontScale;
  template: string;
  format_name: string;
  /**
   * 生成时就生效的版式覆盖（板块顺序、字号系数等）。
   *
   * 不传也行（后端默认 `{}`）：有了它，用户在配置页调的顺序与字号才会跟着简历落库，
   * 关掉弹窗再从简历中心重开仍然是他调过的那一版。
   */
  format_config?: ResumeFormatConfig;
  /** 用户自己补充的生成要求（≤2000 字），作为附加上下文交给模型。 */
  custom_instruction: string;
  /**
   * 长 CV 文档模式（契约 §5）：`resume`（默认）/ `long_cv`。
   *
   * **默认不发送该字段**（保持旧请求逐字节兼容）；只有用户显式选了长 CV 才带上。
   */
  document_mode?: "resume" | "long_cv";
  /**
   * 本次生成显式选用的职业场景（契约 §2.5）。
   *
   * 缺省 / null = 不启用：**不要**发空对象——后端按"没有这个键"保持旧行为。
   */
  career_context?: CareerContextRequest | null;
}

/** 生成接口 SSE 事件（与后端 generator 事件一一对应）。 */
export type StreamEvent =
  | { type: "progress"; message: string }
  | { type: "delta"; text: string }
  | {
      type: "done";
      resume: ResumeContent;
      warnings: string[];
      coverage_notes?: ResumeCoverageNote[];
      rationale?: string;
    }
  | { type: "saved"; record_id: number }
  | { type: "error"; message: string };

/** 后台简历生成任务的终态/进行态（与后端 models.resume 顶部的生成状态常量一致）。 */
export type ResumeGenerateTaskStatus = "pending" | "running" | "completed" | "cancelled" | "failed";

/**
 * 后台简历生成任务的状态（前端按 1.5s 轮询 GET /resumes/generate/tasks/{id}）。
 *
 * 生成改为后台任务后，前端不再直接消费 SSE 的 delta/progress，而是从这里拿：
 * ``message`` 是后端最近一条 progress 文案（映射阶段条），``received_chars`` 是已接收
 * 字数（只计数、不做百分比——总长未知）。``resume_id`` 仅在 completed 后回填。
 */
export interface ResumeGenerateTask {
  id: number;
  status: ResumeGenerateTaskStatus;
  resume_id: number | null;
  error: string;
  message: string;
  received_chars: number;
  job_id: number | null;
  title: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}
