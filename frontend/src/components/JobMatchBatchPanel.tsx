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
  Empty,
  Listy,
  Modal,
  Progress,
  Space,
  Tabs,
  Typography,
} from "antd";
import PageSkeleton from "./common/PageSkeleton";
import LoadingBlock from "./common/LoadingBlock";
import { ListyItem, ListyMeta } from "./common/ListyItem";
import { useCallback, useEffect, useState } from "react";
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
      message.error(requestError instanceof Error ? requestError.message : "读取匹配记录失败");
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
              requestError instanceof Error ? requestError.message : "读取分析结果失败",
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

  const startAnalysis = useCallback(
    async (overrideForce: boolean) => {
      if (jobIds.length === 0) {
        message.warning("请先选择岗位");
        return;
      }
      setStarting(true);
      setError("");
      try {
        const task = await startJobMatchBatchTask({ job_ids: jobIds, force: overrideForce });
        watchJobMatchBatchTask(task, "岗位适配度分析（" + jobIds.length + " 个岗位）");
        setRunningTaskId(task.task_id);
        setPhase("running");
        void loadHistory();
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "创建分析任务失败");
      } finally {
        setStarting(false);
      }
    },
    [jobIds, loadHistory, message],
  );

  const cancelRunning = async () => {
    if (!activeTask || cancelling) return;
    setCancelling(true);
    try {
      await cancelJobMatchBackgroundTask(activeTask.id);
      setRunningTaskId(null);
      setPhase("setup");
      message.success("已取消本次分析；取消前完成的结果仍已保存");
    } catch (requestError) {
      message.error(requestError instanceof Error ? requestError.message : "取消失败");
    } finally {
      setCancelling(false);
    }
  };

  const openHistoryBatch = async (id: number) => {
    setHistoryBatchLoading(true);
    try {
      setHistoryBatch(await getJobMatchBatch(id));
    } catch (requestError) {
      message.error(requestError instanceof Error ? requestError.message : "读取匹配记录失败");
    } finally {
      setHistoryBatchLoading(false);
    }
  };

  const runningContent = activeTask ? (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        title="正在后台分析，关闭这个窗口也不会中断"
        description="分析在服务端逐个岗位进行；切到其他页面任务会继续，完成时会弹出通知。"
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
            已完成 {activeTask.completedCount + activeTask.failedCount} /{" "}
            {activeTask.requestedCount} 个岗位
          </Typography.Text>
          {activeTask.failedCount > 0 ? (
            <Typography.Text type="secondary">（失败 {activeTask.failedCount}）</Typography.Text>
          ) : null}
        </div>
        {activeTask.currentJobTitle ? (
          <Typography.Text type="secondary">正在分析：{activeTask.currentJobTitle}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">等待后台任务启动…</Typography.Text>
        )}
      </div>
      <Space wrap style={{ justifyContent: "center", width: "100%" }}>
        <Button danger loading={cancelling} onClick={() => void cancelRunning()}>
          取消本次分析
        </Button>
        <Button onClick={onClose}>转入后台，先去忙别的</Button>
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
        title={`将为 ${jobIds.length} 个勾选的岗位逐一分析适配度`}
        description="分析在后台逐个岗位进行：可以随时取消，也可以关掉窗口先去忙别的，完成时会弹出通知；结论不带百分比，参考分仅作展示排序用。"
      />
      <Checkbox checked={force} onChange={(event) => setForce(event.target.checked)}>
        重新分析已有结论的岗位（默认跳过已有适配度结论的岗位）
      </Checkbox>
    </Space>
  );

  const historyContent = historyLoading ? (
    <LoadingBlock />
  ) : history.length === 0 ? (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有批量分析记录" />
  ) : (
    <Listy
      items={history}
      rowKey={(item) => item.id}
      itemRender={(item) => (
        <ListyItem
          actions={[
            <Button key="view" type="link" onClick={() => void openHistoryBatch(item.id)}>
              查看结果
            </Button>,
          ]}
        >
          <ListyMeta
            title={`第 ${item.id} 批 · ${formatTime(item.created_at)}`}
            description={`共 ${item.requested_count} 个岗位，完成 ${item.completed_count} 个，失败 ${item.failed_count} 个${item.top_score === null ? "" : `，最高参考分 ${item.top_score}`}`}
          />
        </ListyItem>
      )}
    />
  );

  const resultContent = !batch ? (
    <PageSkeleton rows={8} />
  ) : batch ? (
    <BatchResultView batch={batch} />
  ) : (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有可展示的结果" />
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
            岗位批量适配度分析
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
        footer={
          <Space>
            <Button onClick={onClose}>关闭</Button>
            {phase === "result" && batch && jobIds.length > 0 ? (
              <Button
                icon={<ReloadOutlined />}
                loading={starting}
                onClick={() => void startAnalysis(true)}
              >
                重新分析这批
              </Button>
            ) : null}
            {phase === "setup" ? (
              <Button
                type="primary"
                icon={<RobotOutlined />}
                loading={starting}
                onClick={() => void startAnalysis(force)}
              >
                开始分析
              </Button>
            ) : null}
          </Space>
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
                  {phase === "running" ? "进行中" : phase === "result" ? "本次结果" : "分析设置"}
                </Space>
              ),
              children: phaseContent,
            },
            {
              key: "history",
              label: (
                <Space size={4}>
                  <HistoryOutlined />
                  历史记录
                </Space>
              ),
              children: historyContent,
            },
          ]}
        />
        {phase === "setup" && jobIdsKey ? (
          <Typography.Text type="secondary">本次选择：{jobIds.length} 个岗位</Typography.Text>
        ) : null}
      </Modal>
      {/* 历史结果弹卡：查看某一批的完整结果，不占用面板本身的"本次结果"页签。 */}
      <Modal
        open={historyBatch !== null || historyBatchLoading}
        title={historyBatch ? `第 ${historyBatch.id} 批分析结果` : "读取分析结果…"}
        width={900}
        confirmLoading={historyBatchLoading}
        onCancel={() => setHistoryBatch(null)}
        footer={<Button onClick={() => setHistoryBatch(null)}>关闭</Button>}
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
