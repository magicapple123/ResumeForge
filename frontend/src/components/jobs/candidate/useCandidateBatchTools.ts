// SPDX-License-Identifier: Apache-2.0
/**
 * 备选岗位抽屉的批量动作（跨页全选 / 导出 CSV / 批量删除）：
 * 从 CandidateJobsDrawer 拆出（文件行数预算）——动作本身只依赖选择集与刷新回调，
 * 状态所有权仍留在抽屉，这里只收"发出请求 + 给结果提示"这段流程。
 * （批量导入入口已按产品决策移除；后端端点保留，采集结果面板仍在用。）
 */
import { App } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import {
  deleteCandidateJob,
  exportCandidatesCsv,
  listCandidateJobIds,
} from "../../../api/candidateJob";
import { downloadBlob } from "../../../utils/download";

export function useCandidateBatchTools({
  selectedIds,
  setSelectedIds,
  keyword,
  collectTaskIdsKey,
  onMutated,
  onBatchActionChange,
}: {
  selectedIds: number[];
  setSelectedIds: (updater: (current: number[]) => number[]) => void;
  /** 已提交的搜索词：跨页全选与列表同一份筛选口径。 */
  keyword: string;
  /** 逗号分隔的采集批次 id（「本次采集结果」入口）；空串 = 不按批次过滤。 */
  collectTaskIdsKey: string;
  /** 批量动作改变了数据（删除）后由抽屉整页重拉。 */
  onMutated: () => Promise<void>;
  /** 批量删除进行中由抽屉置位（工具条按钮据此 loading/禁用）。 */
  onBatchActionChange?: (action: "import" | "delete" | null) => void;
}) {
  const { message } = App.useApp();
  const [selectAllPagesLoading, setSelectAllPagesLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  /** 跨页全选：按当前筛选拿全部候选 id（与分页列表同一份筛选器），整体勾选。 */
  const selectAllPages = async () => {
    if (selectAllPagesLoading) return;
    setSelectAllPagesLoading(true);
    try {
      const ids = await listCandidateJobIds({
        ...(keyword ? { keyword } : {}),
        ...(collectTaskIdsKey
          ? { collectTaskIds: collectTaskIdsKey.split(",").map((value) => Number(value)) }
          : {}),
      });
      if (ids.length === 0) {
        message.warning("当前筛选下没有备选岗位");
        return;
      }
      // 上限与后端批量端点（5000）对齐：全选全部（含 CSV 导出）一次过；
      // 超出时给出明确提示，而不是让请求撞 422。
      if (ids.length > 5000) {
        message.warning(
          `当前筛选下共 ${ids.length} 条备选岗位，超出单次批量上限 5000 条；请先用搜索缩小范围`,
        );
        return;
      }
      setSelectedIds(() => ids);
      message.success(`已选中当前筛选下的全部 ${ids.length} 条候选（所有页）`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "获取备选岗位列表失败");
    } finally {
      setSelectAllPagesLoading(false);
    }
  };

  /** 导出勾选的候选为 CSV（文件名带时间戳，多次导出不互相覆盖）。 */
  const exportSelected = async () => {
    if (selectedIds.length === 0 || exporting) return;
    setExporting(true);
    try {
      const blob = await exportCandidatesCsv([...selectedIds]);
      const stamp = dayjs().format("YYYYMMDD-HHmmss");
      downloadBlob(blob, `备选岗位-${stamp}.csv`);
      message.success(`已导出 ${selectedIds.length} 条备选岗位`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  /**
   * 删除勾选的候选（`Promise.allSettled` 逐条删，统计成功/失败）。
   *
   * **二次确认不在这里**：它由工具条上「批量删除」的就地 `Popconfirm` 承担（Popover 形态，
   * 不占容器层）。本 hook 是在 `CandidateJobsDrawer` 打开时被调用的，在这里开 `modal.confirm`
   * 就是抽屉 + confirm 两层容器（AGENTS.md 的 §3.7 明令禁止，`popupStackGuard` 靠文件名抓不到
   * hook，只能靠这条注释与工具条上的实现守着）。传进来的调用点因此只有"已确认"的这一次。
   */
  const deleteSelected = async () => {
    if (selectedIds.length === 0) {
      message.warning("请先选择备选岗位");
      return;
    }
    const ids = [...selectedIds];
    // 置位批量动作：工具条据此把按钮切成 loading/禁用（防二次点击）。
    onBatchActionChange?.("delete");
    try {
      const results = await Promise.allSettled(ids.map((id) => deleteCandidateJob(id)));
      const deleted = results.filter((result) => result.status === "fulfilled").length;
      const failed = results.length - deleted;
      setSelectedIds(() => []);
      await onMutated();
      if (failed > 0) {
        message.warning(`已删除 ${deleted} 个备选岗位，${failed} 个删除失败`);
      } else {
        message.success(`已删除 ${deleted} 个备选岗位`);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "批量删除失败");
    } finally {
      onBatchActionChange?.(null);
    }
  };

  return {
    selectAllPages,
    selectAllPagesLoading,
    exportSelected,
    exporting,
    deleteSelected,
  };
}
