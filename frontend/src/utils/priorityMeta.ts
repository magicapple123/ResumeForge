// SPDX-License-Identifier: Apache-2.0
/**
 * 三档优先级（high / medium / low）的**唯一**标签 + 颜色映射。
 *
 * 之前这张映射在仓里被抄了四份，其中一份只抄了一半（只有颜色、没有文案），于是标签把
 * 原始英文 `high` 直接打到了中文界面上。问题出在函数签名允许"缺文案"——`(p) => color`
 * 在类型上完全合法。
 *
 * 这里把"三个 key 必须齐全"写进参数类型：少传一个就是编译错误，"有颜色没文案"不再可
 * 表达。文案本身不进这一层——各面板保留自己的命名空间（"严重程度"与"优先级"的措辞将来
 * 可能分化），只共享颜色与结构。
 */
import type { MessageKey } from "../i18n";

export type PriorityLevel = "high" | "medium" | "low";

export interface PriorityMeta {
  labelKey: MessageKey;
  /** antd Tag 的色板名，与语言无关。 */
  color: string;
}

/**
 * @param labelKeys 三个档位的文案 key，三个都必须给（缺一个就是类型错误）。
 * @returns 与入参同构的映射：颜色固定为 red / orange / blue。
 */
export function priorityMeta(
  labelKeys: Record<PriorityLevel, MessageKey>,
): Record<PriorityLevel, PriorityMeta> {
  return {
    high: { labelKey: labelKeys.high, color: "red" },
    medium: { labelKey: labelKeys.medium, color: "orange" },
    low: { labelKey: labelKeys.low, color: "blue" },
  };
}
