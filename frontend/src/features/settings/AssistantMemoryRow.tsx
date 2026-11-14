// SPDX-License-Identifier: Apache-2.0
/**
 * 助手记忆的一行（F33）：状态徽标、来源摘录、逐条动作与变更历史。
 *
 * 从 `AssistantMemoryCard` 拆出来的原因：卡片本身已经有搜索、排序、开关、清空与弹层，
 * 再塞进行内按钮与历史弹窗会顶到 500 行；一行记忆的展示规则（置灰、可恢复、可回溯）
 * 也值得单独读。
 *
 * 三条与后端语义对齐的展示规则：
 * - `suppressed`（用户标了「永不使用」）**仍显示**，置灰 + 「已停用」+「恢复使用」；
 * - `superseded` 显示「已被新说法替换」，只读；
 * - `deleted` 不会出现在列表里（后端过滤），这里不做分支。
 */
import { Button, Modal, Space, Spin, Tag, Typography } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { formatDateTime } from "../../utils/format";
import {
  getAssistantMemoryHistory,
  type AssistantMemory,
  type AssistantMemoryEvent,
} from "./assistantMemoryApi";
import { memoryKindLabel } from "./assistantMemoryLabels";

const HISTORY_ACTION_KEYS = {
  create: "assistantMemory.history.action.create",
  update: "assistantMemory.history.action.update",
  supersede: "assistantMemory.history.action.supersede",
  suppress: "assistantMemory.history.action.suppress",
  restore: "assistantMemory.history.action.restore",
  delete: "assistantMemory.history.action.delete",
} as const;
type HistoryActionKey = keyof typeof HISTORY_ACTION_KEYS;

export function AssistantMemoryRow({
  memory,
  onEdit,
  onNeverUse,
  onRestore,
  onDelete,
}: {
  memory: AssistantMemory;
  onEdit: (memory: AssistantMemory) => void;
  onNeverUse: (memory: AssistantMemory) => void;
  onRestore: (memory: AssistantMemory) => void;
  onDelete: (memory: AssistantMemory) => void;
}) {
  const navigate = useNavigate();
  // The row renders module-level `t()` copy, so it must subscribe to language changes.
  useLocale();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [events, setEvents] = useState<AssistantMemoryEvent[] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);

  const suppressed = memory.status === "suppressed";
  const superseded = memory.status === "superseded";
  const excerpt = (memory.source_excerpt || "").trim();

  const openHistory = async () => {
    setHistoryOpen(true);
    if (events !== null || historyFailed) return;
    try {
      setEvents(await getAssistantMemoryHistory(memory.id));
    } catch {
      setHistoryFailed(true);
    }
  };

  return (
    <li
      data-testid={`assistant-memory-${memory.id}`}
      style={{ display: "grid", gap: 4, opacity: suppressed ? 0.65 : 1 }}
    >
      <Space size={8} wrap>
        <Tag color={suppressed ? "default" : "blue"}>
          {memoryKindLabel(memory.kind, memory.kind_label)}
        </Tag>
        <Typography.Text delete={suppressed}>{memory.value}</Typography.Text>
        {suppressed ? <Tag color="orange">{t("assistantMemory.status.suppressed")}</Tag> : null}
        {superseded ? <Tag color="default">{t("assistantMemory.status.superseded")}</Tag> : null}
        <Tag color={memory.source === "extracted" ? "purple" : "green"}>
          {t(
            memory.source === "extracted"
              ? "assistantMemory.source.extracted"
              : "assistantMemory.source.manual",
          )}
        </Tag>
        <Typography.Text type="secondary">
          {t("assistantMemory.updatedAt", { time: formatDateTime(memory.updated_at) })}
        </Typography.Text>
      </Space>
      {excerpt ? (
        <Typography.Text type="secondary" italic style={{ fontSize: 12 }}>
          {t("assistantMemory.sourceExcerpt", { text: excerpt })}
        </Typography.Text>
      ) : null}
      <Space size={4} wrap>
        {memory.source === "extracted" && memory.source_conversation_id ? (
          <Button
            type="link"
            size="small"
            onClick={() => navigate(`/assistant?conversation=${memory.source_conversation_id}`)}
          >
            {t("assistantMemory.openConversation")}
          </Button>
        ) : null}
        {!suppressed && !superseded ? (
          <Button type="link" size="small" onClick={() => onEdit(memory)}>
            {t("assistantMemory.action.edit")}
          </Button>
        ) : null}
        {!suppressed && !superseded ? (
          <Button type="link" size="small" onClick={() => onNeverUse(memory)}>
            {t("assistantMemory.action.neverUse")}
          </Button>
        ) : null}
        {suppressed ? (
          <Button type="link" size="small" onClick={() => onRestore(memory)}>
            {t("assistantMemory.action.restore")}
          </Button>
        ) : null}
        <Button type="link" size="small" onClick={() => void openHistory()}>
          {t("assistantMemory.action.history")}
        </Button>
        <Button type="link" size="small" danger onClick={() => onDelete(memory)}>
          {t("assistantMemory.action.delete")}
        </Button>
      </Space>

      <Modal
        open={historyOpen}
        onCancel={() => setHistoryOpen(false)}
        footer={null}
        title={t("assistantMemory.history.title")}
      >
        {historyFailed ? (
          <Typography.Text type="danger">{t("assistantMemory.history.loadFailed")}</Typography.Text>
        ) : events === null ? (
          <Spin />
        ) : events.length === 0 ? (
          <Typography.Text type="secondary">{t("assistantMemory.history.empty")}</Typography.Text>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
            {events.map((event) => (
              <li key={event.id}>
                <Space size={8} wrap>
                  <Typography.Text strong>
                    {t(
                      HISTORY_ACTION_KEYS[event.action as HistoryActionKey] ??
                        "assistantMemory.history.action.update",
                    )}
                  </Typography.Text>
                  {event.before || event.after ? (
                    <Typography.Text type="secondary">
                      {t("assistantMemory.history.changed", {
                        before: event.before || "∅",
                        after: event.after || "∅",
                      })}
                    </Typography.Text>
                  ) : null}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {formatDateTime(event.at)}
                  </Typography.Text>
                </Space>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </li>
  );
}

export default AssistantMemoryRow;
