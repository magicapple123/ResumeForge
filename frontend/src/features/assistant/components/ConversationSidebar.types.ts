// SPDX-License-Identifier: Apache-2.0
/** 会话列表对外的接线契约（2026-10-28 从 ConversationSidebar 拆出，压 500 行预算）。 */
import type { AssistantConversationBrief, AssistantSurface } from "../../../types";

export interface Props {
  className?: string;
  surface?: AssistantSurface;
  conversations: AssistantConversationBrief[] | undefined;
  loading: boolean;
  activeId: number | null;
  onCreate: () => void;
  onSelect: (id: number) => void;
  /** 单条删除：父级负责接口调用与刷新；返回 `false` 表示没删成功（此时不给撤销入口）。 */
  onDelete: (id: number) => void | Promise<boolean | void>;
  /** 撤销恢复成功后刷新列表（恢复不经过 `onDelete`，所以单列一个入口）。 */
  onRestored?: () => void | Promise<void>;
  onRename: (id: number, title: string) => void;
  onToggleFlag: (conversation: AssistantConversationBrief, field: "pinned" | "favorite") => void;
  onArchive: (conversation: AssistantConversationBrief, archived: boolean) => void;
  onFork: (conversation: AssistantConversationBrief) => void;
  onMoveToGroup: (conversation: AssistantConversationBrief) => void;
  /** 批量删除所选会话（传入才显示「批量选择」入口）；父级负责接口调用与刷新。 */
  onBatchDelete?: (ids: number[]) => void;
  /** 会话搜索输入框的受控值（P0-2：服务端 keyword 搜索）。缺省不显示搜索框。 */
  search?: string;
  /** 搜索输入变化回调（父级负责防抖触发重拉）。 */
  onSearchChange?: (value: string) => void;
}
