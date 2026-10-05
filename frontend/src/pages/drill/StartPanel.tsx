/** 开场面板：选主张、定题数与反馈方式。 */
import { Alert, App, Button, Empty, Modal, Select, Skeleton, Space, Typography } from "antd";
import { ThunderboltOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { createDrillSession } from "../../api/drill";
import { listClaims } from "../../api/claims";
import { listJobs } from "../../api/jobs";
import { useApi } from "../../hooks/useApi";
import type { Claim, DrillSession, FeedbackPolicy } from "../../types";
import { DRILL_QUESTION_OPTIONS, FEEDBACK_LABELS } from "../../types";

export function StartPanel({ onStarted }: { onStarted: (session: DrillSession) => void }) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [claimIds, setClaimIds] = useState<number[]>([]);
  const [jobId, setJobId] = useState<number | null>(null);
  const [maxQuestions, setMaxQuestions] = useState(6);
  const [policy, setPolicy] = useState<FeedbackPolicy>("deferred");
  const [jobOptions, setJobOptions] = useState<{ value: number; label: string }[]>([]);
  const [busy, setBusy] = useState(false);

  // 只有「已确认」的主张能挖——待确认的本来就还没定稿。
  const claims = useApi<Claim[]>(
    () => listClaims({ status: "已确认" }).then((page) => page.items),
    [],
  );

  useEffect(() => {
    if (!open) return;
    void listJobs({ page: 1, page_size: 100 })
      .then((page) =>
        setJobOptions(
          page.items.map((job) => ({
            value: job.id,
            label: `${job.title}${job.company ? ` · ${job.company}` : ""}`,
          })),
        ),
      )
      .catch(() => setJobOptions([]));
  }, [open]);

  const available = claims.data ?? [];

  const start = async () => {
    setBusy(true);
    try {
      const session = await createDrillSession({
        claim_ids: claimIds,
        job_id: jobId,
        max_questions: maxQuestions,
        feedback_policy: policy,
      });
      message.success("评分标准已经定下来，开始吧");
      setOpen(false);
      onStarted(session);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "开场失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => setOpen(true)}>
        开始深挖
      </Button>
      <Modal
        open={open}
        title="按事实台账深挖：先定标准，再提问"
        width={640}
        onCancel={() => setOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="primary" loading={busy} onClick={() => void start()}>
              开始
            </Button>
          </Space>
        }
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            title="每道题的评分标准会在你看到问题**之前**定下来，之后不因答得流利而放宽。"
            description="深挖不评总分——它回答的是「这条主张我讲不讲得清、哪里还站不住」。"
          />
          <div>
            <Typography.Text strong>要验证哪些主张</Typography.Text>
            <Typography.Text type="secondary">（留空表示全部已确认的）</Typography.Text>
            {claims.loading ? (
              <Skeleton active paragraph={{ rows: 2 }} />
            ) : available.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="事实台账里还没有「已确认」的条目。先去「事实台账」确认几条。"
              />
            ) : (
              <Select
                mode="multiple"
                allowClear
                style={{ width: "100%", marginTop: 6 }}
                placeholder="全部已确认的主张"
                value={claimIds}
                onChange={setClaimIds}
                options={available.map((claim) => ({
                  value: claim.id,
                  label: `${claim.title || claim.subject}（${claim.responsibility_level}）`,
                }))}
              />
            )}
          </div>
          <Space size={12} wrap>
            <div>
              <Typography.Text strong>最多几道题</Typography.Text>
              <Select
                style={{ width: 120, marginLeft: 8 }}
                value={maxQuestions}
                onChange={setMaxQuestions}
                options={DRILL_QUESTION_OPTIONS.map((value) => ({ value, label: `${value} 道` }))}
              />
            </div>
            <div>
              <Typography.Text strong>反馈方式</Typography.Text>
              <Select
                style={{ width: 240, marginLeft: 8 }}
                value={policy}
                onChange={setPolicy}
                options={(["deferred", "immediate"] as FeedbackPolicy[]).map((value) => ({
                  value,
                  label: FEEDBACK_LABELS[value],
                }))}
              />
            </div>
          </Space>
          <div>
            <Typography.Text strong>关联岗位</Typography.Text>
            <Typography.Text type="secondary">（可选，用来挑更贴近岗位的问题）</Typography.Text>
            <Select
              allowClear
              style={{ width: "100%", marginTop: 6 }}
              placeholder="不关联"
              value={jobId}
              onChange={setJobId}
              options={jobOptions}
            />
          </div>
        </Space>
      </Modal>
    </>
  );
}
