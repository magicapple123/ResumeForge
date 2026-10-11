/**
 * 手动备份卡（RF-25）：backups/ 目录里的快照清单与逐份可恢复删除。
 *
 * 与「自动备份状态」卡（RF-05）分工：那边是 auto-backups 的保护状态，这里是被
 * 忘在 backups/ 目录里、此前没有任何界面的手动快照。删除是**可恢复**的——服务端
 * 只把它移进 backups/.trash/；没有自动清理、没有"全部删除"，每一份都要单独确认。
 */
import { DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, List, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { listManualBackups, trashManualBackup } from "../../api/storage";
import type { ManualBackupItem } from "../../api/storage";
import { formatDateTime } from "../../utils/format";
import LoadingBlock from "../common/LoadingBlock";

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
  const [deletingName, setDeletingName] = useState<string | null>(null);

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
        setDeletingName(item.name);
        try {
          await trashManualBackup(item.name);
          message.success("已移到 backups/.trash/，可在文件管理器里彻底删除或找回");
          await load();
        } catch (err) {
          message.error(err instanceof Error ? err.message : "移除失败");
        } finally {
          setDeletingName(null);
        }
      },
    });
  };

  return (
    <Card
      title="手动备份"
      className="settings-card"
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
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            这里是迁移或手工备份留在 backups/ 目录里的数据库快照。不会自动清理； 逐份确认后移到
            backups/.trash/，需要时还能找回。
          </Typography.Paragraph>
          {items.length === 0 ? (
            <Typography.Text type="secondary">
              暂无手动备份快照。数据库升级前会自动在这里留一份快照。
            </Typography.Text>
          ) : (
            <List
              size="small"
              dataSource={items}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button
                      key="delete"
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      loading={deletingName === item.name}
                      aria-label={`移除备份 ${item.name}`}
                      onClick={() => confirmDelete(item)}
                    >
                      移除
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
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
              )}
            />
          )}
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
