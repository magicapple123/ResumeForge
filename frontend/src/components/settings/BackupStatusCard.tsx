// SPDX-License-Identifier: Apache-2.0
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
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import LoadingBlock from "../common/LoadingBlock";
import { ListyItem } from "../common/ListyItem";

/** 快照目录状态：旧后端没有 `snapshot_state` 字段时按快照份数推断，缺字段不得崩。 */
type SnapshotState = NonNullable<BackupStatus["snapshot_state"]>;

function resolveSnapshotState(status: BackupStatus): SnapshotState {
  if (status.snapshot_state) return status.snapshot_state;
  return status.snapshot_count === 0 ? "empty" : "ok";
}

/** 后端显式禁用（A02）：新字段任一为真，或统一 state 枚举为 disabled。 */
function isAutoBackupDisabled(status: BackupStatus): boolean {
  return (
    status.disabled === true || status.auto_backup_enabled === false || status.state === "disabled"
  );
}

/**
 * 状态 → 展示标签 key（保护缺口优先如实暴露）。
 *
 * 优先级（高→低）：无法确认 → 保护中断 → 尚无备份 → 快照缺失 → 已到期 → 受保护。
 * 「无法确认」必须压过其他一切：目录读不了时，后面每一条判断都缺依据。
 *
 * 只返回 key、不在这里取文案：模块作用域求值会把语言钉死，渲染处才 `t()`。
 */
function statusMeta(status: BackupStatus): { labelKey: MessageKey; color: string } {
  const state = resolveSnapshotState(status);
  // 禁用压过其它：部署配置关掉自动备份时，不能显示"受保护/保护中断"这些需要调度才能得出的结论。
  if (isAutoBackupDisabled(status)) {
    return { labelKey: "backupStatus.state.disabled.label", color: "default" };
  }
  if (status.state === "unreadable") {
    return { labelKey: "backupStatus.state.unreadable.label", color: "warning" };
  }
  // A02：后端 state 枚举 → 既有标签（文案见 backupStatus.state.*）。
  if (status.state === "failing") {
    return { labelKey: "backupStatus.state.failing.label", color: "error" };
  }
  if (status.state === "never") {
    return { labelKey: "backupStatus.state.never.label", color: "warning" };
  }
  if (status.state === "empty") {
    return { labelKey: "backupStatus.state.empty.label", color: "warning" };
  }
  if (status.state === "overdue") {
    return { labelKey: "backupStatus.state.overdue.label", color: "warning" };
  }
  if (status.state === "protected") {
    return { labelKey: "backupStatus.state.protected.label", color: "success" };
  }
  if (state === "unreadable") {
    return { labelKey: "backupStatus.state.unreadable.label", color: "warning" };
  }
  if (status.consecutive_failures > 0) {
    return { labelKey: "backupStatus.state.failing.label", color: "error" };
  }
  if (!status.last_success) {
    return { labelKey: "backupStatus.state.never.label", color: "warning" };
  }
  if (state === "empty") {
    return { labelKey: "backupStatus.state.empty.label", color: "warning" };
  }
  if (status.overdue) {
    return { labelKey: "backupStatus.state.overdue.label", color: "warning" };
  }
  return { labelKey: "backupStatus.state.protected.label", color: "success" };
}

/** 常用间隔档位（天）；用户自定义过的值不在档位里时由调用方动态补进选项。 */
const INTERVAL_PRESET_DAYS = [1, 3, 7, 14, 30, 90, 365];

export default function BackupStatusCard() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const { message } = App.useApp();
  const { data: status, loading, error, reload } = useApi(getBackupStatus);
  const [savingInterval, setSavingInterval] = useState(false);

  const meta = status ? statusMeta(status) : null;
  const state = status ? resolveSnapshotState(status) : null;
  const disabled = status ? isAutoBackupDisabled(status) : false;

  const changeInterval = async (days: number) => {
    if (!status || days === status.interval_days || savingInterval) return;
    setSavingInterval(true);
    try {
      await saveAutoBackupInterval(days);
      message.success(t("backupStatus.interval.saved", { count: days }));
      await reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("backupStatus.interval.saveFailed"));
    } finally {
      setSavingInterval(false);
    }
  };

  const intervalOptions =
    status && !INTERVAL_PRESET_DAYS.includes(status.interval_days)
      ? [
          {
            value: status.interval_days,
            label: t("backupStatus.interval.optionDays", { count: status.interval_days }),
          },
          ...INTERVAL_PRESET_DAYS.map((days) => ({
            value: days,
            label: t("backupStatus.interval.optionDays", { count: days }),
          })),
        ]
      : INTERVAL_PRESET_DAYS.map((days) => ({
          value: days,
          label: t("backupStatus.interval.optionDays", { count: days }),
        }));

  return (
    <Card
      title={t("backupStatus.title")}
      className="settings-card"
      extra={
        <Button
          size="small"
          type="text"
          icon={<ReloadOutlined />}
          onClick={() => void reload()}
          aria-label={t("backupStatus.refresh.aria")}
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
            <Tag color={meta.color}>{t(meta.labelKey)}</Tag>
            <Typography.Text type="secondary">
              {t("backupStatus.interval.prefix")}
              <Select
                size="small"
                aria-label={t("backupStatus.interval.aria")}
                style={{ width: 88, margin: "0 4px" }}
                value={status.interval_days}
                options={intervalOptions}
                loading={savingInterval}
                disabled={savingInterval || disabled}
                onChange={(days) => void changeInterval(days)}
              />
              {disabled
                ? t("backupStatus.interval.suffixDisabled")
                : t("backupStatus.interval.suffix")}
            </Typography.Text>
          </Space>
          {disabled ? (
            <Alert type="info" showIcon title={t("backupStatus.state.disabled.hint")} />
          ) : null}
          {status.last_success ? (
            <Typography.Text>
              {t("backupStatus.lastSuccess", {
                time: formatDateTime(new Date(status.last_success * 1000).toISOString()),
              })}
            </Typography.Text>
          ) : (
            <Typography.Text type="warning">{t("backupStatus.lastSuccess.never")}</Typography.Text>
          )}
          {/* H3：后端把覆盖范围显式写进 status（coverage=database_only）。不写出来，用户会
              把「受保护」读成"所有东西都不会丢"，而自动快照里根本没有附件与字体。 */}
          {status.coverage === "database_only" && (
            <Typography.Text type="secondary">
              {t("backupStatus.coverage.databaseOnly")}
            </Typography.Text>
          )}
          {status.consecutive_failures > 0 && status.last_error && (
            <Alert
              type="error"
              showIcon
              title={t("backupStatus.failures", {
                count: status.consecutive_failures,
                error: status.last_error,
              })}
            />
          )}
          {state === "unreadable" && (
            <Alert type="warning" showIcon title={t("backupStatus.state.unreadable.hint")} />
          )}
          {state === "empty" && status.last_success && (
            <Alert type="warning" showIcon title={t("backupStatus.state.empty.hint")} />
          )}
          {state !== "unreadable" && status.snapshot_count > 0 && (
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
          )}
          {state !== "unreadable" && status.snapshot_count === 0 && (
            <Typography.Text type="secondary">{t("backupStatus.snapshots.empty")}</Typography.Text>
          )}
        </Space>
      ) : null}
    </Card>
  );
}
