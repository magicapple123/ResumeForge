// SPDX-License-Identifier: Apache-2.0
/**
 * 模型用量汇总（R04）：按任务/模型列调用数与 token；**未知 token 不给 0**，
 * 费用只在用户配置了单价时估算（当前后端一律 estimated=false）。
 *
 * 隐私：接口只回数字与枚举（后端测试逐列检查），本组件也不请求任何正文。
 */
import { Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import EmptyState from "../../common/EmptyState";
import ErrorState from "../../common/ErrorState";
import LoadingBlock from "../../common/LoadingBlock";
import { pt } from "../../../features/resume-provenance/i18n";
import {
  costAmount,
  durationText,
  hasUnknownTokens,
  tokenText,
} from "../../../features/resume-provenance/helpers";
import type { UsageBucketOut, UsageSummaryOut } from "../../../features/resume-provenance/types";
import { useLocale } from "../../../i18n/i18nContext";

interface Props {
  summary: UsageSummaryOut | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const UNKNOWN = "provenance.usage.unknown" as const;

/** finish_reason → 文案（未知值显示原码，不编造解释）。 */
function finishReasonLabel(reason: string): string {
  const known: Record<string, string> = {
    stop: "provenance.usage.finishReason.stop",
    length: "provenance.usage.finishReason.length",
    cancelled: "provenance.usage.finishReason.cancelled",
    error: "provenance.usage.finishReason.error",
    budget_exhausted: "provenance.usage.finishReason.budget",
    tool_calls: "provenance.usage.finishReason.toolCalls",
    unknown: "provenance.usage.finishReason.unknown",
  };
  const key = known[reason];
  return key ? pt(key as Parameters<typeof pt>[0]) : reason;
}

function bucketColumns(): TableColumnsType<UsageBucketOut> {
  return [
    { title: "", dataIndex: "key", ellipsis: true },
    { title: pt("provenance.usage.calls"), dataIndex: "calls", width: 80 },
    {
      title: pt("provenance.usage.tokens"),
      dataIndex: "total_tokens",
      width: 110,
      render: (value: number | null) =>
        tokenText(value) ?? <Typography.Text type="secondary">{pt(UNKNOWN)}</Typography.Text>,
    },
    {
      title: pt("provenance.usage.duration"),
      dataIndex: "duration_ms",
      width: 100,
      render: (value: number | null) => durationText(value) ?? "-",
    },
    { title: pt("provenance.usage.retries"), dataIndex: "retries", width: 80 },
  ];
}

export default function UsageSummaryCard({
  summary,
  loading = false,
  error = null,
  onRetry,
}: Props) {
  useLocale();
  if (error) return <ErrorState description={error} onRetry={onRetry} />;
  if (loading) return <LoadingBlock tip={pt("provenance.usage.title")} />;
  if (!summary || summary.records === 0) {
    return <EmptyState inline description={pt("provenance.usage.empty")} />;
  }

  const amount = costAmount(summary.cost);
  const finishReasons = Object.entries(summary.totals.finish_reasons ?? {}).map(([key, calls]) => ({
    key,
    calls,
  }));
  return (
    <div data-usage-summary="1">
      <Typography.Text strong>{pt("provenance.usage.title")}</Typography.Text>
      <div style={{ fontSize: 12, color: "var(--rf-text-secondary)", marginBottom: 6 }}>
        {pt("provenance.usage.hint")}
      </div>
      <div className="usage-stat-grid" data-usage-totals="1">
        <div className="usage-stat">
          <span className="usage-stat-label">{pt("provenance.usage.stat.calls")}</span>
          <Typography.Text strong className="usage-stat-value">
            {summary.records}
          </Typography.Text>
        </div>
        <div className="usage-stat">
          <span className="usage-stat-label">{pt("provenance.usage.stat.tokens")}</span>
          <Typography.Text strong className="usage-stat-value">
            {tokenText(summary.totals.total_tokens) ?? pt(UNKNOWN)}
          </Typography.Text>
        </div>
        <div className="usage-stat">
          <span className="usage-stat-label">{pt("provenance.usage.cacheHit")}</span>
          <Typography.Text strong className="usage-stat-value">
            {tokenText(summary.totals.cache_hit_tokens ?? null) ?? pt(UNKNOWN)}
          </Typography.Text>
        </div>
        <div className="usage-stat">
          <span className="usage-stat-label">{pt("provenance.usage.cacheMiss")}</span>
          <Typography.Text strong className="usage-stat-value">
            {tokenText(summary.totals.cache_miss_tokens ?? null) ?? pt(UNKNOWN)}
          </Typography.Text>
        </div>
        <div className="usage-stat">
          <span className="usage-stat-label">{pt("provenance.usage.output")}</span>
          <Typography.Text strong className="usage-stat-value">
            {tokenText(summary.totals.completion_tokens) ?? pt(UNKNOWN)}
          </Typography.Text>
        </div>
        <div className="usage-stat">
          <span className="usage-stat-label">{pt("provenance.usage.stat.cost")}</span>
          <Typography.Text strong className="usage-stat-value">
            {amount === null
              ? pt("provenance.usage.costUnavailable")
              : pt("provenance.usage.cost.value", {
                  amount,
                  currency: summary.cost.currency,
                })}
          </Typography.Text>
          {amount !== null ? (
            <Typography.Text type="secondary" className="usage-stat-hint">
              {pt("provenance.usage.costEstimated")}
            </Typography.Text>
          ) : null}
        </div>
      </div>
      <div data-usage-cache="1">
        {(summary.totals.cache_unknown_calls ?? 0) > 0 ? (
          <Typography.Text type="secondary" className="usage-stat-note">
            {pt("provenance.usage.cacheUnknown", {
              count: summary.totals.cache_unknown_calls ?? 0,
            })}
          </Typography.Text>
        ) : null}
        {summary.unknown_token_records > 0 || hasUnknownTokens(summary.totals) ? (
          <Typography.Text type="secondary" className="usage-stat-note">
            {pt("provenance.usage.unknownTokens", { count: summary.unknown_token_records })}
          </Typography.Text>
        ) : null}
      </div>
      {finishReasons.length > 0 ? (
        <div data-usage-finish-reasons="1" style={{ marginBottom: 6 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {pt("provenance.usage.finishReasons")}
          </Typography.Text>
          <Table
            size="small"
            rowKey="key"
            pagination={false}
            dataSource={finishReasons}
            columns={[
              {
                title: "",
                dataIndex: "key",
                render: (value: string) => finishReasonLabel(value),
              },
              { title: pt("provenance.usage.calls"), dataIndex: "calls", width: 80 },
            ]}
            locale={{ emptyText: "-" }}
          />
        </div>
      ) : null}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {pt("provenance.usage.byTask")}
      </Typography.Text>
      <Table
        size="small"
        rowKey="key"
        pagination={false}
        columns={bucketColumns()}
        dataSource={summary.tasks}
        locale={{ emptyText: "-" }}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {pt("provenance.usage.byModel")}
      </Typography.Text>
      <Table
        size="small"
        rowKey="key"
        pagination={false}
        columns={bucketColumns()}
        dataSource={summary.models}
        locale={{ emptyText: "-" }}
      />
    </div>
  );
}
