/**
 * 自动备份保护状态卡（RF-05）：把"是否被保护"如实展示给用户。
 *
 * 显示最近一次成功备份时间、快照份数与失败原因；失败中的保护缺口（连续失败）
 * 与超过间隔未成功（overdue）都明确标出，不把"尝试过"包装成"已保护"。数据自取
 * （挂载时拉一次 /api/settings/backup-status），不向父级传回调，方便插在
 * 设置页"数据"页签的任意位置。
 *
 * 「受保护」的口径是**仅数据库快照**（PR-15 审计项）：自动备份不含附件文件，
 * 也不等价于整机灾备——界面上必须把这个范围说清楚，不能让用户误以为"受保护"
 * 等于"所有数据都不会丢"。
 */

import { ReloadOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Listy, Select, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { getBackupStatus, saveAutoBackupInterval } from "../../api/settings";
import { useApi } from "../../hooks/useApi";
import type { BackupStatus } from "../../types";
import { formatDateTime } from "../../utils/format";
import LoadingBlock from "../common/LoadingBlock";
import { ListyItem } from "../common/ListyItem";

/** 状态 → 展示标签（保护缺口优先如实暴露）。 */
function statusMeta(status: BackupStatus): { label: string; color: string } {
  if (status.consecutive_failures > 0) return { label: "保护中断", color: "error" };
  if (!status.last_success) return { label: "尚无备份", color: "warning" };
  if (status.overdue) return { label: "已到期未备份", color: "warning" };
  return { label: "受保护", color: "success" };
}

/** 常用间隔档位（天）；用户自定义过的值不在档位里时由调用方动态补进选项。 */
const INTERVAL_PRESET_DAYS = [1, 3, 7, 14, 30, 90, 365];

export default function BackupStatusCard() {
  const { message } = App.useApp();
  const { data: status, loading, error, reload } = useApi(getBackupStatus);
  const [savingInterval, setSavingInterval] = useState(false);

  const meta = status ? statusMeta(status) : null;

  const changeInterval = async (days: number) => {
    if (!status || days === status.interval_days || savingInterval) return;
    setSavingInterval(true);
    try {
      await saveAutoBackupInterval(days);
      message.success(`自动备份间隔已改为每 ${days} 天，下次调度检查时生效`);
      await reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存自动备份间隔失败");
    } finally {
      setSavingInterval(false);
    }
  };

  const intervalOptions =
    status && !INTERVAL_PRESET_DAYS.includes(status.interval_days)
      ? [
          { value: status.interval_days, label: `${status.interval_days} 天` },
          ...INTERVAL_PRESET_DAYS.map((days) => ({ value: days, label: `${days} 天` })),
        ]
      : INTERVAL_PRESET_DAYS.map((days) => ({ value: days, label: `${days} 天` }));

  return (
    <Card
      title="自动备份状态"
      className="settings-card"
      extra={
        <Button
          size="small"
          type="text"
          icon={<ReloadOutlined />}
          onClick={() => void reload()}
          aria-label="刷新备份状态"
        />
      }
    >
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <Alert type="error" showIcon title={error} />
      ) : status && meta ? (
        <Space orientation="vertical" style={{ width: "100%" }} size={8}>
          <Space wrap>
            <Tag color={meta.color}>{meta.label}</Tag>
            <Typography.Text type="secondary">
              每
              <Select
                size="small"
                aria-label="自动备份间隔（天）"
                style={{ width: 88, margin: "0 4px" }}
                value={status.interval_days}
                options={intervalOptions}
                loading={savingInterval}
                disabled={savingInterval}
                onChange={(days) => void changeInterval(days)}
              />
              天自动快照一次（仅数据库快照，不含附件文件）；手动导出的备份包才包含附件。
              只保留最近几份，手动备份不受影响。
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
            <Listy
              items={status.snapshots}
              rowKey={(item) => item.name}
              itemRender={(item) => (
                <ListyItem>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <Typography.Text ellipsis style={{ maxWidth: "70%" }}>
                      {item.name}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {formatDateTime(new Date(item.modified_at * 1000).toISOString())}
                    </Typography.Text>
                  </div>
                </ListyItem>
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
