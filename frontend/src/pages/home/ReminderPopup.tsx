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
 * ## 2026-11-26（整改 #13）：每行改成共用的「事件行」，整行可点进详情
 *
 * 旧版把「紧急度 Tag + 标题（包在 `<Link to="/tracker">` 里）+ 时间 + 三个按钮」塞进
 * 一个 `Space`，被挤成三段：日期掉第二行最左、按钮掉第三行，标题再长就把按钮顶掉。
 * 而且那个 `<Link>` 只跳到列表页——后端早就在发 `/tracker?reminder={id}`，前端一直没读。
 *
 * 现在：
 * - 行结构交给 `components/common/EventRow`（与页头通知中心同一份）；
 * - **整行** `onClick` → `onClose()` + `/tracker?reminder=N`（页面据此展开这条的详情）；
 * - 标题不再包 `<Link>`（整行已经是那个入口，再套一层会有两个可点区域）；
 * - 行内动作**各自 `stopPropagation`**——点「完成」绝不能顺带跳走；
 * - 逾期不用色条/Tag，改成副行的红字「逾期 N 天」（`EventRow` 只收 `overdueDays`）。
 *
 * ## 2026-11-26（T25 / R24）：行内只留「完成」+ `⋯`，footer 整条删除
 *
 * 三个同层动作（实心「完成」/ 文字「稍后」/ 描边「忽略」）把副行挤到只剩 130px，
 * 而且「完成」与底部 footer 的「关闭」两个 primary 打架。拍板后的口径：
 *
 * - 行内只留「完成」（唯一 primary）+ 一个 `⋯`；稍后与忽略都进 `⋯` 这一份菜单
 *   （预设来自共用的 `ReminderSnoozeMenu`，忽略通过它的 `extraItems` 追加，
 *   不在这里另抄一遍预设）；
 * - `footer={null}`：右上角 × 是唯一关闭入口（**推翻 CR-21 的底部关闭按钮**）；
 * - 三条右缘由 `reminderPopupSurface.css` 归零 Listy 的 16px 与 EventRow 的 4px 横向
 *   内边距统一到 body 内容右缘，宽度仍固定 460。
 *
 * ## 为什么"已处理"状态放在列表子组件里
 *
 * 它只在弹窗打开期间有意义：关掉再打开应该按服务端最新数据重来。把状态放在**只于
 * `open` 时挂载**的 `ReminderRows` 上，关闭即卸载、状态自然归零——不需要在 effect 里
 * `setState`（那会多一轮渲染，React Compiler 的 lint 也会点名）。
 */
import { BellOutlined } from "@ant-design/icons";
import { App, Button, Listy, Modal, Space } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import EventRow from "../../components/common/EventRow";
import { ListyItem } from "../../components/common/ListyItem";
import { snoozeReminder, updateReminder } from "../../api/reminders";
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
  /** 整行点开某条提醒：由弹窗转成 `onClose` + 跳 `/tracker?reminder=N`。 */
  onOpenReminder: (item: ReminderUpcoming) => void;
}

/** 逾期天数：后端下发的 `days_until` 为负时才成立（缺失/0/整数为正都不算逾期）。 */
function overdueDaysOf(item: ReminderUpcoming): number {
  const days = item.days_until;
  return typeof days === "number" && Number.isFinite(days) && days < 0 ? Math.trunc(-days) : 0;
}

/** 弹窗的列表体：持有"本次打开里已处理 / 正在处理"的行 id。 */
function ReminderRows({ reminders, onChanged, onEmptied, onOpenReminder }: RowsProps) {
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
        const overdueDays = overdueDaysOf(item);
        return (
          <ListyItem>
            <EventRow
              title={item.title}
              overdueDays={overdueDays}
              // 副行：逾期时红字已说清"逾期 N 天"，不再重复倒计时文案；
              // 未逾期时保留倒计时（「6 天后」「明天」）与具体时刻。
              meta={
                <>
                  {overdueDays === 0 && (
                    <span className="rf-reminder-when">
                      {reminderDueLabel(item.days_until, item.due_label)}
                    </span>
                  )}
                  <span className="rf-reminder-when">{formatDateTime(item.remind_at)}</span>
                </>
              }
              onOpen={() => onOpenReminder(item)}
              actions={
                <>
                  {/* 稍后（CR-28 的预设三个 + 自定义时刻）与忽略收进同一个 `⋯`：
                      预设仍由共用的 ReminderSnoozeMenu 提供，忽略通过 extraItems 追加。
                      外层 span 挡冒泡——菜单自己是个 Dropdown，展开动作不该跳页。 */}
                  <span
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <ReminderSnoozeMenu
                      iconTrigger
                      triggerAriaLabel={t("common.rowActions.more")}
                      disabled={busy}
                      onSnooze={(payload) => snooze(item, payload)}
                      extraItems={[
                        {
                          key: "dismiss",
                          label: t("homePage.reminders.action.ignore"),
                          onSelect: () => void markStatus(item, "dismissed"),
                        },
                      ]}
                    />
                  </span>
                  <Button
                    size="small"
                    type="primary"
                    // 禁用语义只传 true / undefined（显式 false 会短路 Form disabled）。
                    disabled={busy || undefined}
                    onClick={(event) => {
                      // 行内动作必须自己挡住冒泡：否则点「完成」会顺手跳去详情页。
                      event.stopPropagation();
                      void markStatus(item, "done");
                    }}
                  >
                    {t("homePage.reminders.action.done")}
                  </Button>
                </>
              }
            />
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
  const navigate = useNavigate();

  /** 整行点开：先关弹窗（释放启动槽位），再带 `reminder` 参数去求职进度。 */
  const openReminder = (item: ReminderUpcoming) => {
    onClose();
    navigate(`/tracker?reminder=${item.id}`);
  };

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
      // T25（R24）：footer 整条删除——它此前只装一个与右上角 × 重复的「关闭」，
      // 却独占一行、还多出第三个右缘坐标。关闭入口只留 ×（**推翻 CR-21**）。
      footer={null}
    >
      <div className="rf-reminder-modal-list">
        {/* 只在打开时挂载：关掉即卸载，"已处理"集合自然归零，下次打开按新数据重来。 */}
        {open ? (
          <ReminderRows
            reminders={reminders ?? []}
            onChanged={onChanged}
            onEmptied={onClose}
            onOpenReminder={openReminder}
          />
        ) : null}
      </div>
    </Modal>
  );
}

