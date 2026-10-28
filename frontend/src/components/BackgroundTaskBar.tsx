// SPDX-License-Identifier: Apache-2.0
/**
 * 页头下方的**常驻任务条**：把所有"关掉窗口也还在跑"的任务摊平成一排 chip。
 *
 * 与页头 `BackgroundTasksIndicator` 的分工：这里是常驻可见的"还有几件活在跑"，
 * 一眼就能看到并就地取消/查看；页头那个是点开的详情面板（带进度文案）。
 *
 * **两个来源**：统一任务登记表 `utils/backgroundTasks`（简历生成 + 所有 `/ai-tasks`
 * 入口：单条岗位适配、岗位解读、风险扫描、岗位化建议、网申字段识别），以及批量匹配
 * 自己的登记表 `utils/jobMatchBackgroundTasks`（那是一批任务，形状不同）。
 *
 * 本轮把"岗位解读"从独立 store 并入统一登记表之后，这个组件不再需要逐个 store 去聚合：
 * 新增一个 AI 入口时，只要它登记进统一表，这里**一行都不用改**。
 * 没有任务时**完全不渲染**——留一条空横条只会白占视口。
 */
import { CloseCircleOutlined, LoadingOutlined } from "@ant-design/icons";
import { App, Button, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBackgroundTasks } from "../hooks/useBackgroundTasks";
import { useJobMatchBackgroundTasks } from "../hooks/useJobMatchBackgroundTasks";
import { cancelBackgroundTask, type BackgroundTask } from "../utils/backgroundTasks";
import {
  cancelJobMatchBackgroundTask,
  type JobMatchBackgroundTaskView,
} from "../utils/jobMatchBackgroundTasks";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

/** 一枚 chip：图标 + 名称 + 一句进度 + 查看 + 取消。 */
function TaskChip({
  label,
  meta,
  busy,
  onView,
  onCancel,
}: {
  label: string;
  meta: string;
  busy: boolean;
  onView?: () => void;
  onCancel?: () => void;
}) {
  useLocale();
  return (
    <Tag className="background-task-bar-chip">
      <Space size={6}>
        <LoadingOutlined className="background-task-bar-spin" />
        <Typography.Text strong className="background-task-bar-label">
          {label}
        </Typography.Text>
        <Typography.Text type="secondary" className="background-task-bar-meta">
          {meta}
        </Typography.Text>
        {onView && (
          <Button size="small" type="link" onClick={onView} disabled={busy}>
            {t("backgroundTasks.bar.view")}
          </Button>
        )}
        {onCancel && (
          <Button
            size="small"
            type="text"
            danger
            icon={<CloseCircleOutlined />}
            aria-label={t("backgroundTasks.bar.cancelAria", { label })}
            onClick={onCancel}
            disabled={busy}
          />
        )}
      </Space>
    </Tag>
  );
}

export default function BackgroundTaskBar() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这块文案不重渲染。
  useLocale();
  const { message } = App.useApp();
  const navigate = useNavigate();
  // 统一登记表：简历生成与所有 `/ai-tasks` 入口都在这一份里。
  const tasks = useBackgroundTasks();
  const matchTasks = useJobMatchBackgroundTasks();
  const [cancelling, setCancelling] = useState<string | null>(null);
  const busy = cancelling !== null;

  if (tasks.length === 0 && matchTasks.length === 0) return null;

  const cancelJobMatch = async (task: JobMatchBackgroundTaskView) => {
    if (busy) return;
    setCancelling(task.id);
    try {
      await cancelJobMatchBackgroundTask(task.id);
      message.info(t("backgroundTasks.toast.cancelRequested", { name: task.label }));
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("backgroundTasks.toast.cancelFailed"),
      );
    } finally {
      setCancelling(null);
    }
  };

  const cancelResume = async (task: BackgroundTask) => {
    if (busy) return;
    setCancelling(task.key);
    try {
      await cancelBackgroundTask(task.key);
      message.info(t("backgroundTasks.toast.cancelled", { name: task.label }));
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("backgroundTasks.toast.cancelFailed"),
      );
    } finally {
      setCancelling(null);
    }
  };

  return (
    <div
      className="background-task-bar"
      role="status"
      aria-label={t("backgroundTasks.popover.title")}
    >
      <Typography.Text type="secondary" className="background-task-bar-title">
        {t("backgroundTasks.bar.heading")}
      </Typography.Text>
      {tasks.map((task) => (
        <TaskChip
          key={task.key}
          label={task.label}
          meta={task.message || t("backgroundTasks.bar.generating")}
          busy={busy}
          // 有深链就落到那条记录上（简历/岗位），没有就退回简历中心：
          // 地址由 taskDeepLinks 生成，这里不手拼。
          onView={task.deepLink ? () => navigate(task.deepLink ?? "/resumes") : undefined}
          onCancel={() => void cancelResume(task)}
        />
      ))}
      {matchTasks.map((task) => (
        <TaskChip
          key={`match-${task.id}`}
          label={task.label}
          meta={t("backgroundTasks.progress.processed", {
            done: task.completedCount + task.failedCount,
            total: task.requestedCount,
          })}
          busy={busy}
          onView={() => navigate("/jobs?match_batch=history")}
          onCancel={() => void cancelJobMatch(task)}
        />
      ))}
    </div>
  );
}
