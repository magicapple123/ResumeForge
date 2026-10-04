/** 助手消息多选删除域：勾选若干条消息后一次删除。
 *
 * 从 AssistantPage 整域下沉：selecting/selectedIds 状态、「换会话就退出多选」effect、
 * 勾选切换与批量删除回调。api 导入仅 deleteAssistantMessages（partial mock 白名单内）。
 */
import { App } from "antd";
import { useCallback, useEffect, useState } from "react";
import { deleteAssistantMessages } from "../../../api/assistant";
import type { AssistantMessage, AssistantSurface } from "../../../types";

interface Options {
  activeId: number | null;
  loadDetail: (conversationId: number) => Promise<void>;
  message: ReturnType<typeof App.useApp>["message"];
  surface: AssistantSurface;
}

export function useAssistantMessageSelection({ activeId, loadDetail, message, surface }: Options) {
  /** 多选删除：进入后每条消息左侧出勾选框，可一次删掉几条。 */
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(() => new Set());

  const exitSelecting = useCallback(() => {
    setSelecting(false);
    setSelectedIds(new Set());
  }, []);

  // 换会话就退出多选：勾着的是上一条会话的消息 id，留着会让新会话里 id 相同的消息
  // 出现在"已选"里，一点删除就删错了。
  useEffect(() => {
    exitSelecting();
  }, [activeId, exitSelecting]);

  const toggleSelected = useCallback((target: AssistantMessage) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(target.id)) next.delete(target.id);
      else next.add(target.id);
      return next;
    });
  }, []);

  /**
   * 多选删除。
   *
   * 一条都不选时按钮是禁用的，所以这里不用处理空集合；后端在 `message_ids` 为空时
   * 会直接 422（它要求至少一条）。删除后退出多选态：留着勾选状态而那条消息已经不见了，
   * 再点删除会把一批旧 id 发过去。
   */
  const removeSelected = useCallback(async () => {
    if (!activeId || selectedIds.size === 0) return;
    try {
      const { deleted } =
        surface === "page"
          ? await deleteAssistantMessages(activeId, [...selectedIds])
          : await deleteAssistantMessages(activeId, [...selectedIds], surface);
      await loadDetail(activeId);
      exitSelecting();
      message.success(`已删除 ${deleted} 条消息`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除消息失败");
    }
  }, [activeId, exitSelecting, loadDetail, message, selectedIds, surface]);

  return { selecting, setSelecting, selectedIds, toggleSelected, removeSelected, exitSelecting };
}
