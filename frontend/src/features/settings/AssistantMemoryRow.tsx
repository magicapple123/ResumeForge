// SPDX-License-Identifier: Apache-2.0
/**
 * 助手记忆的一行（F33）：类型/内容/状态、合并后的元信息、`⋯` 菜单与变更历史。
 *
 * 从 `AssistantMemoryCard` 拆出来的原因：卡片本身已经有开关、列表头、筛选、清空与弹层，
 * 再塞进行内菜单与历史弹窗会顶到 500 行；一行记忆的展示规则（置灰、可恢复、可回溯）
 * 也值得单独读。
 *
 * ## 常驻动作只有两个（I-03）
 *
 * 改造前一行最多 5 个 `type="link"` 按钮（回到原对话 / 编辑 / 永不使用 / 历史 / 删除），
 * 5 行数据就是 25 个同等权重的蓝字，主次全平。现在：
 *
 * - 常驻只有「编辑」（12px）+「⋯」，其余（停用或恢复 / 历史 / 回到原对话 / 删除）都进菜单；
 * - 两个动作默认 `opacity: 0`，行 hover 或键盘进入（`:focus-within`）才显形——它们仍然
 *   可聚焦、可被读屏读到，只是不占视觉注意力；触屏（`hover: none`）下常显，否则无路可走。
 * - 类型标签改中性灰底（不再抢强调色），来源与时间合并成一行 11px 次级文字。
 *
 * 三条与后端语义对齐的展示规则：
 * - `suppressed`（用户标了「永不使用」）**仍显示**，置灰 + 「已停用」+ 菜单里的「恢复使用」；
 * - `superseded` 显示「已被新说法替换」，只读；
 * - `deleted` 不会出现在列表里（后端过滤），这里不做分支。
 */
import { MoreOutlined } from "@ant-design/icons";
import { Button, Dropdown, Modal, Spin, Tag, Typography } from "antd";
import type { MenuProps } from "antd";
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

/** `⋯` 菜单项的动作名：与 handler 一起构成唯一分派点。 */
type RowAction = "edit" | "suppress" | "restore" | "history" | "conversation" | "delete";

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
  const [sourceOpen, setSourceOpen] = useState(false);

  const suppressed = memory.status === "suppressed";
  const superseded = memory.status === "superseded";
  const excerpt = (memory.source_excerpt || "").trim();
  const conversationId = memory.source_conversation_id;
  /** 元信息（来源 · 更新时间）：T23 起只进 `⋯` 菜单与读屏专用文本，不占正文行。 */
  const metaLine = t("assistantMemory.meta.line", {
    source: t(
      memory.source === "extracted"
        ? "assistantMemory.source.extracted"
        : "assistantMemory.source.manual",
    ),
    updated: t("assistantMemory.updatedAt", { time: formatDateTime(memory.updated_at) }),
  });

  const openHistory = async () => {
    setHistoryOpen(true);
    if (events !== null || historyFailed) return;
    try {
      setEvents(await getAssistantMemoryHistory(memory.id));
    } catch {
      setHistoryFailed(true);
    }
  };

  const runAction = (action: RowAction) => {
    if (action === "edit") onEdit(memory);
    else if (action === "suppress") onNeverUse(memory);
    else if (action === "restore") onRestore(memory);
    else if (action === "delete") onDelete(memory);
    else if (action === "conversation") navigate(`/assistant?conversation=${conversationId}`);
    else void openHistory();
  };

  // 菜单按状态裁剪：停用的只剩「恢复使用」，被替换的只剩「历史 / 删除」。
  const items: MenuProps["items"] = [];
  // T23：来源与更新时间不再占正文行，挪成菜单头部的只读信息（disabled 不响应点击）。
  items.push({ key: "meta", label: metaLine, disabled: true });
  items.push({ type: "divider" });
  if (!suppressed && !superseded) {
    items.push({ key: "suppress", label: t("assistantMemory.action.neverUse") });
  }
  if (suppressed) {
    items.push({ key: "restore", label: t("assistantMemory.action.restore") });
  }
  items.push({ key: "history", label: t("assistantMemory.action.history") });
  if (memory.source === "extracted" && conversationId) {
    items.push({ key: "conversation", label: t("assistantMemory.openConversation") });
  }
  items.push({ type: "divider" });
  items.push({ key: "delete", label: t("assistantMemory.action.delete"), danger: true });

  return (
    <li
      data-testid={`assistant-memory-${memory.id}`}
      className={suppressed ? "rf-memory-row is-suppressed" : "rf-memory-row"}
    >
      <div className="rf-memory-row-main">
        <div className="rf-memory-row-line">
          <Tag className="rf-memory-kind">{memoryKindLabel(memory.kind, memory.kind_label)}</Tag>
          <Typography.Text delete={suppressed} className="rf-memory-value">
            {memory.value}
          </Typography.Text>
          {suppressed ? (
            <Tag className="rf-memory-status">{t("assistantMemory.status.suppressed")}</Tag>
          ) : null}
          {superseded ? (
            <Tag className="rf-memory-status">{t("assistantMemory.status.superseded")}</Tag>
          ) : null}
          <span className="rf-memory-actions">
            {!suppressed && !superseded ? (
              <Button
                type="link"
                size="small"
                className="rf-memory-edit"
                onClick={() => onEdit(memory)}
              >
                {t("assistantMemory.action.edit")}
              </Button>
            ) : null}
            <Dropdown
              trigger={["click"]}
              menu={{
                items,
                onClick: ({ key }) => runAction(key as RowAction),
              }}
            >
              <Button
                type="text"
                size="small"
                className="rf-memory-more"
                aria-label={t("assistantMemory.list.menu")}
                icon={<MoreOutlined />}
              />
            </Dropdown>
          </span>
        </div>
        {/* T23：第二行只留「来源」折叠入口；来源/更新时间进菜单与读屏文本。 */}
        {excerpt ? (
          <div className="rf-memory-row-second">
            <Button
              type="link"
              size="small"
              className="rf-memory-source-toggle"
              aria-expanded={sourceOpen}
              onClick={() => setSourceOpen((open) => !open)}
            >
              {t("assistantMemory.source.label")}
            </Button>
            {sourceOpen ? (
              <Typography.Text type="secondary" italic className="rf-memory-excerpt">
                {t("assistantMemory.sourceExcerpt", { text: excerpt })}
              </Typography.Text>
            ) : null}
          </div>
        ) : null}
        <span className="rf-sr-only">{metaLine}</span>
      </div>

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
          <ul className="rf-memory-history">
            {events.map((event) => (
              <li key={event.id}>
                <Typography.Text strong>
                  {t(
                    HISTORY_ACTION_KEYS[event.action as HistoryActionKey] ??
                      "assistantMemory.history.action.update",
                  )}
                </Typography.Text>
                {event.before || event.after ? (
                  <Typography.Text type="secondary" className="rf-memory-history-change">
                    {t("assistantMemory.history.changed", {
                      before: event.before || "∅",
                      after: event.after || "∅",
                    })}
                  </Typography.Text>
                ) : null}
                <Typography.Text type="secondary" className="rf-memory-history-time">
                  {formatDateTime(event.at)}
                </Typography.Text>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </li>
  );
}

export default AssistantMemoryRow;
