// SPDX-License-Identifier: Apache-2.0
/**
 * 「外部连接」页的一行：名称 + 三态 + 存储方式 + 当前掩码，**就地改 / 就地清除**。
 *
 * 为什么不弹窗改：这一页的使用场景是"挨个看一遍哪些还没配"，弹窗会把"一屏看全"变成
 * "一个个点开"。所以新 Key 的输入框直接长在行内，保存/取消也在行内。
 *
 * 清除是不可逆的（旧 Key 不再保留），所以走就地 `Popconfirm`（三段式：动作 + 对象 +
 * 后果），而不是 Toast 撤销——撤销需要把密钥留在内存里，那与"清除"的语义相反。
 */

import { Alert, Button, Flex, Input, Popconfirm, Space, Tag, Tooltip, Typography } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useToast } from "../../hooks/useToast";
import type { ConnectionItem } from "../../types";
import { clearConnectionSecret, writeConnectionSecret } from "./connectionKeyWrite";
import {
  connectionItemHint,
  connectionItemLabel,
  connectionMaskedText,
  connectionProtectionLabel,
  connectionStatusColor,
  connectionStatusLabel,
} from "./connectionLabels";

export interface ConnectionRowProps {
  item: ConnectionItem;
  /** 改完通知外层重新取一次状态（三态/掩码都由后端算，前端不猜）。 */
  onChanged: () => void | Promise<void>;
}

export default function ConnectionRow({ item, onChanged }: ConnectionRowProps) {
  useLocale();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  const label = connectionItemLabel(item);

  const commit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFailure("");
    try {
      await writeConnectionSecret(item, draft);
      setEditing(false);
      setDraft("");
      toast.success(t("connections.toast.saved", { name: label }));
      await onChanged();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : t("connections.loadFailed"));
    } finally {
      setBusy(false);
    }
  };

  const clear = async (): Promise<void> => {
    setBusy(true);
    setFailure("");
    try {
      await clearConnectionSecret(item);
      toast.success(t("connections.toast.cleared", { name: label }));
      await onChanged();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : t("connections.loadFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flex className="connection-row" vertical gap={6}>
      <Flex align="center" gap={8} wrap>
        <Typography.Text strong>{label}</Typography.Text>
        <Tag color={connectionStatusColor(item)}>{connectionStatusLabel(item)}</Tag>
        {/* 存储方式是一句"它在本机怎么存"，与"有没有配"是两件事（Q19：非 Windows 是明文）。 */}
        <Tooltip title={item.protection_description || undefined}>
          <Tag>{connectionProtectionLabel(item)}</Tag>
        </Tooltip>
      </Flex>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {connectionItemHint(item)}
      </Typography.Text>

      {editing ? (
        <Flex align="center" gap={8} wrap>
          <Input.Password
            aria-label={t("connections.input.label", { name: label })}
            placeholder={t("connections.input.placeholder")}
            value={draft}
            autoComplete="off"
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onPressEnter={() => void commit()}
            style={{ maxWidth: 360 }}
          />
          <Button
            type="primary"
            size="small"
            loading={busy}
            // 一页有七行同样的按钮：无障碍名必须带上是哪一把 Key（antd 会自动给
            // 两个汉字的按钮插空格，读屏念出来是"保 存"，所以显式给 aria-label）。
            aria-label={t("connections.action.saveAria", { name: label })}
            disabled={draft.trim() === "" || undefined}
            onClick={() => void commit()}
          >
            {t("connections.action.save")}
          </Button>
          <Button
            size="small"
            disabled={busy || undefined}
            onClick={() => {
              setEditing(false);
              setDraft("");
              setFailure("");
            }}
          >
            {t("connections.action.cancel")}
          </Button>
        </Flex>
      ) : (
        <Flex align="center" gap={8} wrap>
          <Typography.Text code>{connectionMaskedText(item)}</Typography.Text>
          {item.editable ? (
            <Space size={4}>
              <Button
                size="small"
                aria-label={t("connections.action.editAria", { name: label })}
                onClick={() => setEditing(true)}
              >
                {t("connections.action.edit")}
              </Button>
              <Popconfirm
                title={t("connections.clear.title")}
                description={t("connections.clear.body")}
                // 按钮文案写清后果（不是"确定"）：清掉之后这一行会变成"未配置"。
                okText={t("connections.clear.title")}
                cancelText={t("connections.action.cancel")}
                okButtonProps={{ danger: true }}
                onConfirm={() => void clear()}
              >
                <Button
                  size="small"
                  danger
                  aria-label={t("connections.action.clearAria", { name: label })}
                  disabled={busy || undefined}
                >
                  {t("connections.action.clear")}
                </Button>
              </Popconfirm>
            </Space>
          ) : null}
        </Flex>
      )}

      {failure ? <Alert type="error" showIcon title={failure} /> : null}
    </Flex>
  );
}
