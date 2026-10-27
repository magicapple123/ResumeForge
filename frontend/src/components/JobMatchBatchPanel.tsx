// SPDX-License-Identifier: Apache-2.0
/** 岗位广场批量适配度分析：设置 → 进行中（后台任务进度）→ 结果，与历史回看。
 *
 * 分析**一律走后台任务**（`startJobMatchBatchTask`）：同步批量端点要等全部岗位
 * 分析完才返回，多岗位必然撞前端请求超时预算（"请求超时，请重试"就是这么来的）。
 * 走任务后，关掉面板/切到别的页面任务照跑（完成时全局通知），再次打开面板会
 * 自动回到进行中视图——这就是"切页自动转后台"的机制。
 */
import { HistoryOutlined, ReloadOutlined, RobotOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Listy,
  Modal,
  Progress,
  Space,
  Tabs,
  Typography,
} from "antd";
import EmptyState from "./common/EmptyState";
import PageSkeleton from "./common/PageSkeleton";
import LoadingBlock from "./common/LoadingBlock";
import { ListyItem, ListyMeta } from "./common/ListyItem";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BatchResultView } from "./jobs/JobMatchBatchResult";
import {
  getJobMatchBatch,
  getJobMatchBatchTask,
  listJobMatchBatches,
  startJobMatchBatchTask,
} from "../api/jobs";
import type { JobMatchBatchOut, JobMatchBatchSummary } from "../types";
import {
  cancelJobMatchBackgroundTask,
  watchJobMatchBatchTask,
} from "../utils/jobMatchBackgroundTasks";
import { useJobMatchBackgroundTasks } from "../hooks/useJobMatchBackgroundTasks";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

interface JobMatchBatchPanelProps {
  open: boolean;
  jobIds: number[];
  /** 打开时先看哪个页签：筛选条「AI 分析适配度」进设置，「分析记录」进历史。 */
  initialView?: "setup" | "history";
  onClose: () => void;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function JobMatchBatchPanel({
  open,
  jobIds,
  initialView = "setup",
  onClose,
}: JobMatchBatchPanelProps) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后面板文案不重渲染。
  useLocale();
  const { message } = App.useApp();
  // 后台任务注册表（useSyncExternalStore）：面板开着时实时跟随进度；关掉面板
  // 任务照跑，完成时全局通知——"切页自动转后台"靠的就是任务在服务端、不在组件里。
  const backgroundTasks = useJobMatchBackgroundTasks();
  const activeTask =
    backgroundTasks.find((task) => task.status === "pending" || task.status === "running") ?? null;

  const [phase, setPhase] = useState<"setup" | "running" | "result" | "history">(
    initialView === "history" ? "history" : "setup",
  );
  /** 面板自己跟踪的后台任务 id：完成/取消的判定靠它轮询任务端点，不依赖注册表
   *  （注册表在任务进入终态的瞬间就会把它移除，靠订阅会错过"完成"这一刻）。 */
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [force, setForce] = useState(false);
  const [batch, setBatch] = useState<JobMatchBatchOut | null>(null);
  const [history, setHistory] = useState<JobMatchBatchSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  /** 历史「查看结果」的独立弹卡：不再把整个面板切到"本次结果"页签。 */
  const [historyBatch, setHistoryBatch] = useState<JobMatchBatchOut | null>(null);
  const [historyBatchLoading, setHistoryBatchLoading] = useState(false);

