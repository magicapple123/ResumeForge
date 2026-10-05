/** 针对关联岗位生成简历修改建议的按需弹窗；每条建议可一键采纳并直接修改简历。 */
import { BulbOutlined, CheckOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Empty,
  Listy,
  Modal,
  Skeleton,
  Space,
  Tag,
  Typography,
  theme,
} from "antd";
import { ListyItem } from "./common/ListyItem";
import { useCallback, useEffect, useRef, useState } from "react";
import { generateResumeSuggestions, reviseResume } from "../api/resumes";
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
  const [data, setData] = useState<ResumeSuggestions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasAttempted, setHasAttempted] = useState(false);
  /** 正在采纳的建议下标；一次只允许采纳一条，避免两份修订并发写同一份简历。 */
  const [adoptingIndex, setAdoptingIndex] = useState<number | null>(null);
  const requestVersion = useRef(0);
  const lastRecordId = useRef<number | null>(null);
  const lastResetKey = useRef(resetKey);

  useEffect(() => {
    if (!recordId) return;
    if (lastRecordId.current === recordId && lastResetKey.current === resetKey) return;
    lastRecordId.current = recordId;
    lastResetKey.current = resetKey;
    requestVersion.current += 1;
    setData(null);
    setError("");
    setLoading(false);
    setHasAttempted(false);
    setAdoptingIndex(null);
  }, [recordId, resetKey]);

  const loadSuggestions = useCallback(async () => {
    if (!recordId) return;
    const currentRequest = ++requestVersion.current;
    setHasAttempted(true);
    setLoading(true);
    setError("");
    try {
      const result = await generateResumeSuggestions(recordId);
      if (currentRequest !== requestVersion.current) return;
      setData(result);
      onGenerated?.();
    } catch (err) {
      if (currentRequest !== requestVersion.current) return;
      setError(err instanceof Error ? err.message : "生成建议失败，请稍后重试");
    } finally {
      if (currentRequest === requestVersion.current) setLoading(false);
    }
  }, [onGenerated, recordId]);

  useEffect(() => {
    if (open && recordId && !hasAttempted) void loadSuggestions();
  }, [hasAttempted, loadSuggestions, open, recordId]);

  /**
   * 采纳单条建议：把建议格式化成修订指令交给后端，模型只改这一条涉及的内容。
   * 采纳成功后关掉弹窗——预览已经刷新，继续留在建议列表里容易对着旧内容点第二次。
   */
  const adopt = async (item: ResumeSuggestion, index: number) => {
    if (!recordId || adoptingIndex !== null) return;
    setAdoptingIndex(index);
    setError("");
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
      setError(err instanceof Error ? err.message : "采纳建议失败，请稍后重试");
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
        body: { maxHeight: "calc(100vh - 200px)", overflowY: "auto", overflowX: "hidden" },
      }}
      destroyOnHidden
    >
      {error ? (
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Alert type="error" showIcon title={error} />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void loadSuggestions()}
            loading={loading}
          >
            重新生成建议
          </Button>
        </Space>
      ) : loading ? (
        <Skeleton active paragraph={{ rows: 5 }} />
      ) : data ? (
        <div>
          <Space style={{ marginBottom: 12 }} wrap>
            <Typography.Text type="secondary">
              目标岗位：{data.company ? `${data.company} · ` : ""}
              {data.job_title}
            </Typography.Text>
            <Button
              type="link"
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => void loadSuggestions()}
            >
              重新生成建议
            </Button>
          </Space>
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
                        onClick={() => void adopt(item, index)}
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
      ) : null}
    </Modal>
  );
}
