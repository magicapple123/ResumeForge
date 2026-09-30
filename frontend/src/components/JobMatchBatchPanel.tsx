/** 岗位广场批量适配度分析：运行、排序展示与历史回看。 */
import { HistoryOutlined, ReloadOutlined, RobotOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Collapse,
  Empty,
  List,
  Modal,
  Progress,
  Skeleton,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  generateJobMatchBatch,
  getJobMatchBatch,
  listJobMatchBatches,
  startJobMatchBatchTask,
} from "../api/jobs";
import {
  ADMISSION_META,
  MATCH_STATUS_META,
  type JobMatchBatchItem,
  type JobMatchBatchOut,
  type JobMatchBatchSummary,
  type MatchCondition,
} from "../types";
import { watchJobMatchBatchTask } from "../utils/jobMatchBackgroundTasks";

interface JobMatchBatchPanelProps {
  open: boolean;
  jobIds: number[];
  autoRun: boolean;
  runMode?: "immediate" | "background";
  onClose: () => void;
}

type BatchMatchResult = NonNullable<JobMatchBatchItem["result"]>;

const GROUPS: Array<{
  key: keyof Pick<BatchMatchResult, "hard_conditions" | "core_abilities" | "bonus_items">;
  label: string;
}> = [
  { key: "hard_conditions", label: "硬性条件" },
  { key: "core_abilities", label: "核心能力" },
  { key: "bonus_items", label: "加分项" },
];

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function sourceLabel(source: JobMatchBatchItem["analysis_source"]): string {
  if (source === "existing") return "复用已有分析";
  if (source === "local") return "本地降级";
  return "本次新分析";
}

function ConditionList({ conditions }: { conditions: MatchCondition[] }) {
  if (conditions.length === 0) {
    return <Typography.Text type="secondary">暂无条目</Typography.Text>;
  }
  return (
    <List
      size="small"
      dataSource={conditions}
      renderItem={(condition) => {
        const meta = MATCH_STATUS_META[condition.status];
        return (
          <List.Item>
            <Space direction="vertical" size={2} style={{ width: "100%" }}>
              <Space size={6} wrap>
                <Tag color={meta.color}>{meta.label}</Tag>
                <Typography.Text strong>{condition.label}</Typography.Text>
              </Space>
              {condition.evidence ? (
                <Typography.Text type="secondary">依据：{condition.evidence}</Typography.Text>
              ) : null}
            </Space>
          </List.Item>
        );
      }}
    />
  );
}

function MatchDetail({ item }: { item: JobMatchBatchItem }) {
  const result = item.result;
  if (!result) return null;
  const admission = ADMISSION_META[result.admission];
  return (
    <Space direction="vertical" size="small" style={{ width: "100%" }}>
      <Space wrap>
        <Tag color={admission.color}>准入：{admission.label}</Tag>
        <Tag>
          硬性门槛：
          {result.hard_gate === "met" ? "满足" : result.hard_gate === "unmet" ? "未满足" : "待确认"}
        </Tag>
      </Space>
      {GROUPS.map((group) => (
        <section key={group.key}>
          <Typography.Text strong>{group.label}</Typography.Text>
          <ConditionList conditions={result[group.key] ?? []} />
        </section>
      ))}
      {result.advice ? <Typography.Paragraph>{result.advice}</Typography.Paragraph> : null}
      {result.notes.length > 0 ? (
        <Typography.Text type="secondary">说明：{result.notes.join("；")}</Typography.Text>
      ) : null}
    </Space>
  );
}

function BatchItemCard({ item }: { item: JobMatchBatchItem }) {
  if (item.status === "failed") {
    return (
      <Card size="small" title={`${item.job_title}${item.company ? ` · ${item.company}` : ""}`}>
        <Alert type="error" showIcon message={item.error || "本岗位分析失败"} />
      </Card>
    );
  }

  const score = item.reference_score?.score ?? 0;
  return (
    <Card
      size="small"
      title={
        <Space size={6} wrap>
          <Tag color="blue">第 {item.rank ?? "-"} 名</Tag>
          <span>{item.job_title}</span>
          {item.company ? (
            <Typography.Text type="secondary">· {item.company}</Typography.Text>
          ) : null}
        </Space>
      }
      extra={<Tag>{sourceLabel(item.analysis_source)}</Tag>}
    >
      <Space align="start" size="middle">
        <Progress
          type="circle"
          size={64}
          percent={score}
          format={(value) => <span>{value}</span>}
        />
        <Space direction="vertical" size={2}>
          <Typography.Text strong>匹配度参考分：{score}</Typography.Text>
          <Typography.Text type="secondary">
            {item.result ? `准入：${ADMISSION_META[item.result.admission].label}` : "暂无结论"}
          </Typography.Text>
          {item.model ? (
            <Typography.Text type="secondary">模型：{item.model}</Typography.Text>
          ) : null}
        </Space>
      </Space>
      <Collapse
        ghost
        items={[{ key: "detail", label: "查看匹配详情", children: <MatchDetail item={item} /> }]}
        style={{ marginTop: 8 }}
      />
    </Card>
  );
}

