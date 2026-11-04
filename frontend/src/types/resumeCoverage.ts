// SPDX-License-Identifier: Apache-2.0
/**
 * 「资料里有、但没写进这份简历」的分区级清单。
 *
 * 从 types/resume.ts 拆出（那个文件贴 500 行预算）；既有导入路径由 resume.ts 的
 * re-export 保持不变。
 */

/**
 * 一条资料条目**为什么**没进这份简历（5-A 协议值，前后端共用，不做本地化）。
 *
 * - `filtered`：与岗位关键词/预算交集不足，没进候选资料
 * - `capacity`：进了筛选但被**单栏目条数上限**裁掉（名额问题，不是不相关）
 * - `model`：进了候选，模型没采用
 */
export type CoverageReason = "filtered" | "capacity" | "model";

/** 一条"没写进这份简历"的分区级清单。 */
export interface ResumeCoverageNote {
  /** 资料分区键（projects/experience/custom:<id>/...），与简历字段同名。 */
  section: string;
  /**
   * 后端下发的分区展示名。
   *
   * 5-A 起它同时也是**分组键的一半**：字段级 note（如 `项目「X」的亮点`）与条目级
   * note 同属 `projects` 却不是一个组，只按 `section` 聚合会把两类内容混在一起。
   */
  section_label: string;
  /** 全部未写入的条目身份名。 */
  names: string[];
  /** 被岗位筛选/预算拦下的（没进候选资料）。 */
  filtered: string[];
  /**
   * 被**单栏目条数上限**裁掉的（没进候选资料，但不是因为不相关）。
   *
   * 与 `filtered` 分开的理由：技能名额只有 14 条，候选已满时多出来的技能会被裁掉——
   * 那是名额问题，不是"这技能和岗位不相关"，更不是"模型没写"。旧后端没有这个字段，
   * 因此可选；缺失时按"没有这类说明"处理。
   */
  capacity_omitted?: string[];
  /** 进了候选但模型没写的。 */
  model_omitted: string[];
  total: number;
  /**
   * 5-A：`names` 里每一条的**显式**原因（后端 `resume_coverage_notes.reasons_for`）。
   *
   * 可选以兼容旧记录：旧记录只有三个数组，前端按 `capacity > filtered > model` 的
   * 优先级回退推导（与后端 `REASON_PRIORITY` 逐条一致）；三类都不命中显示「未说明」，
   * 不硬猜。值域见 {@link CoverageReason}，读侧仍要容忍未知字符串（后端可能扩展）。
   */
  reasons?: Record<string, string>;
  /**
   * 3-A：能从资料快照**唯一定位**到条目的 entry id（只含定位得到的那些名字）。
   *
   * 可选：旧记录、以及走"只带身份名"的旧入口时这个键缺席。缺席 ≠ 空数组——前者是
   * "不知道"，后者是"没有可确定性补入的条目"，前端据此区分"补进简历"与"去制作台添加"。
   */
  entry_ids?: string[];
}
