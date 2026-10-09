/**
 * 启动提醒弹窗：打开应用时展示近期提醒（popupVisible 由页面持有）。
 * （自 HomePage 拆出，逐字搬运，行为等价。）
 */
import { BellOutlined } from "@ant-design/icons";
import { Button, Listy, Modal, Space, Tag, Typography } from "antd";
import { ListyItem } from "../../components/common/ListyItem";
import { Link } from "react-router-dom";
import { REMINDER_URGENCY_COLORS } from "../../types";
import type { ReminderUpcoming } from "../../types";
import { formatDateTime } from "../../utils/format";
import "./reminderPopupSurface.css";

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
      title={
        <Space size={8}>
          <BellOutlined aria-hidden />
          <span>近期提醒</span>
        </Space>
      }
      onCancel={onClose}
      width={420}
      // className 配合 reminderPopupSurface.css（文件名与组件 stem 刻意不同——
      // Windows 大小写不敏感，同 stem 的 tsx/css 会让守卫与解析都踩坑）：打开瞬间
      // antd 程序化聚焦右上角关闭按钮，鼠标路径下不该出现 :focus-visible 边框。
      className="rf-reminder-modal"
      footer={
        <Button type="primary" onClick={onClose}>
          知道了
        </Button>
      }
    >
      <div className="rf-reminder-modal-list">
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
      </div>
    </Modal>
  );
}
