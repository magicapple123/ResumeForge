/**
 * 手动备份卡（RF-25）：backups/ 目录里的快照清单与逐份可恢复删除。
 *
 * 与「自动备份状态」卡（RF-05）分工：那边是 auto-backups 的保护状态，这里是被
 * 忘在 backups/ 目录里、此前没有任何界面的手动快照。删除是**可恢复**的——服务端
 * 只把它移进 backups/.trash/；没有自动清理、没有"全部删除"，每一份都要单独确认。
 *
 * 交互（用户反馈两轮）：①「移除」收进每行「···」菜单不再裸露；②右键列表任意位置
 * 可进入批量选择模式（勾选多份 → 移除所选），与备选岗位的批量模式同一套交互。
 */
import { DeleteOutlined, MoreOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Checkbox, Dropdown, Flex, List, Space, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { listManualBackups, trashManualBackup } from "../../api/storage";
import type { ManualBackupItem } from "../../api/storage";
import { formatDateTime } from "../../utils/format";
import LoadingBlock from "../common/LoadingBlock";
import { useCollapsedList } from "../common/useCollapsedList";
import { RowContextMenu, type RowMenuItem } from "../common/RowActions";

function formatSize(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ManualBackupsCard() {
  const { message, modal } = App.useApp();
  const [items, setItems] = useState<ManualBackupItem[]>([]);
  const [trashedCount, setTrashedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  // 批量选择模式：右键「批量选择」进入，勾选多份后「移除所选」一次确认逐份移除。
  const [selecting, setSelecting] = useState(false);
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [batchRemoving, setBatchRemoving] = useState(false);
  // 快照多了会刷屏：默认只展示前 5 份，其余收进「显示全部」（展示层折叠）。
  const { visibleItems: visibleItems, toggleNode: itemsToggleNode } = useCollapsedList(items);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listManualBackups();
      setItems(result.items);
      setTrashedCount(result.trashed_count);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "读取手动备份失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  // Compiler 规范：初始加载的 setState 放 .then 回调（外部数据到达时应用）。
  useEffect(() => {
    let cancelled = false;
    listManualBackups()
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setTrashedCount(result.trashed_count);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        message.error(err instanceof Error ? err.message : "读取手动备份失败");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [message]);

  const trashOne = async (name: string) => {
    await trashManualBackup(name);
    // 移除后同步退出选区：条目已不在列表里，勾着它只会产生幽灵选中。
    setSelectedNames((current) => current.filter((value) => value !== name));
    message.success("已移到 backups/.trash/，可在文件管理器里彻底删除或找回");
  };

  const confirmDelete = (item: ManualBackupItem) => {
    modal.confirm({
      title: `移除备份「${item.name}」？`,
      content: (
        <div>
          <p>
            这份备份约占 {formatSize(item.size_bytes)}，快照时间：
            {formatDateTime(new Date(item.modified_at * 1000).toISOString())}。
          </p>
          <p>
            移除后会放到 backups/.trash/ 文件夹里，随时可以在文件管理器里找回来；系统不会自动清理。
          </p>
        </div>
      ),
      okText: "移到 .trash",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await trashOne(item.name);
          await load();
        } catch (err) {
          message.error(err instanceof Error ? err.message : "移除失败");
        }
      },
    });
  };

  const selectedItems = items.filter((item) => selectedNames.includes(item.name));

  const confirmBatchRemove = () => {
    if (selectedItems.length === 0) return;
    modal.confirm({
      title: `移除选中的 ${selectedItems.length} 份备份？`,
      content:
        "移除后会放到 backups/.trash/ 文件夹里，随时可以在文件管理器里找回来；系统不会自动清理。",
      okText: "移到 .trash",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        setBatchRemoving(true);
        try {
          const results = await Promise.allSettled(
            selectedItems.map((item) => trashOne(item.name)),
          );
          const done = results.filter((result) => result.status === "fulfilled").length;
          const failed = results.length - done;
          if (failed > 0) {
            message.warning(`已移除 ${done} 份，${failed} 份移除失败`);
          } else {
            message.success(`已把 ${done} 份备份移到 backups/.trash/`);
          }
          await load();
        } finally {
          setBatchRemoving(false);
        }
      },
    });
  };

  const toggleSelected = (name: string, checked: boolean) => {
    setSelectedNames((current) =>
      checked ? [...new Set([...current, name])] : current.filter((value) => value !== name),
    );
  };

  const exitSelecting = () => {
    setSelecting(false);
    setSelectedNames([]);
  };

  // 右键菜单：查看态提供「批量选择」入口；多选模式下收起（退出在操作条上）。
  const contextItems: RowMenuItem[] = selecting
    ? []
    : [
        {
          key: "batch_select",
          label: "批量选择",
          onClick: () => setSelecting(true),
        },
      ];

  return (
    <Card
      title="手动备份"
      className="settings-card manual-backups-card"
      extra={
        <Button
          size="small"
          type="text"
          icon={<ReloadOutlined />}
          onClick={() => void load()}
          aria-label="刷新手动备份列表"
        />
      }
    >
      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          {/* 说明与批量操作同行（用户要求「跟左侧文字对齐」）：文字左、按钮右，
              基线居中；文案动词统一为「移除」（与按钮/确认弹窗一致，不再混用"移到"）。 */}
          <Flex justify="space-between" align="center" gap={12} wrap>
            <Typography.Paragraph
              type="secondary"
              style={{ marginBottom: 0, flex: 1, minWidth: 240 }}
            >
              这里是迁移或手工备份留在 backups/ 目录里的数据库快照。不会自动清理； 确认后移除到
              backups/.trash/，需要时还能找回。
            </Typography.Paragraph>
            {selecting && selectedNames.length > 0 && (
              <Space size={8}>
                <Button danger loading={batchRemoving} onClick={confirmBatchRemove}>
                  移除所选
                </Button>
                <Button onClick={exitSelecting}>取消</Button>
              </Space>
            )}
          </Flex>
          {items.length === 0 ? (
            <Typography.Text type="secondary">
              暂无手动备份快照。数据库升级前会自动在这里留一份快照。
            </Typography.Text>
          ) : (
            <RowContextMenu items={contextItems}>
              <List
                size="small"
                dataSource={visibleItems}
                renderItem={(item) => {
                  const selected = selectedNames.includes(item.name);
                  return (
                    <List.Item
                      actions={
                        selecting
                          ? []
                          : [
                              <Dropdown
                                key="more"
                                trigger={["click"]}
                                menu={{
                                  items: [
                                    {
                                      key: "remove",
                                      label: "移除",
                                      icon: <DeleteOutlined />,
                                      danger: true,
                                      onClick: () => confirmDelete(item),
                                    },
                                  ],
                                }}
                              >
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<MoreOutlined />}
                                  aria-label={`备份 ${item.name} 的更多操作`}
                                />
                              </Dropdown>,
                            ]
                      }
                    >
                      {/* 勾选框只放 Meta 的 avatar 槽（行首一处）：此前在 actions 与
                          内容区各放一个导致一选项两框；用原生槽位也不会破坏 List 的
                          flex 布局（此前内容区包 Flex 曾把标题/说明压成竖排）。 */}
                      <List.Item.Meta
                        avatar={
                          selecting ? (
                            <Checkbox
                              checked={selected}
                              disabled={batchRemoving}
                              aria-label={`选择备份 ${item.name}`}
                              onChange={(event) => toggleSelected(item.name, event.target.checked)}
                            />
                          ) : undefined
                        }
                        title={
                          <Typography.Text ellipsis style={{ maxWidth: 360 }}>
                            {item.name}
                          </Typography.Text>
                        }
                        description={`${formatSize(item.size_bytes)} · ${formatDateTime(
                          new Date(item.modified_at * 1000).toISOString(),
                        )}`}
                      />
                    </List.Item>
                  );
                }}
              />
            </RowContextMenu>
          )}
          {itemsToggleNode}
          {trashed_count_note(trashedCount)}
        </>
      )}
    </Card>
  );
}

function trashed_count_note(count: number) {
  if (count <= 0) return null;
  return (
    <Alert
      style={{ marginTop: 8 }}
      type="info"
      showIcon
      title={`backups/.trash/ 里还有 ${count} 份已移除的快照，确认不要了可以在文件管理器里删除。`}
    />
  );
}
