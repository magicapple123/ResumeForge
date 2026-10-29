// SPDX-License-Identifier: Apache-2.0
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
import { reminderDueLabel } from "../../utils/reminderDueLabel";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
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
  // 本组件用模块级 t()，必须订阅语言变化。
  useLocale();
  return (
    <Modal
      open={open}
      title={
        <Space size={8}>
          <BellOutlined aria-hidden />
          <span>{t("homePage.reminders.title")}</span>
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
          {t("homePage.reminders.gotIt")}
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
                  {/*
                    倒计时文案按当前界面语言组合（后端只说"还有几天"，`due_label` 只作
                    旧后端的回退）——直接渲染 due_label 会让英文界面里冒出中文胶囊。
                  */}
                  {reminderDueLabel(item.days_until, item.due_label)}
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
