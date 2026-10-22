// SPDX-License-Identifier: Apache-2.0
/**
 * 针对关联岗位生成简历修改建议的按需弹窗；每条建议可一键采纳并直接修改简历。
 *
 * **打开不等于开始**（R/P3）：进弹窗先看说明卡（要做什么、大概多久、能不能走开），
 * 点「开始生成」才真的调一次模型。生成状态住在 `features/resume/suggestionScanStore`：
 * 关掉弹窗不 abort，跑完由 `SuggestionScanWatcher` 弹全局通知告知结果；
 * store 里已有结果时重新打开直接显示，不会重复烧一次模型调用。
 */
import {
  BulbOutlined,
  CheckOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Empty,
  Listy,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Typography,
  theme,
} from "antd";
import PageSkeleton from "./common/PageSkeleton";
import { ListyItem } from "./common/ListyItem";
import { useEffect, useRef, useState } from "react";
import { reviseResume } from "../api/resumes";
import {
  cancelSuggestionScan,
  clearSuggestionScan,
  markSuggestionPanelAttached,
  startSuggestionScan,
  useSuggestionScan,
} from "../features/resume/suggestionScanStore";
import type { ResumeDetail, ResumeSuggestion, ResumeSuggestions } from "../types";

interface Props {
  open: boolean;
  recordId: number | null;
  /** 简历内容修改后递增，避免继续展示旧建议。 */
  resetKey?: number;
  onClose: () => void;
  onGenerated?: () => void;
  /** 采纳建议成功后把更新后的记录交回父组件刷新预览。 */
  onApplied?: (detail: ResumeDetail) => Promise<void> | void;
}

const PRIORITY_META: Record<ResumeSuggestion["priority"], { label: string; color: string }> = {
  high: { label: "优先修改", color: "red" },
  medium: { label: "建议修改", color: "orange" },
  low: { label: "可选优化", color: "blue" },
};

