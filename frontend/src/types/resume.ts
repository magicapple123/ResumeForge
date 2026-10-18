/** 简历内容、生成选项和简历建议类型。 */
import type { TemplateMarketPreset } from "./templateMarket";

export interface ResumeEducation {
  school: string;
  major: string;
  degree: string;
  start_date: string;
  end_date: string;
  gpa: string;
  courses: string[];
  achievements: string[];
}

export interface ResumeExperience {
  company: string;
  role: string;
  start_date: string;
  end_date: string;
  description: string[];
}

export interface ResumeCampusExperience {
  organization: string;
  role: string;
  start_date: string;
  end_date: string;
  description: string[];
}

export interface ResumeProject {
  name: string;
  role: string;
  start_date: string;
  end_date: string;
  tech_stack: string[];
  description: string[];
  highlights: string[];
}

export interface ResumeSkill {
  name: string;
  level: string;
}

export interface ResumeAward {
  name: string;
  date: string;
  description: string;
}

export interface ResumeContent {
  photo: string;
  name: string;
  gender: string;
  birth_year: string;
  phone: string;
  email: string;
  city: string;
  /** 公开作品链接：生成时从资料带入，可留空。 */
  personal_website: string;
  github: string;
  job_intent: string;
  summary: string;
  education: ResumeEducation[];
  experience: ResumeExperience[];
  campus_experience: ResumeCampusExperience[];
  projects: ResumeProject[];
  skills: ResumeSkill[];
  awards: ResumeAward[];
}

export type EnhancementLevel = "light" | "balanced" | "strong";

/** 字号档位（后端 ResumeFontScale）。 */
export type ResumeFontScale = "small" | "standard" | "large";

/** 最大篇幅：A4 页数，与后端 MAX_RESUME_PAGES 一致。 */
export const RESUME_PAGE_LIMITS = [1, 2, 3] as const;

export type ResumePageLimit = (typeof RESUME_PAGE_LIMITS)[number];

export interface ResumeTemplateOption {
  name: string;
  label: string;
  description: string;
  /** 用户自制的样式模板；内置模板为 false。 */
  custom?: boolean;
  id?: number | null;
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

/** 格式模板的一项可调参数（后端 FORMAT_FIELDS）。 */
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
  /** 格式模板的可调参数清单与内置预设。 */
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
  /** 三个版式参数的默认值由后端下发，前端不写死——改默认值只改一处。 */
  defaults: {
    template: string;
    font_scale: ResumeFontScale;
    page_limit: number;
    format_name?: string;
  };
  /** 系统里是否找到中文字体：决定「直接下载 PDF」是否可用。 */
  pdf_direct_available: boolean;
  /** 模板市场预设（R-19）：映射既有样式模板 + 格式预设 + 建议字号。 */
  market: TemplateMarketPreset[];
}

/**
 * 版式参数：样式模板 + 格式模板 + 页数 + 字号。
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
   * 按简历的版式覆盖。
   *
   * 三态语义，必须区分开：**不传**（undefined）= 这次不涉及、保持原样；
   * **空对象** = 明确清掉覆盖；**有值** = 写入。
   */
  format_config?: ResumeFormatConfig;
}

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
  /** 格式模板（版式覆盖）名；空串表示用样式模板自带的版式。 */
  format_name: string;
  /**
   * 只属于这份简历的版式覆盖（叠加在 format_name 之上）。
   *
   * 「自动一页」试出来的方案写在这里，而不是去改具名格式模板——那会让所有引用它的
   * 简历一起变，而自动一页的结果只对当前这份内容成立。
   */
  format_config: ResumeFormatConfig;
  page_limit: number;
  font_scale: ResumeFontScale;
  created_at: string;
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
import type { ResumeFormatConfig } from "./resumeFormat";

export type { ResumeFormatConfig };

/** 「自动一页」用的实测高度，单位随意、只要两者同单位（前端传的是 CSS 像素）。 */
export interface ResumeLayoutMeasure {
  used_height: number;
  page_content_height: number;
  page_limit: number;
}

export type ResumeLayoutStatus =
  "overflow" | "dense" | "healthy" | "sparse" | "too_sparse" | "unknown";

export interface ResumeLayoutSuggestion {
  kind: string;
  title: string;
  detail: string;
}

export interface ResumeLayoutPageFill {
  page: number;
  fill: number;
}

export interface ResumeLayoutDiagnosis {
  status: ResumeLayoutStatus;
  status_label: string;
  summary: string;
  /** 整体填充度（0~1 的小数，可能大于 1 表示溢出）。 */
  fill: number;
  pages_needed: number;
  page_limit: number;
  pages: ResumeLayoutPageFill[];
  suggestions: ResumeLayoutSuggestion[];
}

/** 一档候选版式：把 `css` 注入预览、量一次，够放下就用它。 */
export interface ResumeFitCandidate {
  key: string;
  label: string;
  config: ResumeFormatConfig;
  css: string;
}

export interface ResumeFitRoom {
  has_room: boolean;
  steps: number;
  font_floor_px: number;
  font_adjust_floor: number;
  font_floor_note: string;
}

export interface ResumeLayoutAnalysis {
  diagnosis: ResumeLayoutDiagnosis;
  fit_ladder: ResumeFitCandidate[];
  fit_room: ResumeFitRoom;
}

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
