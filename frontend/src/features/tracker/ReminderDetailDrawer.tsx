// SPDX-License-Identifier: Apache-2.0
/**
 * 提醒详情抽屉（T06；自 ReminderPanel 拆出，让主文件守住 500 行预算）。
 *
 * 只读查看：只走右上角 × 关闭（footer 语义由 RecordDetailDrawer 统一）。关联对象的显示名
 * 由宿主按"已选值回查"的选项算出后传入——抽屉不自己拉接口。
 */
import { CheckOutlined, EditOutlined } from "@ant-design/icons";
import { Button, Space, Tag } from "antd";
import { Link } from "react-router-dom";
import { t } from "../../i18n";
import { reminderKindLabelKey, reminderStatusLabelKey } from "../../i18n/enum/reminder";
import { useLocale } from "../../i18n/i18nContext";
import type { Reminder } from "../../types";
import { formatDateTime } from "../../utils/format";
import { RecordDetailDrawer } from "../../components/common/RecordDetail";

interface Props {
  detail: Reminder | null;
  /** 关联对象在下拉里查不到时的占位（与列表同口径）；未关联时传 undefined，整行不渲染。 */
  trackLabel: string | undefined;
  jobLabel: string | undefined;
  resumeLabel: string | undefined;
  /**
   * 关联简历的跳转地址（R14）：外部简历没有自己的路由，只能"打开外部简历列表 +
   * `?resume=<id>`"，由列表页决定是否展开详情。不给 = 纯文本（查不到名字时的降级态）。
   */
  resumeHref?: string;
  onMarkDone: () => void;
  onEdit: () => void;
  onClose: () => void;
}

export default function ReminderDetailDrawer({
  detail,
  trackLabel,
  jobLabel,
  resumeLabel,
  resumeHref,
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
            <Tag color={detail.status === "active" ? "blue" : "default"}>
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
              {
                label: t("reminder.detail.resume"),
                // 外部简历：点了只能落到列表页（+ `?resume=` 让列表有机会展开详情）。
                value:
                  resumeHref && resumeLabel ? (
                    <Link to={resumeHref}>{resumeLabel}</Link>
                  ) : (
                    resumeLabel
                  ),
              },
              { label: t("reminder.detail.createdAt"), value: formatDateTime(detail.created_at) },
              { label: t("reminder.detail.updatedAt"), value: formatDateTime(detail.updated_at) },
            ]
          : []
      }
      sections={
        detail
          ? [...(detail.note ? [{ title: t("reminder.field.note"), content: detail.note }] : [])]
          : []
      }
      actions={
        detail && (
          <Space>
            {detail.status === "active" && (
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
