// SPDX-License-Identifier: Apache-2.0
/**
 * 草稿恢复条：表单弹窗 body 顶部的一条提示，**永不自动应用草稿**。
 *
 * 自动填充会把"上次没填完的内容"变成"这次打开就是它"，用户会以为自己新建的表单里
 * 已经填过东西——所以恢复必须是一次明确的点击。
 */
import { Button, Space, Typography } from "antd";
import { t } from "../../i18n";

export interface FormDraftBarState {
  /** 草稿保存时间（ms），用于渲染「保存于 HH:mm」。 */
  savedAt: number;
  /** 草稿里有没有被剔除的字段（图片等），需要在文案里说明。 */
  droppedFields?: number;
  /** 草稿里的字段数；拿不到时正文退化成只讲时刻的简版。 */
  fieldCount?: number;
}

export interface DraftRestoreBarProps extends FormDraftBarState {
  onRestore: () => void;
  onDiscard: () => void;
}

/** `HH:mm`（本地时区）。草稿只在同一标签页内有效，不需要日期。 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export default function DraftRestoreBar({
  savedAt,
  droppedFields = 0,
  fieldCount,
  onRestore,
  onDiscard,
}: DraftRestoreBarProps) {
  const time = formatTime(savedAt);
  return (
    <div className="rf-draft-bar" role="status">
      <div className="rf-draft-bar-text">
        <Typography.Text strong>{t("draft.restore.title")}</Typography.Text>
        <Typography.Text type="secondary" className="rf-draft-bar-meta">
          {fieldCount === undefined
            ? t("draft.restore.body-plain", { time })
            : t("draft.restore.body", { time, count: fieldCount })}
          {droppedFields > 0 ? ` · ${t("draft.dropped-fields", { count: droppedFields })}` : ""}
        </Typography.Text>
      </div>
      <Space size={8}>
        <Button size="small" onClick={onDiscard}>
          {t("draft.discard.action")}
        </Button>
        <Button size="small" type="primary" onClick={onRestore}>
          {t("draft.restore.action")}
        </Button>
      </Space>
    </div>
  );
}
