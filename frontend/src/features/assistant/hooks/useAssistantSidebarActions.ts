// SPDX-License-Identifier: Apache-2.0
/** 助手侧栏与分组动作域：技能开关、会话列表操作回调与「移动到分组」弹窗。
 *
 * 从 AssistantPage 整域下沉。会话列表的操作回调**必须继续全部 `useCallback` 且依赖数组
 * 逐字保留**：ConversationSidebar 包了 memo，流式期间页面级 state（streamingText）每个
 * delta 都在变，props 引用不稳定的话 memo 形同虚设。
 */
import { App } from "antd";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { AssistantConversationBrief, AssistantSkill } from "../../../types";
import type { useAssistantConversations } from "./useAssistantConversations";

type MessageApi = ReturnType<typeof App.useApp>["message"];

/** 会话域的对外接口：入参签名直接取自 `useAssistantConversations` 的返回值，改一处即可同步。 */
type ConversationsApi = ReturnType<typeof useAssistantConversations>;

interface Options {
  message: MessageApi;
  /** 会话域整体传入：本 hook 只排布它的返回值，不再逐项转手 8 个函数签名。 */
  conversations: ConversationsApi;
  reloadSkills: () => Promise<void>;
  toggleSkill: (skill: AssistantSkill, enabled: boolean) => Promise<void>;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  setGroupTarget: Dispatch<SetStateAction<AssistantConversationBrief | null>>;
  setGroupValue: Dispatch<SetStateAction<string>>;
  groupTarget: AssistantConversationBrief | null;
  groupValue: string;
}

export function useAssistantSidebarActions({
  message,
  conversations,
  reloadSkills,
  toggleSkill,
  setHistoryOpen,
  setGroupTarget,
  setGroupValue,
  groupTarget,
  groupValue,
}: Options) {
  const {
    createConversation,
    forkConversation,
    reloadConversations,
    removeConversation,
    saveConversationTitle,
    selectConversation,
    updateConversation,
    updateConversationFlags,
  } = conversations;
  const handleToggleSkill = useCallback(
    async (skill: AssistantSkill, enabled: boolean) => {
      try {
        await toggleSkill(skill, enabled);
        message.success(`已${enabled ? "启用" : "停用"}技能「${skill.name}」`);
      } catch (error) {
        message.error(error instanceof Error ? error.message : "切换技能失败");
        await reloadSkills();
      }
    },
    [message, reloadSkills, toggleSkill],
  );

  // 会话列表的操作回调全部 useCallback：ConversationSidebar 包了 memo，流式期间
  // 页面级 state（streamingText）每个 delta 都在变，props 引用不稳定的话 memo 形同虚设。
  const handleSidebarCreate = useCallback(() => {
    setHistoryOpen(false);
    void createConversation();
  }, [createConversation]);

  const handleSidebarSelect = useCallback(
    (id: number) => {
      setHistoryOpen(false);
      selectConversation(id);
    },
    [selectConversation],
  );
  const handleSidebarDelete = useCallback(
    (id: number) => removeConversation(id),
    [removeConversation],
  );
  // 撤销「删除会话」后列表要追上：恢复走的是回收站接口，不经过 removeConversation。
  const handleSidebarRestored = useCallback(() => reloadConversations(), [reloadConversations]);

  const handleSidebarBatchDelete = useCallback(
    (ids: number[]) => {
      // 批量删除：逐条走同一条删除通路（内部会刷新列表）。
      for (const id of ids) void removeConversation(id);
    },
    [removeConversation],
  );

  const handleSidebarRename = useCallback(
    (id: number, title: string) => void saveConversationTitle(id, title),
    [saveConversationTitle],
  );

  const handleSidebarToggleFlag = useCallback(
    (conversation: AssistantConversationBrief, field: "pinned" | "favorite") =>
      void updateConversationFlags(conversation, field),
    [updateConversationFlags],
  );

  const handleSidebarArchive = useCallback(
    (conversation: AssistantConversationBrief, archived: boolean) =>
      void updateConversation(conversation.id, { archived }),
    [updateConversation],
  );

  const handleSidebarFork = useCallback(
    (conversation: AssistantConversationBrief) => void forkConversation(conversation.id),
    [forkConversation],
  );

  const openGroupModal = useCallback((conversation: AssistantConversationBrief) => {
    setGroupTarget(conversation);
    setGroupValue(conversation.group_name);
  }, []);

  const confirmGroup = async () => {
    if (!groupTarget) return;
    const updated = await updateConversation(groupTarget.id, { group_name: groupValue.trim() });
    if (updated) {
      message.success(groupValue.trim() ? `已移动到「${groupValue.trim()}」` : "已移出分组");
      setGroupTarget(null);
    }
  };

  return {
    handleToggleSkill,
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
    confirmGroup,
  };
}
