// SPDX-License-Identifier: Apache-2.0
/** 自动保存状态：保存中 / 已自动保存 / 失败重试。 */
import { CheckCircleOutlined, LoadingOutlined, WarningOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import { t, type MessageKey } from "../../i18n";
import type { AutoSaveStatus } from "../../features/settings/useBatchSectionAutoSave";
// 模块级 t() 不消费 React context：不订阅语言 store，切换语言后这一屏会停在旧文案
// （localeSubscription 守卫）。组件体里调一次 useLocale() 订阅即可随语言重渲染。
import { useLocale } from "../../i18n/i18nContext";

const META: Record<AutoSaveStatus, { key: MessageKey; icon: ReactNode; className: string }> = {
  idle: {
    key: "batchOperation.status.pending",
    icon: <WarningOutlined />,
    className: "is-pending",
  },
  saving: {
    key: "batchOperation.status.saving",
    icon: <LoadingOutlined />,
    className: "is-saving",
  },
  saved: {
    key: "batchOperation.status.saved",
    icon: <CheckCircleOutlined />,
    className: "is-saved",
  },
  error: {
    key: "batchOperation.status.error",
    icon: <WarningOutlined />,
    className: "is-error",
  },
};

export default function BatchSaveStatus({ status }: { status: AutoSaveStatus }) {
  useLocale();
  const meta = META[status];
  return (
    <span className={`batch-config-status ${meta.className}`}>
      {meta.icon}
      {t(meta.key)}
    </span>
  );
}
