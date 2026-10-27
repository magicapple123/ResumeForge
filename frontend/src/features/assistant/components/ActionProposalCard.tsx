// SPDX-License-Identifier: Apache-2.0
/**
 * 助手写入提案确认卡（RF-01）。
 *
 * 助手在用户未同意写入时把写工具转成"待确认提案"：这里展示目标、影响范围与
 * 字段差异，由用户决定批准（后端用存储参数执行）或拒绝。组件自管 API 调用与
 * 状态刷新——挂在消息流里（流式中的 `streamingTools` 与历史消息的
 * `context.tool_calls` 都可能带提案），不向上层传回调，避免页头到消息列表的
 * props 钻透。后端重启后 pending 提案查询 404，按"已失效"展示，不假装还能确认。
 */

import { CheckOutlined, CloseOutlined, ExclamationCircleOutlined } from "@ant-design/icons";
import { App, Button, Space, Spin, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import {
  approveWriteProposal,
  getWriteProposal,
  rejectWriteProposal,
} from "../../../api/assistant";
import type { AssistantWriteProposal } from "../../../types";
import { formatErrorGuidance } from "../../../api/errorGuidance";
import { t, type MessageKey } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

/** 状态值是协议值（后端返回），这里只把它们映射到语言包 key。 */
const STATUS_META: Record<
  AssistantWriteProposal["status"],
  { labelKey: MessageKey; color: string }
> = {
  pending: { labelKey: "assistantUi.actionProposal.status.pending", color: "warning" },
  approved: { labelKey: "assistantUi.actionProposal.status.approved", color: "processing" },
  executed: { labelKey: "assistantUi.actionProposal.status.executed", color: "success" },
  expired: { labelKey: "assistantUi.actionProposal.status.expired", color: "default" },
  rejected: { labelKey: "assistantUi.actionProposal.status.rejected", color: "default" },
  failed: { labelKey: "assistantUi.actionProposal.status.failed", color: "error" },
  // RR-05：执行中途失败但**已经提交过**——数据可能已落库，所以不能说"失败"，
  // 也不能提供任何重试入口（提案终态已经封死）。
  unknown: { labelKey: "assistantUi.actionProposal.status.unknown", color: "warning" },
};

/** 兜底元数据：后端新增终态而前端还没跟上时也要能渲染，而不是整页白屏。 */
const FALLBACK_STATUS_META = {
  labelKey: "assistantUi.actionProposal.status.fallback",
  color: "default",
} as const;

interface Props {
  proposal: AssistantWriteProposal;
}

export default function ActionProposalCard({ proposal: initial }: Props) {
  useLocale();
  const { message } = App.useApp();
  const [proposal, setProposal] = useState(initial);
  const [busy, setBusy] = useState(false);

  // 历史/流式恢复时刷新一次状态：后端重启后提案不在了，404 → 已失效。
  useEffect(() => {
    if (initial.status !== "pending") return;
    let cancelled = false;
    getWriteProposal(initial.proposal_id)
      .then((result) => {
        if (!cancelled) setProposal(result.proposal);
      })
      .catch(() => {
        if (!cancelled) {
          setProposal({ ...initial, status: "expired" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [initial]);

  const act = async (action: "approve" | "reject") => {
    setBusy(true);
    try {
      if (action === "approve") {
        const result = await approveWriteProposal(proposal.proposal_id);
        setProposal(result.proposal);
        message.success(
          result.changed
            ? t("assistantUi.actionProposal.toast.done")
            : t("assistantUi.actionProposal.toast.executed"),
        );
      } else {
        const result = await rejectWriteProposal(proposal.proposal_id);
        setProposal(result.proposal);
      }
    } catch (error) {
      // 兜底不再是「操作失败」：统一走 errorGuidance 的「原因 · 建议 · 编号」三段，
      // 用户能照着「建议」做，也能把「编号」报给维护者（§4.6）。
      message.error(formatErrorGuidance(error, t("assistantUi.actionProposal.error.fallback")));
      // 404/409（失效、已执行、跨数据集等）后刷新一次真实状态，卡片不再可操作。
      try {
        const result = await getWriteProposal(proposal.proposal_id);
        setProposal(result.proposal);
      } catch {
        setProposal((current) => ({ ...current, status: "expired" }));
      }
    } finally {
      setBusy(false);
    }
  };

  const meta = STATUS_META[proposal.status] ?? FALLBACK_STATUS_META;
  const pending = proposal.status === "pending";
  const { preview } = proposal;

  return (
    <div
      className="assistant-write-proposal"
      role="group"
      aria-label={t("assistantUi.actionProposal.aria", { target: preview.target })}
    >
      <div className="assistant-write-proposal-head">
        <ExclamationCircleOutlined style={{ marginRight: 6 }} />
        <Typography.Text strong>{t("assistantUi.actionProposal.heading")}</Typography.Text>
        <Tag color={meta.color} style={{ marginLeft: 8 }}>
          {t(meta.labelKey)}
        </Tag>
        <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
          {proposal.tool_name}
        </Typography.Text>
      </div>
      <div>
        <Typography.Text strong>{preview.target}</Typography.Text>
        <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
          {preview.scope}
        </Typography.Text>
      </div>
      {preview.changes.length > 0 && (
        <ul className="assistant-write-proposal-changes">
          {preview.changes.map((change, index) => (
            <li key={`${change.field}-${index}`}>
              <Typography.Text>
                {t("assistantUi.actionProposal.changeField", { field: change.field })}
              </Typography.Text>
              {change.before != null && (
                <Typography.Text type="secondary" delete>
                  {change.before}
                </Typography.Text>
              )}
              {change.before != null && change.after != null && (
                <Typography.Text type="secondary"> → </Typography.Text>
              )}
              {change.after != null && <Typography.Text>{change.after}</Typography.Text>}
              {change.before == null && change.after == null && (
                <Typography.Text type="secondary">
                  {t("assistantUi.actionProposal.noContent")}
                </Typography.Text>
              )}
            </li>
          ))}
        </ul>
      )}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("assistantUi.actionProposal.notice")}
      </Typography.Text>
      {pending && (
        <div className="assistant-write-proposal-actions">
          <Space>
            <Button
              type="primary"
              size="small"
              icon={<CheckOutlined />}
              loading={busy}
              onClick={() => act("approve")}
            >
              {t("assistantUi.actionProposal.action.approve")}
            </Button>
            <Button
              size="small"
              icon={<CloseOutlined />}
              disabled={busy}
              onClick={() => act("reject")}
            >
              {t("assistantUi.actionProposal.action.reject")}
            </Button>
          </Space>
        </div>
      )}
      {busy && !pending && <Spin size="small" />}
    </div>
  );
}
