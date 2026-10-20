/** 按需生成岗位需求总结和通用求职建议（T1：可真取消 / 后台继续 / 订阅模块级状态）。 */
import { BulbOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, App, Button, Empty, Listy, Modal, Popconfirm, Space, Tag, Typography } from "antd";
import PageSkeleton from "./common/PageSkeleton";
import { ListyItem } from "./common/ListyItem";
import { useEffect, useRef, useState } from "react";
import { getJobAnalysis } from "../api/jobs";
import {
  attachJobAnalysis,
  cancelJobAnalysis,
  detachJobAnalysis,
  startJobAnalysis,
  useJobAnalysis,
} from "../features/jobs/jobAnalysisStore";
import type { Job, JobAnalysisPriority, JobAnalysisResult } from "../types";

interface Props {
  job: Job | null;
  onClose: () => void;
}

const PRIORITY_META: Record<JobAnalysisPriority, { label: string; color: string }> = {
  high: { label: "核心要求", color: "red" },
  medium: { label: "重要要求", color: "orange" },
  low: { label: "加分项", color: "blue" },
};

/** 服务端缓存里读到的那一份（只作为"没有新结果时"的展示来源）。 */
interface CachedAnalysis {
  data: JobAnalysisResult;
  generatedAt: string | null;
  stale: boolean;
}

/**
 * 「已生成 N 秒」：长任务最难熬的是不知道还要多久。每秒刷新一次，卸载即清定时器
 * （不清的话弹窗关掉之后还会往已卸载的组件 setState）。
 */
function useElapsedSeconds(startedAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === undefined) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  if (startedAt === undefined) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

