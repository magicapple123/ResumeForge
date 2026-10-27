// SPDX-License-Identifier: Apache-2.0
/** 按需生成岗位需求总结和通用求职建议（T1：可真取消 / 后台继续 / 订阅模块级状态）。 */
import { BulbOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, App, Button, Listy, Modal, Popconfirm, Space, Tag, Typography } from "antd";
import EmptyState from "./common/EmptyState";
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
import { t } from "../i18n";
import type { MessageKey } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

interface Props {
  job: Job | null;
  onClose: () => void;
}

/** 优先级 → 显示名（labelKey）+ Tag 颜色；显示名在使用处 `t()`，颜色与语言无关。 */
const PRIORITY_META: Record<JobAnalysisPriority, { labelKey: MessageKey; color: string }> = {
  high: { labelKey: "jobAnalysis.priority.high", color: "red" },
  medium: { labelKey: "jobAnalysis.priority.medium", color: "orange" },
  low: { labelKey: "jobAnalysis.priority.low", color: "blue" },
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
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后弹窗文案不重渲染。
  useLocale();
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
    message.info(t("jobAnalysis.toast.cancelled"), 6);
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
          {t("jobAnalysis.title")}
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
          <Button
            aria-label={t("jobAnalysis.action.regenerateAnalysis")}
            icon={<ReloadOutlined />}
            onClick={() => start(false)}
          >
            {t("jobAnalysis.action.regenerateAnalysis")}
          </Button>
        </Space>
      ) : running ? (
        <div>
          <PageSkeleton rows={8} card={false} />
          <Typography.Paragraph type="secondary" className="job-analysis-elapsed">
            {t("jobAnalysis.elapsed", { seconds: elapsedSeconds })}
          </Typography.Paragraph>
          {/* 两条出路说明白：取消 = 白跑一次（结果不保存）；后台继续 = 结果会留下。 */}
          <Alert
            type="info"
            showIcon
            title={t("jobAnalysis.running.title")}
            description={t("jobAnalysis.running.body")}
          />
          <div className="job-analysis-actions">
            <Space>
              <Button aria-label={t("jobAnalysis.aria.cancel")} onClick={cancel}>
                {t("common.action.cancel")}
              </Button>
              <Button onClick={continueInBackground}>
                {t("jobAnalysis.action.continueInBackground")}
              </Button>
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
              title={t("jobAnalysis.stale.title")}
              description={
                generatedAt
                  ? t("jobAnalysis.stale.body", {
                      time: new Date(generatedAt).toLocaleString(),
                    })
                  : t("jobAnalysis.stale.bodyNoTime")
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
                title={t("jobAnalysis.confirm.regenerate.title")}
                description={t("jobAnalysis.confirm.regenerate.body")}
                okText={t("jobAnalysis.action.regenerate")}
                cancelText={t("common.action.cancel")}
                onConfirm={() => start(true)}
              >
                <Button
                  type="link"
                  size="small"
                  aria-label={t("jobAnalysis.action.regenerate")}
                  icon={<ReloadOutlined />}
                >
                  {t("jobAnalysis.action.regenerate")}
                </Button>
              </Popconfirm>
            </Space>
            <Typography.Paragraph>{data.summary}</Typography.Paragraph>
          </div>

          <Typography.Title level={5}>{t("jobAnalysis.section.requirements")}</Typography.Title>
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
                        <Tag color={priority.color}>{t(priority.labelKey)}</Tag>
                        {item.category && <Tag>{item.category}</Tag>}
                      </Space>
                      <Typography.Text strong>{item.requirement}</Typography.Text>
                      {item.evidence && (
                        <Typography.Text type="secondary">
                          {t("jobAnalysis.item.evidence", { value: item.evidence })}
                        </Typography.Text>
                      )}
                    </Space>
                  </ListyItem>
                );
              }}
            />
          ) : (
            <EmptyState inline description={t("jobAnalysis.empty.requirements")} />
          )}

          <Typography.Title level={5}>{t("jobAnalysis.section.advice")}</Typography.Title>
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
                      <Typography.Text type="secondary">
                        {t("jobAnalysis.item.rationale", { value: item.rationale })}
                      </Typography.Text>
                    )}
                  </Space>
                </ListyItem>
              )}
            />
          ) : (
            <EmptyState inline description={t("jobAnalysis.empty.advice")} />
          )}
        </div>
      ) : (
        // 首次打开：先讲清楚这一步在做什么，再让用户决定何时开始。
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Alert type="info" showIcon title={t("jobAnalysis.firstRun.title")} />
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {t("jobAnalysis.firstRun.body")}
          </Typography.Paragraph>
          <div>
            <Button type="primary" icon={<BulbOutlined />} onClick={() => start(false)}>
              {t("jobAnalysis.action.start")}
            </Button>
          </div>
        </Space>
      )}
    </Modal>
  );
}
