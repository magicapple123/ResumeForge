// SPDX-License-Identifier: Apache-2.0
/**
 * 提醒详情抽屉（T06；自 ReminderPanel 拆出，让主文件守住 500 行预算）。
 *
 * 只读查看：只走右上角 × 关闭（footer 语义由 RecordDetailDrawer 统一）。关联对象的显示名
 * 由宿主按"已选值回查"的选项算出后传入——抽屉不自己拉接口。
 */
import { CheckOutlined, EditOutlined } from "@ant-design/icons";
import { Button, Space, Tag } from "antd";
import { t } from "../../i18n";
import { reminderKindLabelKey, reminderStatusLabelKey } from "../../i18n/enum/reminder";
import { useLocale } from "../../i18n/i18nContext";
import type { Reminder } from "../../types";
import { formatDateTime } from "../../utils/format";
import { RecordDetailDrawer } from "../../components/common/RecordDetail";

interface Props {
  detail: Reminder | null;
  /** 关联对象在下拉里查不到时的占位（与列表同口径）。 */
  trackLabel: string;
  jobLabel: string;
  resumeLabel: string;
  onMarkDone: () => void;
  onEdit: () => void;
  onClose: () => void;
}

export default function ReminderDetailDrawer({
  detail,
  trackLabel,
  jobLabel,
  resumeLabel,
  onMarkDone,
  onEdit,
  onClose,
}: Props) {
  useLocale();
  // 协议值先映到语言包 key；未知取值回退成后端下发的原值（不丢信息）。
  const kindLabelKey = detail ? reminderKindLabelKey(detail.kind) : undefined;
  const statusLabelKey = detail ? reminderStatusLabelKey(detail.status) : undefined;

  return (
    <RecordDetailDrawer
      open={detail !== null}
      title={detail?.title || t("reminder.detail.title")}
      tags={
        detail && (
          <Space size={6} wrap>
            <Tag>{kindLabelKey ? t(kindLabelKey) : detail.kind}</Tag>
            <Tag
              color={
                detail.status === "pending"
                  ? "blue"
                  : detail.status === "done"
                    ? "green"
                    : "default"
              }
            >
              {statusLabelKey ? t(statusLabelKey) : detail.status}
            </Tag>
          </Space>
        )
      }
      fields={
        detail
          ? [
              { label: t("reminder.field.time"), value: formatDateTime(detail.remind_at) },
              { label: t("reminder.detail.track"), value: trackLabel },
              { label: t("reminder.detail.job"), value: jobLabel },
              { label: t("reminder.detail.resume"), value: resumeLabel },
              { label: t("reminder.detail.createdAt"), value: formatDateTime(detail.created_at) },
              { label: t("reminder.detail.updatedAt"), value: formatDateTime(detail.updated_at) },
            ]
          : []
      }
      sections={
        detail
          ? [
              {
                title: t("reminder.field.note"),
                content: detail.note || t("reminder.detail.none"),
              },
            ]
          : []
      }
      actions={
        detail && (
          <Space>
            {detail.status === "pending" && (
              <Button icon={<CheckOutlined />} onClick={onMarkDone}>
                {t("reminder.action.markDone")}
              </Button>
            )}
            <Button type="primary" icon={<EditOutlined />} onClick={onEdit}>
              {t("reminder.action.edit")}
            </Button>
          </Space>
        )
      }
      onClose={onClose}
    />
  );
}
