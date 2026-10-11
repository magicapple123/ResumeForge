/**
 * 自动备份保护状态卡（RF-05）：把"是否被保护"如实展示给用户。
 *
 * 显示最近一次成功备份时间、快照份数与失败原因；失败中的保护缺口（连续失败）
 * 与超过间隔未成功（overdue）都明确标出，不把"尝试过"包装成"已保护"。数据自取
 * （挂载时拉一次 /api/settings/backup-status），不向父级传回调，方便插在
 * 设置页"数据"页签的任意位置。
 */

import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, List, Space, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { getBackupStatus } from "../../api/settings";
import type { BackupStatus } from "../../types";
import { formatDateTime } from "../../utils/format";
import LoadingBlock from "../common/LoadingBlock";

/** 状态 → 展示标签（保护缺口优先如实暴露）。 */
function statusMeta(status: BackupStatus): { label: string; color: string } {
  if (status.consecutive_failures > 0) return { label: "保护中断", color: "error" };
  if (!status.last_success) return { label: "尚无备份", color: "warning" };
  if (status.overdue) return { label: "已到期未备份", color: "warning" };
  return { label: "受保护", color: "success" };
}

export default function BackupStatusCard() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStatus(await getBackupStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取备份状态失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const meta = status ? statusMeta(status) : null;

  return (
    <Card
      title="自动备份状态"
      className="settings-card"
      extra={
        <Button
          size="small"
          type="text"
          icon={<ReloadOutlined />}
          onClick={() => void load()}
          aria-label="刷新备份状态"
        />
      }
    >
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <Alert type="error" showIcon title={error} />
      ) : status && meta ? (
        <Space direction="vertical" style={{ width: "100%" }} size={8}>
          <Space wrap>
            <Tag color={meta.color}>{meta.label}</Tag>
            <Typography.Text type="secondary">
              每 {status.interval_days} 天自动快照一次，只保留最近几份；手动导出的备份包不受影响。
            </Typography.Text>
          </Space>
          {status.last_success ? (
            <Typography.Text>
              最近一次成功备份：
              {formatDateTime(new Date(status.last_success * 1000).toISOString())}
            </Typography.Text>
          ) : (
            <Typography.Text type="warning">还没有成功过的自动备份。</Typography.Text>
          )}
          {status.consecutive_failures > 0 && status.last_error && (
            <Alert
              type="error"
              showIcon
              title={`连续 ${status.consecutive_failures} 次备份失败：${status.last_error}。系统会按短间隔自动重试。`}
            />
          )}
          {status.snapshot_count > 0 ? (
            <List
              size="small"
              dataSource={status.snapshots}
              renderItem={(item) => (
                <List.Item>
                  <Typography.Text ellipsis style={{ maxWidth: "70%" }}>
                    {item.name}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    {formatDateTime(new Date(item.modified_at * 1000).toISOString())}
                  </Typography.Text>
                </List.Item>
              )}
            />
          ) : (
            <Typography.Text type="secondary">
              暂无自动快照；首次成功备份后会在这里列出。
            </Typography.Text>
          )}
        </Space>
      ) : null}
    </Card>
  );
}
