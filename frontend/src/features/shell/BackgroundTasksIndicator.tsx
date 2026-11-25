// SPDX-License-Identifier: Apache-2.0
/**
 * 页头的「后台任务」入口：正在跑的生成任务 + 进度 + 取消。
 *
 * 为什么需要它：用户点「后台继续」把弹窗关掉之后，界面里就再也没有任何地方能看到
 * "刚才那个生成跑到哪了"——他只能猜。这一块把那件事说清楚：还有几个任务在跑、分别
 * 是什么、进度如何，以及**取消**。
 *
 * 数据来自 `utils/backgroundTasks`（模块级登记表，关掉弹窗也照跑），所以它天然对
 * "换个页面"免疫：任务由登记表追踪，不是由某个组件的生命周期持有。
 */
import {
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import { App, Badge, Button, Popover, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import { reportBadgePart } from "../../utils/desktopBadge";
import { useNavigate } from "react-router-dom";
import { listAgentTasks } from "../../api/agentTasks";
import { useBackgroundTasks } from "../../hooks/useBackgroundTasks";
import { useJobMatchBackgroundTasks } from "../../hooks/useJobMatchBackgroundTasks";
import {
  cancelJobAnalysis,
  useRunningJobAnalyses,
  type JobAnalysisEntry,
} from "../jobs/jobAnalysisStore";
import {
  cancelBackgroundTask,
  dismissBackgroundTask,
  type BackgroundTask,
} from "../../utils/backgroundTasks";
import {
  cancelJobMatchBackgroundTask,
  type JobMatchBackgroundTaskView,
} from "../../utils/jobMatchBackgroundTasks";
import { startVisibilityPolling } from "../../utils/visibility";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** 助手任务的待确认/进行中轮询：与铃铛同一档（可见 30s / 隐藏 120s）。 */
const AGENT_POLL_VISIBLE_MS = 30_000;
const AGENT_POLL_HIDDEN_MS = 120_000;

/** 一行任务：名称、进度、取消。状态未知时给出「移除」而不是「取消」——后端都不认识
 * 这个任务了，再发取消请求只会再吃一个 404。 */
function TaskRow({
  task,
  onCancel,
  onDismiss,
}: {
  task: BackgroundTask;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  useLocale();
  if (task.unknown) {
    return (
      <div className="background-task-row">
        <Space size={8} align="start">
          <QuestionCircleOutlined />
          <div>
            <Typography.Text strong className="background-task-label">
              {task.label}
            </Typography.Text>
            <Typography.Text type="secondary" className="background-task-progress">
              {task.message || t("backgroundTasks.status.unknown")}
            </Typography.Text>
          </div>
        </Space>
        <Button size="small" type="text" icon={<CloseCircleOutlined />} onClick={onDismiss}>
          {t("backgroundTasks.action.remove")}
        </Button>
      </div>
    );
  }
  // 进度文案：有可信百分比就带上（通用 AI 任务），简历生成只报字数（总长未知）。
  const percent =
    task.progressPercent === null
      ? ""
      : t("backgroundTasks.progress.percent", { percent: task.progressPercent });
  const progress = [
    percent,
    task.receivedChars > 0
      ? t("backgroundTasks.progress.received", { count: task.receivedChars })
      : "",
    task.message,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="background-task-row">
      <Space size={8} align="start">
        <LoadingOutlined className="background-task-spin" />
        <div>
          <Typography.Text strong className="background-task-label">
            {task.label}
          </Typography.Text>
          <Typography.Text type="secondary" className="background-task-progress">
            {progress || t("backgroundTasks.status.preparing")}
          </Typography.Text>
        </div>
      </Space>
      <Button size="small" danger type="text" icon={<CloseCircleOutlined />} onClick={onCancel}>
        {t("backgroundTasks.action.cancel")}
      </Button>
    </div>
  );
}

function JobMatchTaskRow({
  task,
  onCancel,
}: {
  task: JobMatchBackgroundTaskView;
  onCancel: () => void;
}) {
  useLocale();
  const progress = [
    t("backgroundTasks.progress.processed", {
      done: task.completedCount + task.failedCount,
      total: task.requestedCount,
    }),
    task.currentJobTitle
      ? t("backgroundTasks.progress.currentJob", { title: task.currentJobTitle })
      : task.message,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="background-task-row">
      <Space size={8} align="start">
        <LoadingOutlined className="background-task-spin" />
        <div>
          <Typography.Text strong className="background-task-label">
            {task.label}
          </Typography.Text>
          <Typography.Text type="secondary" className="background-task-progress">
            {progress || t("backgroundTasks.status.preparing")}
          </Typography.Text>
        </div>
      </Space>
      <Button size="small" danger type="text" icon={<CloseCircleOutlined />} onClick={onCancel}>
        {t("backgroundTasks.action.cancel")}
      </Button>
    </div>
  );
}

/** 岗位解读：状态在模块级 store 里（可真取消），这里只负责显示与取消入口。 */
function JobAnalysisTaskRow({
  entry,
  onCancel,
}: {
  entry: JobAnalysisEntry;
  onCancel: () => void;
}) {
  useLocale();
  const label = [t("backgroundTasks.jobAnalysis.label"), entry.state.company, entry.state.title]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="background-task-row">
      <Space size={8} align="start">
        <LoadingOutlined className="background-task-spin" />
        <div>
          <Typography.Text strong className="background-task-label">
            {label}
          </Typography.Text>
          <Typography.Text type="secondary" className="background-task-progress">
            {t("backgroundTasks.jobAnalysis.running")}
          </Typography.Text>
        </div>
      </Space>
      <Button size="small" danger type="text" icon={<CloseCircleOutlined />} onClick={onCancel}>
        {t("backgroundTasks.action.cancel")}
      </Button>
    </div>
  );
}

export default function BackgroundTasksIndicator() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这块文案不重渲染。
  useLocale();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const tasks = useBackgroundTasks();
  const matchTasks = useJobMatchBackgroundTasks();
  // 第三源（T1）：岗位解读。此前它只活在弹窗里，关掉弹窗就彻底看不见了。
  const analyses = useRunningJobAnalyses();
  const [cancelling, setCancelling] = useState<number | string | null>(null);
  // CR-29：这个按钮的角标 = 运行中 + 待确认。助手任务的状态在服务端，按可见性轮询。
  const [agentRunning, setAgentRunning] = useState(0);
  const [waitingApprovals, setWaitingApprovals] = useState(0);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const list = await listAgentTasks();
        if (!alive) return;
        setAgentRunning(list.filter((task) => task.status === "running").length);
        setWaitingApprovals(list.filter((task) => task.status === "waiting_approval").length);
      } catch {
        /* 角标读不到就不亮：与铃铛同一口径，不能把页头拖成错误态。 */
      }
    };
    void Promise.resolve().then(refresh);
    const stop = startVisibilityPolling({
      visibleIntervalMs: AGENT_POLL_VISIBLE_MS,
      hiddenIntervalMs: AGENT_POLL_HIDDEN_MS,
      onTick: refresh,
    });
    return () => {
      alive = false;
      stop();
    };
  }, []);

  const total =
    tasks.length + matchTasks.length + analyses.length + agentRunning + waitingApprovals;

  // 桌面壳角标只取"等你的"那一份：待确认任务数（运行中的不需要用户动手）。
  // 必须放在下面的 `total === 0` 早退之前——hooks 不能有条件执行。
  useEffect(() => {
    reportBadgePart("pending", waitingApprovals);
  }, [waitingApprovals]);

  if (total === 0) return null;

  const cancel = async (task: BackgroundTask) => {
    if (cancelling !== null) return;
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

  const cancelMatchTask = async (task: JobMatchBackgroundTaskView) => {
    if (cancelling !== null) return;
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

  // 没有任务时整个入口不渲染（上面已经 return null），所以这里不必再写空态分支。
  const content = (
    <div className="background-tasks-panel">
      {/* CR-29：待确认不是"还在跑"，但用户需要从这里一步去到它；与铃铛的未读分成两个数。 */}
      {waitingApprovals > 0 && (
        <div className="background-task-row background-task-waiting">
          <Space size={8} align="start">
            <ExclamationCircleOutlined />
            <Typography.Text strong>
              {t("notificationsSettings.waiting.badge", { count: waitingApprovals })}
            </Typography.Text>
          </Space>
          <Button size="small" type="link" onClick={() => navigate("/")}>
            {t("notificationsSettings.waiting.action")}
          </Button>
        </div>
      )}
      {tasks.map((task) => (
        <TaskRow
          key={task.key}
          task={task}
          onCancel={() => void cancel(task)}
          onDismiss={() => {
            dismissBackgroundTask(task.key);
            message.info(t("backgroundTasks.toast.dismissed", { name: task.label }));
          }}
        />
      ))}
      {matchTasks.map((task) => (
        <JobMatchTaskRow key={task.id} task={task} onCancel={() => void cancelMatchTask(task)} />
      ))}
      {analyses.map((entry) => (
        <JobAnalysisTaskRow
          key={`analysis-${entry.jobId}`}
          entry={entry}
          onCancel={() => {
            cancelJobAnalysis(entry.jobId);
            message.info(t("backgroundTasks.toast.jobAnalysisCancelled"));
          }}
        />
      ))}
      <Typography.Text type="secondary" className="background-tasks-hint">
        {t("backgroundTasks.hint.keepsRunning")}
      </Typography.Text>
    </div>
  );

  return (
    <Popover
      content={content}
      title={t("backgroundTasks.popover.title")}
      trigger="click"
      placement="bottomRight"
    >
      <Button
        className="background-tasks-button"
        type="text"
        aria-label={t("backgroundTasks.aria.viewTasks")}
      >
        <Badge count={total} size="small" offset={[2, -2]}>
          <LoadingOutlined /> {t("backgroundTasks.label")}
        </Badge>
      </Button>
    </Popover>
  );
}
