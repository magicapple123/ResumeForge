// SPDX-License-Identifier: Apache-2.0
/**
 * W10「当前内容试模板」的类型（契约 §W10 / plan P1-05）。
 *
 * 关键边界：**试用期间不改文档**。这里没有任何"写回布局"的字段——采纳才由宿主的
 * `onTrialAdopt` 落一次 `layout` 变更；试用状态（左右模板、预览内容模式、测量结果）
 * 只活在这个临时会话里，关掉就丢。
 */
import type { ResumeDocument, ResumeFormatConfig, ResumeLayout } from "../../types";

/** 预览内容：内置示例（能看外观、不测篇幅）/ 用户自己的内容（真实测量）。 */
export type TrialContentMode = "demo" | "current";

/** 对比视图的左右两栏。 */
export type TrialSide = "left" | "right";

/** 真实 PDF 排版测量结果（与导出/精确预览同一口径，来自响应头）。 */
export interface TrialMeasurement {
  /** 实际页数（超限时是被截断后的页数 = 上限）。 */
  pages: number | null;
  /** 按当前参数**真实需要**的页数（未截断）。 */
  pagesNeeded: number | null;
  pageLimit: number | null;
  overflow: boolean;
}

/** 一侧的预览与测量状态。 */
export interface TrialSideState {
  template: string;
  html: string;
  htmlLoading: boolean;
  htmlError: string | null;
  measurement: TrialMeasurement | null;
  measureLoading: boolean;
  measureError: string | null;
}

/** 一次试用请求的上下文（不随侧变化）。 */
export interface TrialRequestContext {
  mode: TrialContentMode;
  layout: ResumeLayout;
  /** 当前简历 id：测量与"我的内容"预览需要；新建未落库的草稿可能没有。 */
  resumeId?: number | null;
  /** 未保存的当前正文（W04 的 content 覆盖）；没有时按已保存记录预览。 */
  content?: ResumeDocument | null;
}

/** 采纳一次试用：`formatConfig` 是**最终**要写入的排版覆盖（空对象 = 采用模板默认）。 */
export interface TrialAdoptRequest {
  template: string;
  formatConfig: ResumeFormatConfig;
}

/** 一侧的一次取数（context + 模板 + 覆盖策略）。 */
export interface TrialSideRequest {
  context: TrialRequestContext;
  template: string;
  /** 预览/测量是否带上用户当前的排版覆盖（保留 = true，模板默认 = false）。 */
  useOverrides: boolean;
}
