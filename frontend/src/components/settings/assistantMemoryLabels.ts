// SPDX-License-Identifier: Apache-2.0
/**
 * 记忆 kind 的界面显示名（#31C）：kind 是协议值，显示名在前端语言包。
 *
 * 单独成文件的两个原因：① 弹层组件与列表卡都要用同一份映射（两处各写一份必然漂移）；
 * ② 组件文件只导出组件（react-refresh 的 only-export-components 规范）。
 * 未知 kind（后端将来加类）用后端下发的 kind_label 兜底，不把内部值直接展示给用户。
 */
import { t, type MessageKey } from "../../i18n";

const KIND_LABEL_KEYS: Record<string, MessageKey> = {
  target_role: "assistantMemory.kind.target_role",
  city: "assistantMemory.kind.city",
  salary_floor: "assistantMemory.kind.salary_floor",
  avoid_company: "assistantMemory.kind.avoid_company",
  work_mode: "assistantMemory.kind.work_mode",
  skill_tag: "assistantMemory.kind.skill_tag",
  constraint: "assistantMemory.kind.constraint",
};

/** 界面上的 kind 显示名：语言包优先；未知 kind 用后端 label 兜底。 */
export function memoryKindLabel(kind: string, fallback = ""): string {
  const key = KIND_LABEL_KEYS[kind];
  return key ? t(key) : fallback || kind;
}
