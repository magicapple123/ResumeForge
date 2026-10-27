// SPDX-License-Identifier: Apache-2.0
/**
 * 投递 / 匹配域的「协议值 → 语言包 key」映射。
 *
 * ## 为什么需要这一层
 *
 * `types/apply/*.ts` 里的 `*_META` / `*_LABELS` / `failureLabel` / `stepLabel` 是
 * **协议值 → 中文展示名**的定义：键就是后端下发、落库用的值（永不翻译），而值直接就是
 * 中文。界面要双语，就必须在**页面层**把"取哪个中文"换成"取哪个 key"——改 types 表
 * 等于让协议值表失去唯一正本，也不是这次迁移的授权范围。
 *
 * ## 约束（与本目录外的既有做法一致）
 *
 * - 这里**只存 key**：模块作用域求值 `t()` 会让文案冻结在加载时的语言上；
 * - 颜色 / 图标 / 分组 / `value` 属性仍从 types 表取，本模块只负责展示名；
 * - 未知取值（后端新增的失败分类 / 步骤码）不在表里，调用方按原逻辑回退原码或后端文案，
 *   例如 `stepKey(x) ? t(stepKey(x)!) : stepLabel(x)`。
 */
import type { MessageKey } from "../../i18n";
import type {
  AdmissionResult,
  BrowserChoice,
  BrowserState,
  FailureCategory,
  MatchStatus,
  QueueStatus,
  TaskItemStatus,
  TaskStatus,
} from "../../types";

/** `QUEUE_STATUS_META` 的三个队列状态（协议值顺序即下拉框顺序）。 */
export const QUEUE_STATUS_LABEL_KEYS: Record<QueueStatus, MessageKey> = {
  pending: "enumsApply.queueStatus.pending",
  skipped: "enumsApply.queueStatus.skipped",
  done: "enumsApply.queueStatus.done",
};

/** `TASK_STATUS_META`：投递 / 采集批次的七态。 */
export const TASK_STATUS_LABEL_KEYS: Record<TaskStatus, MessageKey> = {
  pending: "enumsApply.taskStatus.pending",
  running: "enumsApply.taskStatus.running",
  paused: "enumsApply.taskStatus.paused",
  breaker_paused: "enumsApply.taskStatus.breaker_paused",
  completed: "enumsApply.taskStatus.completed",
  stopped: "enumsApply.taskStatus.stopped",
  failed: "enumsApply.taskStatus.failed",
};

/** `TASK_ITEM_STATUS_META`：批次里单个岗位的五态。 */
export const TASK_ITEM_STATUS_LABEL_KEYS: Record<TaskItemStatus, MessageKey> = {
  pending: "enumsApply.taskItemStatus.pending",
  running: "enumsApply.taskItemStatus.running",
  success: "enumsApply.taskItemStatus.success",
  failed: "enumsApply.taskItemStatus.failed",
  skipped: "enumsApply.taskItemStatus.skipped",
};

/** `BROWSER_STATE_META`：受控浏览器的四态。 */
export const BROWSER_STATE_LABEL_KEYS: Record<BrowserState, MessageKey> = {
  stopped: "enumsApply.browserState.stopped",
  starting: "enumsApply.browserState.starting",
  running: "enumsApply.browserState.running",
  unknown: "enumsApply.browserState.unknown",
};

/**
 * `BROWSER_CHOICE_META` 的**选项名**。
 *
 * 刻意不是 `Record<BrowserChoice, MessageKey>`：`chrome` / `edge` 的名字是品牌名
 * （`Google Chrome` / `Microsoft Edge`），中英文逐字相同、本身不含任何中文。把它们塞进
 * 语言包会让 `messageContract` 的 `source-ascii-english` / `untranslated` 检查失败，
 * 唯一出路是往 `i18n/guards/equalityExemptions.ts` 追加例外——那是本批不允许改的守卫
 * 数据文件。因此这两项继续取 types 表（渲染结果在两种语言下都正确），其余两项走语言包。
 */
export const BROWSER_CHOICE_LABEL_KEYS: Partial<Record<BrowserChoice, MessageKey>> = {
  auto: "enumsApply.browserChoice.auto.label",
  custom: "enumsApply.browserChoice.custom.label",
};

/** `BROWSER_CHOICE_META` 的**说明文字**（四项都是中文原文，全部走语言包）。 */
export const BROWSER_CHOICE_HINT_KEYS: Record<BrowserChoice, MessageKey> = {
  auto: "enumsApply.browserChoice.auto.hint",
  chrome: "enumsApply.browserChoice.chrome.hint",
  edge: "enumsApply.browserChoice.edge.hint",
  custom: "enumsApply.browserChoice.custom.hint",
};

