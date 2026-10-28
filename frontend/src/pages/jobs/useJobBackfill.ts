// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位广场的「补齐详情」：只补 JD 为空的岗位，选择模式下优先补勾选的。
 *
 * 抽成 hook 是为了守住页面文件的 500 行预算；行为与原实现一致——仍是一次批量任务，
 * 进度入口在投递台，成功提示里必须写明去哪儿看。
 */
import { App } from "antd";
import { useState } from "react";
import { startBackfill } from "../../api/apply";
import { t } from "../../i18n";
import type { JobList, Page } from "../../types";

export function useJobBackfill({
  jobs,
  selectionMode,
  selectedJobIds,
}: {
  jobs: Page<JobList> | undefined;
  selectionMode: boolean;
  selectedJobIds: number[];
}) {
  const { message } = App.useApp();
  const [backfilling, setBackfilling] = useState(false);

  // 只有"岗位描述为空"的岗位才值得补详情（补详情要逐个打开页面，很慢），按钮据此出现/消失，
  // 而不是常驻一个点了没反应的按钮。当前只统计这一页已加载的岗位：补的就这一页里空的那些。
  const emptyDescriptionJobIds = (jobs?.items ?? [])
    .filter((job) => !job.has_description)
    .map((job) => job.id);

  const backfillDetails = async () => {
    // 批量优先：选择模式下有勾选就补勾选的，否则补当前这页所有 JD 为空的岗位。
    const target =
      selectionMode && selectedJobIds.length > 0 ? selectedJobIds : emptyDescriptionJobIds;
    if (target.length === 0) {
      message.warning(t("pagesMisc.jobsPage.backfill.none"));
      return;
    }
    setBackfilling(true);
    try {
      await startBackfill(target);
      // 它是 kind=collect 的批次，界面入口在投递台：不告诉用户去哪儿看，他会以为点了没反应。
      message.success(t("pagesMisc.jobsPage.backfill.started", { count: target.length }));
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : t("pagesMisc.jobsPage.error.backfillFailed"),
      );
    } finally {
      setBackfilling(false);
    }
  };

  return { emptyDescriptionJobIds, backfilling, backfillDetails };
}
