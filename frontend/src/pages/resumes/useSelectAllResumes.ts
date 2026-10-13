/** 简历中心「全选全部简历」的状态与动作（对齐岗位广场的 useSelectAllJobs）。 */
import { App } from "antd";
import { useEffect, useRef, useState } from "react";
import { listResumeIds } from "../../api/resumes";

export function useSelectAllResumes({
  keyword,
  jobId,
  favoriteFilter,
  hasJobFilter,
  setSelectedIds,
}: {
  keyword: string;
  jobId: number | undefined;
  favoriteFilter: boolean | undefined;
  hasJobFilter: boolean | undefined;
  /** 用一份完整 id 列表替换当前已选（BatchSelection.setSelected）。 */
  setSelectedIds: (ids: number[]) => void;
}) {
  const { message } = App.useApp();
  const [selectAllPagesLoading, setSelectAllPagesLoading] = useState(false);
  // 代次守卫（PR-14）：筛选变化即作废进行中的 ids 请求——请求在途时切换筛选，
  // 旧筛选的 id 集合绝不能装进新视图（口径对齐 useSelectAllJobs）。
  const generationRef = useRef(0);
  /* eslint-disable react-hooks/set-state-in-effect -- 被作废请求的 loading 需要立即
     归位，否则按钮一直转圈到旧请求超时（本仓库对这类 effect 内 setState 的统一豁免）。 */
  useEffect(() => {
    generationRef.current += 1;
    setSelectAllPagesLoading(false);
  }, [keyword, jobId, favoriteFilter, hasJobFilter]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 跨页全选：按**当前筛选**向后端要全部 id（与列表同一份筛选器），拿到后整体勾选。
  // 批量删除卡 500 上限，超出就如实拒绝并指路缩小范围——悄悄只选前 500 会让
  // "全选了"和"实际选了"对不上，比报错更害人（口径对齐岗位广场）。
  const selectAllPages = async () => {
    if (selectAllPagesLoading) return;
    const generation = ++generationRef.current;
    setSelectAllPagesLoading(true);
    try {
      const ids = await listResumeIds({
        keyword,
        job_id: jobId,
        favorite: favoriteFilter,
        has_job: hasJobFilter,
      });
      if (generation !== generationRef.current) return; // 期间筛选已变：旧结果丢弃
      if (ids.length === 0) {
        message.warning("当前筛选下没有简历");
        return;
      }
      if (ids.length > 500) {
        message.warning(
          `当前筛选下共 ${ids.length} 份简历，批量操作一次最多 500 个；请先用筛选或搜索缩小范围`,
        );
        return;
      }
      setSelectedIds(ids);
      message.success(`已选中当前筛选下的全部 ${ids.length} 份简历（所有页）`);
    } catch (err) {
      if (generation !== generationRef.current) return;
      message.error(err instanceof Error ? err.message : "获取简历列表失败");
    } finally {
      if (generation === generationRef.current) setSelectAllPagesLoading(false);
    }
  };

  return { selectAllPages, selectAllPagesLoading };
}
