// SPDX-License-Identifier: Apache-2.0
/**
 * 折叠视图（按岗位分组）的行菜单构造（2026-11-26，问题 1 的修复；R3/R25 后再改一次）。
 *
 * ## 组行与版本行的菜单为什么不一样
 *
 * | 行 | 菜单内容 | 理由 |
 * | --- | --- | --- |
 * | 多版本组行 | 展开 / 收起、去岗位广场、复制岗位名、复制公司名 | 组级只有"看"与"拿出去"两类动作；整组的批量动作由勾选框承担（三态整组），不进菜单 |
 * | 单版本组行 | 与平铺行**完全一致**（含「批量选择」） | 它就是一份简历，语义没有区别 |
 * | 版本行 | 与平铺行**完全一致**（含「批量选择」，R3） | 版本行可以单独勾选，批量入口没有理由缺席 |
 *
 * 版本行原先**不给**「批量选择」，理由是"多版本组不可整组勾选，给批量入口会引导删整组"。
 * 那条前提随 2026-11-26 的三态整组方案失效（组行本身就能整组勾选），于是补齐与单条行
 * 同一份入口——两个入口指向同一件事，不该一个有一个没有。
 *
 * ## 不复用第二份 builder
 *
 * 单条行一律走 `resumeTableActions.resumeRowMenuItems`（与平铺表格的整行右键同一份），
 * 组级三项是本文件独有的最小集合。两条 `复制` 项复用 `copyMenu` 工厂的字段表，
 * 不在这里各写一遍剪贴板逻辑。
 */
import { ApartmentOutlined } from "@ant-design/icons";
import type { RowActionItem } from "../../components/common/RowActions";
import { copyItemsFor, type CopyField, type CopyNotifier } from "../../components/common/copyMenu";
import { t } from "../../i18n";
import type { ResumeBrief } from "../../types";
import type { ResumeGroup } from "../../features/resume/list/resumeGroups";
import { resumeCopyTexts } from "./resumeRowCopyActions";
import { batchSelectAction, resumeRowMenuItems, type RowActionDeps } from "./resumeTableActions";

export interface GroupMenuContext {
  deps: RowActionDeps;
  /** 复制结果的提示口：与行内「⋯」共用同一个（同 key 覆盖，连点不堆卡片）。 */
  toast: CopyNotifier;
  /** 进入多选模式（单版本组行 / 版本行的「批量选择」）。 */
  enterSelecting: () => void;
  /**
   * 把这一份简历加进已选。与 `enterSelecting` 配对使用：右键某一行点「批量选择」，
   * 用户指的是**这一行**，进去之后它还空着就是断的（R3 的验收原话："点击后
   * `batch.selecting` 为真且该 id 在 `selectedIds`"）。
   */
  selectResume?: (id: number) => void;
  toggleGroup: (key: string) => void;
  openJob: (jobId: number) => void;
  isExpanded: (key: string) => boolean;
}

/** 「批量选择」的完整语义：进多选 + 把点中的那一行勾上。 */
function enterSelectingWith(record: ResumeBrief, ctx: GroupMenuContext): () => void {
  return () => {
    ctx.enterSelecting();
    ctx.selectResume?.(record.id);
  };
}

/**
 * 行内「⋯」里的「批量选择」。
 *
 * 导出它是为了让**行内下拉**与**整行右键**拿到同一个动作：折叠表的两处下拉
 * （单版本组行的「⋯」、版本行的「⋯」）此前各自叫 `batch.enterSelecting`，
 * 于是右键会勾上那一行、下拉不会——同一句文案两种行为。
 */
export function batchSelectFor(record: ResumeBrief, ctx: GroupMenuContext): RowActionItem {
  return batchSelectAction(enterSelectingWith(record, ctx));
}

/**
 * 组里可复制的两个字段：岗位名、公司名。
 *
 * 空值不出现（复制空串只会弹一句失败），与 `resumeCopyFields` 同一口径。
 */
export function groupCopyFields(group: ResumeGroup): CopyField[] {
  const fields: CopyField[] = [];
  const jobTitle = group.jobTitle.trim();
  if (jobTitle) {
    fields.push({
      key: "copy_job",
      label: t("resumes.copy.job"),
      noun: t("resumes.copy.field.job"),
      pick: () => jobTitle,
    });
  }
  const company = group.company.trim();
  if (company) {
    fields.push({
      key: "copy_company",
      label: t("resumes.copy.company"),
      noun: t("resumes.copy.field.company"),
      pick: () => company,
    });
  }
  return fields;
}

/** 「展开 N 个版本」/「收起版本」：组行右键的第一项，也是行内「⋯」的主按钮。 */
export function groupToggleAction(group: ResumeGroup, ctx: GroupMenuContext): RowActionItem {
  const expanded = ctx.isExpanded(group.key);
  return {
    key: "toggle_group",
    label: expanded
      ? t("resumesPage.list.group.collapseVersions")
      : t("resumesPage.list.group.expandVersions", { count: group.versionCount }),
    onClick: () => ctx.toggleGroup(group.key),
  };
}

/**
 * 多版本组行的次级动作：去岗位广场 + 两个复制项。
 *
 * 单独导出是因为行内「⋯」要把它与 `groupToggleAction` 拆成"主按钮 + 菜单"两处，
 * 而整行右键要的是两份合起来的一整张菜单——**同一个数组**喂两个位置，不各自拼一遍。
 */
export function groupSecondaryActions(group: ResumeGroup, ctx: GroupMenuContext): RowActionItem[] {
  const items: RowActionItem[] = [];
  if (group.jobId !== null) {
    const jobId = group.jobId;
    items.push({
      key: "open_job",
      label: t("resumesPage.list.group.openJob"),
      icon: <ApartmentOutlined />,
      onClick: () => ctx.openJob(jobId),
    });
  }
  items.push(...copyItemsFor(groupCopyFields(group), ctx.toast, resumeCopyTexts()));
  return items;
}

/** 多版本组行的整行右键菜单：展开/收起 + 次级动作。 */
export function groupRowActions(group: ResumeGroup, ctx: GroupMenuContext): RowActionItem[] {
  return [groupToggleAction(group, ctx), ...groupSecondaryActions(group, ctx)];
}

/** 单版本组行的菜单：与平铺表格的整行右键完全一致（含「批量选择」）。 */
export function singleRowActions(record: ResumeBrief, ctx: GroupMenuContext): RowActionItem[] {
  return resumeRowMenuItems(record, {
    deps: ctx.deps,
    toast: ctx.toast,
    enterSelecting: enterSelectingWith(record, ctx),
  });
}

/**
 * 版本行的菜单：与单条行同一份（含「批量选择」，见文件头的 R3 说明）。
 *
 * 与 `singleRowActions` 逐字相同，但这个别名**保留**：版本行与单版本组行的语义不同
 * （前者是组内的一版，后者是一个独立岗位），将来其中一侧要加专属项时不必再拆。
 */
export function versionRowActions(record: ResumeBrief, ctx: GroupMenuContext): RowActionItem[] {
  return resumeRowMenuItems(record, {
    deps: ctx.deps,
    toast: ctx.toast,
    enterSelecting: enterSelectingWith(record, ctx),
  });
}
