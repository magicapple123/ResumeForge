// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心的**结果列表**：有分组数据时用「按岗位折叠」的表格（CR-33），否则退回
 * 原来的宽档表格 / 窄档卡片。
 *
 * 折叠视图刻意不分宽窄卡片：它只有 5 列（岗位/简历、最近更新、投递、操作），窄档由
 * 表格自己收起「投递」列，不需要横滚 1494px。原来的两份视图保留，页面现在始终传
 * `groups`。
 *
 * 排序有**两套状态**，各自喂给各自那一半：`sortState`（服务端）给平铺表格的列头，
 * `groupSortState`（本地组级）给折叠表的列头。口径见 `useResumesPageView` 的文件头。
 */
import type { ComponentProps } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { mqMax } from "../../theme/breakpoints";
import type { ResumeGroup } from "../../features/resume/list/resumeGroups";
import type { GroupSortState } from "../../utils/groupSort";
import ResumeCardList from "./ResumeCardList";
import ResumeGroupedTable from "./ResumeGroupedTable";
import ResumeTable from "./ResumeTable";

type BaseProps = ComponentProps<typeof ResumeTable>;

type Props = BaseProps & {
  /** 折叠后的组（当前页）。传了就走折叠视图。 */
  groups?: ResumeGroup[];
  /** 折叠后的组总数（分页 total）。 */
  totalGroups?: number;
  /** 已加载的简历条数（≤2000）：折叠视图分页文案要同时说清"多少个岗位、多少份简历"。 */
  resumeCount?: number;
  /** 折叠视图的组级排序状态 + 变更回调（页面两套排序状态都从这里下发）。 */
  groupSortState: GroupSortState;
  onGroupSortChange: (next: GroupSortState) => void;
  expandedKeys?: string[];
  setExpandedKeys?: (keys: string[]) => void;
};

export default function ResumeResultList({
  groups,
  totalGroups,
  resumeCount = 0,
  groupSortState,
  onGroupSortChange,
  expandedKeys = [],
  setExpandedKeys,
  ...rest
}: Props) {
  const narrow = useMediaQuery(mqMax("narrow"));

  // 只有真的出现「同一岗位多版本」时才折叠。没有可折叠的重复时，平铺表格信息更全
  // （来源/模型/备注/美化拓展等列），也避免把单版本工作区换成一张更瘦的表。
  const hasStackedGroup = (groups ?? []).some((group) => group.versionCount > 1);
  if (groups && setExpandedKeys && hasStackedGroup) {
    return (
      <ResumeGroupedTable
        {...rest}
        groups={groups}
        totalGroups={totalGroups ?? groups.length}
        resumeCount={resumeCount}
        groupSortState={groupSortState}
        onGroupSortChange={onGroupSortChange}
        expandedKeys={expandedKeys}
        setExpandedKeys={setExpandedKeys}
      />
    );
  }

  return narrow ? <ResumeCardList {...rest} /> : <ResumeTable {...rest} />;
}
