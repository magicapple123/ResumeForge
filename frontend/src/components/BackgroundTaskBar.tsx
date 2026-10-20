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
            查看
          </Button>
        )}
        {onCancel && (
          <Button
            size="small"
            type="text"
            danger
            icon={<CloseCircleOutlined />}
            aria-label={`取消${label}`}
            onClick={onCancel}
            disabled={busy}
          />
        )}
      </Space>
    </Tag>
  );
}

export default function BackgroundTaskBar() {
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
      message.info(`已请求取消「${task.label}」`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "取消失败，请稍后重试");
    } finally {
      setCancelling(null);
    }
  };

  const cancelResume = async (task: BackgroundTask) => {
    if (busy) return;
    setCancelling(String(task.id));
    try {
      await cancelBackgroundTask(task.id);
      message.info(`已取消「${task.label}」`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "取消失败，请稍后重试");
    } finally {
      setCancelling(null);
    }
  };

  return (
    <div className="background-task-bar" role="status" aria-label="正在进行的任务">
      <Typography.Text type="secondary" className="background-task-bar-title">
        正在进行
      </Typography.Text>
      {analyses.map((entry: JobAnalysisEntry) => {
        const label = ["岗位解读", entry.state.company, entry.state.title]
          .filter(Boolean)
          .join(" · ");
        return (
          <TaskChip
            key={`analysis-${entry.jobId}`}
            label={label}
            meta={`已运行 ${elapsedSeconds(entry.state.startedAt, now)} 秒`}
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
          meta={task.message || "生成中…"}
          busy={busy}
          onView={() => navigate("/resumes")}
          onCancel={() => void cancelResume(task)}
        />
      ))}
      {matchTasks.map((task) => (
        <TaskChip
          key={`match-${task.id}`}
          label={task.label}
          meta={`已处理 ${task.completedCount + task.failedCount}/${task.requestedCount} 个岗位`}
          busy={busy}
          onView={() => navigate("/jobs?match_batch=history")}
          onCancel={() => void cancelJobMatch(task)}
        />
      ))}
    </div>
  );
}
