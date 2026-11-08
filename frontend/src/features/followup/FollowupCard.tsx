// SPDX-License-Identifier: Apache-2.0
/**
 * 跟进巡检卡（T06）：一张卡里最多 5 个岗位，每个岗位三选一，整卡一次提交。
 *
 * 形态（契约 A 节 + 计划 §6.1.2）：
 * - 卡标题来自后端模板（数据，由 AgentTaskRow 展示），这里只显示桶名与桶说明；
 * - 每个 step 一行：岗位文案 + 三选一（已联系 / 对方已回 / 不跟了）；
 * - 一个整卡提交按钮；全部步骤已处理时不再出现按钮，只显示「这张卡已处理完」。
 *
 * 「确认状态」桶**没有**任何"发跟进"动作：长期没有记录到状态变化时先请用户确认状态，
 * 此时再提供一个催跟进按钮等于拿旧数据制造噪音。两类桶都只提供三种决策。
 */
import { Alert, Button, Radio, Tag, Typography } from "antd";
import type { AgentTask, AgentTaskStep } from "../../api/agentTasks";
import type { FollowupDecision } from "../../api/followups";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { STEP_STATUS_LABEL_KEYS } from "../assistant/tasks/agentTaskView";
import { trackIdOfStep, type FollowupStepKind } from "./followupDecisions";
import { useFollowupDecisions } from "./useFollowupDecisions";
import "../../styles/followup.css";

/** 三种处理方式：value 是提交给后端的协议值，label 是语言包 key。 */
const DECISION_OPTIONS: ReadonlyArray<{ value: FollowupDecision; labelKey: MessageKey }> = [
  { value: "contacted", labelKey: "followupSweep.decision.contacted" },
  { value: "replied", labelKey: "followupSweep.decision.replied" },
  { value: "stopped", labelKey: "followupSweep.decision.stopped" },
];

const KIND_LABEL_KEYS: Record<FollowupStepKind, MessageKey> = {
  followup: "followupSweep.kind.followup",
  confirm: "followupSweep.kind.confirm",
};

const KIND_HINT_KEYS: Record<FollowupStepKind, MessageKey> = {
  followup: "followupSweep.kindHint.followup",
  confirm: "followupSweep.kindHint.confirm",
};

interface Props {
  task: AgentTask;
}

export default function FollowupCard({ task: initial }: Props) {
  useLocale();
  const {
    task,
    kind,
    selections,
    select,
    selectedCount,
    incompleteCount,
    submitting,
    done,
    submit,
  } = useFollowupDecisions(initial);

  return (
    <section
      className="followup-card"
      data-testid={`followup-card-${task.id}`}
      aria-label={t("followupSweep.aria.card")}
    >
      {kind ? (
        <div className="followup-card-head">
          <Tag color="processing">{t(KIND_LABEL_KEYS[kind])}</Tag>
          <Typography.Text type="secondary">{t(KIND_HINT_KEYS[kind])}</Typography.Text>
        </div>
      ) : null}
      <ol className="followup-card-steps">
        {task.steps
          .slice()
          .sort((left, right) => left.step_index - right.step_index)
          .map((step) => (
            <FollowupStepRow
              key={step.step_index}
              taskId={task.id}
              step={step}
              decision={selections[step.step_index]}
              onSelect={select}
            />
          ))}
      </ol>
      {done ? (
        <Alert type="success" showIcon title={t("followupSweep.state.done")} />
      ) : (
        <div className="followup-card-actions">
          {incompleteCount > 0 ? (
            <Typography.Text type="secondary" data-testid={`followup-incomplete-${task.id}`}>
              {selectedCount > 0
                ? t("followupSweep.hint.partial", { count: incompleteCount })
                : t("followupSweep.hint.incomplete", { count: incompleteCount })}
            </Typography.Text>
          ) : null}
          <Button
            type="primary"
            loading={submitting}
            disabled={selectedCount === 0}
            onClick={() => void submit()}
            data-testid={`followup-submit-${task.id}`}
          >
            {t("followupSweep.action.submit", { count: selectedCount })}
          </Button>
        </div>
      )}
    </section>
  );
}

interface StepRowProps {
  taskId: number;
  step: AgentTaskStep;
  decision: FollowupDecision | undefined;
  onSelect: (stepIndex: number, decision: FollowupDecision) => void;
}

function FollowupStepRow({ taskId, step, decision, onSelect }: StepRowProps) {
  const done = step.status === "done" || step.status === "skipped";
  const trackId = trackIdOfStep(step);
  return (
    <li
      className="followup-card-step"
      data-testid={`followup-step-${taskId}-${step.step_index}`}
      data-step-kind={step.kind}
    >
      <span className="followup-card-step-title">{step.title}</span>
      {done ? (
        <Tag color="success">{t("followupSweep.state.stepDone")}</Tag>
      ) : trackId === null ? (
        // 防御性分支：协议里每个 step 都带 track_id；缺了就不能提交（后端会 422），
        // 这里如实显示步骤状态，不编一个能点的动作。
        <Tag>{t(STEP_STATUS_LABEL_KEYS[step.status])}</Tag>
      ) : (
        <Radio.Group
          className="followup-card-decisions"
          aria-label={t("followupSweep.decision.aria", { title: step.title })}
          value={decision}
          optionType="button"
          buttonStyle="solid"
          size="small"
          options={DECISION_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.labelKey),
          }))}
          onChange={(event) => onSelect(step.step_index, event.target.value as FollowupDecision)}
        />
      )}
    </li>
  );
}
