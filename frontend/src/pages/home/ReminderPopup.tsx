// SPDX-License-Identifier: Apache-2.0
/**
 * 启动提醒弹窗：打开应用时展示近期提醒（popupVisible 由页面持有）。
 * （自 HomePage 拆出，逐字搬运，行为等价。）
 *
 * ## 逐条处理（CR-21 / CR-28）
 *
 * 原来只有「知道了」：关掉之后提醒仍是待办，下次启动又弹一遍，用户只能去求职进度
 * 一条条改状态。现在每行直接给「完成 / 稍后 / 跳过」：完成与跳过是 `PATCH
 * /reminders/{id}` 的两个动作（done / dismissed），稍后走 `POST /reminders/{id}/snooze`
 * ——只推后"这一次"的时刻，不新建提醒。
 *
 * 三条约束：
 * - **行内请求中禁用该行**：同一行连点会发两次 PATCH，第二次可能把已终态的行再改回去；
 * - **成功才从列表里去掉**：失败保留该行 + toast，用户不会以为已经处理好了；
 * - **最后一条处理完自动关闭**：剩下 0 条时继续挂着空弹窗没有意义，直接调用 `onClose`，
 *   由页面释放启动槽位（提示队列里的下一条才能出现）。
 *
 * ## 为什么"已处理"状态放在列表子组件里
 *
 * 它只在弹窗打开期间有意义：关掉再打开应该按服务端最新数据重来。把状态放在**只于
 * `open` 时挂载**的 `ReminderRows` 上，关闭即卸载、状态自然归零——不需要在 effect 里
 * `setState`（那会多一轮渲染，React Compiler 的 lint 也会点名）。
 */
import { BellOutlined } from "@ant-design/icons";
import { App, Button, Listy, Modal, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { ListyItem } from "../../components/common/ListyItem";
import { Link } from "react-router-dom";
import { snoozeReminder, updateReminder } from "../../api/reminders";
import { REMINDER_URGENCY_COLORS } from "../../types";
import type { ReminderSnoozePayload, ReminderUpcoming } from "../../types";
import { formatDateTime } from "../../utils/format";
import { reminderDueLabel } from "../../utils/reminderDueLabel";
import ReminderSnoozeMenu from "../../features/tracker/ReminderSnoozeMenu";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import "./reminderPopupSurface.css";

interface RowsProps {
  reminders: ReminderUpcoming[];
  onChanged?: () => void;
  /** 最后一条也处理完时调用：由弹窗转成 `onClose`（关闭 + 释放启动槽位）。 */
  onEmptied: () => void;
}

/** 弹窗的列表体：持有"本次打开里已处理 / 正在处理"的行 id。 */
function ReminderRows({ reminders, onChanged, onEmptied }: RowsProps) {
  // 处理成功的行：先本地摘掉，不等页面重新拉列表（`onChanged` 会触发刷新）。
  const [handledIds, setHandledIds] = useState<ReadonlySet<number>>(() => new Set());
  // 正在提交的行：只禁用这一行，别的行仍可继续处理。
  const [pendingIds, setPendingIds] = useState<ReadonlySet<number>>(() => new Set());
  const { message } = App.useApp();

  const rows = reminders.filter((item) => !handledIds.has(item.id));

  const markStatus = async (item: ReminderUpcoming, status: "done" | "dismissed") => {
    if (pendingIds.has(item.id)) return;
    setPendingIds((current) => new Set(current).add(item.id));
    try {
      await updateReminder(item.id, { status });
      setHandledIds((current) => new Set(current).add(item.id));
      onChanged?.();
      message.success(
        status === "done"
          ? t("homePage.reminders.toast.done")
          : t("homePage.reminders.toast.ignored"),
      );
      // 这是最后一条：关掉弹窗（`onEmptied` 由页面转成关闭 + 释放槽位）。
      if (rows.length === 1) onEmptied();
    } catch {
      message.error(t("homePage.reminders.toast.updateFailed"));
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };

  /** 稍后：推后这一次的到期时刻；成功后本行从弹窗里去掉（它已经不再"到点"）。 */
  const snooze = async (item: ReminderUpcoming, payload: ReminderSnoozePayload) => {
    if (pendingIds.has(item.id)) return;
    setPendingIds((current) => new Set(current).add(item.id));
    try {
      const saved = await snoozeReminder(item.id, payload);
      setHandledIds((current) => new Set(current).add(item.id));
      onChanged?.();
      message.success(t("reminder.snooze.toast", { time: formatDateTime(saved.remind_at) }));
      if (rows.length === 1) onEmptied();
    } catch {
      message.error(t("reminder.snooze.failed"));
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };

  return (
    <Listy
      items={rows}
      rowKey={(item) => item.id}
      itemRender={(item) => {
        const busy = pendingIds.has(item.id);
        return (
          <ListyItem>
            <Space size={6} wrap>
              <Tag color={REMINDER_URGENCY_COLORS[item.urgency] ?? "default"}>
                {/*
                  倒计时文案按当前界面语言组合（后端只说"还有几天"，`due_label` 只作
                  旧后端的回退）——直接渲染 due_label 会让英文界面里冒出中文胶囊。
                */}
                {reminderDueLabel(item.days_until, item.due_label)}
              </Tag>
              <Link to="/tracker" onClick={onEmptied}>
                {item.title}
              </Link>
              <Typography.Text type="secondary">{formatDateTime(item.remind_at)}</Typography.Text>
              <Space size={4}>
                <Button
                  size="small"
                  type="primary"
                  // 禁用语义只传 true / undefined（显式 false 会短路 Form disabled）。
                  disabled={busy || undefined}
                  onClick={() => void markStatus(item, "done")}
                >
                  {t("homePage.reminders.action.done")}
                </Button>
                {/* 稍后（CR-28）：预设三个 + 自定义时刻，统一走共用菜单。 */}
                <ReminderSnoozeMenu
                  disabled={busy || false}
                  onSnooze={(payload) => snooze(item, payload)}
                />
                <Button
                  size="small"
                  disabled={busy || undefined}
                  onClick={() => void markStatus(item, "dismissed")}
                >
                  {t("homePage.reminders.action.ignore")}
                </Button>
              </Space>
            </Space>
          </ListyItem>
        );
      }}
    />
  );
}

export function ReminderPopup({
  open,
  reminders,
  onClose,
  onChanged,
}: {
  open: boolean;
  reminders: ReminderUpcoming[] | undefined;
  onClose: () => void;
  /** 一条提醒被处理成功后回调：页面据此重新拉列表（卡片与月历同步）。 */
  onChanged?: () => void;
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
      width={460}
      // className 配合 reminderPopupSurface.css（文件名与组件 stem 刻意不同——
      // Windows 大小写不敏感，同 stem 的 tsx/css 会让守卫与解析都踩坑）：打开瞬间
      // antd 程序化聚焦右上角关闭按钮，鼠标路径下不该出现 :focus-visible 边框。
      className="rf-reminder-modal"
      footer={
        <Button type="primary" onClick={onClose}>
          {t("homePage.reminders.close")}
        </Button>
      }
    >
      <div className="rf-reminder-modal-list">
        {/* 只在打开时挂载：关掉即卸载，"已处理"集合自然归零，下次打开按新数据重来。 */}
        {open ? (
          <ReminderRows reminders={reminders ?? []} onChanged={onChanged} onEmptied={onClose} />
        ) : null}
      </div>
    </Modal>
  );
}
