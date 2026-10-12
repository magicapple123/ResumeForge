/** 简历中心「全选全部简历」的状态与动作（对齐岗位广场的 useSelectAllJobs）。 */
import { App } from "antd";
import { useState } from "react";
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

  // 跨页全选：按**当前筛选**向后端要全部 id（与列表同一份筛选器），拿到后整体勾选。
  // 批量删除卡 500 上限，超出就如实拒绝并指路缩小范围——悄悄只选前 500 会让
  // "全选了"和"实际选了"对不上，比报错更害人（口径对齐岗位广场）。
  const selectAllPages = async () => {
    if (selectAllPagesLoading) return;
    setSelectAllPagesLoading(true);
    try {
      const ids = await listResumeIds({
        keyword,
        job_id: jobId,
        favorite: favoriteFilter,
        has_job: hasJobFilter,
      });
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
      message.error(err instanceof Error ? err.message : "获取简历列表失败");
    } finally {
      setSelectAllPagesLoading(false);
    }
  };

  return { selectAllPages, selectAllPagesLoading };
}
