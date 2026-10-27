// SPDX-License-Identifier: Apache-2.0
/**
 * 页头下方的**常驻任务条**：把所有"关掉窗口也还在跑"的任务摊平成一排 chip。
 *
 * 与页头 `BackgroundTasksIndicator` 的分工：这里是常驻可见的"还有几件活在跑"，
 * 一眼就能看到并就地取消/查看；页头那个是点开的详情面板（带进度文案）。
 *
 * 三个来源聚合在一处：简历生成（`utils/backgroundTasks`）、批量匹配
 * （`utils/jobMatchBackgroundTasks`）、岗位解读（`features/jobs/jobAnalysisStore`）。
 * 没有任务时**完全不渲染**——留一条空横条只会白占视口。
 */
import { CloseCircleOutlined, LoadingOutlined } from "@ant-design/icons";
import { App, Button, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBackgroundTasks } from "../hooks/useBackgroundTasks";
import { useJobMatchBackgroundTasks } from "../hooks/useJobMatchBackgroundTasks";
import {
  cancelJobAnalysis,
  useRunningJobAnalyses,
  type JobAnalysisEntry,
} from "../features/jobs/jobAnalysisStore";
import { cancelBackgroundTask, type BackgroundTask } from "../utils/backgroundTasks";
import {
  cancelJobMatchBackgroundTask,
  type JobMatchBackgroundTaskView,
} from "../utils/jobMatchBackgroundTasks";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

/** 任务条自身的每秒心跳：chip 上的「已运行 N 秒」靠它推进。 */
function useSecondTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function elapsedSeconds(startedAt: number | undefined, now: number): number {
  if (startedAt === undefined) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

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
  const resumeTasks = useBackgroundTasks();
  const matchTasks = useJobMatchBackgroundTasks();
  const analyses = useRunningJobAnalyses();
  const [cancelling, setCancelling] = useState<string | null>(null);
  const busy = cancelling !== null;
  const now = useSecondTick(analyses.length > 0 || resumeTasks.length > 0 || matchTasks.length > 0);

  if (resumeTasks.length === 0 && matchTasks.length === 0 && analyses.length === 0) return null;

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
    setCancelling(String(task.id));
    try {
      await cancelBackgroundTask(task.id);
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
      {analyses.map((entry: JobAnalysisEntry) => {
        const label = [
          t("backgroundTasks.jobAnalysis.label"),
          entry.state.company,
          entry.state.title,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <TaskChip
            key={`analysis-${entry.jobId}`}
            label={label}
            meta={t("backgroundTasks.bar.elapsed", {
              seconds: elapsedSeconds(entry.state.startedAt, now),
            })}
            busy={busy}
            onView={() => navigate(`/jobs?job_id=${entry.jobId}&analysis=1`)}
            onCancel={() => cancelJobAnalysis(entry.jobId)}
          />
        );
      })}
      {resumeTasks.map((task) => (
        <TaskChip
          key={`resume-${task.id}`}
          label={task.label}
          meta={task.message || t("backgroundTasks.bar.generating")}
          busy={busy}
          onView={() => navigate("/resumes")}
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
