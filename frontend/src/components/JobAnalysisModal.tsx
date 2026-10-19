/** 按需生成岗位需求总结和通用求职建议。 */
import { BulbOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, App, Button, Empty, Listy, Modal, Popconfirm, Space, Tag, Typography } from "antd";
import PageSkeleton from "./common/PageSkeleton";
import { ListyItem } from "./common/ListyItem";
import { announceBackgroundFailure, announceBackgroundResult } from "../utils/backgroundTask";
import { useCallback, useEffect, useRef, useState } from "react";
import { generateJobAnalysis, getJobAnalysis } from "../api/jobs";
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

export default function JobAnalysisModal({ job, onClose }: Props) {
  const { message } = App.useApp();
  const [data, setData] = useState<JobAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasAttempted, setHasAttempted] = useState(false);
  // R2：缓存信息——生成时间与「内容改过」标记。旧结果照常展示，只是提醒可能过期。
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const requestVersion = useRef(0);
  const lastJobId = useRef<number | null>(null);

  useEffect(() => {
    if (!job || lastJobId.current === job.id) return;
    lastJobId.current = job.id;
    requestVersion.current += 1;
    setData(null);
    setError("");
    setLoading(false);
    setHasAttempted(false);
    setStale(false);
    setGeneratedAt(null);
  }, [job]);

  // 打开时先读缓存：有就直接显示（不调模型），没有才让用户点「开始生成」。
  useEffect(() => {
    if (!job) return undefined;
    let cancelled = false;
    getJobAnalysis(job.id)
      .then((cache) => {
        if (cancelled || !cache.cached || !cache.result) return;
        setData(cache.result);
        setGeneratedAt(cache.generated_at);
        setStale(cache.stale);
        setHasAttempted(true);
      })
      .catch(() => {
        // 读缓存失败不打扰用户：当作没有缓存，仍可点「开始生成」。
      });
    return () => {
      cancelled = true;
    };
  }, [job]);

  // 用户在生成过程中关掉了弹窗：请求继续跑，但结果用统一通知告诉他（见 utils/backgroundTask）。
  const leftWhileLoading = useRef(false);

  // R2-b：请求一旦发出就**不主动 abort**。后端只有检测到客户端仍连接时才写缓存；
  // abort 会让这次已经烧掉的 token 白费（下次打开又要重跑）。controller 仍保留，
  // 只是当前没有任何地方调用 `abort()`。
  const abortRef = useRef<AbortController | null>(null);

  // 组件卸载（父级换页/整块销毁）后不再 setState；在途请求照常跑完并落缓存。
  // 挂载时显式置回 true：StrictMode 会「挂载→清理→再挂载」，只在清理里置 false 会让
  // 后续所有提示都被吞掉。
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * 「停止等待」（R2-b 诚实降级）：停止占用用户注意力，但**不断开连接**。
   *
   * 只做三件事：停掉加载动画并清掉错误、关闭弹窗、提示「后台会完成并缓存」。
   * 不 abort 是刻意的——服务端连接不断，本次生成才会写进缓存，下次打开秒读。
   */
  const stopWaiting = () => {
    // 让迟到的结果不再回填到已经关掉的弹窗；请求本身继续跑。
    requestVersion.current += 1;
    if (mounted.current) {
      setLoading(false);
      setError("");
      setHasAttempted(false);
    }
    onClose();
    message.info("已停止等待。后台仍会完成本次生成并缓存，下次打开可直接查看。", 6);
  };

  const load = useCallback(
    async (force = false) => {
      if (!job) return;
      const currentRequest = ++requestVersion.current;
      const controller = new AbortController();
      abortRef.current = controller;
      setHasAttempted(true);
      setLoading(true);
      setError("");
      leftWhileLoading.current = false;
      try {
        // R2-a：普通生成不带 force——后端已有缓存时直接返回，不必重跑模型再付一次钱。
        const result = await generateJobAnalysis(job.id, controller.signal, force);
        if (leftWhileLoading.current) {
          announceBackgroundResult("岗位解读", "回到岗位详情再点「岗位需求解读」即可看到。");
          return;
        }
        if (currentRequest === requestVersion.current) {
          setData(result);
          setStale(false);
          setGeneratedAt(new Date().toISOString());
        }
      } catch (loadError) {
        // 用户主动取消：不是失败，也不该弹「生成失败」。
        if (controller.signal.aborted) {
          if (currentRequest === requestVersion.current) setLoading(false);
          return;
        }
        const detail =
          loadError instanceof Error ? loadError.message : "生成岗位解读失败，请稍后重试";
        if (leftWhileLoading.current) {
          announceBackgroundFailure("岗位解读", detail);
          return;
        }
        if (currentRequest === requestVersion.current) setError(detail);
      } finally {
        if (!leftWhileLoading.current && currentRequest === requestVersion.current)
          setLoading(false);
      }
    },
    [job],
  );

  /** 「重新生成」：唯一会带 `force=true` 的入口——用户明确要求覆盖当前结论。 */
  const regenerate = useCallback(() => {
    void load(true);
  }, [load]);

  // R2：**不**在打开弹窗时自动调模型。先说明「要读什么、大概多久、能不能走开」，
  // 用户点「开始生成」才发请求——此前一打开就转圈，用户既不知道在等什么，也不好取消。

  return (
    <Modal
      title={
        <Space>
          <BulbOutlined />
          岗位需求解读
        </Space>
      }
      open={!!job}
      onCancel={onClose}
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
          <Button aria-label="重新生成解读" icon={<ReloadOutlined />} onClick={() => void load()}>
            重新生成解读
          </Button>
        </Space>
      ) : loading ? (
        <div>
          <PageSkeleton rows={8} card={false} />
          {/* 「后台继续」：请求不会因为关掉弹窗而中断，完成后会弹通知并响一声。
              没有这个按钮时，用户只能干等——而他根本不知道能不能走开。 */}
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 12 }}
            title="生成期间可以关掉这个弹窗去做别的，完成后会提醒你（弹窗 + 提示音）。"
          />
          <div style={{ marginTop: 12, textAlign: "right" }}>
            <Space>
              {/* R2-b：停止等待 ≠ 取消。连接不断，后台跑完会写缓存；下次打开直接读缓存。 */}
              <Button onClick={stopWaiting}>停止等待</Button>
              <Button
                onClick={() => {
                  leftWhileLoading.current = true;
                  onClose();
                }}
              >
                后台继续（关闭弹窗）
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
                onConfirm={regenerate}
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
      ) : !hasAttempted ? (
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
            <Button type="primary" icon={<BulbOutlined />} onClick={() => void load()}>
              开始生成
            </Button>
          </div>
        </Space>
      ) : null}
    </Modal>
  );
}
