// SPDX-License-Identifier: Apache-2.0
/**
 * 手动备份卡（RF-25）：backups/ 目录里的快照清单与逐份可恢复删除。
 *
 * 与「自动备份状态」卡（RF-05）分工：那边是 auto-backups 的保护状态，这里是被
 * 忘在 backups/ 目录里、此前没有任何界面的手动快照。删除是**可恢复**的——服务端
 * 只把它移进本地数据目录下的回收目录；没有自动清理、没有"全部删除"，每一份都要单独确认。
 *
 * 交互（用户反馈两轮）：①「移除」收进每行「···」菜单不再裸露；②右键列表任意位置
 * 可进入批量选择模式（勾选多份 → 移除所选），与备选岗位的批量模式同一套交互。
 */
import { DeleteOutlined, MoreOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Checkbox, Dropdown, Flex, Listy, Space, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { listManualBackups, trashManualBackup } from "../../api/storage";
import type { ManualBackupItem } from "../../api/storage";
import { formatDateTime } from "../../utils/format";
import LoadingBlock from "../common/LoadingBlock";
import { useCollapsedList } from "../common/useCollapsedList";
import { ListyItem, ListyMeta } from "../common/ListyItem";
import { RowContextMenu, type RowMenuItem } from "../common/RowActions";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

function formatSize(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ManualBackupsCard() {
  // 本组件（含模块级的 `trashed_count_note`）用模块级 t()：必须订阅语言变化才会重渲染。
  useLocale();
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
      message.error(err instanceof Error ? err.message : t("manualBackups.loadFailed"));
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
        message.error(err instanceof Error ? err.message : t("manualBackups.loadFailed"));
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
    message.success(t("manualBackups.trashed"));
  };

  const confirmDelete = (item: ManualBackupItem) => {
    modal.confirm({
      title: t("manualBackups.confirm.title", { name: item.name }),
      content: (
        <div>
          <p>
            {t("manualBackups.confirm.size", {
              size: formatSize(item.size_bytes),
              time: formatDateTime(new Date(item.modified_at * 1000).toISOString()),
            })}
          </p>
          <p>{t("manualBackups.confirm.body")}</p>
        </div>
      ),
      okText: t("manualBackups.action.trash"),
      okButtonProps: { danger: true },
      cancelText: t("common.action.cancel"),
      onOk: async () => {
        try {
          await trashOne(item.name);
          await load();
        } catch (err) {
          message.error(err instanceof Error ? err.message : t("manualBackups.removeFailed"));
        }
      },
    });
  };

  const selectedItems = items.filter((item) => selectedNames.includes(item.name));

  const confirmBatchRemove = () => {
    if (selectedItems.length === 0) return;
    modal.confirm({
      title: t("manualBackups.batch.confirm.title"),
      content: t("manualBackups.batch.confirm.body", { count: selectedItems.length }),
      okText: t("manualBackups.action.trash"),
      okButtonProps: { danger: true },
      cancelText: t("common.action.cancel"),
      onOk: async () => {
        setBatchRemoving(true);
        try {
          const results = await Promise.allSettled(
            selectedItems.map((item) => trashOne(item.name)),
          );
          const done = results.filter((result) => result.status === "fulfilled").length;
          const failed = results.length - done;
          if (failed > 0) {
            message.warning(t("manualBackups.batch.partial", { done, failed }));
          } else {
            message.success(t("manualBackups.batch.done", { count: done }));
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
  // 菜单项在组件体内构造，`t()` 可以安全直调（模块作用域里调会把语言固定住）。
  const contextItems: RowMenuItem[] = selecting
    ? []
    : [
        {
          key: "batch_select",
          label: t("common.action.batchSelect"),
          onClick: () => setSelecting(true),
        },
      ];

  return (
    <Card
      title={t("manualBackups.title")}
      className="settings-card manual-backups-card"
      extra={
        <Button
          size="small"
          type="text"
          icon={<ReloadOutlined />}
          onClick={() => void load()}
          aria-label={t("manualBackups.refresh.aria")}
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
              {t("manualBackups.intro")}
            </Typography.Paragraph>
            {selecting && selectedNames.length > 0 && (
              <Space size={8}>
                <Button danger loading={batchRemoving} onClick={confirmBatchRemove}>
                  {t("manualBackups.action.removeSelected")}
                </Button>
                <Button onClick={exitSelecting}>{t("common.action.cancel")}</Button>
              </Space>
            )}
          </Flex>
          {items.length === 0 ? (
            <Typography.Text type="secondary">{t("manualBackups.empty")}</Typography.Text>
          ) : (
            <RowContextMenu items={contextItems}>
              <Listy
                items={visibleItems}
                rowKey={(item) => item.name}
                itemRender={(item) => {
                  const selected = selectedNames.includes(item.name);
                  return (
                    <ListyItem
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
                                      label: t("manualBackups.action.remove"),
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
                                  aria-label={t("manualBackups.more.aria", { name: item.name })}
                                />
                              </Dropdown>,
                            ]
                      }
                    >
                      {/* 勾选框只放行首一处，ListyItem 保持主内容与操作区横向排列。 */}
                      <ListyMeta
                        avatar={
                          selecting ? (
                            <Checkbox
                              checked={selected}
                              disabled={batchRemoving}
                              aria-label={t("manualBackups.select.aria", { name: item.name })}
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
                    </ListyItem>
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
      title={t("manualBackups.trashNote", { count })}
    />
  );
}