export default function ResumeSuggestionsModal({
  open,
  recordId,
  resetKey = 0,
  onClose,
  onGenerated,
  onApplied,
}: Props) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const state = useSuggestionScan(recordId ?? 0);
  /** 正在采纳的建议下标；一次只允许采纳一条，避免两份修订并发写同一份简历。 */
  const [adoptingIndex, setAdoptingIndex] = useState<number | null>(null);
  /** 采纳失败的错误（与生成失败分开：采纳失败不该把整份建议列表换掉）。 */
  const [adoptError, setAdoptError] = useState("");

  // 只算「弹窗开着」才算附着：关掉之后由全局 watcher 接手通知（后台继续）。
  useEffect(() => {
    if (!open || recordId == null) return;
    return markSuggestionPanelAttached(recordId);
  }, [open, recordId]);

  // 生成完成时通知父组件一次（按钮文案从「生成」变「查看」）。用 finishedAt 做令牌，
  // 避免同一次结果因为其它状态变化被重复上报。
  const notifiedFinish = useRef<number | null>(null);
  useEffect(() => {
    if (state.status !== "done" || !state.data) return;
    const finishToken = state.finishedAt ?? 0;
    if (notifiedFinish.current === finishToken) return;
    notifiedFinish.current = finishToken;
    onGenerated?.();
  }, [onGenerated, state.data, state.finishedAt, state.status]);

  // resetKey 变化（简历内容改过）→ 旧建议必须整槽丢掉，否则用户会对着旧正文点「采纳」。
  // 换了一份简历时不清理：那是另一个 resumeId 的槽。
  const lastRecordId = useRef<number | null>(recordId);
  const lastResetKey = useRef(resetKey);
  useEffect(() => {
    const recordChanged = lastRecordId.current !== recordId;
    const resetChanged = lastResetKey.current !== resetKey;
    lastRecordId.current = recordId;
    lastResetKey.current = resetKey;
    if (!resetChanged || recordChanged || recordId == null) return;
    clearSuggestionScan(recordId);
    setAdoptingIndex(null);
    setAdoptError("");
  }, [recordId, resetKey]);

  const start = () => {
    if (recordId == null) return;
    setAdoptError("");
    startSuggestionScan(recordId);
  };

  /**
   * 采纳单条建议：把建议格式化成修订指令交给后端，模型只改这一条涉及的内容。
   * 采纳成功后关掉弹窗——预览已经刷新，继续留在建议列表里容易对着旧内容点第二次。
   */
  const adopt = async (item: ResumeSuggestion, index: number) => {
    if (!recordId || adoptingIndex !== null) return;
    setAdoptingIndex(index);
    setAdoptError("");
    try {
      const instructions = [
        `请按以下建议修改简历（目标分区：${item.section || "未指定"}）：`,
        `问题：${item.issue}`,
        `修改建议：${item.suggestion}`,
        item.evidence.length ? `依据：${item.evidence.join("；")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const updated = await reviseResume(recordId, instructions);
      await onApplied?.(updated);
      message.success("已采纳这条建议并更新简历");
      onClose();
    } catch (err) {
      setAdoptError(err instanceof Error ? err.message : "采纳建议失败，请稍后重试");
    } finally {
      setAdoptingIndex(null);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <BulbOutlined />
          岗位化修改建议
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      // 建议条数不固定：限高让超长内容只滚弹窗内部，卡片整体不出视口。
      styles={{
        body: { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto", overflowX: "hidden" },
      }}
      destroyOnHidden
    >
      {recordId == null ? null : state.status === "scanning" ? (
        <ScanningBody startedAt={state.startedAt} onCancel={() => cancelSuggestionScan(recordId)} />
      ) : state.status === "error" ? (
        <Space orientation="vertical" style={{ width: "100%" }} size="middle">
          <Alert type="error" showIcon title={state.error || "生成建议失败，请稍后重试"} />
          <div>
            <Button icon={<ReloadOutlined />} onClick={start}>
              重试
            </Button>
          </div>
        </Space>
      ) : state.status === "done" && state.data ? (
        <SuggestionList
          data={state.data}
          adoptError={adoptError}
          adoptingIndex={adoptingIndex}
          token={token}
          onAdopt={adopt}
          onRestart={start}
        />
      ) : (
        <IntroBody onStart={start} onCancel={onClose} />
      )}
    </Modal>
  );
}

/** 说明卡：讲清"要读什么、大概多久、能不能走开"，再让用户点开始。 */
function IntroBody({ onStart, onCancel }: { onStart: () => void; onCancel: () => void }) {
  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="middle">
      <Typography.Title level={5} style={{ margin: 0 }}>
        生成岗位优化建议
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
        会读取这份简历与关联岗位 JD，调用一次大模型生成逐条修改建议；约 10–60
        秒，生成期间可以关闭窗口，完成后会通知你。
      </Typography.Paragraph>
      <Space wrap>
        <Button type="primary" icon={<ThunderboltOutlined />} onClick={onStart}>
          开始生成
        </Button>
        <Button onClick={onCancel}>取消</Button>
      </Space>
    </Space>
  );
}

/** 生成中：已用时 + 「可以关掉窗口」+ 取消（取消才是真 abort，关闭窗口不是）。 */
function ScanningBody({ startedAt, onCancel }: { startedAt?: number; onCancel: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;

  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="middle" align="center">
      <PageSkeleton rows={5} card={false} />
      <Typography.Text>正在生成建议…已用时 {elapsed}s</Typography.Text>
      <Typography.Text type="secondary">可以关闭此窗口，生成会继续</Typography.Text>
      <Button onClick={onCancel}>取消生成</Button>
    </Space>
  );
}

/** 结果列表：目标岗位 + 重新生成（需确认）+ 逐条采纳。 */
function SuggestionList({
  data,
  adoptError,
  adoptingIndex,
  token,
  onAdopt,
  onRestart,
}: {
  data: ResumeSuggestions;
  adoptError: string;
  adoptingIndex: number | null;
  token: ReturnType<typeof theme.useToken>["token"];
  onAdopt: (item: ResumeSuggestion, index: number) => void;
  onRestart: () => void;
}) {
  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Typography.Text type="secondary">
          目标岗位：{data.company ? `${data.company} · ` : ""}
          {data.job_title}
        </Typography.Text>
        {/* 覆盖类动作：就地 Popconfirm（Popover 形态，不占弹层容器层级）。 */}
        <Popconfirm
          title="重新生成会覆盖当前建议"
          okText="重新生成"
          cancelText="取消"
          onConfirm={onRestart}
        >
          <Button type="link" size="small" icon={<ReloadOutlined />}>
            重新生成建议
          </Button>
        </Popconfirm>
      </Space>
      {adoptError && (
        <Alert type="error" showIcon title={adoptError} style={{ marginBottom: 12 }} />
      )}
      {data.suggestions.length > 0 ? (
        <Listy
          items={data.suggestions}
          rowKey={(item) => `${item.issue}|${item.suggestion}`}
          /* List 的 bordered（1px 边框 + 大圆角）以语义样式还原。 */
          styles={{
            root: {
              border: `${token.lineWidth}px ${token.lineType} ${token.colorBorder}`,
              borderRadius: token.borderRadiusLG,
            },
          }}
          itemRender={(item) => {
            // Listy 的 itemRender 不提供下标，按对象引用从原数组取回（建议对象引用唯一）。
            const index = data.suggestions.indexOf(item);
            const priority = PRIORITY_META[item.priority];
            const adopting = adoptingIndex === index;
            return (
              <ListyItem
                actions={[
                  <Button
                    key="adopt"
                    size="small"
                    icon={<CheckOutlined />}
                    loading={adopting}
                    disabled={adoptingIndex !== null && !adopting}
                    onClick={() => onAdopt(item, index)}
                  >
                    采纳并修改
                  </Button>,
                ]}
              >
                <Space orientation="vertical" size={6} style={{ width: "100%" }}>
                  <Space wrap>
                    <Tag color={priority.color}>{priority.label}</Tag>
                    {item.section && <Tag>{item.section}</Tag>}
                  </Space>
                  <Typography.Text strong>{item.issue}</Typography.Text>
                  <Typography.Paragraph style={{ marginBottom: 0 }}>
                    {item.suggestion}
                  </Typography.Paragraph>
                  {item.evidence.length > 0 && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      依据：{item.evidence.join("；")}
                    </Typography.Text>
                  )}
                </Space>
              </ListyItem>
            );
          }}
        />
      ) : (
        <Empty description="当前简历与岗位要求匹配度较好，暂未发现必须修改项" />
      )}
    </div>
  );
}
