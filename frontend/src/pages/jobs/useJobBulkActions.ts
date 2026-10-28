// SPDX-License-Identifier: Apache-2.0
/**
 * 多选态的批量动作入口：把下拉 / 右键菜单的六个动作接到既有实现上。
 *
 * 六个动作都**逐个执行原来的单项操作**：删除走软删撤销、导出 CSV 一次导出所选、
 * 生成简历与岗位解读交给 `jobBulkAiRunner` 串行执行、匹配度分析仍打开逐岗面板
 * （横向对比是筛选条另一个入口），加入队列沿用既有批量入队（含双确认与来源校验）。
 */
import { App } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { exportJobsCsv } from "../../api/jobs";
import { startBulkAi, stopBulkAi, useBulkAiState } from "../../features/jobs/jobBulkAiRunner";
import type { BatchGenerationConfig } from "../../api/settingsBatch";
import { t } from "../../i18n";
import type { JobList, Page } from "../../types";
import { downloadBlob } from "../../utils/download";
import type { BulkMenuAction } from "./bulkActionItems";

export function useJobBulkActions({
  jobs,
  selectedJobIds,
  removeSelectedJobs,
  enqueueSelectedJobs,
  openMatchBatch,
  ensureBatchConfig,
}: {
  jobs: Page<JobList> | undefined;
  selectedJobIds: number[];
  removeSelectedJobs: () => Promise<void>;
  enqueueSelectedJobs: () => Promise<void>;
  openMatchBatch: (view?: "setup" | "history", mode?: "match" | "compare") => void;
  /** 批量生成简历前必须确认「设置 → 批量操作」已保存；返回 null = 已提示并中止。 */
  ensureBatchConfig: () => Promise<BatchGenerationConfig | null>;
}) {
  const { message } = App.useApp();
  const [exporting, setExporting] = useState(false);
  const bulkAi = useBulkAiState();

  const selectedJobs = () => {
    const byId = new Map((jobs?.items ?? []).map((job) => [job.id, job]));
    return selectedJobIds.map((id) => ({
      id,
      title: byId.get(id)?.title ?? `#${id}`,
      company: byId.get(id)?.company ?? "",
    }));
  };

  const exportSelectedJobs = async () => {
    if (selectedJobIds.length === 0 || exporting) return;
    setExporting(true);
    try {
      const blob = await exportJobsCsv([...selectedJobIds]);
      const stamp = dayjs().format("YYYYMMDD-HHmmss");
      downloadBlob(blob, t("jobsPage.toolbar.exportFileName", { stamp }));
      message.success(t("jobsPage.toolbar.exported", { count: selectedJobIds.length }));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("jobsPage.toolbar.exportFailed"));
    } finally {
      setExporting(false);
    }
  };

  const handleBulkAction = async (action: BulkMenuAction) => {
    if (selectedJobIds.length === 0) {
      message.warning(t("jobsPage.batch.needSelection"));
      return;
    }
    switch (action) {
      case "delete":
        void removeSelectedJobs();
        return;
      case "enqueue":
        void enqueueSelectedJobs();
        return;
      case "export":
        void exportSelectedJobs();
        return;
      case "matchAnalysis":
        openMatchBatch("setup", "match");
        return;
      case "generateResume": {
        // 先确认批量参数：未配置时给"去设置"的弹窗，绝不拿默认值偷偷跑一批。
        const config = await ensureBatchConfig();
        if (!config) return;
        startBulkAi("resume", selectedJobs(), config);
        return;
      }
      case "analyzeJob":
        startBulkAi("analysis", selectedJobs());
        return;
    }
  };

  return { handleBulkAction, exporting, bulkAi, stopBulkAi };
}
