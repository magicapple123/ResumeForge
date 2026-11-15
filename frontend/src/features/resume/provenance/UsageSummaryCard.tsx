// SPDX-License-Identifier: Apache-2.0
/**
 * 模型用量汇总（R04）：按任务/模型列调用数与 token；**未知 token 不给 0**，
 * 费用只在用户配置了单价时估算（当前后端一律 estimated=false）。
 *
 * 隐私：接口只回数字与枚举（后端测试逐列检查），本组件也不请求任何正文。
 */
import { Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import EmptyState from "../../../components/common/EmptyState";
import ErrorState from "../../../components/common/ErrorState";
import LoadingBlock from "../../../components/common/LoadingBlock";
import { pt, type ProvenanceMessageKey } from "./i18n";
import { usageTaskLabel } from "./usageTaskLabels";
import { costAmount, durationText, hasUnknownTokens, tokenText } from "./helpers";
import type { UsageBucketOut, UsageSummaryOut } from "./types";
import { useLocale } from "../../../i18n/i18nContext";

interface Props {
  summary: UsageSummaryOut | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

/** 四类外部用量的展示顺序与单位（单位文案在同一个命名空间里，便于一起翻译）。 */
function externalStats(
  external: NonNullable<UsageSummaryOut["external"]>,
): [ProvenanceMessageKey, ProvenanceMessageKey, number][] {
  return [
    ["provenance.usage.external.ocr", "provenance.usage.external.pages", external.ocr_pages],
    ["provenance.usage.external.tts", "provenance.usage.external.chars", external.tts_chars],
    // 秒数按整数展示：小数的秒对用户没有意义（0.4 秒写成 0 秒会像"没记"）。
    [
      "provenance.usage.external.asr",
      "provenance.usage.external.seconds",
      Math.round(external.asr_seconds),
    ],
    ["provenance.usage.external.search", "provenance.usage.external.calls", external.search_calls],
  ];
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

function bucketColumns(valueLabel?: (value: string) => string): TableColumnsType<UsageBucketOut> {
  return [
    {
      title: "",
      dataIndex: "key",
      ellipsis: true,
      // 按任务视图把协议码翻译成标签；按模型视图（valueLabel 缺省）模型名原样显示。
      render: (value: string) => (valueLabel ? valueLabel(value) : value),
    },
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
  // 老响应没有 external：整套按 0 兜底，而不是让整张卡抛错（升级瞬间的旧数据）。
  // 必须声明在下面的空态判据之前——空态判据要用它，写到后面就是 TDZ 报错。
  const external: UsageSummaryOut["external"] = summary?.external ?? {
    ocr_pages: 0,
    tts_chars: 0,
    asr_seconds: 0,
    search_calls: 0,
    window: { days: 0, since: null, until: null },
  };
  // records 只数 token 调用；OCR / 语音 / 搜索不会产生 token 记录，所以"没有 token 记录"
  // 不等于"什么用量都没有"（只做过 OCR 的用户会看到空态，那是在说谎）。
  const externalTotal =
    external.ocr_pages + external.tts_chars + external.asr_seconds + external.search_calls;
  if (!summary || (summary.records === 0 && externalTotal === 0)) {
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
      <div data-usage-external="1" style={{ marginTop: 10 }}>
        <Typography.Text strong>{pt("provenance.usage.external.title")}</Typography.Text>
        <div style={{ fontSize: 12, color: "var(--rf-text-secondary)", marginBottom: 6 }}>
          {pt("provenance.usage.external.hint")}
        </div>
        <div className="usage-stat-grid">
          {externalStats(external).map(([labelKey, unitKey, value]) => (
            <div className="usage-stat" key={labelKey}>
              <span className="usage-stat-label">{pt(labelKey)}</span>
              <Typography.Text strong className="usage-stat-value">
                {pt(unitKey, { count: value })}
              </Typography.Text>
            </div>
          ))}
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
        columns={bucketColumns(usageTaskLabel)}
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
