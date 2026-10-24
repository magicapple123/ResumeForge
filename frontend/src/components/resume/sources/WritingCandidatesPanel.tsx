// SPDX-License-Identifier: Apache-2.0
/**
 * 局部写作候选（W12 / P1-06）：精炼 / 突出方法 / 突出结果三条建议，先看差异再逐条采纳。
 *
 * ## 为什么是"两列对照"而不是行内高亮
 *
 * 这里比较的是"同一栏的原文 vs 建议"，而词级 diff 的唯一实现在后端（`resume_diff`）与
 * 版本对比组件里；为三条候选再写一份前端 diff 就是第二套实现。两列原文/建议 + 后端返回的
 * `original`/`result` 已经足够判断，且不会出现"前端高亮与后端 diff 不一致"。
 *
 * ## 过期与拒绝
 *
 * AI 迟到（base_revision 过期）与服务端事实锁拒绝都**不会**改正文：面板只显示原因与重试入口。
 */
import { BulbOutlined, CheckOutlined, CloseOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Space, Tag, Typography } from "antd";
import EmptyState from "../../common/EmptyState";
import { pt } from "../../../features/resume-provenance/i18n";
import {
  CANDIDATE_MODES,
  type CandidateMode,
  type WritingCandidateState,
} from "../../../features/resume-provenance/types";

interface Props {
  /** 三条候选的状态（由宿主 hook 维护）。 */
  states: WritingCandidateState[];
  /** 重新生成某一条。 */
  onGenerate?: (mode: CandidateMode) => void;
  /** 采纳某一条（宿主负责写库 + base_revision）。 */
  onAdopt?: (state: WritingCandidateState) => void;
  /** 丢弃某一条。 */
  onDiscard?: (mode: CandidateMode) => void;
  /** 服务端 409 业务码：事实锁 / 版本过期，分别给专门说明。 */
  conflictCode?: string | null;
}

const MODE_LABEL_KEYS: Record<CandidateMode, Parameters<typeof pt>[0]> = {
  concise: "provenance.candidate.concise",
  method: "provenance.candidate.method",
  result: "provenance.candidate.result",
};

function textStyle() {
  return {
    fontSize: 13,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    minWidth: 0,
  };
}

export default function WritingCandidatesPanel({
  states,
  onGenerate,
  onAdopt,
  onDiscard,
  conflictCode = null,
}: Props) {
  const anyContent = states.some((state) => state.status !== "idle");
  return (
    <div data-writing-candidates="1">
      <Space size={6} align="center" style={{ marginBottom: 6 }} wrap>
        <Typography.Text strong>{pt("provenance.candidate.title")}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {pt("provenance.candidate.hint")}
        </Typography.Text>
      </Space>

      {conflictCode === "fact_lock_conflict" ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          title={pt("provenance.lock.conflict")}
          description={pt("provenance.lock.conflict.hint")}
        />
      ) : conflictCode === "resume_revision_conflict" ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          title={pt("provenance.candidate.staleRevision")}
          description={pt("provenance.candidate.staleRevision.hint")}
        />
      ) : null}

      {!anyContent ? <EmptyState inline description={pt("provenance.candidate.hint")} /> : null}

      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        {CANDIDATE_MODES.map((mode) => {
          const state =
            states.find((item) => item.mode === mode) ??
            ({ mode, status: "idle", suggestion: null, errorMessage: "" } as WritingCandidateState);
          return (
            <div
              key={mode}
              data-candidate-mode={mode}
              style={{
                border: "1px solid var(--rf-border-subtle)",
                borderRadius: 8,
                padding: "8px 10px",
                background: "var(--rf-surface-alt)",
              }}
            >
              <Space size={6} wrap align="center" style={{ marginBottom: 4 }}>
                <Tag icon={<BulbOutlined />}>{pt(MODE_LABEL_KEYS[mode])}</Tag>
                {onGenerate ? (
                  <Button
                    size="small"
                    type="link"
                    icon={<ReloadOutlined />}
                    aria-label={pt(
                      state.status === "ready"
                        ? "provenance.candidate.regenerate"
                        : "provenance.candidate.generate",
                    )}
                    onClick={() => onGenerate(mode)}
                  >
                    {pt(
                      state.status === "ready"
                        ? "provenance.candidate.regenerate"
                        : "provenance.candidate.generate",
                    )}
                  </Button>
                ) : null}
              </Space>

              {state.status === "loading" ? (
                <Typography.Text type="secondary">
                  {pt("provenance.candidate.loading")}
                </Typography.Text>
              ) : null}
              {state.status === "error" ? (
                <Alert
                  type="error"
                  showIcon
                  title={pt("provenance.candidate.failed")}
                  description={state.errorMessage || pt("provenance.candidate.failed.hint")}
                />
              ) : null}
              {state.status === "stale" ? (
                <Alert
                  type="warning"
                  showIcon
                  title={pt("provenance.candidate.staleRevision")}
                  description={pt("provenance.candidate.staleRevision.hint")}
                />
              ) : null}
              {state.status === "ready" && state.suggestion ? (
                <>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
                    <div style={{ flex: "1 1 220px", ...textStyle() }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {pt("provenance.candidate.original")}
                      </Typography.Text>
                      <div>{state.suggestion.original}</div>
                    </div>
                    <div style={{ flex: "1 1 220px", ...textStyle() }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {pt("provenance.candidate.suggested")}
                      </Typography.Text>
                      <div>{state.suggestion.result}</div>
                    </div>
                  </div>
                  <Space size={8} wrap>
                    {onAdopt ? (
                      <Button
                        size="small"
                        type="primary"
                        icon={<CheckOutlined />}
                        aria-label={pt("provenance.candidate.adopt")}
                        onClick={() => onAdopt(state)}
                      >
                        {pt("provenance.candidate.adopt")}
                      </Button>
                    ) : null}
                    {onDiscard ? (
                      <Button
                        size="small"
                        type="text"
                        icon={<CloseOutlined />}
                        aria-label={pt("provenance.candidate.discard")}
                        onClick={() => onDiscard(mode)}
                      >
                        {pt("provenance.candidate.discard")}
                      </Button>
                    ) : null}
                  </Space>
                </>
              ) : null}
            </div>
          );
        })}
      </Space>
    </div>
  );
}
