/**
 * 启动提醒弹窗：打开应用时展示近期提醒（popupVisible 由页面持有）。
 * （自 HomePage 拆出，逐字搬运，行为等价。）
 */
import { Button, Listy, Modal, Space, Tag, Typography } from "antd";
import { ListyItem } from "../../components/common/ListyItem";
import { Link } from "react-router-dom";
import { REMINDER_URGENCY_COLORS } from "../../types";
import type { ReminderUpcoming } from "../../types";
import { formatDateTime } from "../../utils/format";

export function ReminderPopup({
  open,
  reminders,
  onClose,
}: {
  open: boolean;
  reminders: ReminderUpcoming[] | undefined;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title="近期提醒"
      onCancel={onClose}
      footer={
        <Button type="primary" onClick={onClose}>
          知道了
        </Button>
      }
    >
      <Listy
        items={reminders ?? []}
        rowKey={(item) => item.id}
        itemRender={(item) => (
          <ListyItem>
            <Space size={6} wrap>
              <Tag color={REMINDER_URGENCY_COLORS[item.urgency] ?? "default"}>
                {item.due_label}
              </Tag>
              <Link to="/tracker" onClick={onClose}>
                {item.title}
              </Link>
              <Typography.Text type="secondary">{formatDateTime(item.remind_at)}</Typography.Text>
            </Space>
          </ListyItem>
        )}
      />
    </Modal>
  );
}
