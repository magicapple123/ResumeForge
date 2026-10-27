// SPDX-License-Identifier: Apache-2.0
/** 求职助手会话列表：筛选、按需管理操作与整行右键菜单。 */

import {
  CheckSquareOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FolderOutlined,
  InboxOutlined,
  LinkOutlined,
  MoreOutlined,
  PlusOutlined,
  PushpinFilled,
  PushpinOutlined,
  SaveOutlined,
  StarFilled,
  StarOutlined,
  SplitCellsOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Checkbox,
  Input,
  Listy,
  Popconfirm,
  Popover,
  Segmented,
  Tooltip,
  Typography,
} from "antd";
import EmptyState from "../../../components/common/EmptyState";
import { memo, useState } from "react";
import type {
  AssistantConversationBrief,
  ConversationFilter,
} from "../../../types";
import type { Props } from "./ConversationSidebar.types";
import { conversationToMaterial, exportConversation } from "../../../api/assistant";
import { copyText } from "../../../utils/clipboard";
import { downloadBlob } from "../../../utils/download";
import { formatDateTime } from "../../../utils/format";
import BatchActionBar from "../../../components/common/BatchActionBar";
import LoadingBlock from "../../../components/common/LoadingBlock";
import { RowContextMenu, type RowActionItem } from "../../../components/common/RowActions";
import { TRASH_RECOVERY_NOTE } from "../../../components/common/rowActionMenu";
import { useBatchSelection } from "../../../hooks/useBatchSelection";
import { useDeleteUndo } from "../../trash/useDeleteUndo";
import { ListyItem } from "../../../components/common/ListyItem";
import { ConversationTitle } from "./AssistantMessageContent";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

