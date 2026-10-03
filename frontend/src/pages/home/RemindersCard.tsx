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

const REMINDER_VIEW_KEY = "rf.home.reminderView";

/** 紧急度着色点的实际色值（与 REMINDER_URGENCY_COLORS 的 antd 色名对应）。 */
const URGENCY_DOT_COLORS: Record<string, string> = {
  overdue: "#ff4d4f",
  soon: "#fa8c16",
  upcoming: "#1677ff",
  later: "#d9d9d9",
};

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
          <span>近期提醒</span>
        </Space>
      }
      extra={
        <Space size={8}>
          <Segmented
            aria-label="近期提醒视图切换"
            size="small"
            value={reminderView}
            options={[
              { label: "列表", value: "list" },
              { label: "月历", value: "calendar" },
            ]}
            onChange={(value) => changeReminderView(value as "list" | "calendar")}
          />
          <Link to="/tracker">查看全部</Link>
        </Space>
      }
      loading={remindersLoading}
    >
      {reminderView === "calendar" ? (
        <CalendarView compact />
      ) : (reminders ?? []).length === 0 ? (
        <Empty description="近期没有待办提醒" />
      ) : (
        <Listy
          items={reminders ?? []}
          rowKey={(item) => item.id}
          itemRender={(item) => (
            <ListyItem
              style={{ cursor: "pointer" }}
              onClick={onOpenPopup}
              ariaLabel={`查看提醒：${item.title}`}
            >
              <Space size={8} wrap>
                <span
                  aria-hidden
                  className="reminder-urgency-dot"
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: URGENCY_DOT_COLORS[item.urgency] ?? "#d9d9d9",
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
