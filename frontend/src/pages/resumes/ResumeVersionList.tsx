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
 * 与父表对齐（方案 A）：版本行是一个 5 列栅格，列宽来自 `resumeGroupLayout.ts` 的
 * 同一份常量——原来用 flex + `margin-left:auto`，时间紧跟标题、操作贴右边，
 * 与组行的三列完全不在一条竖线上。**组内版本顺序永远按时间倒序**（最新在上），
 * 组级排序只影响组与组的先后，不穿透到版本层。
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
import { versionGridColumns } from "./resumeGroupLayout";
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
  // 列宽唯一来源：与父表同一份常量，改一次不会错位。
  const rowStyle: CSSProperties = { gridTemplateColumns: versionGridColumns(narrow) };

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
              <Typography.Text type="secondary" className="resume-version-time rf-group-num">
                {formatDateTime(record.updated_at ?? record.created_at)}
              </Typography.Text>
              {/* 投递列在版本行没有内容（投递按岗位聚合）：占位保持栅格对齐。 */}
              <span className="resume-version-delivery" aria-hidden="true" />
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
