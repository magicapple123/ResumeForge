// SPDX-License-Identifier: Apache-2.0
/**
 * 拖拽被拒的四种原因 → 界面文案（问题 13）。
 *
 * 单独一个模块的原因：`EntryCard`（`drop` 到达时给文案）与 `ItemChip`（`dropEffect="none"`
 * 吞掉 `drop` 时由 `dragend` 兜底给文案）都要这张表；写在任一个组件里，另一个就得反向
 * import 组件，容易牵进循环依赖。
 *
 * 四种原因必须分开：跨方框、正文块区、位置本身不允许、插完不动，用户需要知道的"该怎么改"
 * 完全不同。合并成一句"不能放到这里"等于把出口堵死。
 */
import type { MessageKey } from "../../i18n";
import type { DropRejectReason } from "../../features/resume-document/drag";

export const DRAG_REJECT_COPY: Record<DropRejectReason, MessageKey> = {
  /** item 类型本身不允许这个位置（列表字段进标题行）。 */
  invalid: "document.drag.invalid",
  /** 跨方框，目标是标题/元信息或正文前/后灰字区。 */
  illegalTitle: "document.drag.illegalTitle",
  /** 跨方框，目标是正文块区。 */
  illegalBody: "document.drag.illegalBody",
  /** 位置合法但插完不动。 */
  samePosition: "document.drag.samePosition",
};