  const jobIdsKey = jobIds.join(",");

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      setHistory(await listJobMatchBatches());
    } catch (requestError) {
      message.error(
        requestError instanceof Error
          ? requestError.message
          : t("jobMatchBatch.error.loadHistoryFailed"),
      );
    } finally {
      setHistoryLoading(false);
    }
  }, [message]);

  // 打开面板：重置到目标页签 + 拉历史；有进行中的后台任务则回到进度视图
  // （跨页回来的"自动接上"），并把任务 id 交给面板自己的轮询。
  const [prevOpenKey, setPrevOpenKey] = useState<string | null>(null);
  if (prevOpenKey !== `${open}-${initialView}-${jobIdsKey}`) {
    setPrevOpenKey(`${open}-${initialView}-${jobIdsKey}`);
    if (open) {
      if (activeTask) {
        setRunningTaskId(activeTask.id);
        setPhase("running");
      } else {
        setRunningTaskId(null);
        setPhase(initialView === "history" ? "history" : "setup");
      }
      setBatch(null);
      setError("");
      setForce(false);
    }
  }

  // 打开面板就拉一次历史（历史页签与「转入后台」后回看都靠它）。loadHistory 内部的
  // setState 都是异步完成回调，规则的调用图追踪仍会标记——按"派生事件"书面理由豁免。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    void loadHistory();
  }, [loadHistory, open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 面板自轮询任务状态（注册表只负责进度展示，完成判定在这里——它在任务进入
  // 终态时就把任务移除了，靠它会在"完成的一瞬间"丢失事件）。
  useEffect(() => {
    if (!open || phase !== "running" || !runningTaskId) return;
    let cancelled = false;
    const check = async () => {
      let latest: Awaited<ReturnType<typeof getJobMatchBatchTask>> | undefined;
      try {
        latest = await getJobMatchBatchTask(runningTaskId);
      } catch {
        return; // 后端短暂不可用：下一轮继续，进度展示由注册表兜底。
      }
      if (cancelled || !latest) return;
      if (latest.status === "completed" && latest.batch_id) {
        try {
          const result = await getJobMatchBatch(latest.batch_id);
          if (!cancelled) {
            setBatch(result);
            setPhase("result");
            setRunningTaskId(null);
            void loadHistory();
          }
        } catch (requestError) {
          if (!cancelled) {
            message.error(
              requestError instanceof Error
                ? requestError.message
                : t("jobMatchBatch.error.loadResultFailed"),
            );
            setPhase("setup");
            setRunningTaskId(null);
          }
        }
      } else if (latest.status === "cancelled" || latest.status === "failed") {
        setPhase("setup");
        setRunningTaskId(null);
      }
    };
    const timer = window.setInterval(() => void check(), 1500);
    void check();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadHistory, message, open, phase, runningTaskId]);

  /* eslint-disable react-hooks/preserve-manual-memoization --
     误报：加了 useLocale()（语言订阅）之后，React Compiler 把 useState 的稳定 setter
     也算进依赖推断，于是与人工核对的依赖数组对不上。本回调的依赖就是 jobIds /
     loadHistory / message 这三个，setter 恒稳不需要列。 */
  const startAnalysis = useCallback(
    async (overrideForce: boolean) => {
      if (jobIds.length === 0) {
        message.warning(t("jobMatchBatch.toast.needJobs"));
        return;
      }
      setStarting(true);
      setError("");
      try {
        const task = await startJobMatchBatchTask({ job_ids: jobIds, force: overrideForce });
        watchJobMatchBatchTask(task, t("jobMatchBatch.task.title", { count: jobIds.length }));
        setRunningTaskId(task.task_id);
        setPhase("running");
        void loadHistory();
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : t("jobMatchBatch.error.createFailed"),
        );
      } finally {
        setStarting(false);
      }
    },
    [jobIds, loadHistory, message],
  );
  /* eslint-enable react-hooks/preserve-manual-memoization */

  const cancelRunning = async () => {
    if (!activeTask || cancelling) return;
    setCancelling(true);
    try {
      await cancelJobMatchBackgroundTask(activeTask.id);
      setRunningTaskId(null);
      setPhase("setup");
      message.success(t("jobMatchBatch.toast.cancelled"));
    } catch (requestError) {
      message.error(
        requestError instanceof Error
          ? requestError.message
          : t("jobMatchBatch.error.cancelFailed"),
      );
    } finally {
      setCancelling(false);
    }
  };

  const openHistoryBatch = async (id: number) => {
    setHistoryBatchLoading(true);
    try {
      setHistoryBatch(await getJobMatchBatch(id));
    } catch (requestError) {
      message.error(
        requestError instanceof Error
          ? requestError.message
          : t("jobMatchBatch.error.loadHistoryFailed"),
      );
    } finally {
      setHistoryBatchLoading(false);
    }
  };

  const runningContent = activeTask ? (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        title={t("jobMatchBatch.running.title")}
        description={t("jobMatchBatch.running.body")}
      />
      <div style={{ textAlign: "center" }}>
        <Progress
          type="circle"
          percent={
            activeTask.requestedCount > 0
              ? Math.round(
                  ((activeTask.completedCount + activeTask.failedCount) /
                    activeTask.requestedCount) *
                    100,
                )
              : 0
          }
          size={96}
        />
        <div style={{ marginTop: 8 }}>
          <Typography.Text strong>
            {t("jobMatchBatch.running.progress", {
              done: activeTask.completedCount + activeTask.failedCount,
              total: activeTask.requestedCount,
            })}
          </Typography.Text>
          {activeTask.failedCount > 0 ? (
            <Typography.Text type="secondary">
              {t("jobMatchBatch.running.failed", { count: activeTask.failedCount })}
            </Typography.Text>
          ) : null}
        </div>
        {activeTask.currentJobTitle ? (
          <Typography.Text type="secondary">
            {t("jobMatchBatch.running.current", { title: activeTask.currentJobTitle })}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">{t("jobMatchBatch.running.waiting")}</Typography.Text>
        )}
      </div>
      <Space wrap style={{ justifyContent: "center", width: "100%" }}>
        <Button danger loading={cancelling} onClick={() => void cancelRunning()}>
          {t("jobMatchBatch.action.cancel")}
        </Button>
        <Button onClick={onClose}>{t("jobMatchBatch.action.background")}</Button>
      </Space>
    </Space>
  ) : (
    <LoadingBlock />
  );

  const setupContent = (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        title={t("jobMatchBatch.setup.title", { count: jobIds.length })}
        description={t("jobMatchBatch.setup.body")}
      />
      <Checkbox checked={force} onChange={(event) => setForce(event.target.checked)}>
        {t("jobMatchBatch.setup.force")}
      </Checkbox>
    </Space>
  );

  const historyContent = historyLoading ? (
    <LoadingBlock />
  ) : history.length === 0 ? (
    <EmptyState inline description={t("jobMatchBatch.history.empty")} />
  ) : (
    <Listy
      items={history}
      rowKey={(item) => item.id}
      itemRender={(item) => (
        <ListyItem
          actions={[
            <Button key="view" type="link" onClick={() => void openHistoryBatch(item.id)}>
              {t("jobMatchBatch.action.viewResult")}
            </Button>,
          ]}
        >
          <ListyMeta
            title={t("jobMatchBatch.history.batchTitle", {
              id: item.id,
              time: formatTime(item.created_at),
            })}
            description={t(
              item.top_score === null
                ? "jobMatchBatch.history.summary"
                : "jobMatchBatch.history.summaryWithScore",
              {
                requested: item.requested_count,
                completed: item.completed_count,
                failed: item.failed_count,
                score: item.top_score ?? "",
              },
            )}
          />
        </ListyItem>
      )}
    />
  );

  // 只分两种：有 batch 就渲染结果，没有就先给骨架屏（第三个分支永远不可达——
  // `!batch` 已经截住所有空值，写出来只会让人以为存在"无结果但有值"的中间态）。
  const resultContent: ReactNode = batch ? (
    <BatchResultView batch={batch} />
  ) : (
    <PageSkeleton rows={8} />
  );

  const phaseContent =
    phase === "running"
      ? runningContent
      : phase === "result"
        ? resultContent
        : phase === "history"
          ? historyContent
          : setupContent;

  return (
    <>
      <Modal
        open={open}
        title={
          <Space>
            <RobotOutlined />
            {t("jobMatchBatch.title")}
          </Space>
        }
        width={900}
        // 批量结果逐岗位输出：限高让超长内容只滚弹窗内部；全局 flex+margin:auto
        // 让弹窗垂直居中，底部「关闭」不再抵住视口下缘。
        styles={{
          body: {
            maxHeight: "var(--rf-modal-body-max-h)",
            overflowY: "auto",
            overflowX: "hidden",
          },
        }}
        onCancel={onClose}
        // 底部只留"这一阶段要做的事"，不再放「关闭」：退出统一走右上角 ×／Esc／点遮罩，
        // 三者最终都映射到同一个 onClose（Modal 的默认行为），所以不存在"没有出口"。
        // running / history 阶段没有底部动作，footer 直接不渲染（否则会留一条空底栏）。
        footer={
          phase === "setup" ? (
            <Space>
              <Button
                type="primary"
                icon={<RobotOutlined />}
                loading={starting}
                onClick={() => void startAnalysis(force)}
              >
                {t("jobMatchBatch.action.start")}
              </Button>
            </Space>
          ) : phase === "result" && batch && jobIds.length > 0 ? (
            <Space>
              <Button
                icon={<ReloadOutlined />}
                loading={starting}
                onClick={() => void startAnalysis(true)}
              >
                {t("jobMatchBatch.action.restart")}
              </Button>
            </Space>
          ) : null
        }
      >
        {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} /> : null}
        <Tabs
          activeKey={phase === "history" ? "history" : "analysis"}
          onChange={(key) => {
            if (activeTask && key === "history") {
              // 进行中允许看历史，但回到分析页签要回到进度视图而不是 setup。
              setPhase("history");
              return;
            }
            setPhase(key === "history" ? "history" : activeTask ? "running" : "setup");
          }}
          items={[
            {
              key: "analysis",
              label: (
                <Space size={4}>
                  <RobotOutlined />
                  {phase === "running"
                    ? t("jobMatchBatch.tab.running")
                    : phase === "result"
                      ? t("jobMatchBatch.tab.result")
                      : t("jobMatchBatch.tab.setup")}
                </Space>
              ),
              children: phaseContent,
            },
            {
              key: "history",
              label: (
                <Space size={4}>
                  <HistoryOutlined />
                  {t("jobMatchBatch.tab.history")}
                </Space>
              ),
              children: historyContent,
            },
          ]}
        />
        {phase === "setup" && jobIdsKey ? (
          <Typography.Text type="secondary">
            {t("jobMatchBatch.setup.selected", { count: jobIds.length })}
          </Typography.Text>
        ) : null}
      </Modal>
      {/* 历史结果弹卡：查看某一批的完整结果，不占用面板本身的"本次结果"页签。 */}
      <Modal
        open={historyBatch !== null || historyBatchLoading}
        title={
          historyBatch
            ? t("jobMatchBatch.detail.title", { id: historyBatch.id })
            : t("jobMatchBatch.detail.loading")
        }
        width={900}
        confirmLoading={historyBatchLoading}
        onCancel={() => setHistoryBatch(null)}
        footer={
          // 保留：这张弹卡自带「关闭」是有意设计（JobMatchBatchPanel.test.tsx 断言
          // "此刻页面上只有弹卡这一颗关闭按钮"）；删除需先改测试，并确认只用 × 的可用性。
          <Button onClick={() => setHistoryBatch(null)}>{t("common.action.close")}</Button>
        }
        styles={{
          body: {
            maxHeight: "var(--rf-modal-body-max-h)",
            overflowY: "auto",
            overflowX: "hidden",
          },
        }}
      >
        {historyBatch ? <BatchResultView batch={historyBatch} /> : <PageSkeleton rows={6} />}
      </Modal>
    </>
  );
}
