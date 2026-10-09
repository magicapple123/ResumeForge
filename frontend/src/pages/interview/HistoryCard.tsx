/**
 * 历史面试卡：批量选择 + 历史列表（打开/删除/批量删除经 props 回调页面）。
 * （自 InterviewPage 拆出，逐字搬运，行为等价。）
 */
import { CheckSquareOutlined, DeleteOutlined } from "@ant-design/icons";
import { Button, Card, Checkbox, Empty, Listy, Pagination, Space, Tag } from "antd";
import LoadingBlock from "../../components/common/LoadingBlock";
import BatchActionBar from "../../components/common/BatchActionBar";
import { ListyItem, ListyMeta } from "../../components/common/ListyItem";
import { RowActions, RowContextMenu, type RowActionItem } from "../../components/common/RowActions";
import { LISTY_ITEM_PADDING_SMALL } from "../../components/common/listyPadding";
import type { BatchSelection } from "../../hooks/useBatchSelection";
import { useClientPagination } from "../../hooks/useClientPagination";
import type { InterviewBrief } from "../../types";
import { formatDateTime } from "../../utils/format";

export function HistoryCard({
  sessions,
  batch,
  loadingList,
  onOpen,
  onRemove,
  onRemoveSelected,
}: {
  sessions: InterviewBrief[];
  batch: BatchSelection<number>;
  loadingList: boolean;
  onOpen: (id: number) => Promise<void>;
  onRemove: (session: InterviewBrief) => Promise<void>;
  onRemoveSelected: () => void;
}) {
  // 面试历史持续累积，一页 10 条（Listy 是虚拟滚动列表、无内建分页，走通用客户端分页）。
  const {
    page,
    setPage,
    paged: pagedSessions,
    total: sessionTotal,
  } = useClientPagination(sessions, 10);

  /** 历史卡片的右键菜单：批量选择（工具栏按钮已收进这里，R8）+ 删除（二次确认）。 */
  const contextActions = (item: InterviewBrief): RowActionItem[] => [
    {
      key: "batch_select",
      label: "批量选择",
      icon: <CheckSquareOutlined />,
      onClick: batch.enterSelecting,
    },
    {
      key: "delete",
      label: "删除这场面试",
      danger: true,
      icon: <DeleteOutlined />,
      confirm: "删除这场面试？删除后可在回收站找回。",
      onClick: () => void onRemove(item),
    },
  ];

  return (
    <Card size="small" className="settings-card" title="历史面试" style={{ marginTop: 16 }}>
      {batch.selecting && (
        <BatchActionBar count={batch.selectedCount} onExit={batch.exitSelecting}>
          <Button danger disabled={batch.selectedCount === 0} onClick={onRemoveSelected}>
            删除所选
          </Button>
        </BatchActionBar>
      )}
      {loadingList ? (
        <LoadingBlock />
      ) : sessions.length === 0 ? (
        <Empty description="还没有做过模拟面试" />
      ) : (
        <>
          <Listy
            items={pagedSessions}
            rowKey={(item) => item.id}
            styles={{ item: { ...LISTY_ITEM_PADDING_SMALL } }}
            itemRender={(item) => (
              <RowContextMenu items={batch.selecting ? [] : contextActions(item)}>
                <ListyItem
                  actions={
                    batch.selecting
                      ? [
                          <Checkbox
                            key="pick"
                            aria-label={`选择面试 ${item.title}`}
                            checked={batch.isSelected(item.id)}
                            onChange={() => batch.toggle(item.id)}
                          />,
                        ]
                      : [
                          <RowActions
                            key="actions"
                            primary={[
                              {
                                key: "open",
                                label: item.status === "active" ? "继续" : "看报告",
                                onClick: () => void onOpen(item.id),
                              },
                            ]}
                            more={[
                              {
                                key: "delete",
                                label: "删除这场面试",
                                danger: true,
                                icon: <DeleteOutlined />,
                                confirm: "删除这场面试？删除后可在回收站找回。",
                                onClick: () => void onRemove(item),
                              },
                            ]}
                          />,
                        ]
                  }
                >
                  <ListyMeta
                    title={
                      <Space size={6} wrap>
                        <span>{item.title}</span>
                        <Tag color={item.status === "active" ? "blue" : "default"}>
                          {item.status === "active" ? "进行中" : "已结束"}
                        </Tag>
                        <Tag>{item.interview_type}</Tag>
                        <Tag>{item.difficulty}</Tag>
                      </Space>
                    }
                    description={`第 ${item.answered_rounds}/${item.rounds} 轮 · ${formatDateTime(item.created_at)}`}
                  />
                </ListyItem>
              </RowContextMenu>
            )}
          />
          <div style={{ textAlign: "right", marginTop: 12 }}>
            <Pagination
              current={page}
              pageSize={10}
              total={sessionTotal}
              onChange={setPage}
              hideOnSinglePage
              showSizeChanger={false}
              showTotal={(count) => `共 ${count} 场`}
            />
          </div>
        </>
      )}
    </Card>
  );
}