export default function JobMatchBatchPanel({
  open,
  jobIds,
  autoRun,
  runMode = "immediate",
  onClose,
}: JobMatchBatchPanelProps) {
  const { message } = App.useApp();
  const [activeTab, setActiveTab] = useState(autoRun ? "result" : "history");
  const [batch, setBatch] = useState<JobMatchBatchOut | null>(null);
  const [history, setHistory] = useState<JobMatchBatchSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState("");
  const [jobIdsKey, setJobIdsKey] = useState("");

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

  const runBatch = useCallback(
    async (force: boolean) => {
      if (jobIds.length === 0) {
        message.warning("请先选择岗位");
        return;
      }
      setLoading(true);
      setError("");
      try {
        const result = await generateJobMatchBatch({ job_ids: jobIds, force });
        setBatch(result);
        setActiveTab("result");
        void loadHistory();
      } catch (requestError) {
        const detail = requestError instanceof Error ? requestError.message : "批量分析失败";
        setError(detail);
      } finally {
        setLoading(false);
      }
    },
    [jobIds, loadHistory, message],
  );

  const runInBackground = useCallback(async () => {
    if (jobIds.length === 0) {
      message.warning("请先选择岗位");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const task = await startJobMatchBatchTask({ job_ids: jobIds, force: false });
      watchJobMatchBatchTask(task, "岗位适配度分析（" + jobIds.length + " 个岗位）");
      message.success("已转入后台分析，完成后会通知你");
      onClose();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "创建后台分析任务失败");
    } finally {
      setLoading(false);
    }
  }, [jobIds, message, onClose]);

  useEffect(() => {
    if (!open) return;
    const nextKey = jobIds.join(",");
    setJobIdsKey(nextKey);
    setBatch(null);
    setError("");
    setActiveTab(autoRun ? "result" : "history");
    void loadHistory();
    if (autoRun) {
      if (runMode === "background") void runInBackground();
      else void runBatch(false);
    }
  }, [autoRun, jobIds, loadHistory, open, runBatch, runInBackground, runMode]);

  const openHistory = async (id: number) => {
    setLoading(true);
    setError("");
    try {
      setBatch(await getJobMatchBatch(id));
      setActiveTab("result");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "读取匹配记录失败");
    } finally {
      setLoading(false);
    }
  };

  const resultContent =
    loading && !batch ? (
      <Skeleton active paragraph={{ rows: 8 }} />
    ) : batch ? (
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Alert
          type={batch.failed_count > 0 ? "warning" : "success"}
          showIcon
          message={`已完成 ${batch.completed_count} 个岗位，${batch.failed_count} 个岗位失败`}
          description={`结果已保存，可在「历史记录」中回看；已按匹配度参考分从高到低排列。${batch.model ? `本批使用模型：${batch.model}` : "本批未配置模型，使用本地降级结果。"}`}
        />
        <List
          dataSource={batch.items}
          locale={{ emptyText: "没有可展示的分析结果" }}
          renderItem={(item) => (
            <List.Item key={`${batch.id}-${item.job_id}`}>
              <div style={{ width: "100%" }}>
                <BatchItemCard item={item} />
              </div>
            </List.Item>
          )}
        />
      </Space>
    ) : (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择岗位后开始批量分析" />
    );

  const historyContent = historyLoading ? (
    <Spin />
  ) : history.length === 0 ? (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有批量分析记录" />
  ) : (
    <List
      dataSource={history}
      renderItem={(item) => (
        <List.Item
          key={item.id}
          actions={[
            <Button key="view" type="link" onClick={() => void openHistory(item.id)}>
              查看结果
            </Button>,
          ]}
        >
          <List.Item.Meta
            title={`第 ${item.id} 批 · ${formatTime(item.created_at)}`}
            description={`共 ${item.requested_count} 个岗位，完成 ${item.completed_count} 个，失败 ${item.failed_count} 个${item.top_score === null ? "" : `，最高参考分 ${item.top_score}`}`}
          />
        </List.Item>
      )}
    />
  );

  return (
    <Modal
      open={open}
      title={
        <Space>
          <RobotOutlined />
          岗位批量适配度分析
        </Space>
      }
      width={900}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          {activeTab === "result" && batch && autoRun && jobIds.length > 0 ? (
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void runBatch(true)}>
              重新分析
            </Button>
          ) : null}
        </Space>
      }
    >
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: "result", label: "本次结果", children: resultContent },
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
      {jobIdsKey && autoRun ? (
        <Typography.Text type="secondary">本次选择：{jobIds.length} 个岗位</Typography.Text>
      ) : null}
    </Modal>
  );
}
