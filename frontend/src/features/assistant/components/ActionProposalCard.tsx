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

const STATUS_META: Record<AssistantWriteProposal["status"], { label: string; color: string }> = {
  pending: { label: "待确认", color: "warning" },
  approved: { label: "已批准", color: "processing" },
  executed: { label: "已执行", color: "success" },
  expired: { label: "已失效", color: "default" },
  rejected: { label: "已拒绝", color: "default" },
  failed: { label: "执行失败", color: "error" },
  // RR-05：执行中途失败但**已经提交过**——数据可能已落库，所以不能说"失败"，
  // 也不能提供任何重试入口（提案终态已经封死）。
  unknown: { label: "结果未知", color: "warning" },
};

/** 兜底元数据：后端新增终态而前端还没跟上时也要能渲染，而不是整页白屏。 */
const FALLBACK_STATUS_META = { label: "状态未知", color: "default" } as const;

interface Props {
  proposal: AssistantWriteProposal;
}

export default function ActionProposalCard({ proposal: initial }: Props) {
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
        message.success(result.changed ? "写入已完成" : "提案已执行");
      } else {
        const result = await rejectWriteProposal(proposal.proposal_id);
        setProposal(result.proposal);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : "操作失败";
      message.error(text);
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
      aria-label={`写入提案：${preview.target}`}
    >
      <div className="assistant-write-proposal-head">
        <ExclamationCircleOutlined style={{ marginRight: 6 }} />
        <Typography.Text strong>助手请求写入数据</Typography.Text>
        <Tag color={meta.color} style={{ marginLeft: 8 }}>
          {meta.label}
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
              <Typography.Text>{change.field}：</Typography.Text>
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
                <Typography.Text type="secondary">（无内容）</Typography.Text>
              )}
            </li>
          ))}
        </ul>
      )}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        在你确认之前，这条写入不会执行；助手也无法替你确认。
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
              确认执行
            </Button>
            <Button
              size="small"
              icon={<CloseOutlined />}
              disabled={busy}
              onClick={() => act("reject")}
            >
              拒绝
            </Button>
          </Space>
        </div>
      )}
      {busy && !pending && <Spin size="small" />}
    </div>
  );
}
