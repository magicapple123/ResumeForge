// SPDX-License-Identifier: Apache-2.0
/**
 * 提醒任务卡的专门行（CR-20）。
 *
 * ## 为什么要单独一行
 *
 * 提醒到期生成的卡只有一个确认步骤，用通用任务行渲染时会写成「第 0/1 步」+ 可展开的
 * 步骤清单——用户看到的是一个"进度 0% 的任务"，而它其实只是"这条提醒到点了"。所以：
 *
 * - **不显示进度与步骤折叠**，改成标题下一行上下文：来自提醒 · 类型 · 到期 · 公司/岗位；
 * - 未结束给「知道了」（= 取消这张卡，提醒本身不受影响）+「去求职进度」；
 * - 终态只给结果（状态标签），没有任何操作——历史里看到它就该是这样；
 * - `goal` 原句上卡：它写着"只提醒你准备，不会自动执行任何写操作"，这是用户最需要知道的。
 *
 * ## 软删提醒
 *
 * 提醒被移进回收站后（`reminder.deleted`），卡上**不给任何跳转链接**——点进去在求职进度
 * 里找不到它，只会让用户以为数据丢了。此时只留标题与时间。
 */
import { Button, Space, Tag, Typography } from "antd";
import { Link } from "react-router-dom";
import type { AgentTask } from "../../../api/agentTasks";
import { REMINDER_KIND_LABEL_KEYS } from "../../../i18n/enum/reminder";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { formatDateTime } from "../../../utils/format";
import { STATUS_LABEL_KEYS, STATUS_TAG_COLORS, bucketOf } from "./agentTaskView";

interface Props {
  task: AgentTask;
  /** 「知道了」：取消这张卡（提醒本身不动）。历史弹窗传只读，不传这个。 */
  onAcknowledge?: (taskId: number) => void;
  /** 只读（设置页历史）：不渲染任何操作按钮。 */
  readOnly?: boolean;
}

export default function ReminderTaskRow({ task, onAcknowledge, readOnly = false }: Props) {
  useLocale();
  const reminder = task.reminder ?? null;
  const finished = bucketOf(task.status) === "finished";
  // 提醒被软删 / 旧后端没有上下文：都不给跳转（跳过去也交代不了这条卡从哪来）。
  const canNavigate = Boolean(reminder) && !reminder?.deleted;

  const kindKey = reminder ? REMINDER_KIND_LABEL_KEYS[reminder.kind as never] : undefined;
  const parts: string[] = [t("assistantUi.tasks.reminder.from")];
  if (reminder) {
    // 提醒还在：类型 / 到期 / 公司 / 岗位都给（认卡靠它们）。
    // 提醒进了回收站：只留到期时间——公司和岗位点进去也找不到，索性不说。
    if (!reminder.deleted) {
      // 未知类型回退后端原值，不把信息丢掉，也不假装成「其它」。
      parts.push(kindKey ? t(kindKey) : reminder.kind);
    }
    if (reminder.due_at) {
      parts.push(t("assistantUi.tasks.reminder.dueAt", { time: formatDateTime(reminder.due_at) }));
    }
    if (!reminder.deleted) {
      if (reminder.company) parts.push(reminder.company);
      if (reminder.job_title) parts.push(reminder.job_title);
    }
  }

  const title = (
    <span
      title={task.title}
      style={{
        flex: "1 1 160px",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {task.title}
    </span>
  );

  return (
    <li data-testid={`agent-task-${task.id}`} style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {canNavigate ? <Link to="/tracker">{title}</Link> : title}
        <Tag color={STATUS_TAG_COLORS[task.status]}>{t(STATUS_LABEL_KEYS[task.status])}</Tag>
        {!finished && !readOnly ? (
          <Space size={4}>
            <Button size="small" onClick={() => onAcknowledge?.(task.id)}>
              {t("assistantUi.tasks.action.acknowledge")}
            </Button>
            {canNavigate ? (
              // 次级动作做成文字链接而非第二个按钮：这一行唯一的"决定"是「知道了」，
              // 跳转只是出口（button 套在 a 里是无效 HTML，也会让读屏念两个角色）。
              <Link to="/tracker">{t("assistantUi.tasks.action.goTracker")}</Link>
            ) : null}
          </Space>
        ) : null}
      </div>
      {reminder ? (
        <Typography.Text type="secondary" data-testid={`agent-task-reminder-context-${task.id}`}>
          {parts.join(" · ")}
        </Typography.Text>
      ) : null}
      {task.goal ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {task.goal}
        </Typography.Text>
      ) : null}
      {task.status === "failed" && task.error ? (
        <Typography.Text type="danger" data-testid={`agent-task-error-${task.id}`}>
          {t("assistantUi.tasks.failedReason", { error: task.error })}
        </Typography.Text>
      ) : null}
    </li>
  );
}
