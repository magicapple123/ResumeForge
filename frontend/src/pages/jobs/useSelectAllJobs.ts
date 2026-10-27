// SPDX-License-Identifier: Apache-2.0
/** 岗位广场「全选全部岗位」的状态与动作（自 JobsPage 拆出：文件行数预算）。
 *  状态所有权仍在页面，这里只收"按当前筛选拉全部 id + 上限裁决"这段流程。 */
import { App } from "antd";
import { useEffect, useRef, useState } from "react";
import { listJobIds } from "../../api/jobs";
import { t } from "../../i18n";
import type { JobSortState } from "../../utils/jobSort";

export function useSelectAllJobs({
  keyword,
  jobType,
  status,
  sourceKind,
  sortState,
  setSelectedJobIds,
}: {
  keyword: string;
  jobType: string;
  status: string;
  sourceKind: "" | "collected" | "manual";
  /** 排序必须与列表同源：全选拿到的 id 顺序要和用户看到的顺序一致（R14）。 */
  sortState: JobSortState;
  setSelectedJobIds: (updater: (current: number[]) => number[]) => void;
}) {
  const { message } = App.useApp();
  const [selectAllPagesLoading, setSelectAllPagesLoading] = useState(false);
  // 代次守卫（PR-14）：筛选变化即作废进行中的 ids 请求——请求在途时切换筛选，
  // 旧筛选的 id 集合绝不能装进新视图。代次号在筛选变化的 effect 里推进；
  // 请求发起时取号，响应回来只在号仍是最新时写选择/收尾。
  const generationRef = useRef(0);
  /* eslint-disable react-hooks/set-state-in-effect -- 被作废请求的 loading 需要立即
     归位，否则按钮一直转圈到旧请求超时（本仓库对这类 effect 内 setState 的统一豁免）。 */
  useEffect(() => {
    generationRef.current += 1;
    setSelectAllPagesLoading(false);
  }, [keyword, jobType, status, sourceKind, sortState]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 跨页全选：按**当前筛选**向后端要全部 id（与列表同一份筛选器），拿到后整体勾选。
  // 上限与后端批量端点（5000）对齐：超出就如实拒绝并指路缩小范围——悄悄只选一部分
  // 会让"全选了"和"实际选了"对不上，比报错更害人。
  const selectAllPages = async () => {
    if (selectAllPagesLoading) return;
    const generation = ++generationRef.current;
    setSelectAllPagesLoading(true);
    try {
      const ids = await listJobIds({
        keyword,
        job_type: jobType,
        status,
        source_kind: sourceKind || undefined,
        sort: sortState.sort,
        order: sortState.order ?? undefined,
      });
      if (generation !== generationRef.current) return; // 期间筛选已变：旧结果丢弃
      if (ids.length === 0) {
        message.warning(t("jobsPage.selectAll.empty"));
        return;
      }
      if (ids.length > 5000) {
        message.warning(t("jobsPage.selectAll.overLimit", { count: ids.length, limit: 5000 }));
        return;
      }
      setSelectedJobIds(() => ids);
      message.success(t("jobsPage.selectAll.done", { count: ids.length }));
    } catch (err) {
      if (generation !== generationRef.current) return;
      message.error(err instanceof Error ? err.message : t("jobsPage.selectAll.failed"));
    } finally {
      if (generation === generationRef.current) setSelectAllPagesLoading(false);
    }
  };

  return { selectAllPages, selectAllPagesLoading };
}
