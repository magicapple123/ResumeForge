// SPDX-License-Identifier: Apache-2.0
/** 岗位、岗位解析和岗位分析类型。 */

import type { RecognitionSource, SkillTag } from "./common";

/**
 * 招聘信息的录入方式（后端 `RECOGNITION_SOURCES`）。
 * 它是"这条信息**怎么录进来的**"（驱动列表角标与筛选）；用户可见、可编辑的
 * 「来源」字段是 `Job.origin_source`，两者是两回事。
 */
export const JOB_RECOGNITION_SOURCES = [
  "手动填写",
  "粘贴文本识别",
  "图片识别",
  "文档识别",
  "备选岗位导入",
  "AI 助手录入",
  "岗位采集",
  "官网采集",
] as const;

export type JobRecognitionSource = "" | (typeof JOB_RECOGNITION_SOURCES)[number];

/**
 * 岗位类型选项（唯一来源）。
 *
 * 定义放这里而不是放在 `components/jobs/form/jobFormOptions.ts` 或
 * `pages/jobs/jobFilterOptions.ts`：那两个文件过去各写一份逐字相同的定义，改一处就会分叉；
 * `types/` 是 `pages/` 与 `components/` 都合法依赖的唯一公共层。选项值就是落库值。
 */
// i18n-ok: 岗位类型是落库的数据值（与后端 job_type 同值），不是可自由改写的文案
export const JOB_TYPE_OPTIONS = ["校招", "实习", "社招", "其他"].map((value) => ({
  value,
  label: value,
}));

/**
 * 岗位状态 → 展示名 + Tag 颜色（唯一来源）。
 *
 * **三个键是落库的数据值，一个字符都不能改**：`backend/app/models/job.py` 的
 * `JOB_STATUS_OPEN` / `JOB_STATUS_CLOSED` 就是「开放中」/「已截止」，
 * `backend/app/schemas/job.py` 的默认值是「开放中」，投递成功时
 * `backend/app/services/apply/_records.py` 会把岗位状态写成「已投递」。
 * 改这些键等于改数据语义（需要迁移脚本 + 后端常量同步），不在文案整改范围。
 *
 * label 才是给界面看的：将来真要换个叫法，只改 label，键（数据值）不动。
 * 颜色与标签同源，避免 `JobTable` 再写一份「中文值当查找键」的颜色表——那种写法在
 * 状态值改名时会静默掉成 `default`，`tsc` 也不报。
 */
export const JOB_STATUS_META: Record<string, { label: string; color: string }> = {
  开放中: { label: "开放中", color: "green" }, // i18n-ok: 岗位状态是落库的数据值（B0 只搬位置）
  已截止: { label: "已截止", color: "default" }, // i18n-ok: 岗位状态是落库的数据值（B0 只搬位置）
  已投递: { label: "已投递", color: "blue" }, // i18n-ok: 岗位状态是落库的数据值（B0 只搬位置）
};

/** 岗位状态选项：由 META 派生，标签与列表里的状态 Tag 同源（下拉顺序 = META 键序）。 */
export const JOB_STATUS_OPTIONS = Object.entries(JOB_STATUS_META).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

