// SPDX-License-Identifier: Apache-2.0
/**
 * 统一检查面板（W11 / P0-04）：三层分组 + 三级严重度 + 计数 + "只显示必须解决"。
 *
 * 只读面板：不自动跑检查（用户点按钮）、不改简历、不阻塞保存/导出。请求编排在
 * `usePreflight`（快照守卫/取消/单飞），本组件只负责展示与分派修复动作。
 */
import { ReloadOutlined } from "@ant-design/icons";
import { Alert, App, Button, Switch, Tag, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import EmptyState from "../../common/EmptyState";
import ErrorState from "../../common/ErrorState";
import LoadingBlock from "../../common/LoadingBlock";
import type { MessageKey } from "../../../i18n";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import {
  compareRecheck,
  countBySeverity,
  filterBlockersOnly,
  groupIssues,
} from "../../../features/resume-preflight/model";
import type {
  CheckFix,
  CheckFixAction,
  CheckIssue,
  CheckLayer,
  FontCoveragePayload,
  PreflightOut,
} from "../../../features/resume-preflight/types";
import type { PreflightStatus } from "../../../features/resume-preflight/usePreflight";
import CheckIssueRow from "./CheckIssueRow";
import FontCoverageCard from "./FontCoverageCard";

const LAYER_LABEL_KEY: Record<CheckLayer, MessageKey> = {
  content: "preflight.layer.content",
  layout: "preflight.layer.layout",
  product: "preflight.layer.product",
};

interface Props {
  status: PreflightStatus;
  result: PreflightOut | null;
  error: string;
  stale: boolean;
  running: boolean;
  onRun: () => void;
  onCancel: () => void;
  /** 宿主分派修复动作；不传 = 所有修复按钮都不渲染。 */
  onFix?: (fix: CheckFix) => void;
  availableFixActions?: ReadonlySet<CheckFixAction>;
  /** ATS 完整报告入口（短期并存，契约 §4.9 Q3）。 */
  onOpenAts?: () => void;
  /** 测试可注入；默认从 result.font_coverage 取。 */
  fontCoverage?: FontCoveragePayload | null;
}

export default function CheckPanel({
  status,
  result,
  error,
  stale,
  running,
  onRun,
  onCancel,
  onFix,
  availableFixActions,
  onOpenAts,
  fontCoverage,
}: Props) {
  useLocale();
  const { message } = App.useApp();
  const [blockersOnly, setBlockersOnly] = useState(false);
  const pendingRef = useRef<ReadonlySet<string>>(new Set());
  const [hasPending, setHasPending] = useState(false);
  const previousIssuesRef = useRef<readonly CheckIssue[]>([]);

  // 复检比对：修复过的条目在下一份结果里消失 → 明确告诉用户"已解决 N 条"。
  // 只在 result 变化时跑：pending 集合放 ref，不把"清除 pending"写进依赖（否则会自激）。
  useEffect(() => {
    if (!result) return;
    // 后端字段缺失（老版本 / 部分层）不能让整页崩：一律按空数组兜底。
    const issues = result.issues ?? [];
    if (pendingRef.current.size > 0) {
      const comparison = compareRecheck(previousIssuesRef.current, issues);
      const resolved = comparison.resolved.length;
      if (resolved > 0) {
        message.success(t("preflight.recheck.resolved", { count: resolved }));
      }
      pendingRef.current = new Set();
      setHasPending(false);
    }
    previousIssuesRef.current = issues;
  }, [message, result]);

  /** 修复入口：先交给宿主，再把这条记为"待复检"（下一次结果到达时比对）。 */
  const handleFix = (issue: CheckIssue, fix: CheckFix) => {
    onFix?.(fix);
    pendingRef.current = new Set(pendingRef.current).add(issue.id);
    setHasPending(true);
  };

  const idle = status === "idle" && !result;
  const firstLoading = status === "loading" && !result;
  const firstError = status === "error" && !result;
  // 后端字段缺失时的统一兜底：下面所有 `.length` 都读这份，不再直接摸 `result.issues`。
  const issues = result?.issues ?? [];
  const counts = result ? countBySeverity(issues) : null;
  const coverage = fontCoverage ?? result?.font_coverage ?? null;
  const groups = result ? groupIssues(filterBlockersOnly(issues, blockersOnly)) : [];
  const filteredEmpty = Boolean(result && issues.length > 0 && groups.length === 0);
  const snapshotHash = (result?.snapshot?.content_sha256 ?? "").slice(0, 8);

  const runLabel = result ? t("preflight.action.recheck") : t("preflight.action.run");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Button
          type="primary"
          size="small"
          icon={<ReloadOutlined />}
          loading={running}
          onClick={onRun}
          // 显式可访问名：图标（`role="img"` + aria-label="reload"）会混进按钮名，
          // 读屏与测试都会读成「reload 开始检查」。这里钉成与文案一致的唯一名字。
          aria-label={runLabel}
        >
          {runLabel}
        </Button>
        {running ? (
          <Button size="small" onClick={onCancel}>
            {t("preflight.action.cancel")}
          </Button>
        ) : null}
        {counts ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("preflight.summary", {
              blocker: counts.blocker,
              verify: counts.verify,
              suggestion: counts.suggestion,
            })}
          </Typography.Text>
        ) : null}
        <span style={{ flex: "1 1 auto" }} />
        <Typography.Text style={{ fontSize: 12 }}>{t("preflight.filter.blockers")}</Typography.Text>
        <Switch
          size="small"
          aria-label={t("preflight.filter.blockers")}
          checked={blockersOnly}
          onChange={setBlockersOnly}
        />
        {onOpenAts ? (
          <Button size="small" type="link" onClick={onOpenAts}>
            {t("preflight.ats.open")}
          </Button>
        ) : null}
      </div>

      {stale ? <Alert type="warning" showIcon title={t("preflight.status.stale")} /> : null}
      {status === "error" && result ? (
        <Alert
          type="error"
          showIcon
          title={t("preflight.error.title")}
          description={error}
          action={
            <Button size="small" onClick={onRun}>
              {t("preflight.error.retry")}
            </Button>
          }
        />
      ) : null}

      {idle ? (
        // 空态只给说明：**入口只有顶部那一颗「开始检查」**（2026-10-29 用户反馈"卡片上有两个
        // 开始检查按钮"）。同一屏里两颗同名主按钮既像重复，也让人猜哪一颗才生效。
        <EmptyState inline description={t("preflight.status.idle")} />
      ) : null}
      {firstLoading ? <LoadingBlock tip={t("preflight.status.loading")} /> : null}
      {firstError ? (
        <ErrorState
          description={error || t("preflight.error.generic")}
          onRetry={onRun}
          retryLabel={t("preflight.error.retry")}
        />
      ) : null}

      {result ? (
        <>
          <FontCoverageCard coverage={coverage} />
          {issues.length === 0 ? (
            <EmptyState
              inline
              description={
                <>
                  <div>{t("preflight.empty.title")}</div>
                  <div>{t("preflight.empty.description")}</div>
                </>
              }
            />
          ) : null}
          {filteredEmpty ? <EmptyState inline description={t("preflight.empty.filtered")} /> : null}
          {groups.map((group) => (
            <section key={group.layer}>
              <Typography.Text strong>
                {t("preflight.layer.groupLabel", {
                  layer: t(LAYER_LABEL_KEY[group.layer]),
                  count: group.issues.length,
                })}
              </Typography.Text>
              <ul style={{ margin: "4px 0 0", padding: 0 }}>
                {group.issues.map((issue) => (
                  <CheckIssueRow
                    key={issue.id}
                    issue={issue}
                    onFix={onFix ? (fix) => handleFix(issue, fix) : undefined}
                    availableFixActions={availableFixActions}
                  />
                ))}
              </ul>
            </section>
          ))}
          {hasPending ? <Tag color="processing">{t("preflight.issue.pendingRecheck")}</Tag> : null}
          {result.disclaimer ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("preflight.disclaimer.line", {
                label: t("preflight.disclaimer.label"),
                text: result.disclaimer,
              })}
            </Typography.Text>
          ) : null}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("preflight.snapshot.line", {
              label: t("preflight.snapshot.label"),
              hash: snapshotHash,
            })}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("preflight.hint")}
          </Typography.Text>
        </>
      ) : null}
    </div>
  );
}
