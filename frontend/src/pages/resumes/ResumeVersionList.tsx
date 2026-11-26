// SPDX-License-Identifier: Apache-2.0
/**
 * 「岗位 · N 个版本」展开后的版本清单（CR-33）。
 *
 * 每个版本仍然是**一条独立记录**：收藏、预览、重命名、备注、对比、删除都带自己的
 * `resume_id`——折叠只改变呈现，不改变任何单条语义。动作清单与表格行共用
 * `resumeTableActions` 的 builder，避免两套菜单漂移。
 *
 * 整行右键（2026-11-26，问题 1）：版本行原来是一张裸 `div`，是折叠表里唯一没有任何
 * 右键入口的地方。现在用 `RowContextMenu` 包住行本身——它对宿主元素会补 `tabIndex` 与
 * `onKeyDown`，键盘用户因此一并拿到 Shift+F10 的等价入口，不必另写一套。
 * 菜单与单条行**完全一致**（含「批量选择」，见 R3）：版本行可以单独勾选，批量入口
 * 没有理由缺席。
 *
 * ## 版本行的勾选框（R1 第四条，2026-11-26）
 *
 * 组行的勾选框代表"整组每份简历"，但"只想选其中的第 9 版"是真实诉求。所以展开后每一版
 * 都有自己的勾选框，直接改 `batch`：组行的全选/半选状态由份数反推，不需要额外回写。
 * 勾选框放在首格内（不新增栅格跟踪列），否则整行四列会整体右移一格。
 *
 * 与父表对齐（方案 A + 2026-11-26 返工）：版本行是父表的**同一套列**——
 * `versionGridColumns()` 给出的栅格里，首格就是父表的身份列，其余三列照抄
 * `GROUP_COLUMN_WIDTHS`，每格的横向内边距取 `--rf-group-cell-pad-x`（与 `td`
 * 的 `padding-inline` 同一份）。上一版是 flex + `margin-left:auto`，再上一版是
 * `column-gap` + 列表缩进：列宽数字同源，但"能用的宽度"各算一套，尾随列就整体左移
 * （940 视口实测「最近更新」列左缘 576 vs 父表 608）。数字与理由见 `resumeGroupLayout.ts`。
 * **组内版本顺序永远按时间倒序**（最新在上），组级排序只影响组与组的先后，不穿透到版本层。
 */
import { Button, Checkbox, Tag, Typography } from "antd";
import type { CSSProperties } from "react";
import { RowActions, RowContextMenu } from "../../components/common/RowActions";
import type { BatchSelection } from "../../hooks/useBatchSelection";
import type { ToastApi } from "../../hooks/useToast";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumeBrief } from "../../types";
import { formatDateTime } from "../../utils/format";
import type { ResumeGroup } from "../../features/resume/list/resumeGroups";
import ResumeFavoriteButton from "./ResumeFavoriteButton";
import { copyMenuFor } from "./resumeRowCopyActions";
import { GROUP_COLUMN_WIDTHS, versionGridColumns } from "./resumeGroupLayout";
import { batchSelectFor, versionRowActions, type GroupMenuContext } from "./resumeGroupMenu";
import { primaryActionsFor, secondaryActionsFor, type RowActionDeps } from "./resumeTableActions";
import "./resumeVersions.css";

/**
 * 父表在多选态下由 antd 插在最前面的勾选列宽（传给 `rowSelection.columnWidth`）。
 *
 * 版本行的栅格必须**跟着多一格**：否则整组版本会整体左移这么多，时间/投递/操作三列
 * 与父表的竖线当场错开（"一条边只有一个右缘"）。40 是 8px 内边距 + 24px 勾选框的量级，
 * 与 antd 自己的默认值一档。
 */
export const GROUP_SELECTION_COLUMN_WIDTH = 40;

interface Props {
  group: ResumeGroup;
  deps: RowActionDeps;
  toast: ToastApi;
  /** 折叠表的行菜单上下文（与组行共用同一份）。 */
  menuCtx: GroupMenuContext;
  /** 多选态：整行右键与行内操作一并停用（与平铺表的行同口径），勾选框改为可用。 */
  selecting: boolean;
  /** 多选状态本体：版本行的勾选框直接改它，组行的全选/半选由份数反推。 */
  batch: BatchSelection<number>;
  /** 窄档：收起备注，时间列收窄（列宽仍由 `resumeGroupLayout` 一处给出）。 */
  narrow: boolean;
  favoriteResumeId: number | null;
  toggleFavorite: (record: ResumeBrief) => Promise<void>;
}

