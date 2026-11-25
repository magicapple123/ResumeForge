// SPDX-License-Identifier: Apache-2.0
/**
 * 「岗位 · N 个版本」展开后的版本清单（CR-33）。
 *
 * 每个版本仍然是**一条独立记录**：收藏、预览、重命名、备注、对比、删除都带自己的
 * `resume_id`——折叠只改变呈现，不改变任何单条语义。动作清单与表格行共用
 * `resumeTableActions` 的 builder，避免两套菜单漂移。
 */
import { Button, Tag, Typography } from "antd";
import { RowActions } from "../../components/common/RowActions";
import type { ToastApi } from "../../hooks/useToast";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumeBrief } from "../../types";
import { formatDateTime } from "../../utils/format";
import type { ResumeGroup } from "../../features/resume/list/resumeGroups";
import ResumeFavoriteButton from "./ResumeFavoriteButton";
import { copyMenuFor } from "./resumeRowCopyActions";
import { primaryActionsFor, secondaryActionsFor, type RowActionDeps } from "./resumeTableActions";
import "./resumeVersions.css";

interface Props {
  group: ResumeGroup;
  deps: RowActionDeps;
  toast: ToastApi;
  favoriteResumeId: number | null;
  toggleFavorite: (record: ResumeBrief) => Promise<void>;
}

export default function ResumeVersionList({
  group,
  deps,
  toast,
  favoriteResumeId,
  toggleFavorite,
}: Props) {
  useLocale();
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
          <div className="resume-version-row" role="listitem" key={record.id}>
            <span className="resume-version-index">
              {t("resumes.list.versionLabel", { index: versionNumber })}
            </span>
            {index === 0 && <Tag color="green">{t("resumes.list.latestVersion")}</Tag>}
            <Button
              type="link"
              className="table-text-link resume-version-title"
              onClick={() => deps.setPreviewId(record.id)}
            >
              {record.title}
            </Button>
            <Typography.Text type="secondary" className="resume-version-time">
              {formatDateTime(record.updated_at ?? record.created_at)}
            </Typography.Text>
            {record.note && (
              <Typography.Text
                type="secondary"
                className="resume-version-note"
                ellipsis={{ tooltip: record.note }}
              >
                {record.note}
              </Typography.Text>
            )}
            <span className="resume-version-actions">
              <ResumeFavoriteButton
                record={record}
                loading={favoriteResumeId === record.id}
                disabled={favoriteResumeId !== null}
                onToggle={(target) => void toggleFavorite(target)}
              />
              <RowActions
                primary={primaryActionsFor(record, deps)}
                more={[copyMenuFor(record, toast), ...secondaryActionsFor(record, deps)]}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}
