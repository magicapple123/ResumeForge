// SPDX-License-Identifier: Apache-2.0
/**
 * 多选态的批量动作入口：把下拉 / 右键菜单的六个动作接到既有实现上。
 *
 * 六个动作都**逐个执行原来的单项操作**：删除走软删撤销、导出 CSV 一次导出所选、
 * 生成简历与岗位解读交给 `jobBulkAiRunner` 串行执行、匹配度分析仍打开逐岗面板
 * （横向对比是筛选条另一个入口），加入队列沿用既有批量入队（含双确认与来源校验）。
 *
 * 「批量生成简历」不再跳设置页：改为打开「本次参数」弹窗（`configModal`），确认后
 * 才开跑，页面不被跳转、勾选不丢。
 */
import { App } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { exportJobsCsv } from "../../api/jobs";
import { startBulkAi, stopBulkAi, useBulkAiState } from "../../features/jobs/jobBulkAiRunner";
import type { BatchConfigValues } from "../../features/batch/BatchConfigModal";
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
}: {
  jobs: Page<JobList> | undefined;
  selectedJobIds: number[];
  removeSelectedJobs: () => Promise<void>;
  enqueueSelectedJobs: () => Promise<void>;
  openMatchBatch: (view?: "setup" | "history", mode?: "match" | "compare") => void;
}) {
  const { message } = App.useApp();
  const [exporting, setExporting] = useState(false);
  /** 非 null = 弹窗打开，值就是本次要生成的那几个岗位（确认时才开跑）。 */
  const [generateTargets, setGenerateTargets] = useState<
    | {
        id: number;
        title: string;
        company: string;
      }[]
    | null
  >(null);
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
      case "generateResume":
        // 先把人留在原地：弹一张卡片当场确认本次参数，确认后才开跑。
        setGenerateTargets(selectedJobs());
        return;
      case "analyzeJob":
        startBulkAi("analysis", selectedJobs());
        return;
    }
  };

  /** 传给 `BatchConfigModal`（mode="generation"）的打开态与两个回调。 */
  const configModal = {
    open: generateTargets !== null,
    count: generateTargets?.length ?? 0,
    onCancel: () => setGenerateTargets(null),
    onConfirm: (config: BatchConfigValues) => {
      const targets = generateTargets;
      setGenerateTargets(null);
      if (!targets || !("enhance" in config)) return;
      startBulkAi("resume", targets, config);
    },
  };

  return { handleBulkAction, exporting, bulkAi, stopBulkAi, configModal };
}