export default function ResumeVersionList({
  group,
  deps,
  toast,
  menuCtx,
  selecting,
  batch,
  narrow,
  favoriteResumeId,
  toggleFavorite,
}: Props) {
  useLocale();
  /**
   * 列宽唯一来源：与父表同一份常量，改一次不会错位。
   * `--rf-group-version-index` 把「第 N 版」的定宽前缀也交给同一份常量——它在首格里，
   * 不参与列宽分配，但每一行必须是同一个宽度，否则组内标题左缘会一行一个位置。
   *
   * 多选态要给父表的勾选列让出一格：那一格只放一个空占位，作用是让后面四格的左缘与
   * 父表的同名四列对齐（详见 `GROUP_SELECTION_COLUMN_WIDTH` 的说明）。
   */
  const gridColumns = selecting
    ? `${GROUP_SELECTION_COLUMN_WIDTH}px ${versionGridColumns(narrow)}`
    : versionGridColumns(narrow);
  const rowStyle = {
    gridTemplateColumns: gridColumns,
    "--rf-group-version-index": `${GROUP_COLUMN_WIDTHS.versionIndex}px`,
  } as CSSProperties;

  return (
    <div
      className="resume-version-list"
      role="list"
      aria-label={t("resumes.list.versionListRegion")}
    >
      {group.versions.map((record, index) => {
        // 版本号按时间正序编：最新的排最前，但编号最大（"第 4 版"比"第 1 版"新）。
        const versionNumber = group.versions.length - index;
        return (
          <RowContextMenu
            key={record.id}
            items={versionRowActions(record, menuCtx)}
            disabled={selecting}
          >
            <div className="resume-version-row" role="listitem" style={rowStyle}>
              {/* 父表勾选列的占位（只在多选态出现）：让后面四格与父表同名四列对齐。 */}
              {selecting ? (
                <span className="resume-version-gutter" aria-hidden="true" />
              ) : null}
              {/* 首格 = 父表的身份列：里面是「勾选框 + 第 N 版」+ 标题。 */}
              <div className="resume-version-leading">
                {selecting ? (
                  <Checkbox
                    className="resume-version-check"
                    checked={batch.isSelected(record.id)}
                    aria-label={t("resumesPage.list.group.selectVersion", {
                      index: versionNumber,
                      title: record.title,
                    })}
                    onChange={() => batch.toggle(record.id)}
                  />
                ) : null}
                <span className="resume-version-index">
                  {t("resumes.list.versionLabel", { index: versionNumber })}
                </span>
                <div className="resume-version-main">
                  {index === 0 && <Tag color="green">{t("resumes.list.latestVersion")}</Tag>}
                  <Button
                    type="link"
                    className="table-text-link resume-version-title"
                    onClick={() => deps.setPreviewId(record.id)}
                  >
                    {record.title}
                  </Button>
                  {record.note && !narrow && (
                    <Typography.Text
                      type="secondary"
                      className="resume-version-note"
                      ellipsis={{ tooltip: record.note }}
                    >
                      {record.note}
                    </Typography.Text>
                  )}
                </div>
              </div>
              <Typography.Text type="secondary" className="resume-version-time rf-group-num">
                {formatDateTime(record.updated_at ?? record.created_at)}
              </Typography.Text>
              {/* 投递列在版本行没有内容（投递按岗位聚合）：占位保持栅格对齐。
                  窄档父表不下发这一列，这里也必须不渲染——多一个格子会顶到 0 宽的
                  跟踪列上，操作列就整体左移（与 `versionGridColumns` 同一条理由）。 */}
              {!narrow && <span className="resume-version-delivery" aria-hidden="true" />}
              <span className="resume-version-actions">
                <ResumeFavoriteButton
                  record={record}
                  loading={favoriteResumeId === record.id}
                  disabled={favoriteResumeId !== null || selecting}
                  onToggle={(target) => void toggleFavorite(target)}
                />
                <RowActions
                  primary={primaryActionsFor(record, deps)}
                  more={[
                    // 与整行右键同一份「批量选择」（进多选 + 勾上这一版，R3）。
                    batchSelectFor(record, menuCtx),
                    copyMenuFor(record, toast),
                    ...secondaryActionsFor(record, deps),
                  ]}
                  disabled={selecting}
                />
              </span>
            </div>
          </RowContextMenu>
        );
      })}
    </div>
  );
}