export default function JobAnalysisModal({ job, onClose }: Props) {
  const { message } = App.useApp();
  const jobId = job?.id ?? null;
  const state = useJobAnalysis(jobId);
  // 打开时的服务端缓存：有就直接展示（不调模型），没有才让用户点「开始生成」。
  const [cached, setCached] = useState<CachedAnalysis | null>(null);
  const lastJobId = useRef<number | null>(null);

  // 换岗位：上一份缓存必须清掉，否则会把另一个岗位的结论当成这个岗位的显示出来。
  useEffect(() => {
    if (!job || lastJobId.current === job.id) return;
    lastJobId.current = job.id;
    setCached(null);
  }, [job]);

  // 有人在看 → 完成时就地回填；离开（卸载 / 换岗位）→ detach，完成时改走统一通知。
  useEffect(() => {
    if (jobId === null) return undefined;
    attachJobAnalysis(jobId);
    return () => detachJobAnalysis(jobId);
  }, [jobId]);

  useEffect(() => {
    if (!job) return undefined;
    let cancelled = false;
    getJobAnalysis(job.id)
      .then((cache) => {
        if (cancelled || !cache.cached || !cache.result) return;
        setCached({
          data: cache.result,
          generatedAt: cache.generated_at,
          stale: cache.stale,
        });
      })
      .catch(() => {
        // 读缓存失败不打扰用户：当作没有缓存，仍可点「开始生成」。
      });
    return () => {
      cancelled = true;
    };
  }, [job]);

  const running = state.status === "running";
  // 新结果优先于缓存：用户刚生成完，看到的不该还是上次那份。
  const data = state.status === "done" ? (state.result ?? null) : (cached?.data ?? null);
  const stale = state.status === "done" ? Boolean(state.stale) : (cached?.stale ?? false);
  const generatedAt =
    state.status === "done" ? (state.generatedAt ?? null) : (cached?.generatedAt ?? null);
  const error = state.status === "error" ? (state.error ?? "") : "";
  const elapsedSeconds = useElapsedSeconds(running ? state.startedAt : undefined);

  const start = (force: boolean) => {
    if (!job) return;
    startJobAnalysis({
      jobId: job.id,
      title: job.title,
      company: job.company,
      force,
    });
  };

  /** 取消 = 真的停掉本次生成，结果不保存（与「后台继续」是两条不同的路）。 */
  const cancel = () => {
    if (!job) return;
    cancelJobAnalysis(job.id);
    message.info("已取消，本次生成结果不会保存", 6);
  };

  /** 后台继续 = 关掉弹窗但不断开连接，完成后弹通知并响一声。 */
  const continueInBackground = () => {
    if (job) detachJobAnalysis(job.id);
    onClose();
  };

  // 右上角 X / Esc：生成期间等价于「后台继续」（别让误关把结果丢掉）。
  const handleClose = () => {
    if (job && running) detachJobAnalysis(job.id);
    onClose();
  };

  return (
    <Modal
      title={
        <Space>
          <BulbOutlined />
          岗位需求解读
        </Space>
      }
      open={!!job}
      onCancel={handleClose}
      footer={null}
      width={760}
      // 解读是 AI 长文：限高让超长内容只滚弹窗内部，卡片整体不出视口。
      styles={{
        body: { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto", overflowX: "hidden" },
      }}
      destroyOnHidden
    >
      {error ? (
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Alert type="error" showIcon title={error} />
          <Button aria-label="重新生成解读" icon={<ReloadOutlined />} onClick={() => start(false)}>
            重新生成解读
          </Button>
        </Space>
      ) : running ? (
        <div>
          <PageSkeleton rows={8} card={false} />
          <Typography.Paragraph type="secondary" className="job-analysis-elapsed">
            已生成 {elapsedSeconds} 秒
          </Typography.Paragraph>
          {/* 两条出路说明白：取消 = 白跑一次（结果不保存）；后台继续 = 结果会留下。 */}
          <Alert
            type="info"
            showIcon
            title="生成期间可以关掉这个弹窗去做别的，完成后会提醒你（弹窗 + 提示音）。"
            description="点「取消」会中断本次生成，结果不会保存。"
          />
          <div className="job-analysis-actions">
            <Space>
              <Button aria-label="取消生成本次解读" onClick={cancel}>
                取消
              </Button>
              <Button onClick={continueInBackground}>后台继续</Button>
            </Space>
          </div>
        </div>
      ) : data ? (
        <div className="job-analysis-content">
          {stale ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              title="岗位内容改过，这份解读可能已过期"
              description={
                generatedAt
                  ? `生成于 ${new Date(generatedAt).toLocaleString()}；重写岗位描述后建议重新生成。`
                  : "重写岗位描述后建议重新生成。"
              }
            />
          ) : null}
          <div className="job-analysis-summary">
            <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
              <Typography.Text strong>
                {job?.company ? `${job.company} · ` : ""}
                {job?.title}
              </Typography.Text>
              {/* 重新生成会覆盖当前这份结果，先问一句再动手。 */}
              <Popconfirm
                title="重新生成岗位解读？"
                description="当前这份解读会被新结果替换。"
                okText="重新生成"
                cancelText="取消"
                onConfirm={() => start(true)}
              >
                <Button type="link" size="small" aria-label="重新生成" icon={<ReloadOutlined />}>
                  重新生成
                </Button>
              </Popconfirm>
            </Space>
            <Typography.Paragraph>{data.summary}</Typography.Paragraph>
          </div>

          <Typography.Title level={5}>核心需求</Typography.Title>
          {data.requirements.length ? (
            <Listy
              items={data.requirements}
              rowKey={(item) => `${item.requirement}|${item.category ?? ""}`}
              itemRender={(item) => {
                const priority = PRIORITY_META[item.priority];
                return (
                  <ListyItem>
                    <Space orientation="vertical" size={5} style={{ width: "100%" }}>
                      <Space wrap>
                        <Tag color={priority.color}>{priority.label}</Tag>
                        {item.category && <Tag>{item.category}</Tag>}
                      </Space>
                      <Typography.Text strong>{item.requirement}</Typography.Text>
                      {item.evidence && (
                        <Typography.Text type="secondary">依据：{item.evidence}</Typography.Text>
                      )}
                    </Space>
                  </ListyItem>
                );
              }}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未提取到明确要求" />
          )}

          <Typography.Title level={5}>求职建议</Typography.Title>
          {data.advice.length ? (
            <Listy
              items={data.advice}
              rowKey={(item) => `${item.title}|${item.action}`}
              itemRender={(item) => (
                <ListyItem>
                  <Space orientation="vertical" size={4}>
                    <Typography.Text strong>{item.title}</Typography.Text>
                    <Typography.Text>{item.action}</Typography.Text>
                    {item.rationale && (
                      <Typography.Text type="secondary">原因：{item.rationale}</Typography.Text>
                    )}
                  </Space>
                </ListyItem>
              )}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无补充建议" />
          )}
        </div>
      ) : (
        // 首次打开：先讲清楚这一步在做什么，再让用户决定何时开始。
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            title="这一步会把岗位描述交给模型，整理出核心要求与求职建议"
          />
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            读取的是这个岗位的标题、公司、岗位描述与你已保存的标签，<strong>不会</strong>
            发送整份简历或个人资料；通常需要 10–60 秒。生成期间可以关掉弹窗去做别的，
            完成后会提醒你。
          </Typography.Paragraph>
          <div>
            <Button type="primary" icon={<BulbOutlined />} onClick={() => start(false)}>
              开始生成
            </Button>
          </div>
        </Space>
      )}
    </Modal>
  );
}
