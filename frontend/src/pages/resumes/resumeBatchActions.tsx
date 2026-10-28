// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心多选态的批量动作（下拉与右键共用）。
 *
 * 与岗位广场的 `pages/jobs/bulkActionItems.tsx` 同一形态：动作构造与组件分开（Fast Refresh），
 * 下拉与右键引用同一份文案与禁用规则。
 */
import { DeleteOutlined, DownloadOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";
import type { RowActionItem } from "../../components/common/RowActions";
import { t } from "../../i18n";

export type ResumeBatchAction = "delete" | "export";

export function buildResumeBatchMenuItems(
  onAction: (action: ResumeBatchAction) => void,
  disabled: boolean,
): MenuProps["items"] {
  return [
    {
      key: "delete",
      label: t("resumesPage.batchDelete.button"),
      icon: <DeleteOutlined />,
      danger: true,
      disabled,
      onClick: () => onAction("delete"),
    },
    {
      key: "export",
      label: t("resumesPage.batch.export"),
      icon: <DownloadOutlined />,
      disabled,
      onClick: () => onAction("export"),
    },
  ];
}

export function buildResumeBatchRowActions(
  onAction: (action: ResumeBatchAction) => void,
  disabled: boolean,
): RowActionItem[] {
  return [
    {
      key: "batch_delete",
      label: t("resumesPage.batchDelete.button"),
      icon: <DeleteOutlined />,
      danger: true,
      disabled,
      onClick: () => onAction("delete"),
    },
    {
      key: "batch_export",
      label: t("resumesPage.batch.export"),
      icon: <DownloadOutlined />,
      disabled,
      onClick: () => onAction("export"),
    },
  ];
}
