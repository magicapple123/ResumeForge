// SPDX-License-Identifier: Apache-2.0
/**
 * 「补充字段位置」（meta_position）的**类型、常量与归一化**（从 fieldLayout.ts 按 500 行
 * 预算拆出；fieldLayout.ts 仍重新导出这些名字，既有导入路径不变）。
 *
 * - `below`（默认）= 正文要点之后（改造前四格式产物不变）；
 * - `above` = 置顶：单行补充字段整组排到要点/长描述之前。
 *
 * 七个承载分区（教育 / 工作 / 校园 / 项目 / 奖项 / 论文 / 科研项目）都已实现，
 * HTML / PDF / Word / Markdown 四格式同序。
 */
import type { MessageKey } from "../../i18n";
import type { EntryFieldLayoutPatch } from "./fieldLayout";

export type FieldMetaPosition = "below" | "above";

export const FIELD_META_POSITIONS: readonly FieldMetaPosition[] = ["below", "above"];
export const DEFAULT_META_POSITION: FieldMetaPosition = "below";

export const META_POSITION_LABEL_KEYS: Record<FieldMetaPosition, MessageKey> = {
  below: "typography.fieldLayout.metaPosition.below",
  above: "typography.fieldLayout.metaPosition.above",
};

/** 未知 / 非法的「补充字段位置」落回默认 below（与后端 _validated_meta_position 同口径）。 */
export function normalizeMetaPosition(raw: unknown): FieldMetaPosition {
  return raw === "above" ? "above" : DEFAULT_META_POSITION;
}

/** 条目级覆盖 → 落库形状：只有 metaPosition 需要换回后端键名 meta_position。 */
export function storedEntryPatch(patch: EntryFieldLayoutPatch): EntryFieldLayoutPatch & {
  meta_position?: FieldMetaPosition;
} {
  const stored: EntryFieldLayoutPatch & { meta_position?: FieldMetaPosition } = { ...patch };
  delete stored.metaPosition;
  if (patch.metaPosition !== undefined) stored.meta_position = patch.metaPosition;
  return stored;
}
