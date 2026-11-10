// SPDX-License-Identifier: Apache-2.0
/**
 * 一条进度记录的只读展示（13.2-D/E/F：列表去卡片化；2026-11-10 第二轮：行内重排）。
 *
 * 排序上把「下一步」放在状态旁边：秋招真正会被漏掉的是"9 月 20 日前确认面试时间"
 * 这种带截止时间的事，而不是"我投过这家"。
 *
 * 一行记录不再是一张卡——外层 `.tracker-list` 负责容器边框，本组件只画一条带分隔线的行；
 * 状态信号从「彩底胶囊 Tag」改成「6px 圆点 + 文字」，一行里彩色块从 2–3 个降到 1 个点。
 * 来源（手动添加 / 识别导入）是系统字段，收进 ⋮ 菜单顶部，不再与业务日期同级展示。
 *
 * 2026-11-10 第二轮（清单 §4.3）：
 * - 头部拆「ident（公司 + 岗位 + 阶段备注）/ aside（状态 + ⋮）」两组，状态在右侧**定宽列**，
 *   跨行扫视时圆点落在同一条竖线上（此前夹在标题里，位置随公司名长度漂移）；
 * - 「依据」并入元信息行尾部（低频信息不占第四行），超长时省略号 + `title` 全文；
 * - 逾期从句尾「· 已过期」改成红色短标记「逾期 N 天」，日期单独成 chip；
 * - 左侧竖条给**所有**行：进行中用阶段色、已结束/待确认用中性描边色。
 */
import { MoreOutlined } from "@ant-design/icons";
import { Button, Dropdown, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { TRACK_SOURCE_LABEL_KEYS, TRACK_STATUS_LABEL_KEYS } from "../../i18n/enum/tracker";
import type { Track } from "../../types";
import { FUNNEL_STATUSES, isActiveStatus } from "../../types";
import { useRowActionMenu } from "../common/rowActionMenu";
import { daysOverdue } from "./trackDates";

interface Props {
  track: Track;
  onEdit: () => void;
  onDelete: () => void;
  /** 长列表每 10 行的分组起点：加一条 2px 细分隔，不重新加回卡片。 */
  groupStart?: boolean;
}

/** 元信息只留「月-日」：`2026-10-15` → `10-15`，完整日期在 tooltip/表单里仍可查。 */
function shortDate(dateText: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(dateText) ? dateText.slice(5) : dateText;
}

export default function TrackCard({ track, onEdit, onDelete, groupStart = false }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后行内容停在旧文案。
  useLocale();
  const buildMenu = useRowActionMenu();
  // 逾期天数按本地日期算（见 trackDates）：当天 0、未来为负，都不显示标记。
  const overdueDays = daysOverdue(track.next_action_date);
  const overdue = overdueDays > 0;
  const evidence = track.evidence ? t("trackerUi.card.evidence", { evidence: track.evidence }) : "";
  const className = [
    "track-card",
    isActiveStatus(track.status) ? "is-active" : "",
    groupStart ? "is-group-start" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    // data-stage-index 注入阶段色（--rf-stage-color/--rf-stage-bar，见 tracker-board.css）：
    // 左侧 3px 竖条与状态圆点用与构成条同一套颜色；「已结束 / 待确认」不在主线，index 为 -1。
    <article className={className} data-stage-index={FUNNEL_STATUSES.indexOf(track.status)}>
      <header className="track-card-head">
        <div className="track-card-ident">
          <Typography.Text strong>
            {track.company || t("trackerUi.card.emptyCompany")}
          </Typography.Text>
          <Typography.Text type="secondary">
            {track.title || t("trackerUi.card.emptyTitle")}
          </Typography.Text>
          {track.stage_note && <span className="track-stage-note">{track.stage_note}</span>}
        </div>
        <div className="track-card-aside">
          <span className={`track-status${track.status === "unknown" ? " is-unknown" : ""}`}>
            <span className="track-status-dot" aria-hidden="true" />
            {t(TRACK_STATUS_LABEL_KEYS[track.status])}
          </span>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: buildMenu([
                // 来源是系统字段：收进菜单顶部，不与「投递/更新」这些业务日期同级。
                { key: "source", label: t(TRACK_SOURCE_LABEL_KEYS[track.source]), disabled: true },
                { key: "source-divider", type: "divider" },
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
              className="track-card-more"
              icon={<MoreOutlined />}
              aria-label={t("trackerUi.card.aria.more", {
                name: track.company || track.title || t("trackerUi.card.fallbackName"),
              })}
            />
          </Dropdown>
        </div>
      </header>

      <div className="track-card-meta">
        {track.applied_at && (
          <span>{t("trackerUi.card.appliedAt", { date: shortDate(track.applied_at) })}</span>
        )}
        {track.status_date && (
          <span>{t("trackerUi.card.statusDate", { date: shortDate(track.status_date) })}</span>
        )}
        {/* 使用的简历版本（RF-17）：有活关联显示名字；只剩标题快照（简历已删、
            resume_id 被 SET NULL）时如实标注"历史关联"，不臆造还关联着。 */}
        {(track.resume_id || track.resume_title) && (
          <span className="track-card-resume">
            {t("trackerUi.card.resume", {
              title: track.resume_title || `#${track.resume_id}`,
            })}
            {!track.resume_id && t("trackerUi.card.resumeHistorical")}
          </span>
        )}
        {/* 依据：低频信息，并入元信息行尾部；`title` 保住被省略的全文。 */}
        {evidence && (
          <span className="track-card-evidence" title={evidence}>
            {evidence}
          </span>
        )}
      </div>

      {(track.next_action || track.next_action_date) && (
        <div className={`track-card-next${overdue ? " is-overdue" : ""}`}>
          <span className="track-card-next-label">{t("trackerUi.card.nextStep")}</span>
          <span className="track-card-next-body">
            <span>{track.next_action || t("trackerUi.card.emptyNextAction")}</span>
            {track.next_action_date && (
              <span className="track-card-date-chip">{shortDate(track.next_action_date)}</span>
            )}
            {overdue && (
              <span className="track-card-overdue">
                {t("trackerUi.card.overdueDays", { days: overdueDays })}
              </span>
            )}
          </span>
        </div>
      )}

      {track.note && (
        <Typography.Paragraph className="track-card-note">{track.note}</Typography.Paragraph>
      )}
    </article>
  );
}
