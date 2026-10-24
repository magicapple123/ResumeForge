// SPDX-License-Identifier: Apache-2.0
/**
 * 「按条件优化版面」面板（W09 / P1-04）：约束 → 最多 3 个有差异候选 → 实测 → 应用到滑杆。
 *
 * ## 与「自动一页」的分工
 *
 * 自动一页是"从当前版式逐档收紧，够放下就停"；本面板多三件事：
 * 1. **用户约束**：不动字号 / 最小页边距 / 保持条目完整 / 目标 1–2 页；
 * 2. **最多 3 个有差异候选**，每个写清"改了哪些参数、溢出减少多少、可读性影响"；
 * 3. **应用是显式一步**：把候选里的数值交给宿主写回**滑杆**（用户看得见），
 *    W03 就绪后由宿主记为一步历史；本组件不直接写库、不自己缩字号。
 *
 * ## 无可行方案时
 *
 * 明确说明原因（锁定排除 / 没有可收紧项 / 试过仍放不下 / 没量到），**不弹成功提示**。
 */
import { InfoCircleOutlined, ThunderboltOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  InputNumber,
  Segmented,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useState } from "react";
import EmptyState from "../../common/EmptyState";
import { ot } from "../../../features/resume-optimizer/i18n";
import {
  evaluateCandidate,
  filterCandidates,
  fitsAlready,
  keepImproved,
  noFeasibleReason,
  pickCandidateSamples,
} from "../../../features/resume-optimizer/constraints";
import type {
  MeasuredCandidate,
  NoFeasibleReason,
  OptimizerCandidateView,
  OptimizerConstraints,
  OptimizerCurrentValues,
  ParameterChange,
} from "../../../features/resume-optimizer/types";
import type { LayoutMeasure } from "../../../utils/resumeLayoutMeasure";
import type { ResumeLayoutAnalysis } from "../../../types/resumeLayout";

interface Props {
  /** 版面诊断结果（来自既有 `/layout/analyze`，含 fit_ladder）。 */
  analysis: ResumeLayoutAnalysis | null;
  /** 当前生效的四个排版参数值（宿主从 layout 解析）。 */
  current: OptimizerCurrentValues;
  /** 真实测量：注入候选 CSS 后返回实测高度（宿主从预览句柄提供）。 */
  probe?: (css: string) => LayoutMeasure | null;
  /** 当前实测（before）；没有它就不生成候选。 */
  before?: LayoutMeasure | null;
  /** 应用候选：宿主写回滑杆 + 记为一步历史（W03 就绪后接）。 */
  onApply?: (candidate: OptimizerCandidateView) => void | Promise<void>;
  disabled?: boolean;
  /** 宿主正在保存（应用按钮转圈并禁用）。 */
  applying?: boolean;
  /** PATCH 409 的业务码（参数被其他窗口改过）。 */
  conflictCode?: string | null;
}

const DEFAULT_CONSTRAINTS: OptimizerConstraints = {
  lockFont: false,
  minMarginMm: null,
  keepEntriesWhole: true,
  targetPages: 1,
};

const REASON_KEYS: Record<NoFeasibleReason, Parameters<typeof ot>[0]> = {
  no_ladder: "optimizer.empty",
  locked_out: "optimizer.noFeasible.locked",
  still_overflow: "optimizer.noFeasible.stillOverflow",
  no_room: "optimizer.noFeasible.noRoom",
  no_measure: "optimizer.noMeasure",
};

const READABILITY_KEYS = {
  none: "optimizer.candidate.readability.none",
  mild: "optimizer.candidate.readability.mild",
  noticeable: "optimizer.candidate.readability.noticeable",
} as const;

const READABILITY_COLORS: Record<string, string> = {
  none: "green",
  mild: "blue",
  noticeable: "orange",
};

function formatValue(key: ParameterChange["key"], value: number): string {
  if (key === "page_padding") return String(Math.round(value * 100) / 100);
  return String(Math.round(value * 1000) / 1000);
}

function changeText(change: ParameterChange): string {
  const from = formatValue(change.key, change.from);
  const to = formatValue(change.key, change.to);
  if (change.key === "page_padding") return ot("optimizer.change.padding", { from, to });
  if (change.key === "section_gap") return ot("optimizer.change.sectionGap", { from, to });
  if (change.key === "line_height") return ot("optimizer.change.lineHeight", { from, to });
  return ot("optimizer.change.fontScale", { from, to });
}