function ConversationSidebar({
  className,
  surface = "page",
  conversations,
  loading,
  activeId,
  onCreate,
  onSelect,
  onDelete,
  onRename,
  onToggleFlag,
  onArchive,
  onFork,
  onMoveToGroup,
  onBatchDelete,
  onRestored,
  search,
  onSearchChange,
}: Props) {
  useLocale();
  const { message, modal } = App.useApp();
  // 批量选择：勾选若干段对话后一次删除。
  const batch = useBatchSelection<number>();
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [actionMenuId, setActionMenuId] = useState<number | null>(null);
  // 软删可撤销：单条删除不再前置确认，Toast 里给 5 秒「撤销」（见 useDeleteUndo）。
  const deleteUndo = useDeleteUndo();

  /** 单条删除：**先删成功，再给撤销入口**——删失败还弹「已删除 / 撤销」比不弹更糟。 */
  const removeConversation = async (conversation: AssistantConversationBrief) => {
    const removed = await onDelete(conversation.id);
    if (removed === false) return;
    // `remove` 传空操作：接口调用已经在上一行完成，这里只是拿到统一的那张撤销卡。
    await deleteUndo.run({ type: "conversation", ids: [conversation.id] }, async () => undefined, {
      onRestored,
    });
  };

  const visibleConversations = (conversations ?? []).filter((conversation) => {
    if (filter === "archived") return conversation.archived;
    if (filter === "favorite") return conversation.favorite;
    return !conversation.archived;
  });

  // 列表全量渲染（滚动由样式接管）：会话再多也是一屏内滚动，不再分页。

  const startRename = (conversation: AssistantConversationBrief) => {
    setActionMenuId(null);
    setEditingId(conversation.id);
    setEditingTitle(conversation.title);
  };

  const saveTitle = (id: number) => {
    const title = editingTitle.trim();
    if (!title) return;
    onRename(id, title);
    setEditingId(null);
  };

  const copyShareLink = async (conversation: AssistantConversationBrief) => {
    setActionMenuId(null);
    const link = `${window.location.origin}/assistant?conversation=${conversation.id}&surface=${surface}`;
    const ok = await copyText(link);
    if (ok) {
      message.success(t("assistantUi.sidebar.toast.shareLinkCopied"));
    } else {
      message.warning(t("assistantUi.sidebar.toast.copyLinkFailed", { link }));
    }
  };

  const copyConversationId = async (conversation: AssistantConversationBrief) => {
    setActionMenuId(null);
    const ok = await copyText(String(conversation.id));
    if (ok) message.success(t("assistantUi.sidebar.toast.idCopied", { id: conversation.id }));
  };

  /** 导出为 Markdown 文件：内容含时间、附件名、助手做过的操作与参考来源。 */
  const exportToFile = async (conversation: AssistantConversationBrief) => {
    setActionMenuId(null);
    try {
      const { blob, filename } = await exportConversation(conversation.id, "md", surface);
      downloadBlob(blob, filename);
      message.success(t("assistantUi.sidebar.toast.exported"));
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("assistantUi.sidebar.toast.exportFailed"),
      );
    }
  };

  /** 存进资料箱：之后可以让助手读它、总结成面试复盘或整理进个人资料。 */
  const saveToMaterials = async (conversation: AssistantConversationBrief) => {
    setActionMenuId(null);
    try {
      await conversationToMaterial(conversation.id, { title: conversation.title }, surface);
      message.success(t("assistantUi.sidebar.toast.savedToMaterials"));
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("assistantUi.sidebar.toast.saveFailed"),
      );
    }
  };

  /** 右键菜单顶部的「批量选择」入口：侧栏按钮已收进这里（R8）。 */
  const batchSelectAction = (): RowActionItem => ({
    key: "batch_select",
    label: t("common.action.batchSelect"),
    icon: <CheckSquareOutlined />,
    onClick: batch.enterSelecting,
  });

  /** 会话的完整操作清单：三点菜单与整行右键共用同一份。 */
  const actionsFor = (conversation: AssistantConversationBrief): RowActionItem[] => [
    {
      key: "pin",
      label: conversation.pinned
        ? t("assistantUi.sidebar.action.unpin")
        : t("assistantUi.sidebar.action.pin"),
      icon: conversation.pinned ? <PushpinFilled /> : <PushpinOutlined />,
      onClick: () => {
        setActionMenuId(null);
        onToggleFlag(conversation, "pinned");
      },
    },
    {
      key: "favorite",
      label: conversation.favorite
        ? t("assistantUi.sidebar.action.unfavorite")
        : t("assistantUi.sidebar.action.favorite"),
      icon: conversation.favorite ? <StarFilled /> : <StarOutlined />,
      onClick: () => {
        setActionMenuId(null);
        onToggleFlag(conversation, "favorite");
      },
    },
    {
      key: "link",
      label: t("assistantUi.sidebar.action.shareLink"),
      icon: <LinkOutlined />,
      onClick: () => void copyShareLink(conversation),
    },
    {
      key: "rename",
      label: t("assistantUi.sidebar.action.rename"),
      icon: <EditOutlined />,
      onClick: () => startRename(conversation),
    },
    {
      key: "fork",
      label: t("assistantUi.sidebar.action.fork"),
      icon: <SplitCellsOutlined />,
      onClick: () => {
        setActionMenuId(null);
        onFork(conversation);
      },
    },
    {
      key: "export",
      label: t("assistantUi.sidebar.action.export"),
      icon: <DownloadOutlined />,
      onClick: () => void exportToFile(conversation),
    },
    {
      key: "material",
      label: t("assistantUi.sidebar.action.saveToMaterials"),
      icon: <InboxOutlined />,
      onClick: () => void saveToMaterials(conversation),
    },
    {
      key: "group",
      label: conversation.group_name
        ? t("assistantUi.group.moveCurrent", { name: conversation.group_name })
        : t("assistantUi.group.move"),
      icon: <FolderOutlined />,
      onClick: () => {
        setActionMenuId(null);
        onMoveToGroup(conversation);
      },
    },
    {
      key: "copy-id",
      label: t("assistantUi.sidebar.action.copyId"),
      icon: <LinkOutlined />,
      onClick: () => void copyConversationId(conversation),
    },
    {
      key: "archive",
      label: conversation.archived
        ? t("assistantUi.sidebar.action.unarchive")
        : t("assistantUi.sidebar.action.archive"),
      icon: <InboxOutlined />,
      onClick: () => {
        setActionMenuId(null);
        onArchive(conversation, !conversation.archived);
      },
    },
    {
      key: "delete",
      label: t("common.action.delete"),
      danger: true,
      icon: <DeleteOutlined />,
      // 软删可撤销：不弹确认，撤销入口在 Toast 上（见 useDeleteUndo）。
      undo: true,
      onClick: () => {
        setActionMenuId(null);
        void removeConversation(conversation);
      },
    },
  ];

  /** 批量删除：确认后交给父级（接口调用与刷新在父级的删除通路上）。 */
  const removeSelected = () => {
    const ids = [...batch.selectedIds];
    if (!onBatchDelete || ids.length === 0) return;
    modal.confirm({
      title: t("assistantUi.sidebar.confirm.deleteSelectedTitle"),
      // 与单条删除同措辞的后果段：批量删除同样是软删除，能恢复。条数进正文（§4.4 例外）。
      // TRASH_RECOVERY_NOTE 是软删后果的唯一出口；迁出语言包前先按原文拼接。
      content: t("assistantUi.sidebar.confirm.deleteSelectedContent", {
        count: ids.length,
        note: TRASH_RECOVERY_NOTE,
      }),
      okText: t("common.action.delete"),
      okButtonProps: { danger: true },
      onOk: () => {
        onBatchDelete(ids);
        batch.exitSelecting();
      },
    });
  };

  return (
    <aside className={`assistant-sidebar${className ? ` ${className}` : ""}`}>
      <Button type="primary" block icon={<PlusOutlined />} onClick={onCreate}>
        {t("assistantUi.sidebar.newConversation")}
      </Button>
      {onBatchDelete && batch.selecting && (
        <div style={{ marginTop: 8 }}>
          <BatchActionBar
            count={batch.selectedCount}
            onExit={batch.exitSelecting}
            pageSelectAll={{
              allSelected:
                visibleConversations.length > 0 &&
                visibleConversations.every((item) => batch.isSelected(item.id)),
              someSelected: visibleConversations.some((item) => batch.isSelected(item.id)),
              onToggle: (checked) =>
                batch.selectPage(
                  visibleConversations.map((item) => item.id),
                  checked,
                ),
            }}
          >
            <Button danger disabled={batch.selectedCount === 0} onClick={removeSelected}>
              {t("assistantUi.sidebar.deleteSelected")}
            </Button>
          </BatchActionBar>
        </div>
      )}
      {onSearchChange && (
        <Input
          className="assistant-conversation-search"
          allowClear
          placeholder={t("assistantUi.sidebar.searchPlaceholder")}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          aria-label={t("assistantUi.sidebar.searchAria")}
        />
      )}
      <Segmented
        className="assistant-conversation-filter"
        block
        value={filter}
        options={[
          { label: t("assistantUi.sidebar.filter.all"), value: "all" },
          { label: t("assistantUi.sidebar.filter.favorite"), value: "favorite" },
          { label: t("assistantUi.sidebar.filter.archived"), value: "archived" },
        ]}
        onChange={(value) => setFilter(value as ConversationFilter)}
      />
      {/* 首次加载不显示「暂无对话」（那是空态）：用 LoadingBlock 体系给加载提示；
          刷新已有列表仍用 LoadingBlock 的遮罩模式（spinning），避免刷新时整列闪没。 */}
      {visibleConversations.length === 0 ? (
        <div className="assistant-conversation-list">
          {loading ? (
            <LoadingBlock tip={t("assistantUi.sidebar.loading")} />
          ) : (
            <EmptyState inline description={t("assistantUi.sidebar.empty")} />
          )}
        </div>
      ) : (
        <LoadingBlock spinning={loading}>
          <Listy
            className="assistant-conversation-list"
            items={visibleConversations}
            rowKey={(conversation) => conversation.id}
            itemRender={(conversation) => (
              <RowContextMenu
                items={
                  batch.selecting
                    ? []
                    : onBatchDelete
                      ? [batchSelectAction(), ...actionsFor(conversation)]
                      : actionsFor(conversation)
                }
              >
                <ListyItem
                  className={conversation.id === activeId ? "is-active" : ""}
                  actions={
                    batch.selecting
                      ? [
                          // 多选模式：行动作区换成勾选框，点行（标题）也切换勾选。
                          <Checkbox
                            key="pick"
                            aria-label={t("assistantUi.sidebar.aria.selectConversation", {
                              title: conversation.title,
                            })}
                            checked={batch.isSelected(conversation.id)}
                            onChange={() => batch.toggle(conversation.id)}
                          />,
                        ]
                      : [
                          <Popover
                            key="more"
                            trigger="click"
                            placement="bottomRight"
                            open={actionMenuId === conversation.id}
                            onOpenChange={(open) => setActionMenuId(open ? conversation.id : null)}
                            content={
                              <div className="assistant-conversation-actions-menu">
                                {actionsFor(conversation).map((item) =>
                                  item.confirm ? (
                                    <Popconfirm
                                      key={item.key}
                                      title={item.confirm}
                                      // 这个「···」菜单是手写的 Popover（不走 useRowActionMenu），
                                      // 所以正文要在这里显式传，否则右键菜单有后果段、这里没有。
                                      description={item.confirmBody}
                                      onConfirm={() => {
                                        setActionMenuId(null);
                                        item.onClick?.();
                                      }}
                                    >
                                      <Button
                                        type="text"
                                        size="small"
                                        danger={item.danger}
                                        icon={item.icon}
                                      >
                                        {item.label}
                                      </Button>
                                    </Popconfirm>
                                  ) : (
                                    <Button
                                      key={item.key}
                                      type="text"
                                      size="small"
                                      danger={item.danger}
                                      icon={item.icon}
                                      onClick={item.onClick}
                                    >
                                      {item.label}
                                    </Button>
                                  ),
                                )}
                              </div>
                            }
                          >
                            <Tooltip title={t("assistantUi.sidebar.moreTooltip")}>
                              <Button
                                type="text"
                                size="small"
                                aria-label={t("assistantUi.sidebar.moreAria")}
                                className="assistant-conversation-more-button"
                                icon={<MoreOutlined />}
                              />
                            </Tooltip>
                          </Popover>,
                        ]
                  }
                >
                  {editingId === conversation.id ? (
                    <Input
                      size="small"
                      value={editingTitle}
                      autoFocus
                      maxLength={128}
                      suffix={
                        <Tooltip title={t("assistantUi.sidebar.saveTitleTooltip")}>
                          <Button
                            type="text"
                            size="small"
                            aria-label={t("assistantUi.sidebar.saveTitleAria")}
                            icon={<SaveOutlined />}
                            onClick={() => saveTitle(conversation.id)}
                          />
                        </Tooltip>
                      }
                      onChange={(event) => setEditingTitle(event.target.value)}
                      onPressEnter={() => saveTitle(conversation.id)}
                    />
                  ) : (
                    <div className="assistant-conversation-item">
                      <ConversationTitle
                        title={conversation.title}
                        pinned={conversation.pinned}
                        favorite={conversation.favorite}
                        onSelect={() =>
                          batch.selecting
                            ? batch.toggle(conversation.id)
                            : onSelect(conversation.id)
                        }
                      />
                      <Typography.Text type="secondary" className="assistant-conversation-meta">
                        {conversation.group_name ? `${conversation.group_name} · ` : ""}
                        {t("assistantUi.sidebar.messageCount", {
                          count: conversation.message_count,
                        })}
                        {" · "}
                        {formatDateTime(conversation.updated_at)}
                      </Typography.Text>
                    </div>
                  )}
                </ListyItem>
              </RowContextMenu>
            )}
          />
        </LoadingBlock>
      )}
    </aside>
  );
}

/** 流式期间页面每来一个 delta 都会重渲染；props 稳定（父级已 useCallback）时 memo 掉，会话列表不再陪跑。 */
export default memo(ConversationSidebar);
