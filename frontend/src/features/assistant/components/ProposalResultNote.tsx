// SPDX-License-Identifier: Apache-2.0
/**
 * 写操作终态回写的状态行（T01-A）。
 *
 * 后端在提案进入终态时补一条 kind=proposal_result 的消息；这里渲染成一行状态提示
 * （图标 + 状态 + 目标 + 摘要），而不是一句普通助手回复——用户一眼能看出"刚才那个
 * 写入最后怎么样了"。文案走语言包；后端 content 只用于导出与兜底展示。
 */
import { CheckCircleOutlined, CloseCircleOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { Typography } from "antd";
import type { ReactNode } from "react";
import type { AssistantProposalResult } from "../../../types";
import { t, type MessageKey } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

const STATUS_META: Record<
  AssistantProposalResult["status"],
  { labelKey: MessageKey; icon: ReactNode }
> = {
  executed: {
    labelKey: "assistantUi.proposalResult.status.executed",
    icon: <CheckCircleOutlined />,
  },
  failed: {
    labelKey: "assistantUi.proposalResult.status.failed",
    icon: <CloseCircleOutlined />,
  },
  unknown: {
    labelKey: "assistantUi.proposalResult.status.unknown",
    icon: <InfoCircleOutlined />,
  },
  rejected: {
    labelKey: "assistantUi.proposalResult.status.rejected",
    icon: <CloseCircleOutlined />,
  },
  expired: {
    labelKey: "assistantUi.proposalResult.status.expired",
    icon: <InfoCircleOutlined />,
  },
};

export default function ProposalResultNote({ result }: { result: AssistantProposalResult }) {
  useLocale();
  const meta = STATUS_META[result.status] ?? STATUS_META.failed;
  return (
    <article
      className="assistant-proposal-result"
      role="status"
      aria-label={t("assistantUi.proposalResult.aria", { target: result.target })}
    >
      <span className="assistant-proposal-result-icon" aria-hidden="true">
        {meta.icon}
      </span>
      <Typography.Text strong>{t(meta.labelKey)}</Typography.Text>
      <Typography.Text type="secondary">
        {t("assistantUi.proposalResult.target", { target: result.target })}
      </Typography.Text>
      {result.summary ? (
        <Typography.Text type="secondary" className="assistant-proposal-result-summary">
          {result.summary}
        </Typography.Text>
      ) : null}
    </article>
  );
}
