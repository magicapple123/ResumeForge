// SPDX-License-Identifier: Apache-2.0
/**
 * 事实标注的展示元数据（RF-13）：与 EvidencePanel 组件解耦存放。
 *
 * 独立成文件是 react-refresh/only-export-components 的要求——组件文件只导出
 * 组件，常量与纯函数放这里（quickStartPaths.ts 同款先例）。
 */
import type { MessageKey } from "../../i18n";
import type { FactAnnotation, FactAnnotationOrigin } from "../../types";

/** 四类 origin 的展示文案 key（渲染处再过 t()；色板刻意与台账状态 Tag 同源）。 */
export const ORIGIN_LABELS: Record<FactAnnotationOrigin, MessageKey> = {
  grounded: "resume.evidence.origin.grounded",
  restored: "resume.evidence.origin.restored",
  enhanced_kept: "resume.evidence.origin.enhancedKept",
  ai_rewrite: "resume.evidence.origin.aiRewrite",
  user_added: "resume.evidence.origin.userAdded",
};

export const ORIGIN_COLORS: Record<FactAnnotationOrigin, string> = {
  grounded: "green",
  restored: "blue",
  enhanced_kept: "gold",
  ai_rewrite: "volcano",
  user_added: "purple",
};

/** 事实依据 / 责任边界 / 核实状态是否值得展示的来源分类。 */
export const AI_ORIGINS: ReadonlySet<FactAnnotationOrigin> = new Set([
  "enhanced_kept",
  "ai_rewrite",
]);

/**
 * 字段旁徽标的三档来源（#24 24E）：`data-source` 的取值就是这三个词。
 *
 * 后端给的是五种 `origin`（精确到"怎么来的"），而编辑器里那颗小徽标只能放一个字眼——
 * 用户在改字段时问的是"这句话是谁写的"，答案只有三个：资料库里本来就有 / AI 写的 /
 * 我自己填的。五→三的映射必须**只有一份**（下面这张表），否则同一段内容在证据面板
 * 与徽标上会给出互相矛盾的来源分类。证据面板（`EvidencePanel`）仍然显示细分的五种，
 * 因为它有整行空间，而"回填原文"与"资料原文"对核对事实是有区别的。
 */
export type FactSourceKind = "profile" | "ai" | "manual";

/** 五种 origin → 三档来源。 */
export const FACT_SOURCE_KIND: Record<FactAnnotationOrigin, FactSourceKind> = {
  grounded: "profile",
  restored: "profile",
  enhanced_kept: "ai",
  ai_rewrite: "ai",
  user_added: "manual",
};

/** 三档来源的展示文案 key（渲染处再过 t()）。 */
export const FACT_SOURCE_LABELS: Record<FactSourceKind, MessageKey> = {
  profile: "resume.factSource.profile",
  ai: "resume.factSource.ai",
  manual: "resume.factSource.manual",
};

/** 一条标注属于哪一档来源。 */
export function factSourceKind(annotation: FactAnnotation): FactSourceKind {
  return FACT_SOURCE_KIND[annotation.origin] ?? "profile";
}

/** 判断一条标注在界面上可不可以显示"已确认"：AI 来源的永远不行。 */
export function canShowVerified(annotation: FactAnnotation): boolean {
  return !AI_ORIGINS.has(annotation.origin);
}
