// SPDX-License-Identifier: Apache-2.0
/**
 * 近期提醒卡：列表 / 月历视图切换 + 提醒列表（点击任一条打开提醒弹窗）。
 * （自 HomePage 拆出：reminderView state、changeReminderView、loadReminderView、
 * REMINDER_VIEW_KEY、URGENCY_DOT_COLORS 随唯一消费者下沉；CalendarView import 随迁。）
 */
import { CalendarOutlined } from "@ant-design/icons";
import { Card, Empty, Listy, Segmented, Space, Typography } from "antd";
import { ListyItem } from "../../components/common/ListyItem";
import { Link } from "react-router-dom";
import { useState } from "react";
import type { ReminderUpcoming } from "../../types";
import { formatDateTime } from "../../utils/format";
import CalendarView from "../../components/tracker/CalendarView";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

const REMINDER_VIEW_KEY = "rf.home.reminderView";

/** 紧急度着色点的实际色值（与 REMINDER_URGENCY_COLORS 的 antd 色名对应）。 */
// 用 token 而不是色值（R18）：深色下 #1677ff 的蓝点与深底几乎同亮度，点会"消失"。
const URGENCY_DOT_COLORS: Record<string, string> = {
  overdue: "var(--rf-danger)",
  soon: "var(--rf-accent-amber)",
  upcoming: "var(--rf-info)",
  later: "var(--rf-border-strong)",
};

/** 紧急度的文字名（RF-12：颜色不能是唯一状态信号——点旁必须带可读的紧急度）。 */
const URGENCY_LABELS: Record<string, MessageKey> = {
  overdue: "homePage.reminders.urgency.overdue",
  soon: "homePage.reminders.urgency.soon",
  upcoming: "homePage.reminders.urgency.upcoming",
  later: "homePage.reminders.urgency.later",
};

/** 紧急度的显示名；后端给了未知取值时回落到「未知」。 */
function urgencyLabel(urgency: string): string {
  return t(URGENCY_LABELS[urgency] ?? "homePage.reminders.urgency.unknown");
}

/** 从 localStorage 读取近期提醒视图偏好；缺省为列表。 */
function loadReminderView(): "list" | "calendar" {
  try {
    return localStorage.getItem(REMINDER_VIEW_KEY) === "calendar" ? "calendar" : "list";
  } catch {
    return "list";
  }
}

export function RemindersCard({
  reminders,
  remindersLoading,
  onOpenPopup,
}: {
  reminders: ReminderUpcoming[] | undefined;
  remindersLoading: boolean;
  onOpenPopup: () => void;
}) {
  // 本组件用模块级 t()，必须订阅语言变化。
  useLocale();
  // 近期提醒卡片视图：列表 / 月历，缺省列表。
  const [reminderView, setReminderView] = useState<"list" | "calendar">(() => loadReminderView());

  const changeReminderView = (value: "list" | "calendar") => {
    setReminderView(value);
    localStorage.setItem(REMINDER_VIEW_KEY, value);
  };

  return (
    <Card
      style={{ marginTop: 16 }}
      title={
        <Space size={8}>
          <CalendarOutlined />
          <span>{t("homePage.reminders.title")}</span>
        </Space>
      }
      extra={
        <Space size={8}>
          <Segmented
            aria-label={t("homePage.reminders.viewSwitchAria")}
            size="small"
            value={reminderView}
            options={[
              { label: t("homePage.reminders.view.list"), value: "list" },
              { label: t("homePage.reminders.view.calendar"), value: "calendar" },
            ]}
            onChange={(value) => changeReminderView(value as "list" | "calendar")}
          />
          <Link to="/tracker">{t("homePage.action.viewAll")}</Link>
        </Space>
      }
      loading={remindersLoading}
    >
      {reminderView === "calendar" ? (
        <CalendarView compact />
      ) : (reminders ?? []).length === 0 ? (
        <Empty description={t("homePage.reminders.empty")} />
      ) : (
        <Listy
          items={reminders ?? []}
          rowKey={(item) => item.id}
          itemRender={(item) => (
            <ListyItem
              style={{ cursor: "pointer" }}
              onClick={onOpenPopup}
              ariaLabel={t("homePage.reminders.openAria", { title: item.title })}
            >
              <Space size={8} wrap>
                <span
                  role="img"
                  aria-label={t("homePage.reminders.urgencyAria", {
                    level: urgencyLabel(item.urgency),
                  })}
                  className="reminder-urgency-dot"
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: URGENCY_DOT_COLORS[item.urgency] ?? "var(--rf-border-strong)",
                    flex: "none",
                  }}
                />
                <span>{item.title}</span>
                <Typography.Text type="secondary">{formatDateTime(item.remind_at)}</Typography.Text>
              </Space>
            </ListyItem>
          )}
        />
      )}
    </Card>
  );
}
