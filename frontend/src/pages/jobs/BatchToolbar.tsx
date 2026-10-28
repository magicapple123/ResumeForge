// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位广场批量操作条：选择模式下的计数 / 全选 / 退出 / 清空 / 批量设置状态，
 * 以及一个统一的「批量操作」下拉（删除、导出 CSV、生成简历、需求解读、匹配度分析、入队）。
 *
 * 下拉只负责把动作交回页面（`onBulkAction`）：导出要下载文件、入队要带双确认、
 * 删除要走撤销 Toast，这些都留在各自的既有实现里，工具栏不再各持一份状态。
 */
import { CheckOutlined, ClearOutlined, CloseCircleOutlined } from "@ant-design/icons";
import { Button, Progress, Select, Space, Tooltip, Typography } from "antd";
import { t } from "../../i18n";
import { JOB_STATUS_LABEL_KEYS } from "../../i18n/enum/jobs";
import { useLocale } from "../../i18n/i18nContext";
import type { BulkAiState } from "../../features/jobs/jobBulkAiRunner";
import BulkActionsMenu from "./BulkActionsMenu";
import type { BulkMenuAction } from "./bulkActionItems";
import type { BatchAction } from "./jobFilterOptions";

export function BatchToolbar({
  selectionMode,
  selectedJobIds,
  setSelectedJobIds,
  batchAction,
  batchStatus,
  setBatchStatus,
  applyBatchStatus,
  onBulkAction,
  bulkAi,
  onStopBulkAi,
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
  /** 六个批量动作统一交回页面处理。 */
  onBulkAction: (action: BulkMenuAction) => void;
  bulkAi: BulkAiState;
  onStopBulkAi: () => void;
  /** 退出选择模式（从筛选行挪到这里，用户要求）。 */
  exitSelectionMode: () => void;
  /** 当前筛选下全部岗位数：>0 时显示「全选全部岗位」按钮。 */
  totalCount?: number;
  selectAllPagesLoading?: boolean;
  /** 一键全选所有页；未传（undefined）时不渲染该入口。 */
  onSelectAllPages?: () => void;
}) {
  useLocale();
  // 下拉的 value 仍是落库的协议值，展示名在渲染期取（见 i18n/enum/jobs.ts）。
  const statusOptions = Object.entries(JOB_STATUS_LABEL_KEYS).map(([value, key]) => ({
    value,
    label: t(key),
  }));
  if (!selectionMode) return null;
  const busy = batchAction !== null || bulkAi.running;
  return (
    <Space orientation="vertical" size={8} style={{ width: "100%", marginBottom: 12 }}>
      <Space wrap style={{ minHeight: 32 }}>
        <Typography.Text type="secondary">
          {t("jobsPage.toolbar.selectedCount", { count: selectedJobIds.length })}
        </Typography.Text>
        {onSelectAllPages && totalCount > 0 && (
          <Tooltip title={t("jobsPage.toolbar.selectAllTooltip", { count: totalCount })}>
            <Button disabled={busy} loading={selectAllPagesLoading} onClick={onSelectAllPages}>
              {t("jobsPage.toolbar.selectAllButton", { count: totalCount })}
            </Button>
          </Tooltip>
        )}
        <Button icon={<CloseCircleOutlined />} disabled={busy} onClick={exitSelectionMode}>
          {t("jobsPage.toolbar.exitSelection")}
        </Button>
        <Button
          icon={<ClearOutlined />}
          disabled={selectedJobIds.length === 0 || busy}
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
          disabled={selectedJobIds.length === 0 || busy}
          onChange={setBatchStatus}
        />
        <Button
          icon={<CheckOutlined />}
          disabled={selectedJobIds.length === 0 || !batchStatus || busy}
          loading={batchAction === "status"}
          onClick={() => void applyBatchStatus()}
        >
          {t("jobsPage.toolbar.applyStatus")}
        </Button>
        <BulkActionsMenu disabled={selectedJobIds.length === 0 || busy} onAction={onBulkAction} />
      </Space>
      {bulkAi.running ? (
        <Space size={12} wrap>
          <Progress
            percent={bulkAi.total > 0 ? Math.round((bulkAi.done / bulkAi.total) * 100) : 0}
            size="small"
            style={{ width: 220 }}
          />
          <Typography.Text type="secondary">
            {t(
              bulkAi.kind === "resume"
                ? "jobsPage.bulkAi.resumeProgress"
                : "jobsPage.bulkAi.analysisProgress",
              {
                done: bulkAi.done,
                total: bulkAi.total,
                current: bulkAi.currentTitle,
              },
            )}
          </Typography.Text>
          <Button size="small" disabled={bulkAi.stopRequested} onClick={onStopBulkAi}>
            {t("jobsPage.bulkAi.stop")}
          </Button>
        </Space>
      ) : null}
    </Space>
  );
}
