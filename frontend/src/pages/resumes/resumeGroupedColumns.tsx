// SPDX-License-Identifier: Apache-2.0
/**
 * 折叠视图的列定义（方案 A「岗位分区列表」，2026-11-26）。
 *
 * 五列：岗位 / 简历（两行身份）｜最近更新｜投递｜操作。原来那张表的病根都在这里：
 *
 * - 第一列表头写「简历标题」，多版本组里渲染的却是岗位名 —— 现在列名叫「岗位 / 简历」，
 *   单元格按"这一行是什么"自己决定主身份。
 * - 多版本组的「目标岗位」列是空的（只有 `versionCount === 1` 才给 Tag），一大块白。
 *   现在岗位名就是主身份、公司进副行，不再有空的整列。
 * - 列内重复文案（「最近更新 {time}」上方表头已经叫「最近更新」）—— 现在只渲染时间值，
 *   数字用 `tabular-nums` 纵向对齐；投递 0 次显示 `—` 而不是"投递过 0 次"。
 *
 * 排序是**本地组级**的（`utils/groupSort`）：三态列头、默认态不显示箭头，与岗位广场
 * 同一套交互，但排序对象是"组"而不是"简历"。服务端排序仍由平铺表与数据层使用。
 *
 * 文件名小写开头是有意的：本模块导出的是**纯构造函数**（`buildGroupedColumns`），
 * 在里面调 `t()` 是替调用方取文案，由 `ResumeGroupedTable` 的 `useLocale()` 负责订阅
 * 语言变化（见 `src/i18n/localeSubscription.test.ts` 里 `isComponentFile` 的说明）。
 */
import { StarFilled } from "@ant-design/icons";
import { Button, Tag } from "antd";
import type { TableColumnsType } from "antd";
import { RowActions } from "../../components/common/RowActions";
import type { BatchSelection } from "../../hooks/useBatchSelection";
import type { CopyNotifier } from "../../components/common/copyMenu";
import { t } from "../../i18n";
import { formatDateTime } from "../../utils/format";
import { groupSortDirections, groupSortOrderFor, type GroupSortState } from "../../utils/groupSort";
import type { ResumeGroup } from "../../features/resume/list/resumeGroups";
import { copyMenuFor } from "./resumeRowCopyActions";
import { GROUP_COLUMN_WIDTHS } from "./resumeGroupLayout";
import {
  batchSelectFor,
  groupSecondaryActions,
  groupToggleAction,
  type GroupMenuContext,
} from "./resumeGroupMenu";
import { primaryActionsFor, secondaryActionsFor, type RowActionDeps } from "./resumeTableActions";

export interface GroupedColumnArgs {
  deps: RowActionDeps;
  toast: CopyNotifier;
  batch: BatchSelection<number>;
  menuCtx: GroupMenuContext;
  groupSortState: GroupSortState;
  onGroupSortChange: (next: GroupSortState) => void;
  setPreviewId: (id: number) => void;
  toggleGroup: (key: string) => void;
  /** 该组当前是否展开（自绘展开按钮要 `aria-expanded`，不是给 antd 箭头用的）。 */
  isExpanded: (key: string) => boolean;
  /** 窄档（`mqMax("narrow")`）：收窄时间列，收起「投递」列。 */
  narrow: boolean;
}

/**
 * 展开区域（版本清单）的 DOM id：自绘按钮的 `aria-controls` 必须指到它。
 *
 * 写在这里而不是 `ResumeGroupedTable`：按钮与容器分属两个文件，id 只能有一份拼法。
 * 组 key 里只有 `job:12` / `resume:7` 这种字符，直接拼进 id 是安全的。
 */
export function groupVersionsRegionId(groupKey: string): string {
  return `rf-group-versions-${groupKey.replace(":", "-")}`;
}

/** 多版本组 / 单版本组 / 通用简历的主身份都是"岗位名或简历标题"，副行各有各的写法。 */
function identityOf(group: ResumeGroup): { primary: string; secondary: string } {
  if (group.jobId === null)
    return { primary: group.latest.title, secondary: group.latest.job_title };
  return { primary: group.jobTitle || `#${group.jobId}`, secondary: group.company };
}

