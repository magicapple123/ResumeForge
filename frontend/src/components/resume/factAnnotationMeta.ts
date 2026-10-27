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

/** 判断一条标注在界面上可不可以显示"已确认"：AI 来源的永远不行。 */
export function canShowVerified(annotation: FactAnnotation): boolean {
  return !AI_ORIGINS.has(annotation.origin);
}