export interface Job {
  id: number;
  title: string;
  company: string;
  location: string;
  salary: string;
  job_type: string;
  description: string;
  requirements: string;
  additional_info: string;
  keywords: SkillTag[];
  source: string;
  source_url: string;
  posted_at: string;
  status: string;
  note: string;
  /** 备注里的图片（受限的 base64 data URL，最多 2 张）。 */
  note_images: string[];
  recognition_source: JobRecognitionSource;
  /**
   * 用户可见、可编辑的「来源」字段：这条招聘信息从哪来的（如"内推"/"招聘会"）。
   * 可留空、可随时清空——备注不再自动追加「来源：…」行（0042 起拆成独立字段）。
   */
  origin_source: string;
  favorite: boolean;
  /**
   * 这个岗位能不能用「投递台」自动投递：来源 / 投递链接必须能归属到某个招聘网站。
   *
   * 由**后端算好下发**（判据在后端只有一处），前端据此禁用「加入投递台」并把原因写在旁边，
   * 而不是让用户点一下才被拒。前端不写死站点名或主机名。
   *
   * **可选**：后端读取接口始终会带这个字段，但缺失时按"支持"处理（与后端 `default=True`
   * 同向）——少一个字段就判成不可投，会把本来能投的岗位藏起来。所以判断一律写
   * `job.apply_supported === false`，不要写 `!job.apply_supported`。
   */
  apply_supported?: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * 岗位列表项（`GET /jobs` 与收藏夹的列表响应）。
 *
 * 与 `Job`（详情 `GET /jobs/{id}`）的字段一致，但**不带 JD 全文**——列表页从不消费
 * 整份岗位描述，带着它会让响应随 JD 长度线性膨胀（PR-17 瘦身）。需要 JD 的场景
 * （详情抽屉 / 编辑表单 / 生成简历 / 自行编写）用 `getJob(id)` 单取详情那份。
 *
 * `has_description` 由后端算好下发：列表页「补齐详情」按钮据此判断哪些岗位缺 JD，
 * 不再对（已不存在的）description 做 trim。
 */
export type JobList = Omit<Job, "description"> & {
  has_description: boolean;
};

/** 一次粘贴里含多份招聘信息时的解析结果；只有一个元素表示没识别出多份。 */
export interface JobMultiParseResult {
  items: ParsedJobDraft[];
  parse_engine: RecognitionSource;
  warnings: string[];
}

export interface JobPayload {
  title: string;
  company?: string;
  location?: string;
  salary?: string;
  job_type?: string;
  description?: string;
  requirements?: string;
  additional_info?: string;
  source_url?: string;
  posted_at?: string;
  status?: string;
  note?: string;
  note_images?: string[];
  recognition_source?: JobRecognitionSource;
  origin_source?: string;
  favorite?: boolean;
}

/** 备选岗位：还没核对的招聘信息暂存。 */
export type CandidateJobStatus = "pending" | "imported";

export const CANDIDATE_JOB_SOURCE_LABELS = [
  "手动添加",
  "粘贴文本",
  "招聘截图",
  "招聘文档",
] as const;

export type CandidateJobSource = (typeof CANDIDATE_JOB_SOURCE_LABELS)[number] | "助手录入";

export interface CandidateJob {
  id: number;
  title: string;
  company: string;
  /** 采集多带出来的两个字段；手动粘贴的候选为空串。 */
  location: string;
  salary: string;
  raw_text: string;
  images: string[];
  note: string;
  /**
   * 来源。手动录入的是 `CANDIDATE_JOB_SOURCE_LABELS` 里的那几种；**投递台采集进来的是
   * 站点名**（由后端站点注册表给出，前端不写死具体名字），所以读取侧不能收窄成枚举——
   * 收窄会让后端多注册一个站点就把界面类型检查搞红。
   */
  source: string;
  /**
   * 采集带回来的 JD 两段（已在服务端按小标题切好）。
   *
   * **只在 `getCandidateJob`（单条详情）里有值**——列表接口不带它们，理由是体积：列表最多
   * 300 条而单条正文上限几万字符，塞进列表会让「打开备选岗位」随采集量线性变慢。
   *
   * 声明成可选是**在说实话**：它曾经是必填 `string`，而列表从来不给——类型在说谎，
   * 直到有人真的去读它（从备选岗位导入时预填表单）才炸成"导入进来什么都没有"。
   */
  description?: string;
  requirements?: string;
  /** 原始岗位链接（采集来的才有）：界面上用它显示「回原站看」。 */
  source_url: string;
  /** 产生这条候选的采集批次；为空表示不是采集来的。 */
  collect_task_id: number | null;
  status: CandidateJobStatus;
  imported_job_id: number | null;
  created_at: string;
  updated_at: string;
}

/** 单条候选的**完整**内容（`GET /candidate-jobs/{id}`）。要读 JD 就用它。 */
export interface CandidateJobDetail extends CandidateJob {
  description: string;
  requirements: string;
  job_type: string;
  additional_info: string;
}

export type CandidateJobImportOutcomeKind =
  "imported" | "duplicate" | "trashed" | "invalid" | "missing";

/** 单条候选的导入结果：**逐条**反馈，用户才知道是哪几条没进去、为什么。 */
export interface CandidateJobImportOutcome {
  candidate_id: number;
  title: string;
  outcome: CandidateJobImportOutcomeKind;
  job_id?: number | null;
}

export interface CandidateJobImportResult {
  imported: number;
  duplicate: number;
  /** 岗位广场的回收站里已有同名岗位：既没新建也没恢复，等你去回收站处理。 */
  trashed: number;
  invalid: number;
  missing: number;
  results: CandidateJobImportOutcome[];
}

export interface CandidateJobPayload {
  title?: string;
  company?: string;
  /** 岗位链接（选填）：添加备选时留个"回原站看"的入口，导入岗位时预填投递链接。 */
  source_url?: string;
  raw_text?: string;
  images?: string[];
  note?: string;
  source?: CandidateJobSource;
}

export interface CandidateJobUpdatePayload {
  title?: string;
  company?: string;
  source_url?: string;
  raw_text?: string;
  images?: string[];
  note?: string;
}

/** 候选 CSV 导入（与岗位 CSV 同一套两步流：预览 → 确认）。 */
export interface CandidateCsvRow {
  line: number;
  data: Record<string, string>;
}

export interface CandidateCsvPreview {
  rows: CandidateCsvRow[];
  errors: { line: number; message: string; code: "invalid" }[];
}

export interface CandidateCsvImportResult {
  imported: number;
  failed: { line: number; message: string; code: "duplicate" | "invalid" | "error" }[];
}

export interface ParsedJobDraft extends Required<
  Omit<JobPayload, "note" | "favorite" | "note_images" | "recognition_source">
> {
  warnings: string[];
  /**
   * 识别引擎（模型还是本地规则）。与 `Job.recognition_source`（招聘信息的**录入方式**）
   * 是两件事：这里只说明这次识别是谁做的，保存岗位时的来源由输入类型决定。
   */
  parse_engine: RecognitionSource;
  /** 图片识别时模型逐字抄录的原文；纯文本识别为空。 */
  recognized_text: string;
}

export interface JobBatchStatusResult {
  updated: number;
}

export interface JobBatchDeleteResult {
  deleted: number;
}

/** CSV 导入：一行待导入数据（line 是预览时的文件真实行号，账目里原样带回）。 */
export interface JobImportRow {
  line: number;
  data: Record<string, string>;
}

export interface JobImportPreview {
  rows: JobImportRow[];
  errors: { line: number; message: string }[];
}

export interface JobImportResult {
  imported: number;
  failed: { line: number; message: string }[];
}

export type JobAnalysisPriority = "high" | "medium" | "low";

export interface JobRequirementAnalysis {
  priority: JobAnalysisPriority;
  category: string;
  requirement: string;
  evidence: string;
}

export interface JobSearchAdvice {
  title: string;
  action: string;
  rationale: string;
}

export interface JobAnalysisResult {
  summary: string;
  requirements: JobRequirementAnalysis[];
  advice: JobSearchAdvice[];
}
