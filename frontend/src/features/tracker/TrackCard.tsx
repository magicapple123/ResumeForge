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
import { LinkOutlined, MoreOutlined } from "@ant-design/icons";
import { Button, Dropdown, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { TRACK_SOURCE_LABEL_KEYS, TRACK_STATUS_LABEL_KEYS } from "../../i18n/enum/tracker";
import type { Track } from "../../types";
import { FUNNEL_STATUSES, isActiveStatus } from "../../types";
import { useRowActionMenu } from "../../components/common/rowActionMenu";
import { safeExternalUrl } from "../../utils/externalUrl";
import { formatServerTime } from "../../utils/serverTime";
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

/**
 * 简历名（RF-17 / T6）：`resume_title` 优先，只剩快照/没有标题时退回 `#id`。
 *
 * 三个标注的判据必须分清（判错就是把外部关联说成历史关联）：
 *
 * - **外部**：`external_resume_id != null` → 追加「（外部）」，这版是在别处做的原件；
 * - **历史关联**：`!(resume_id || external_resume_id)` 且标题快照还在 → 关联已经没了
 *   （简历被删、外键 SET NULL），只剩快照，如实标注、不臆造还关联着；
 * - 两者都不成立 = 活关联，什么都不加。
 *
 * **这里不做任何截断**：可见文本与 `title` 用同一份完整字符串，放不下由 CSS 让位
 * （`.track-card-resume` 的 flex 与 `:last-child` 规则）。在 JS 里 `slice` 掉的字符
 * 用户永远看不到，也没法在 tooltip 里找回来。
 */
function resumeLabel(track: Track): string {
  const title = track.resume_title || `#${track.resume_id ?? track.external_resume_id ?? ""}`;
  const kind = track.external_resume_id != null ? t("trackerUi.card.resumeExternal") : "";
  // 判据是"两个关联都为空"：只看 `resume_id` 会把外部关联误标成「历史关联」。
  const linked = Boolean(track.resume_id || track.external_resume_id);
  const historical = linked ? "" : t("trackerUi.card.resumeHistorical");
  return `${title}${kind}${historical}`;
}

export default function TrackCard({ track, onEdit, onDelete, groupStart = false }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后行内容停在旧文案。
  useLocale();
  const buildMenu = useRowActionMenu();
  // 逾期天数按本地日期算（见 trackDates）：当天 0、未来为负，都不显示标记。
  const overdueDays = daysOverdue(track.next_action_date);
  const overdue = overdueDays > 0;
  const evidence = track.evidence ? t("trackerUi.card.evidence", { evidence: track.evidence }) : "";
  // 关联链接（取代已删除的「状态回读」）：只有真填了、且能安全解析成 http/https 才画图标。
  // 安全判定与助手的 Markdown 外链同一份（`utils/externalUrl`），不为了一个图标再写一套。
  const link = track.link ? safeExternalUrl(track.link) : null;
  const displayName = track.company || track.title || t("trackerUi.card.fallbackName");
  // 显示条件把外部关联也算进来：只看 resume_id 会让"外部简历"的行整段消失。
  const hasResume = Boolean(track.resume_id || track.external_resume_id || track.resume_title);
  const resume = hasResume ? resumeLabel(track) : "";
  // CR-19：最近一次「已联系」的月-日（设备时区）。取不到/旧接口没这个字段时不显示。
  const followUpDate = track.latest_followup
    ? shortDate(formatServerTime(track.latest_followup, { dateOnly: true }))
    : "";
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
          {/* 关联链接：`target="_blank"` 必须配 `rel="noopener noreferrer"`，
              否则新页面能通过 `window.opener` 反向操纵本页。 */}
          {link && (
            <a
              className="track-card-link"
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              title={link}
              aria-label={t("trackerUi.card.aria.link", { name: displayName })}
            >
              <LinkOutlined aria-hidden="true" />
            </a>
          )}
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
                name: displayName,
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
        {/* 使用的简历版本（RF-17 / T6）：有活关联（内部或外部）时显示名字；
            只剩标题快照（简历被删、外键 SET NULL）时如实标注"历史关联"，
            外部简历再标明"外部"。可见文本与 `title` 同一份字符串——长标题不在这里截断。 */}
        {resume && (
          <span className="track-card-resume" title={resume}>
            {t("trackerUi.card.resume", { title: resume })}
          </span>
        )}
        {/* CR-19：最近一次「已联系」跟进——从首页任务卡跳到 /tracker?job_id= 后，
            用户要能一眼看到跟进痕迹。日期按设备时区显示（后端是 naive UTC）。 */}
        {followUpDate && (
          <span className="track-card-followup">
            {t("trackerUi.card.followup", { date: followUpDate })}
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
