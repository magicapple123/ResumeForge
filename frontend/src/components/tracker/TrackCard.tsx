// SPDX-License-Identifier: Apache-2.0
/**
 * 一条进度记录的只读展示。
 *
 * 排序上把「下一步」放在状态旁边：秋招真正会被漏掉的是"9 月 20 日前确认面试时间"
 * 这种带截止时间的事，而不是"我投过这家"。
 */
import { MoreOutlined } from "@ant-design/icons";
import { Button, Dropdown, Space, Tag, Typography } from "antd";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { Track, TrackSource, TrackStatus } from "../../types";
import { FUNNEL_STATUSES, TRACK_STATUS_COLORS, isActiveStatus } from "../../types";
import { useRowActionMenu } from "../common/rowActionMenu";

interface Props {
  track: Track;
  onEdit: () => void;
  onDelete: () => void;
}

/**
 * 进度状态的显示名：键是协议值（与后端逐字对应），值指向语言包 key。
 *
 * 七个名字与「求职进度」页、进度表单共用 `trackerForm.status.*` 词表——同一个协议值
 * 在两处必须是同一个名字，各写一份迟早会漂。`types/tracker.ts` 的中文表不翻，也
 * 一个字都没动（界面显示名一律从这里取 key）。
 */
const STATUS_LABEL_KEYS: Record<TrackStatus, MessageKey> = {
  applied: "trackerForm.status.applied",
  screening: "trackerForm.status.screening",
  assessment: "trackerForm.status.assessment",
  interview: "trackerForm.status.interview",
  offer: "trackerForm.status.offer",
  rejected: "trackerForm.status.rejected",
  unknown: "trackerForm.status.unknown",
};

/** 记录来源的显示名：同一个协议值的名字只在本包写一份。 */
const SOURCE_LABEL_KEYS: Record<TrackSource, MessageKey> = {
  apply: "trackerUi.source.apply",
  manual: "trackerUi.source.manual",
  recognized: "trackerUi.source.recognized",
};

/** 截止日期是不是已经过了（只看日期，不管当天）。 */
function isOverdue(dateText: string): boolean {
  if (!dateText) return false;
  const today = new Date();
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;
  return dateText < stamp;
}

export default function TrackCard({ track, onEdit, onDelete }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后卡片停在旧文案。
  useLocale();
  const buildMenu = useRowActionMenu();
  const overdue = isOverdue(track.next_action_date);

  return (
    // data-stage-index 注入漏斗同款阶段色（--rf-stage-color，见 tracker.css）：
    // 进行中的记录左侧那条颜色 pill 与漏斗按同一套颜色说话，
    // 「已结束 / 待确认」不在漏斗主线上（indexOf 为 -1），不参与着色。
    <article
      className={`track-card${isActiveStatus(track.status) ? " is-active" : ""}`}
      data-stage-index={FUNNEL_STATUSES.indexOf(track.status)}
    >
      <header className="track-card-head">
        <Space size={6} wrap>
          <Typography.Text strong>
            {track.company || t("trackerUi.card.emptyCompany")}
          </Typography.Text>
          <Typography.Text type="secondary">
            {track.title || t("trackerUi.card.emptyTitle")}
          </Typography.Text>
          <Tag color={TRACK_STATUS_COLORS[track.status]}>{t(STATUS_LABEL_KEYS[track.status])}</Tag>
          {track.stage_note && <Tag>{track.stage_note}</Tag>}
        </Space>
        <Space size={4}>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: buildMenu([
                { key: "edit", label: t("trackerUi.card.action.edit"), onClick: onEdit },
                {
                  key: "delete",
                  label: t("trackerUi.card.action.delete"),
                  danger: true,
                  // 软删由父级用 useDeleteUndo 兜：这里**不再问**，撤销入口在 Toast 上。
                  undo: true,
                  onClick: onDelete,
                },
              ]),
            }}
          >
            <Button
              size="small"
              type="text"
              icon={<MoreOutlined />}
              aria-label={t("trackerUi.card.aria.more", {
                name: track.company || track.title || t("trackerUi.card.fallbackName"),
              })}
            />
          </Dropdown>
        </Space>
      </header>

      <div className="track-card-meta">
        {track.applied_at && (
          <Typography.Text type="secondary">
            {t("trackerUi.card.appliedAt", { date: track.applied_at })}
          </Typography.Text>
        )}
        {track.status_date && (
          <Typography.Text type="secondary">
            {t("trackerUi.card.statusDate", { date: track.status_date })}
          </Typography.Text>
        )}
        <Typography.Text type="secondary">{t(SOURCE_LABEL_KEYS[track.source])}</Typography.Text>
        {/* 使用的简历版本（RF-17）：有活关联显示名字；只剩标题快照（简历已删、
            resume_id 被 SET NULL）时如实标注"历史关联"，不臆造还关联着。 */}
        {(track.resume_id || track.resume_title) && (
          <Typography.Text type="secondary">
            {t("trackerUi.card.resume", {
              title: track.resume_title || `#${track.resume_id}`,
            })}
            {!track.resume_id && t("trackerUi.card.resumeHistorical")}
          </Typography.Text>
        )}
      </div>

      {(track.next_action || track.next_action_date) && (
        <div className={`track-card-next${overdue ? " is-overdue" : ""}`}>
          <span className="track-card-next-label">{t("trackerUi.card.nextStep")}</span>
          <span>
            {track.next_action || t("trackerUi.card.emptyNextAction")}
            {track.next_action_date && ` · ${track.next_action_date}`}
            {overdue && ` · ${t("trackerUi.card.overdue")}`}
          </span>
        </div>
      )}

      {track.note && (
        <Typography.Paragraph className="track-card-note">{track.note}</Typography.Paragraph>
      )}

      {track.evidence && (
        <Typography.Text type="secondary" className="track-card-evidence">
          {t("trackerUi.card.evidence", { evidence: track.evidence })}
        </Typography.Text>
      )}
    </article>
  );
}
