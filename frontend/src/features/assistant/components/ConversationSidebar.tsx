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
  Empty,
  Input,
  Listy,
  Spin,
  Popconfirm,
  Popover,
  Segmented,
  Tooltip,
  Typography,
} from "antd";
import { memo, useState } from "react";
import type {
  AssistantConversationBrief,
  AssistantSurface,
  ConversationFilter,
} from "../../../types";
import { conversationToMaterial, exportConversation } from "../../../api/assistant";
import { copyText } from "../../../utils/clipboard";
import { downloadBlob } from "../../../utils/download";
import { formatDateTime } from "../../../utils/format";
import BatchActionBar from "../../../components/common/BatchActionBar";
import { RowContextMenu, type RowActionItem } from "../../../components/common/RowActions";
import { useBatchSelection } from "../../../hooks/useBatchSelection";
import { ListyItem } from "../../../components/common/ListyItem";
import { ConversationTitle } from "./AssistantMessageContent";

interface Props {
  className?: string;
  surface?: AssistantSurface;
  conversations: AssistantConversationBrief[] | undefined;
  loading: boolean;
  activeId: number | null;
  onCreate: () => void;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
  onRename: (id: number, title: string) => void;
  onToggleFlag: (conversation: AssistantConversationBrief, field: "pinned" | "favorite") => void;
  onArchive: (conversation: AssistantConversationBrief, archived: boolean) => void;
  onFork: (conversation: AssistantConversationBrief) => void;
  onMoveToGroup: (conversation: AssistantConversationBrief) => void;
  /** 批量删除所选会话（传入才显示「批量选择」入口）；父级负责接口调用与刷新。 */
  onBatchDelete?: (ids: number[]) => void;
}

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
}: Props) {
  const { message, modal } = App.useApp();
  // 批量选择：勾选若干段对话后一次删除。
  const batch = useBatchSelection<number>();
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [actionMenuId, setActionMenuId] = useState<number | null>(null);

  const visibleConversations = (conversations ?? []).filter((conversation) => {
    if (filter === "archived") return conversation.archived;
    if (filter === "favorite") return conversation.favorite;
    return !conversation.archived;
  });

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
      message.success("已复制会话链接，在本应用打开即可回到这段对话");
    } else {
      message.warning(`复制失败，可以手动复制：${link}`);
    }
  };

  const copyConversationId = async (conversation: AssistantConversationBrief) => {
    setActionMenuId(null);
    const ok = await copyText(String(conversation.id));
    if (ok) message.success(`已复制会话 ID：${conversation.id}`);
  };

  /** 导出为 Markdown 文件：内容含时间、附件名、助手做过的操作与参考来源。 */
  const exportToFile = async (conversation: AssistantConversationBrief) => {
    setActionMenuId(null);
    try {
      const { blob, filename } = await exportConversation(conversation.id, "md", surface);
      downloadBlob(blob, filename);
      message.success("已导出为 Markdown 文件");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "导出失败");
    }
  };

  /** 存进资料箱：之后可以让助手读它、总结成面试复盘或整理进个人资料。 */
  const saveToMaterials = async (conversation: AssistantConversationBrief) => {
    setActionMenuId(null);
    try {
      await conversationToMaterial(conversation.id, { title: conversation.title }, surface);
      message.success("已存进资料箱");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "存进资料箱失败");
    }
  };

  /** 会话的完整操作清单：三点菜单与整行右键共用同一份。 */
  const actionsFor = (conversation: AssistantConversationBrief): RowActionItem[] => [
    {
      key: "pin",
      label: conversation.pinned ? "取消置顶" : "置顶对话",
      icon: conversation.pinned ? <PushpinFilled /> : <PushpinOutlined />,
      onClick: () => {
        setActionMenuId(null);
        onToggleFlag(conversation, "pinned");
      },
    },
    {
      key: "favorite",
      label: conversation.favorite ? "取消收藏" : "收藏对话",
      icon: conversation.favorite ? <StarFilled /> : <StarOutlined />,
      onClick: () => {
        setActionMenuId(null);
        onToggleFlag(conversation, "favorite");
      },
    },
    {
      key: "link",
      label: "复制分享链接",
      icon: <LinkOutlined />,
      onClick: () => void copyShareLink(conversation),
    },
    {
      key: "rename",
      label: "重命名",
      icon: <EditOutlined />,
      onClick: () => startRename(conversation),
    },
    {
      key: "fork",
      label: "在新对话中继续",
      icon: <SplitCellsOutlined />,
      onClick: () => {
        setActionMenuId(null);
        onFork(conversation);
      },
    },
    {
      key: "export",
      label: "导出为 Markdown",
      icon: <DownloadOutlined />,
      onClick: () => void exportToFile(conversation),
    },
    {
      key: "material",
      label: "存进资料箱",
      icon: <InboxOutlined />,
      onClick: () => void saveToMaterials(conversation),
    },
    {
      key: "group",
      label: conversation.group_name
        ? `移动到分组（当前：${conversation.group_name}）`
        : "移动到分组",
      icon: <FolderOutlined />,
      onClick: () => {
        setActionMenuId(null);
        onMoveToGroup(conversation);
      },
    },
    {
      key: "copy-id",
      label: "复制会话 ID",
      icon: <LinkOutlined />,
      onClick: () => void copyConversationId(conversation),
    },
    {
      key: "archive",
      label: conversation.archived ? "取消归档" : "归档对话",
      icon: <InboxOutlined />,
      onClick: () => {
        setActionMenuId(null);
        onArchive(conversation, !conversation.archived);
      },
    },
    {
      key: "delete",
      label: "删除",
      danger: true,
      icon: <DeleteOutlined />,
      confirm: "删除这段对话？",
      onClick: () => {
        setActionMenuId(null);
        onDelete(conversation.id);
      },
    },
  ];

  /** 批量删除：确认后交给父级（接口调用与刷新在父级的删除通路上）。 */
  const removeSelected = () => {
    const ids = [...batch.selectedIds];
    if (!onBatchDelete || ids.length === 0) return;
    modal.confirm({
      title: `删除选中的 ${ids.length} 段对话？`,
      okText: "删除",
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
        新对话
      </Button>
      {onBatchDelete && !batch.selecting && (
        <Button
          block
          style={{ marginTop: 8 }}
          icon={<CheckSquareOutlined />}
          onClick={batch.enterSelecting}
        >
          批量选择
        </Button>
      )}
      {onBatchDelete && batch.selecting && (
        <div style={{ marginTop: 8 }}>
          <BatchActionBar count={batch.selectedCount} onExit={batch.exitSelecting}>
            <Button danger disabled={batch.selectedCount === 0} onClick={removeSelected}>
              删除所选
            </Button>
          </BatchActionBar>
        </div>
      )}
      <Segmented
        className="assistant-conversation-filter"
        block
        value={filter}
        options={[
          { label: "全部", value: "all" },
          { label: "收藏", value: "favorite" },
          { label: "已归档", value: "archived" },
        ]}
        onChange={(value) => setFilter(value as ConversationFilter)}
      />
      {/* List 的 loading 是内容外层的 Spin；空态单独渲染（与原 locale.emptyText 等价）。 */}
      <Spin spinning={loading}>
        {visibleConversations.length === 0 ? (
          <div className="assistant-conversation-list">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无对话" />
          </div>
        ) : (
          <Listy
            className="assistant-conversation-list"
            items={visibleConversations}
            rowKey={(conversation) => conversation.id}
            itemRender={(conversation) => (
              <RowContextMenu items={batch.selecting ? [] : actionsFor(conversation)}>
                <ListyItem
                  className={conversation.id === activeId ? "is-active" : ""}
                  actions={
                    batch.selecting
                      ? [
                          // 多选模式：行动作区换成勾选框，点行（标题）也切换勾选。
                          <Checkbox
                            key="pick"
                            aria-label={`选择对话 ${conversation.title}`}
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
                            <Tooltip title="更多操作（也可以直接右键这条对话）">
                              <Button
                                type="text"
                                size="small"
                                aria-label="更多对话操作"
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
                        <Tooltip title="保存标题（回车也可以）">
                          <Button
                            type="text"
                            size="small"
                            aria-label="保存对话标题"
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
                        {conversation.message_count} 条 · {formatDateTime(conversation.updated_at)}
                      </Typography.Text>
                    </div>
                  )}
                </ListyItem>
              </RowContextMenu>
            )}
          />
        )}
      </Spin>
    </aside>
  );
}

/** 流式期间页面每来一个 delta 都会重渲染；props 稳定（父级已 useCallback）时 memo 掉，会话列表不再陪跑。 */
export default memo(ConversationSidebar);
