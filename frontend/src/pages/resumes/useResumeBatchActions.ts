// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心的批量动作：删除沿用页面既有的确认流程，导出走「本次参数」弹窗。
 *
 * 拆成 hook 的原因与岗位广场一致：ResumesPage 已贴着 500 行预算，而这两个动作要接
 * 弹窗、下载、跳过说明三件事，写在页面里会继续挤占组合层。
 *
 * 导出不再先跑一趟设置页：点「批量导出」先弹卡片当场设置（初值来自设置页的默认值），
 * 确认后把这一份参数随请求发出去，**不写回**全局配置。
 */
import { App } from "antd";
import { useState } from "react";
import { batchDeleteResumes } from "../../api/resumes";
import { batchExportResumes } from "../../api/resumeBatchExport";
import type { BatchExportConfig } from "../../api/settingsBatch";
import type { BatchConfigValues } from "../../components/batch/BatchConfigModal";
import { t } from "../../i18n";
import { downloadBlob } from "../../utils/download";
import type { ResumeBatchAction } from "./resumeBatchActions";

export function useResumeBatchActions({
  selectedIds,
  exitSelecting,
  onDeleted,
}: {
  selectedIds: ReadonlySet<number>;
  /** 删除成功后退出多选（选择集由 useBatchSelection 清空）。 */
  exitSelecting: () => void;
  /** 删除成功后重拉列表。 */
  onDeleted: () => void;
}) {
  const { message, modal } = App.useApp();
  const [exporting, setExporting] = useState(false);
  /** 非 null = 「本次参数」弹窗打开，值就是本次要导出的那几份。 */
  const [exportTargets, setExportTargets] = useState<number[] | null>(null);

  /** 批量删除：一次请求删完（全部进回收站），确认后调用。 */
  const removeSelected = () => {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    modal.confirm({
      title: t("resumesPage.batchDelete.title"),
      content: t("resumesPage.batchDelete.body", {
        count: ids.length,
        note: t("common.note.trashRecovery"),
      }),
      okText: t("common.action.delete"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const { deleted } = await batchDeleteResumes(ids);
          message.success(t("resumesPage.batchDelete.done", { count: deleted }));
        } catch (err) {
          message.error(
            err instanceof Error ? err.message : t("resumesPage.error.batchDeleteFailed"),
          );
        }
        exitSelecting();
        onDeleted();
      },
    });
  };

  const runExport = async (ids: number[], config: BatchExportConfig) => {
    if (exporting) return;
    setExporting(true);
    try {
      const result = await batchExportResumes(ids, config);
      downloadBlob(result.blob, result.filename);
      if (result.skipped > 0) {
        // 跳过的是"正文还有未完成标记"这类单份问题：说清几份、为什么，不假装全成功。
        message.warning(
          t("batchOperation.export.skipped", {
            exported: result.exported,
            skipped: result.skipped,
            detail: result.skippedDetail,
          }),
        );
      } else {
        message.success(t("batchOperation.export.done", { count: result.exported }));
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("batchOperation.export.failed"));
    } finally {
      setExporting(false);
    }
  };

  const handleBatchAction = (action: ResumeBatchAction) => {
    if (action === "delete") {
      removeSelected();
      return;
    }
    if (selectedIds.size === 0 || exporting) return;
    // 先弹卡片：参数在这里改，只作用于这一批。
    setExportTargets([...selectedIds]);
  };

  /** 传给 `BatchConfigModal`（mode="export"）的打开态与两个回调。 */
  const configModal = {
    open: exportTargets !== null,
    count: exportTargets?.length ?? 0,
    onCancel: () => setExportTargets(null),
    onConfirm: (config: BatchConfigValues) => {
      const ids = exportTargets;
      setExportTargets(null);
      if (!ids || !("export_format" in config)) return;
      void runExport(ids, config);
    },
  };

  return { exporting, handleBatchAction, configModal };
}
