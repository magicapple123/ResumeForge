// SPDX-License-Identifier: Apache-2.0
/**
 * W09 的「内容精简候选」列表（P1-04：内容精简先生成差异候选，不自动删）。
 *
 * 组件只负责把纯规则层（`features/resume-optimizer/contentCandidates`）产出的候选摆出来：
 * 改了哪几处、能省多少、溢出真实减少多少（可测量时用 probe 在预览里量一次）、
 * 以及"这个候选无法用 CSS 表达合并 → 应用后重新诊断"的如实说明。
 *
 * 应用动作交给宿主 `onApply`：宿主把候选里的 `content` 写回文档并记为**一步历史**
 * （撤销即可整体回退），本组件不直接调 API、不改内容。
 */
import { Alert, Button, Card, Space, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import { ot } from "../../../features/resume-optimizer/i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { overflowForTarget } from "../../../features/resume-optimizer/constraints";
import type {
  ContentCandidateKind,
  OptimizerContentCandidate,
} from "../../../features/resume-optimizer/types";
import type { LayoutMeasure } from "../../../utils/resumeLayoutMeasure";
import { pagesNeededFor } from "../../../utils/resumeLayoutMeasure";

const KIND_KEYS: Record<ContentCandidateKind, Parameters<typeof ot>[0]> = {
  "duplicate-entries": "optimizer.content.kind.duplicate-entries",
  "duplicate-points": "optimizer.content.kind.duplicate-points",
  "merge-short-points": "optimizer.content.kind.merge-short-points",
  "low-relevance-points": "optimizer.content.kind.low-relevance-points",
};

interface Props {
  candidates: readonly OptimizerContentCandidate[];
  /** 真实测量入口（宿主预览句柄）；不传 = 只显示省下多少，不声称页数。 */
  probe?: (css: string) => LayoutMeasure | null;
  before?: LayoutMeasure | null;
  targetPages: 1 | 2;
  disabled?: boolean;
  applying?: boolean;
  onApply?: (candidate: OptimizerContentCandidate) => void | Promise<void>;
}

interface Measured {
  overflowReduced: number;
  pagesAfter: number;
  fits: boolean;
}

function measureCandidates(
  candidates: readonly OptimizerContentCandidate[],
  probe: Props["probe"],
  before: Props["before"],
  targetPages: number,
): Record<string, Measured | null> {
  const result: Record<string, Measured | null> = {};
  for (const candidate of candidates) {
    if (!probe || !before || !candidate.measureCss) {
      result[candidate.key] = null;
      continue;
    }
    const after = probe(candidate.measureCss);
    if (!after) {
      result[candidate.key] = null;
      continue;
    }
    const overflowBefore = overflowForTarget(before, targetPages);
    const overflowAfter = overflowForTarget(after, targetPages);
    result[candidate.key] = {
      overflowReduced: Math.max(0, overflowBefore - overflowAfter),
      pagesAfter: pagesNeededFor(after),
      fits: overflowAfter <= 0.5,
    };
  }
  return result;
}

function statsText(candidate: OptimizerContentCandidate): string {
  const parts: string[] = [];
  const { entriesRemoved, pointsRemoved, pointsMerged, charsSaved } = candidate.stats;
  if (entriesRemoved > 0)
    parts.push(ot("optimizer.content.stats.entries", { count: entriesRemoved }));
  if (pointsRemoved > 0) parts.push(ot("optimizer.content.stats.points", { count: pointsRemoved }));
  if (pointsMerged > 0) parts.push(ot("optimizer.content.stats.merged", { count: pointsMerged }));
  if (charsSaved > 0) parts.push(ot("optimizer.content.stats.chars", { count: charsSaved }));
  return parts.join(" · ");
}

function itemText(candidate: OptimizerContentCandidate): string {
  const names = candidate.items
    .map((item) => item.label || ot("optimizer.content.untitled"))
    .join("\u3001");
  return candidate.itemCount > candidate.items.length
    ? `${names} ${ot("optimizer.content.itemCount", { count: candidate.itemCount })}`
    : names;
}

export default function ContentCandidateList({
  candidates,
  probe,
  before,
  targetPages,
  disabled = false,
  applying = false,
  onApply,
}: Props) {
  useLocale();
  const measured = useMemo(
    () => measureCandidates(candidates, probe, before, targetPages),
    [candidates, probe, before, targetPages],
  );
  const [appliedKey, setAppliedKey] = useState<string | null>(null);
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  /** 宿主写回失败：行内错误态（宿主可能已 toast，这里保证"失败不会被读成成功"）。 */
  const [applyError, setApplyError] = useState<{ key: string; message: string } | null>(null);

  if (candidates.length === 0) return null;

  const apply = async (candidate: OptimizerContentCandidate) => {
    if (!onApply) return;
    setApplyingKey(candidate.key);
    setApplyError(null);
    try {
      await onApply(candidate);
      setAppliedKey(candidate.key);
    } catch (error) {
      // 必须在这里接住：`void apply(...)` 里再向外抛会变成 unhandled rejection。
      // 宿主负责 toast 具体原因；组件渲染行内错误，并保持"未应用"状态可重试。
      setApplyError({
        key: candidate.key,
        message:
          error instanceof Error && error.message
            ? error.message
            : ot("optimizer.content.applyFailed.hint"),
      });
    } finally {
      setApplyingKey(null);
    }
  };

  return (
    <section className="resume-optimizer-content" aria-label={ot("optimizer.content.title")}>
      <Typography.Text strong>{ot("optimizer.content.title")}</Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {ot("optimizer.content.hint")}
      </Typography.Text>
      <Space orientation="vertical" size={8} style={{ width: "100%", marginTop: 6 }}>
        {candidates.map((candidate, index) => {
          const result = measured[candidate.key];
          const hiddenOnly =
            candidate.stats.entriesRemoved > 0 &&
            candidate.stats.visibleRemoved === 0 &&
            candidate.kind === "duplicate-entries";
          return (
            <Card
              key={candidate.key}
              size="small"
              data-content-candidate={candidate.kind}
              data-applied={appliedKey === candidate.key ? "true" : undefined}
            >
              <Space size={6} wrap align="center">
                <Typography.Text strong>{ot(KIND_KEYS[candidate.kind])}</Typography.Text>
                <Tag>{statsText(candidate)}</Tag>
              </Space>
              <div style={{ fontSize: 12, color: "var(--rf-text-secondary)", marginTop: 4 }}>
                {itemText(candidate)}
              </div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                {result
                  ? `${ot("optimizer.content.measure.reduced", {
                      value: Math.round(result.overflowReduced),
                    })} · ${
                      result.fits
                        ? ot("optimizer.content.measure.fits")
                        : ot("optimizer.content.measure.pages", { pages: result.pagesAfter })
                    }`
                  : ot("optimizer.content.measure.after")}
              </div>
              {hiddenOnly ? (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginTop: 6 }}
                  title={ot("optimizer.content.hiddenOnly")}
                />
              ) : null}
              <Button
                size="small"
                type="primary"
                style={{ marginTop: 6 }}
                loading={applyingKey === candidate.key}
                disabled={disabled || applying || !onApply}
                aria-label={ot("optimizer.content.apply.aria", { index: index + 1 })}
                onClick={() => void apply(candidate)}
              >
                {appliedKey === candidate.key
                  ? ot("optimizer.content.applied")
                  : ot("optimizer.content.apply")}
              </Button>
              {applyError?.key === candidate.key ? (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginTop: 6 }}
                  title={ot("optimizer.content.applyFailed")}
                  description={applyError.message}
                />
              ) : null}
            </Card>
          );
        })}
      </Space>
    </section>
  );
}
