// SPDX-License-Identifier: Apache-2.0
/**
 * 兼容入口（问题 25）：字段 chip 菜单 / 页签菜单 / 排版浮层的关闭路径已提升为
 * `features/context-menu/useMenuDismiss.ts`，四个右键实现共用那一份。
 *
 * 保留这个文件是为了让既有调用点（`DocumentEditor`、`DocumentSectionTabs`、
 * `ChipStylePopover`）不动 import 路径；行为逐字不变。
 */

export {
  useMenuDismiss as useChipMenuDismiss,
  type MenuDismissOptions as ChipMenuDismissOptions,
} from "../../context-menu/useMenuDismiss";
