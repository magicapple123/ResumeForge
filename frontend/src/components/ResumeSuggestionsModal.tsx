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
import { t, type MessageKey } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

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

/**
 * 三档优先级的显示名与颜色。
 *
 * `labelKey` 而不是 `label`：模块作用域里调 `t()` 会把语言固定在模块求值那一刻
 * （交接单 §8.1），所以常量里只存 key，`t()` 留在渲染处。
 * `color` 是 antd Tag 的色板名，与语言无关，不进词表。
 */
const PRIORITY_META: Record<ResumeSuggestion["priority"], { labelKey: MessageKey; color: string }> =
  {
    high: { labelKey: "resumeSuggestions.priority.high", color: "red" },
    medium: { labelKey: "resumeSuggestions.priority.medium", color: "orange" },
    low: { labelKey: "resumeSuggestions.priority.low", color: "blue" },
  };

export default function ResumeSuggestionsModal({
  open,
  recordId,
  resetKey = 0,
  onClose,
  onGenerated,
  onApplied,
}: Props) {
  // 本组件与它的三个子视图都用模块级 t()：必须订阅语言变化，否则切语言后这块不重渲染。
  useLocale();
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
      // 这是给模型的修订指令，不是界面文案（交接单 §3 红线）：翻成英文会改变生成行为。
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
      message.success(t("resumeSuggestions.adopted"));
      onClose();
    } catch (err) {
      setAdoptError(err instanceof Error ? err.message : t("resumeSuggestions.adoptFailed"));
    } finally {
      setAdoptingIndex(null);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <BulbOutlined />
          {t("resumeSuggestions.modal.title")}
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
          <Alert
            type="error"
            showIcon
            title={state.error || t("resumeSuggestions.generateFailed")}
          />
          <div>
            <Button icon={<ReloadOutlined />} onClick={start}>
              {t("common.retry")}
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
        {t("resumeSuggestions.intro.title")}
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
        {t("resumeSuggestions.intro.body")}
      </Typography.Paragraph>
      <Space wrap>
        <Button type="primary" icon={<ThunderboltOutlined />} onClick={onStart}>
          {t("resumeSuggestions.action.start")}
        </Button>
        <Button onClick={onCancel}>{t("common.action.cancel")}</Button>
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
      <Typography.Text>
        {t("resumeSuggestions.scanning.elapsed", { seconds: elapsed })}
      </Typography.Text>
      <Typography.Text type="secondary">{t("resumeSuggestions.scanning.hint")}</Typography.Text>
      <Button onClick={onCancel}>{t("resumeSuggestions.action.cancelScan")}</Button>
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
          {/* 没有关联公司时换一句话说，不留下悬空的「·」分隔符。 */}
          {data.company
            ? t("resumeSuggestions.target.company", {
                company: data.company,
                job: data.job_title,
              })
            : t("resumeSuggestions.target.job", { job: data.job_title })}
        </Typography.Text>
        {/* 覆盖类动作：就地 Popconfirm（Popover 形态，不占弹层容器层级）。 */}
        <Popconfirm
          title={t("resumeSuggestions.regenerate.confirm")}
          okText={t("resumeSuggestions.regenerate.ok")}
          cancelText={t("common.action.cancel")}
          onConfirm={onRestart}
        >
          <Button type="link" size="small" icon={<ReloadOutlined />}>
            {t("resumeSuggestions.action.regenerate")}
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
                    {t("resumeSuggestions.action.adopt")}
                  </Button>,
                ]}
              >
                <Space orientation="vertical" size={6} style={{ width: "100%" }}>
                  <Space wrap>
                    <Tag color={priority.color}>{t(priority.labelKey)}</Tag>
                    {item.section && <Tag>{item.section}</Tag>}
                  </Space>
                  <Typography.Text strong>{item.issue}</Typography.Text>
                  <Typography.Paragraph style={{ marginBottom: 0 }}>
                    {item.suggestion}
                  </Typography.Paragraph>
                  {item.evidence.length > 0 && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t("resumeSuggestions.evidence", {
                        evidence: item.evidence.join(t("resumeSuggestions.separator.evidence")),
                      })}
                    </Typography.Text>
                  )}
                </Space>
              </ListyItem>
            );
          }}
        />
      ) : (
        <Empty description={t("resumeSuggestions.empty")} />
      )}
    </div>
  );
}