/** `ADMISSION_META` 的三个准入结论（协议值顺序即筛选项顺序）。 */
export const ADMISSION_LABEL_KEYS: Record<AdmissionResult, MessageKey> = {
  allow: "enumsApply.admission.allow",
  needs_confirm: "enumsApply.admission.needs_confirm",
  block: "enumsApply.admission.block",
};

/** `MATCH_STATUS_META` 的五类匹配结论。 */
export const MATCH_STATUS_LABEL_KEYS: Record<MatchStatus, MessageKey> = {
  matched: "enumsApply.matchStatus.matched",
  expression_gap: "enumsApply.matchStatus.expression_gap",
  evidence_insufficient: "enumsApply.matchStatus.evidence_insufficient",
  real_gap: "enumsApply.matchStatus.real_gap",
  to_confirm: "enumsApply.matchStatus.to_confirm",
};

/**
 * `MatchScoreDimension.key`：匹配度参考分的五个分项（后端 `MATCH_SCORE_DIMENSIONS` 的 key）。
 *
 * 分项 `label` 是后端直接下发的**中文展示名**，不是协议值；英文界面照原样渲染就会露出中文。
 * 所以按稳定的 `key` 查表，表里没有的（后端新增分项）由调用方回退 `label` 原文。
 */
export const MATCH_SCORE_DIMENSION_LABEL_KEYS: Record<string, MessageKey> = {
  skill_coverage: "enumsApply.matchDimension.skill_coverage",
  experience_years: "enumsApply.matchDimension.experience_years",
  project_relevance: "enumsApply.matchDimension.project_relevance",
  hard_gate: "enumsApply.matchDimension.hard_gate",
  jd_keyword_coverage: "enumsApply.matchDimension.jd_keyword_coverage",
};

/** `FAILURE_CATEGORY_LABELS` 的十个失败分类。 */
export const FAILURE_CATEGORY_LABEL_KEYS: Record<FailureCategory, MessageKey> = {
  selector_invalid: "enumsApply.failure.selector_invalid",
  login_required: "enumsApply.failure.login_required",
  captcha_required: "enumsApply.failure.captcha_required",
  greeting_missing: "enumsApply.failure.greeting_missing",
  network_timeout: "enumsApply.failure.network_timeout",
  file_upload_failed: "enumsApply.failure.file_upload_failed",
  site_unsupported: "enumsApply.failure.site_unsupported",
  profile_insufficient: "enumsApply.failure.profile_insufficient",
  unconfirmed: "enumsApply.failure.unconfirmed",
  unknown: "enumsApply.failure.unknown",
};

/** `STEP_LABELS` 的八个执行步骤；键是后端下发的步骤码（可能新增，按 `string` 收）。 */
export const STEP_LABEL_KEYS: Record<string, MessageKey> = {
  opening: "enumsApply.step.opening",
  filling: "enumsApply.step.filling",
  greeting: "enumsApply.step.greeting",
  uploading: "enumsApply.step.uploading",
  submitting: "enumsApply.step.submitting",
  verifying: "enumsApply.step.verifying",
  waiting: "enumsApply.step.waiting",
  idle: "enumsApply.step.idle",
};

/**
 * 失败分类的 key；未登记的取值返回 `undefined`。
 *
 * 调用方在 `undefined` 时回退 `failureLabel(category, fallback)`——保留"后端新增分类显示
 * 原码 / 后端文案"的旧行为，而不是显示一条 key 或空白。
 */
export function failureCategoryKey(category: string): MessageKey | undefined {
  return FAILURE_CATEGORY_LABEL_KEYS[category as FailureCategory];
}

/**
 * 执行步骤的 key；未登记的步骤码返回 `undefined`。
 *
 * 回退交给 `stepLabel(step)`：它把空串映射成「空闲」、把未知码原样显示。
 */
export function stepKey(step: string): MessageKey | undefined {
  return STEP_LABEL_KEYS[step];
}

/**
 * 参考分分项的 key；未登记的 `key` 返回 `undefined`。
 *
 * 调用方在 `undefined` 时回退 `dimension.label`——后端新增分项时显示它下发的原文，
 * 而不是显示一个 key 或空白。
 */
export function matchScoreDimensionKey(key: string): MessageKey | undefined {
  return Object.prototype.hasOwnProperty.call(MATCH_SCORE_DIMENSION_LABEL_KEYS, key)
    ? MATCH_SCORE_DIMENSION_LABEL_KEYS[key]
    : undefined;
}
