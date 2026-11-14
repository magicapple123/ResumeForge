// SPDX-License-Identifier: Apache-2.0
/**
 * 助手页的历史会话栏位：宽档内联、平板档抽屉、浮窗浮层三处共用同一个会话列表节点。
 *
 * 从 AssistantPage 拆出（行数预算）：列表**只有一份 JSX**，写三遍的话（曾经有过两遍）
 * 「会话搜索」「批量删除」这类能力会在某一处悄悄缺失。本组件承担三件事——会话列表的
 * props 接线、新建/切换会话时清空岗位/简历关联（F36）、三种容器形态的摆放。
 */
import { Drawer } from "antd";
import type { Dispatch, SetStateAction } from "react";
import ConversationSidebar from "../features/assistant/components/ConversationSidebar";
import type { Props as ConversationSidebarProps } from "../features/assistant/components/ConversationSidebar.types";
import { useContextResetOnSwitch } from "../features/assistant/hooks/useAssistantContextSelection";
import type { useAssistantConversations } from "../features/assistant/hooks/useAssistantConversations";
import type { useAssistantSidebarActions } from "../features/assistant/hooks/useAssistantSidebarActions";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

export interface AssistantSidebarSlotProps {
  compact: boolean;
  surface: ConversationSidebarProps["surface"];
  historyOpen: boolean;
  onHistoryOpenChange: Dispatch<SetStateAction<boolean>>;
  /** 平板档把历史列表从横条改成抽屉（由父级 useAssistantHistoryDrawer 计算）。 */
  drawerVisible: boolean;
  drawerOpen: boolean;
  onDrawerOpenChange: Dispatch<SetStateAction<boolean>>;
  conversationsState: ReturnType<typeof useAssistantConversations>;
  sidebarActions: ReturnType<typeof useAssistantSidebarActions>;
  clearContextRefs: () => void;
}

export default function AssistantSidebarSlot({
  compact,
  surface,
  historyOpen,
  onHistoryOpenChange,
  drawerVisible,
  drawerOpen,
  onDrawerOpenChange,
  conversationsState,
  sidebarActions,
  clearContextRefs,
}: AssistantSidebarSlotProps) {
  useLocale();
  const {
    conversations,
    conversationsLoading,
    activeId,
    conversationSearch,
    handleConversationSearch,
  } = conversationsState;
  const {
    handleSidebarCreate,
    handleSidebarSelect,
    handleSidebarDelete,
    handleSidebarRestored,
    handleSidebarBatchDelete,
    handleSidebarRename,
    handleSidebarToggleFlag,
    handleSidebarArchive,
    handleSidebarFork,
    openGroupModal,
  } = sidebarActions;
  // F36：新建 / 切换会话都要丢掉上一段对话的岗位/简历关联，否则对话 A 的岗位会跟着
  // 对话 B 的下一条消息发出去。
  const { handleCreate: handleSidebarCreateWithClear, handleSelect: handleSidebarSelectWithClear } =
    useContextResetOnSwitch(clearContextRefs, handleSidebarCreate, handleSidebarSelect);

  const sidebarNode = (
    <ConversationSidebar
      surface={surface}
      conversations={conversations}
      loading={conversationsLoading}
      activeId={activeId}
      onCreate={handleSidebarCreateWithClear}
      onSelect={handleSidebarSelectWithClear}
      onDelete={handleSidebarDelete}
      onRestored={handleSidebarRestored}
      onBatchDelete={handleSidebarBatchDelete}
      onRename={handleSidebarRename}
      onToggleFlag={handleSidebarToggleFlag}
      onArchive={handleSidebarArchive}
      onFork={handleSidebarFork}
      onMoveToGroup={openGroupModal}
      // 会话搜索（P0-2）：输入防抖后走服务端 keyword 过滤。
      search={conversationSearch}
      onSearchChange={handleConversationSearch}
      className={compact ? "assistant-sidebar--floating" : undefined}
    />
  );
  return (
    <>
      {compact && historyOpen && (
        <button
          type="button"
          className="assistant-sidebar-backdrop"
          aria-label={t("responsive.assistant.aria.closeHistory")}
          onClick={() => onHistoryOpenChange(false)}
        />
      )}
      {(!compact && !drawerVisible) || (compact && historyOpen) ? sidebarNode : null}
      {drawerVisible ? (
        <Drawer
          className="assistant-history-drawer"
          open={drawerOpen}
          onClose={() => onDrawerOpenChange(false)}
          title={t("responsive.assistant.history.title")}
          size="default"
          destroyOnHidden
        >
          {sidebarNode}
        </Drawer>
      ) : null}
    </>
  );
}