/**
 * 第一列：两行身份 + 自绘展开按钮。
 *
 * 三档渲染：
 * - 多版本组：主行岗位名（**纯文本**，R25）+「N 个版本」chip；副行「公司 · 最新版本 {标题}」。
 * - 单版本组：主行岗位名（**纯文本**）；副行「公司 · 该版本标题」（→ 详情）。
 * - 通用简历（无 job_id）：主行简历标题（→ 自己的详情）；副行「通用简历」tag + 求职意向。
 *
 * ## 岗位名为什么不再是链接（R25）
 *
 * 原来它是 `Button type="link"` → `/jobs?job_id=N`：用户想看清岗位名，点一下就整页
 * 跳到岗位广场；通用简历一旦有两个版本还会拼出 `/jobs?job_id=null`。跳转没有消失，
 * 只是挪进了右键/「⋯」菜单（`secondaryActionsFor` 的 `open_job`）——**误触优先于可发现性**。
 * 平铺表的同名列同一口径。
 *
 * 通用简历的主行仍是按钮：它打开的**就是这一行自己的详情**（不离开上下文），
 * 与"被带走"是两件事。副行里最新版本的标题也保留详情入口。
 */
function groupIdentity(group: ResumeGroup, args: GroupedColumnArgs) {
  const { setPreviewId, toggleGroup, isExpanded } = args;
  const { primary, secondary } = identityOf(group);
  const isGeneral = group.jobId === null;
  const stacked = group.versionCount > 1;
  const expanded = stacked && isExpanded(group.key);
  const regionId = groupVersionsRegionId(group.key);
  const star = group.hasFavorite ? (
    <StarFilled className="rf-group-star" aria-label={t("resumes.list.group.favoriteHint")} />
  ) : null;

  /**
   * 展开按钮占位：单版本组没有"展开"这回事，但箭头位仍要留出来，
   * 否则同列里带箭头与不带箭头的岗位名左缘差 20px，读起来像两级缩进。
   *
   * ## 为什么这里不叫「展开 {count} 个版本」（2026-11-26 收尾）
   *
   * 同一行里本来就有**两个**展开入口：左边这个箭头（R1 第五条把 44px 展开列去掉后
   * 自绘的，带 `aria-expanded` / `aria-controls`）与操作列那个文字按钮
   * （`groupToggleAction`，鼠标用户更容易发现的显式入口）。两者此前共用同一句
   * 「展开 3 个版本」，对读屏用户就是**同一行里两个同名按钮**——无法区分，也让
   * `getByRole("button", { name })` 这种"唯一命名"的断言无解。
   * 箭头用「展开版本 / 收起版本」（版本数紧接着的 chip 已经说了），语义仍然是
   * "这块可折叠区域"，与操作列那句带计数的动作不再撞名。
   */
  const expandLabel = expanded ? t("resumes.list.group.collapse") : t("resumes.list.group.expand");
  const expandSlot = stacked ? (
    <button
      type="button"
      className="rf-group-expand"
      aria-expanded={expanded}
      aria-controls={regionId}
      aria-label={expandLabel}
      title={expandLabel}
      onClick={() => toggleGroup(group.key)}
    >
      <span className="rf-group-expand-icon" aria-hidden="true" />
    </button>
  ) : (
    <span className="rf-group-expand-placeholder" aria-hidden="true" />
  );

  const primaryNode = isGeneral ? (
    <Button
      type="link"
      className="table-text-link rf-group-identity-name"
      onClick={() => setPreviewId(group.latest.id)}
    >
      {primary}
    </Button>
  ) : (
    <span className="rf-group-identity-name" title={primary}>
      {primary}
    </span>
  );

  return (
    <div className="rf-group-identity">
      <div className="rf-group-identity-main">
        {expandSlot}
        {star}
        {primaryNode}
        {stacked ? (
          <Tag className="rf-group-count">
            {t("resumesPage.list.group.versionCount", { count: group.versionCount })}
          </Tag>
        ) : null}
      </div>
      <div className="rf-group-identity-sub">
        {isGeneral ? (
          <>
            <Tag color="purple">{t("resumes.list.general")}</Tag>
            {secondary ? <span>{t("resumes.list.intent", { job: secondary })}</span> : null}
          </>
        ) : (
          <>
            {secondary ? (
              <>
                <span>{secondary}</span>
                <span className="rf-group-dot">·</span>
              </>
            ) : null}
            {stacked ? (
              <span>
                {t("resumesPage.list.group.latestVersion", { title: group.latest.title })}
              </span>
            ) : (
              <Button
                type="link"
                className="table-text-link"
                onClick={() => setPreviewId(group.latest.id)}
              >
                {group.latest.title}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** 操作列：单版本组与平铺行同一份（主操作 + 「⋯」），多版本组是展开/收起 + 组级三项。 */
function groupActions(group: ResumeGroup, args: GroupedColumnArgs) {
  const { batch, deps, toast, menuCtx } = args;
  if (group.versionCount > 1) {
    return (
      <RowActions
        primary={[groupToggleAction(group, menuCtx)]}
        more={groupSecondaryActions(group, menuCtx)}
        disabled={batch.selecting}
      />
    );
  }
  return (
    <RowActions
      primary={primaryActionsFor(group.latest, deps)}
      more={[
        // 与整行右键同一份语义（进多选 + 勾上这一行），不是裸的 `enterSelecting`。
        batchSelectFor(group.latest, menuCtx),
        copyMenuFor(group.latest, toast),
        ...secondaryActionsFor(group.latest, deps),
      ]}
      disabled={batch.selecting}
    />
  );
}

/** 五列定义。`narrow` 时**不下发**投递列——见文件头的说明。 */
export function buildGroupedColumns(args: GroupedColumnArgs): TableColumnsType<ResumeGroup> {
  const { groupSortState, narrow } = args;

  /**
   * 三态列头：升 → 降 → 取消回默认。默认态不显示箭头（`groupSortOrderFor` 返回 null），
   * 所以不会出现"表头永远高亮、而「恢复默认排序」按钮却是灰的"这种自相矛盾。
   */
  const sortProps = (
    columnKey: "identity" | "updated" | "delivery",
    hintKey:
      | "resumesPage.list.sort.identity"
      | "resumesPage.list.sort.updated"
      | "resumesPage.list.sort.delivery",
  ) => ({
    sorter: true as const,
    sortOrder: groupSortOrderFor(columnKey, groupSortState),
    sortDirections: groupSortDirections(columnKey),
    showSorterTooltip: { title: t(hintKey) },
  });

  const columns: TableColumnsType<ResumeGroup> = [
    {
      title: t("resumesPage.list.column.titleJob"),
      key: "identity",
      ...sortProps("identity", "resumesPage.list.sort.identity"),
      render: (_, group) => groupIdentity(group, args),
    },
    {
      title: t("resumes.list.column.lastUpdated"),
      key: "updated",
      width: narrow ? GROUP_COLUMN_WIDTHS.updatedNarrow : GROUP_COLUMN_WIDTHS.updated,
      ...sortProps("updated", "resumesPage.list.sort.updated"),
      render: (_, group) =>
        group.latestUpdatedAt ? (
          <span className="rf-group-num">{formatDateTime(group.latestUpdatedAt)}</span>
        ) : (
          <span className="rf-group-empty">—</span>
        ),
    },
  ];

  if (!narrow) {
    columns.push({
      title: t("resumes.list.column.delivery"),
      key: "delivery",
      width: GROUP_COLUMN_WIDTHS.delivery,
      ...sortProps("delivery", "resumesPage.list.sort.delivery"),
      render: (_, group) =>
        group.deliveryCount > 0 ? (
          <span className="rf-group-num">
            {t("resumesPage.list.group.deliveryCount", { count: group.deliveryCount })}
          </span>
        ) : (
          <span className="rf-group-empty">—</span>
        ),
    });
  }

  columns.push({
    title: t("resumes.list.column.actions"),
    key: "actions",
    width: GROUP_COLUMN_WIDTHS.actions,
    align: "right",
    render: (_, group) => <span className="rf-group-actions">{groupActions(group, args)}</span>,
  });

  return columns;
}
