// SPDX-License-Identifier: Apache-2.0
/**
 * 多选态批量动作的菜单项构造（下拉与右键共用同一组六项、同一份文案）。
 *
 * 与组件分开：`.tsx` 只导出组件，Fast Refresh 才不会因为同文件导出普通函数而退化成整页刷新
 * （与 `components/common/rowActionMenu` 同一个理由）。
 */
import {
  DeleteOutlined,
  DownloadOutlined,
  FileTextOutlined,
  RobotOutlined,
  SendOutlined,
  SolutionOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import type { RowActionItem } from "../../components/common/RowActions";
import { t } from "../../i18n";

export type BulkMenuAction =
  "delete" | "export" | "generateResume" | "analyzeJob" | "matchAnalysis" | "enqueue";

export function buildBulkActionItems(
  onAction: (action: BulkMenuAction) => void,
  disabled: boolean,
): MenuProps["items"] {
  const item = (key: BulkMenuAction, label: string, icon: React.ReactNode, danger = false) => ({
    key,
    label,
    icon,
    danger,
    disabled,
    onClick: () => onAction(key),
  });
  return [
    item("matchAnalysis", t("jobsPage.toolbar.bulkMatch"), <SolutionOutlined />),
    item("analyzeJob", t("jobsPage.toolbar.bulkAnalyze"), <FileTextOutlined />),
    item("generateResume", t("jobsPage.toolbar.bulkGenerate"), <RobotOutlined />),
    item("enqueue", t("jobsPage.toolbar.bulkEnqueue"), <SendOutlined />),
    { type: "divider" as const },
    item("export", t("jobsPage.toolbar.exportCsv"), <DownloadOutlined />),
    item("delete", t("jobsPage.toolbar.delete"), <DeleteOutlined />, true),
  ];
}

/** 多选态下整行右键菜单：与下拉同一组动作、同一份文案。 */
export function buildBulkRowActions(
  onAction: (action: BulkMenuAction) => void,
  disabled: boolean,
): RowActionItem[] {
  return [
    {
      key: "bulk_match",
      label: t("jobsPage.toolbar.bulkMatch"),
      icon: <SolutionOutlined />,
      disabled,
      onClick: () => onAction("matchAnalysis"),
    },
    {
      key: "bulk_analyze",
      label: t("jobsPage.toolbar.bulkAnalyze"),
      icon: <FileTextOutlined />,
      disabled,
      onClick: () => onAction("analyzeJob"),
    },
    {
      key: "bulk_generate",
      label: t("jobsPage.toolbar.bulkGenerate"),
      icon: <RobotOutlined />,
      disabled,
      onClick: () => onAction("generateResume"),
    },
    {
      key: "bulk_enqueue",
      label: t("jobsPage.toolbar.bulkEnqueue"),
      icon: <SendOutlined />,
      disabled,
      onClick: () => onAction("enqueue"),
    },
    {
      key: "bulk_export",
      label: t("jobsPage.toolbar.exportCsv"),
      icon: <DownloadOutlined />,
      disabled,
      onClick: () => onAction("export"),
    },
    {
      key: "bulk_delete",
      label: t("jobsPage.toolbar.delete"),
      icon: <DeleteOutlined />,
      danger: true,
      disabled,
      undo: true,
      onClick: () => onAction("delete"),
    },
  ];
}