export default function LayoutOptimizerPanel({
  analysis,
  current,
  probe,
  before = null,
  onApply,
  disabled = false,
  applying = false,
  conflictCode = null,
}: Props) {
  const { message } = App.useApp();
  const [constraints, setConstraints] = useState<OptimizerConstraints>(DEFAULT_CONSTRAINTS);
  const [candidates, setCandidates] = useState<MeasuredCandidate[] | null>(null);
  const [noReason, setNoReason] = useState<NoFeasibleReason | null>(null);
  const [alreadyFits, setAlreadyFits] = useState(false);
  const [tried, setTried] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [appliedKey, setAppliedKey] = useState<string | null>(null);
  const [applyingKey, setApplyingKey] = useState<string | null>(null);

  const patch = (next: Partial<OptimizerConstraints>) => {
    setConstraints((values) => ({ ...values, ...next }));
    // 约束一变，旧候选就不再代表当前条件——清掉，避免用户按旧结论应用。
    setCandidates(null);
    setNoReason(null);
    setAlreadyFits(false);
    setAppliedKey(null);
  };

  const generate = () => {
    setCandidates(null);
    setNoReason(null);
    setAlreadyFits(false);
    setAppliedKey(null);
    if (!analysis || !before || !probe) {
      setNoReason("no_measure");
      return;
    }
    if (fitsAlready(before, constraints.targetPages)) {
      setAlreadyFits(true);
      return;
    }
    setGenerating(true);
    try {
      const filter = filterCandidates(analysis.fit_ladder, current, constraints);
      const samples = pickCandidateSamples(filter.views, 3);
      setTried(samples.length);
      const measured: MeasuredCandidate[] = [];
      for (const view of samples) {
        const after = probe(view.css);
        if (!after) continue;
        measured.push(evaluateCandidate(view, before, after, constraints.targetPages));
      }
      const improved = keepImproved(measured);
      setCandidates(improved);
      setNoReason(
        noFeasibleReason({
          hasBefore: true,
          ladderLength: analysis.fit_ladder.length,
          filter,
          measured,
        }),
      );
    } finally {
      setGenerating(false);
    }
  };

  const apply = async (candidate: MeasuredCandidate) => {
    if (!onApply) return;
    setApplyingKey(candidate.key);
    try {
      await onApply(candidate);
      setAppliedKey(candidate.key);
      message.success(ot("optimizer.applied"));
    } catch {
      // 失败时不标记已应用（宿主负责给出具体原因；这里不假装成功）。
    } finally {
      setApplyingKey(null);
    }
  };

  const hasAnalysis = Boolean(analysis);
  const canGenerate = hasAnalysis && Boolean(before) && Boolean(probe) && !disabled;

  return (
    <div data-layout-optimizer="1">
      <Space size={8} align="center" style={{ marginBottom: 6 }} wrap>
        <Typography.Text strong>{ot("optimizer.title")}</Typography.Text>
        <Tooltip title={ot("optimizer.hint")}>
          <Button
            type="text"
            size="small"
            icon={<InfoCircleOutlined />}
            aria-label={ot("optimizer.hint")}
          />
        </Tooltip>
      </Space>

      {conflictCode === "resume_revision_conflict" ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          title={ot("optimizer.conflict")}
          description={ot("optimizer.conflict.hint")}
        />
      ) : null}

      <Card size="small" style={{ marginBottom: 8 }}>
        <Space orientation="vertical" size={6} style={{ width: "100%" }}>
          <Space size={12} wrap>
            <Checkbox
              checked={constraints.lockFont}
              disabled={disabled || undefined}
              onChange={(event) => patch({ lockFont: event.target.checked })}
            >
              {ot("optimizer.lockFont")}
            </Checkbox>
            <Checkbox
              checked={constraints.keepEntriesWhole}
              disabled={disabled || undefined}
              onChange={(event) => patch({ keepEntriesWhole: event.target.checked })}
            >
              {ot("optimizer.keepEntries")}
            </Checkbox>
          </Space>
          <Space size={8} wrap>
            <Typography.Text style={{ fontSize: 12 }}>{ot("optimizer.minMargin")}</Typography.Text>
            <InputNumber
              size="small"
              min={0}
              max={26}
              step={0.5}
              style={{ width: 90 }}
              value={constraints.minMarginMm ?? undefined}
              placeholder={ot("optimizer.minMargin.off")}
              aria-label={ot("optimizer.minMargin")}
              disabled={disabled || undefined}
              onChange={(value) => patch({ minMarginMm: typeof value === "number" ? value : null })}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {ot("optimizer.minMargin.hint")}
            </Typography.Text>
          </Space>
          <Space size={8} wrap>
            <Typography.Text style={{ fontSize: 12 }}>{ot("optimizer.target")}</Typography.Text>
            <Segmented
              size="small"
              value={constraints.targetPages}
              disabled={disabled || undefined}
              aria-label={ot("optimizer.target")}
              options={[
                { value: 1, label: ot("optimizer.target.pages", { count: 1 }) },
                { value: 2, label: ot("optimizer.target.pages", { count: 2 }) },
              ]}
              onChange={(value) => patch({ targetPages: value === 2 ? 2 : 1 })}
            />
          </Space>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={generating}
            disabled={!canGenerate || undefined}
            aria-label={candidates ? ot("optimizer.regenerate") : ot("optimizer.generate")}
            onClick={generate}
          >
            {candidates ? ot("optimizer.regenerate") : ot("optimizer.generate")}
          </Button>
        </Space>
      </Card>

      {conflictCode !== "resume_revision_conflict" && noReason ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          title={ot(REASON_KEYS[noReason])}
          description={
            tried > 0 ? ot("optimizer.tried", { count: tried }) : ot("optimizer.noFeasible.locked")
          }
        />
      ) : null}

      {alreadyFits ? <EmptyState inline description={ot("optimizer.empty")} /> : null}

      {!alreadyFits && noReason === null && candidates !== null && candidates.length === 0 ? (
        <EmptyState inline description={ot("optimizer.noFeasible.stillOverflow")} />
      ) : null}

      {candidates && candidates.length > 0 ? (
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {ot("optimizer.candidates.hint", { count: candidates.length })}
          </Typography.Text>
          {candidates.map((candidate, index) => (
            <Card key={candidate.key} size="small" data-optimizer-candidate={candidate.key}>
              <Space size={6} wrap align="center" style={{ marginBottom: 4 }}>
                <Typography.Text strong>{candidate.label}</Typography.Text>
                <Tag color={candidate.fits ? "green" : "orange"}>
                  {candidate.fits
                    ? ot("optimizer.candidate.fits")
                    : ot("optimizer.candidate.notFits")}
                </Tag>
                <Tag color={READABILITY_COLORS[candidate.readability]}>
                  {ot(READABILITY_KEYS[candidate.readability])}
                </Tag>
              </Space>
              <div style={{ fontSize: 12, color: "var(--rf-text-secondary)" }}>
                {ot("optimizer.candidate.changesColon")}
              </div>
              <ul style={{ margin: "2px 0 4px", paddingInlineStart: 18, fontSize: 13 }}>
                {candidate.changes.map((change) => (
                  <li key={change.key}>{changeText(change)}</li>
                ))}
              </ul>
              <Space size={10} wrap>
                <Typography.Text style={{ fontSize: 12 }}>
                  {ot("optimizer.candidate.overflow", {
                    value: Math.round(candidate.overflowReduced),
                  })}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {ot("optimizer.candidate.pages", { pages: candidate.pagesAfter })}
                </Typography.Text>
                {candidate.fontDeltaPercent !== null && analysis ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {ot("optimizer.candidate.fontNote", {
                      percent: candidate.fontDeltaPercent,
                      floor: analysis.fit_room.font_floor_px,
                    })}
                  </Typography.Text>
                ) : null}
              </Space>
              <div style={{ marginTop: 6 }}>
                <Button
                  size="small"
                  disabled={disabled || applying || appliedKey === candidate.key || undefined}
                  loading={applyingKey === candidate.key || undefined}
                  aria-label={ot("optimizer.apply.aria", { index: index + 1 })}
                  onClick={() => void apply(candidate)}
                >
                  {ot("optimizer.apply")}
                </Button>
                {appliedKey === candidate.key ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12, marginInlineStart: 8 }}>
                    {ot("optimizer.applied.hint")}
                  </Typography.Text>
                ) : null}
              </div>
            </Card>
          ))}
        </Space>
      ) : null}
    </div>
  );
}
