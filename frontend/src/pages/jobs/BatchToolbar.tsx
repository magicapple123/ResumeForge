// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位广场批量操作条：选择模式下的清空/批量设置状态/导出 CSV/批量删除。
 * （自 JobsPage 拆出：:489-537 整块逐字随迁；applyBatchStatus/removeSelectedJobs
 * 经 prop 直通页面 handler；「导出 CSV」是纯前端动作，状态与调用就地持有。）
 */
import {
  CheckOutlined,
  ClearOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { App, Button, Select, Space, Tooltip, Typography } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { exportJobsCsv } from "../../api/jobs";
import { t } from "../../i18n";
import { JOB_STATUS_LABEL_KEYS } from "../../i18n/enum/jobs";
import { useLocale } from "../../i18n/i18nContext";
import { downloadBlob } from "../../utils/download";
import type { BatchAction } from "./jobFilterOptions";

export function BatchToolbar({
  selectionMode,
  selectedJobIds,
  setSelectedJobIds,
  batchAction,
  batchStatus,
  setBatchStatus,
  applyBatchStatus,
  enqueueSelectedJobs,
  removeSelectedJobs,
  exitSelectionMode,
  totalCount = 0,
  selectAllPagesLoading = false,
  onSelectAllPages,
}: {
  selectionMode: boolean;
  selectedJobIds: number[];
  setSelectedJobIds: (value: number[]) => void;
  batchAction: BatchAction;
  batchStatus: string | undefined;
  setBatchStatus: (value: string | undefined) => void;
  applyBatchStatus: () => Promise<void>;
  enqueueSelectedJobs: () => Promise<void>;
  removeSelectedJobs: () => Promise<void>;
  /** 退出选择模式（从筛选行挪到这里，用户要求）。 */
  exitSelectionMode: () => void;
  /** 当前筛选下全部岗位数：>0 时显示「全选全部岗位」按钮。 */
  totalCount?: number;
  selectAllPagesLoading?: boolean;
  /** 一键全选所有页；未传（undefined）时不渲染该入口。 */
  onSelectAllPages?: () => void;
}) {
  useLocale();
  // 导出 CSV 是纯前端动作（勾选的 id → 后端序列化 → 触发下载）：
  // 状态本地持有，不占用页面级的 batchAction（那边留给会改数据的操作）。
  const { message } = App.useApp();
  const [exporting, setExporting] = useState(false);
  const exportSelectedJobs = async () => {
    if (selectedJobIds.length === 0 || exporting) return;
    setExporting(true);
    try {
      const blob = await exportJobsCsv([...selectedJobIds]);
      // 文件名带导出时刻：几次导出的文件落在同一个下载目录里不会互相覆盖、
      // 也不用靠文件管理器的"副本 (1)"来分辨先后。
      const stamp = dayjs().format("YYYYMMDD-HHmmss");
      downloadBlob(blob, t("jobsPage.toolbar.exportFileName", { stamp }));
      message.success(t("jobsPage.toolbar.exported", { count: selectedJobIds.length }));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("jobsPage.toolbar.exportFailed"));
    } finally {
      setExporting(false);
    }
  };
  if (!selectionMode) return null;
  // 下拉的 value 仍是落库的协议值，展示名在渲染期取（见 i18n/enum/jobs.ts）。
  const statusOptions = Object.entries(JOB_STATUS_LABEL_KEYS).map(([value, key]) => ({
    value,
    label: t(key),
  }));
  return (
    <Space style={{ marginBottom: 12, minHeight: 32 }} wrap>
      <Typography.Text type="secondary">
        {t("jobsPage.toolbar.selectedCount", { count: selectedJobIds.length })}
      </Typography.Text>
      {onSelectAllPages && totalCount > 0 && (
        <Tooltip title={t("jobsPage.toolbar.selectAllTooltip", { count: totalCount })}>
          <Button
            disabled={batchAction !== null}
            loading={selectAllPagesLoading}
            onClick={onSelectAllPages}
          >
            {t("jobsPage.toolbar.selectAllButton", { count: totalCount })}
          </Button>
        </Tooltip>
      )}
      {/* 退出选择挪到「全选全部岗位」右侧（用户要求）：与选择操作同处一行，
          不再挤在筛选行的末尾。 */}
      <Button
        icon={<CloseCircleOutlined />}
        disabled={batchAction !== null}
        onClick={exitSelectionMode}
      >
        {t("jobsPage.toolbar.exitSelection")}
      </Button>
      <Button
        icon={<ClearOutlined />}
        disabled={selectedJobIds.length === 0 || batchAction !== null}
        onClick={() => {
          setSelectedJobIds([]);
          setBatchStatus(undefined);
        }}
      >
        {t("jobsPage.toolbar.clearSelection")}
      </Button>
      <Select
        placeholder={t("jobsPage.toolbar.statusPlaceholder")}
        value={batchStatus}
        options={statusOptions}
        style={{ width: 150 }}
        disabled={selectedJobIds.length === 0 || batchAction !== null}
        onChange={setBatchStatus}
      />
      <Button
        icon={<CheckOutlined />}
        disabled={selectedJobIds.length === 0 || !batchStatus || batchAction !== null}
        loading={batchAction === "status"}
        onClick={() => void applyBatchStatus()}
      >
        {t("jobsPage.toolbar.applyStatus")}
      </Button>
      {/* 海投效率路径：批量直接入队。Tooltip 必须说清两件看不见的事——双确认会被
          一并带上（不逐条弹窗）、来源不支持的岗位会静默跳过，否则用户只看到"少进去了几个"。 */}
      <Tooltip title={t("jobsPage.toolbar.enqueueTooltip")}>
        <Button
          icon={<SendOutlined />}
          disabled={selectedJobIds.length === 0 || batchAction !== null}
          loading={batchAction === "enqueue"}
          onClick={() => void enqueueSelectedJobs()}
        >
          {t("jobsPage.toolbar.enqueue")}
        </Button>
      </Tooltip>
      <Button
        icon={<DownloadOutlined />}
        disabled={selectedJobIds.length === 0 || batchAction !== null}
        loading={exporting}
        onClick={() => void exportSelectedJobs()}
      >
        {t("jobsPage.toolbar.exportCsv")}
      </Button>
      {/* 软删可撤销：不再前置确认，撤销入口在删除后的 Toast 上（见 useDeleteUndo）。 */}
      <Button
        danger
        icon={<DeleteOutlined />}
        disabled={selectedJobIds.length === 0 || batchAction !== null}
        loading={batchAction === "delete"}
        onClick={() => removeSelectedJobs()}
      >
        {t("jobsPage.toolbar.delete")}
      </Button>
    </Space>
  );
}
