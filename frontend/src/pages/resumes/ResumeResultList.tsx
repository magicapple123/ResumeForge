// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心的**结果列表**：有分组数据时用「按岗位折叠」的表格（CR-33），否则退回
 * 原来的宽档表格 / 窄档卡片。
 *
 * 折叠视图刻意不分宽窄：它只有 4 列（岗位 / 最近更新 / 投递次数 / 操作），窄屏不需要
 * 横滚 1494px。原来的两份视图保留，页面现在始终传 `groups`。
 */
import type { ComponentProps } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { mqMax } from "../../theme/breakpoints";
import type { ResumeGroup } from "../../features/resume/list/resumeGroups";
import ResumeCardList from "./ResumeCardList";
import ResumeGroupedTable from "./ResumeGroupedTable";
import ResumeTable from "./ResumeTable";

type BaseProps = ComponentProps<typeof ResumeTable>;

type Props = BaseProps & {
  /** 折叠后的组（当前页）。传了就走折叠视图。 */
  groups?: ResumeGroup[];
  /** 折叠后的组总数（分页 total）。 */
  totalGroups?: number;
  expandedKeys?: string[];
  setExpandedKeys?: (keys: string[]) => void;
};

export default function ResumeResultList({
  groups,
  totalGroups,
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
        expandedKeys={expandedKeys}
        setExpandedKeys={setExpandedKeys}
      />
    );
  }

  return narrow ? <ResumeCardList {...rest} /> : <ResumeTable {...rest} />;
}
