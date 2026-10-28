// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心的批量动作：删除沿用页面既有的确认流程，导出走「设置 → 批量操作」的统一参数。
 *
 * 拆成 hook 的原因与岗位广场一致：ResumesPage 已贴着 500 行预算，而这两个动作要接
 * 守卫、下载、跳过说明三件事，写在页面里会继续挤占组合层。
 */
import { App } from "antd";
import { useState } from "react";
import { batchDeleteResumes } from "../../api/resumes";
import { batchExportResumes } from "../../api/resumeBatchExport";
import type { BatchExportConfigOut } from "../../api/settingsBatch";
import { t } from "../../i18n";
import { downloadBlob } from "../../utils/download";
import type { ResumeBatchAction } from "./resumeBatchActions";

export function useResumeBatchActions({
  selectedIds,
  exitSelecting,
  onDeleted,
  ensureBatchConfig,
}: {
  selectedIds: ReadonlySet<number>;
  /** 删除成功后退出多选（选择集由 useBatchSelection 清空）。 */
  exitSelecting: () => void;
  /** 删除成功后重拉列表。 */
  onDeleted: () => void;
  /** 未配置批量参数时给"去设置"的弹窗并返回 null。 */
  ensureBatchConfig: () => Promise<BatchExportConfigOut | null>;
}) {
  const { message, modal } = App.useApp();
  const [exporting, setExporting] = useState(false);

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

  const exportSelected = async () => {
    if (selectedIds.size === 0 || exporting) return;
    if (!(await ensureBatchConfig())) return;
    setExporting(true);
    try {
      const result = await batchExportResumes([...selectedIds]);
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
    void exportSelected();
  };

  return { exporting, handleBatchAction };
}
