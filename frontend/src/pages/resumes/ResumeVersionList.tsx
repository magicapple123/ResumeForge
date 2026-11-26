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
 * 菜单**不含**「批量选择」：多版本组不可整组勾选，给批量入口就会引导用户删整组。
 *
 * 与父表对齐（方案 A + 2026-11-26 返工）：版本行是父表的**同一套列**——
 * `versionGridColumns()` 给出的栅格里，首格吃掉父表的「展开列 + 身份列」，其余三列
 * 照抄 `GROUP_COLUMN_WIDTHS`，每格的横向内边距取 `--rf-group-cell-pad-x`（与 `td`
 * 的 `padding-inline` 同一份）。上一版是 flex + `margin-left:auto`，再上一版是
 * `column-gap` + 列表缩进：列宽数字同源，但"能用的宽度"各算一套，尾随列就整体左移
 * （940 视口实测「最近更新」列左缘 576 vs 父表 608）。数字与理由见 `resumeGroupLayout.ts`。
 * **组内版本顺序永远按时间倒序**（最新在上），组级排序只影响组与组的先后，不穿透到版本层。
 */
import { Button, Tag, Typography } from "antd";
import type { CSSProperties } from "react";
import { RowActions, RowContextMenu } from "../../components/common/RowActions";
import type { ToastApi } from "../../hooks/useToast";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumeBrief } from "../../types";
import { formatDateTime } from "../../utils/format";
import type { ResumeGroup } from "../../features/resume/list/resumeGroups";
import ResumeFavoriteButton from "./ResumeFavoriteButton";
import { copyMenuFor } from "./resumeRowCopyActions";
import { GROUP_COLUMN_WIDTHS, versionGridColumns } from "./resumeGroupLayout";
import { versionRowActions, type GroupMenuContext } from "./resumeGroupMenu";
import { primaryActionsFor, secondaryActionsFor, type RowActionDeps } from "./resumeTableActions";
import "./resumeVersions.css";

interface Props {
  group: ResumeGroup;
  deps: RowActionDeps;
  toast: ToastApi;
  /** 折叠表的行菜单上下文（与组行共用同一份）。 */
  menuCtx: GroupMenuContext;
  /** 多选态：整行右键与行内操作一并停用（与平铺表的行同口径）。 */
  selecting: boolean;
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
  narrow,
  favoriteResumeId,
  toggleFavorite,
}: Props) {
  useLocale();
  /**
   * 列宽唯一来源：与父表同一份常量，改一次不会错位。
   * `--rf-group-version-index` 把「第 N 版」的定宽前缀也交给同一份常量——它在首格里，
   * 不参与列宽分配，但每一行必须是同一个宽度，否则组内标题左缘会一行一个位置。
   */
  const rowStyle = {
    gridTemplateColumns: versionGridColumns(narrow),
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
              {/* 首格 = 父表的「展开列 + 身份列」：里面是缩进后的「第 N 版」+ 标题。 */}
              <div className="resume-version-leading">
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
                  more={[copyMenuFor(record, toast), ...secondaryActionsFor(record, deps)]}
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
