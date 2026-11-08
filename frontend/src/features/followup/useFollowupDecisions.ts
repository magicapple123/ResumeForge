// SPDX-License-Identifier: Apache-2.0
/**
 * 跟进巡检卡的状态机（T06）：选择 / 整卡提交 / 按响应回写 / 幂等提示。
 *
 * 三件容易写错的事，都在这里收口：
 * 1. **轮询不得覆盖本地结果**：任务卡每 5 秒轮询一次列表，提交响应已经给出权威步骤
 *    状态；本地用"按 step_index 覆盖"的方式合并到最新 prop 上，而不是用旧快照整卡替换。
 * 2. **重复点击不重复提交**：`submitting` 在请求期间锁住按钮；后端本身也幂等，但前端
 *    不该靠后端兜底来避免双击。
 * 3. **后端返回的 status 是字符串**：认识才采用（见 followupDecisions.resolveFollowupStatus），
 *    避免把未知协议值写进 AgentTask.status。
 */
import { App } from "antd";
import { useCallback, useMemo, useRef, useState } from "react";
import type { AgentTask, AgentTaskStatus, AgentTaskStep } from "../../api/agentTasks";
import { submitFollowupDecisions, type FollowupDecision } from "../../api/followups";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import {
  applyFollowupResponse,
  buildFollowupDecisions,
  followupBucketKind,
  incompleteFollowupCount,
  isFollowupDone,
  selectedFollowupCount,
  type FollowupSelections,
  type FollowupStepKind,
} from "./followupDecisions";

interface LocalSubmission {
  taskId: number;
  steps: Record<number, AgentTaskStep>;
  status: AgentTaskStatus;
}

export interface FollowupDecisionsController {
  /** 合并了本地提交结果的任务（未提交时就是传入的 task）。 */
  task: AgentTask;
  kind: FollowupStepKind | null;
  selections: FollowupSelections;
  select: (stepIndex: number, decision: FollowupDecision) => void;
  selectedCount: number;
  incompleteCount: number;
  submitting: boolean;
  done: boolean;
  submit: () => Promise<void>;
}

export function useFollowupDecisions(initial: AgentTask): FollowupDecisionsController {
  useLocale();
  const { message } = App.useApp();
  // 任务卡按 task.id 复用行；换卡时（id 变）这两份本地状态都必须作废，否则会把上张卡
  // 的选择带过来。用渲染期守卫式调整，而不是 effect——避免先渲染一帧旧选择。
  const [local, setLocal] = useState<LocalSubmission | null>(null);
  const [selectionState, setSelectionState] = useState<{ taskId: number; map: FollowupSelections }>(
    {
      taskId: initial.id,
      map: {},
    },
  );
  const [submitting, setSubmitting] = useState(false);
  // 同步锁：setState 要等下一次渲染才生效，同一帧里的第二次点击读到的 submitting 仍是 false。
  const submittingRef = useRef(false);
  if (local !== null && local.taskId !== initial.id) setLocal(null);
  if (selectionState.taskId !== initial.id) setSelectionState({ taskId: initial.id, map: {} });

  const overrides = local !== null && local.taskId === initial.id ? local : null;
  const task = useMemo<AgentTask>(() => {
    if (!overrides) return initial;
    const steps = initial.steps.map((step) => overrides.steps[step.step_index] ?? step);
    return { ...initial, steps, status: overrides.status };
  }, [initial, overrides]);

  const selections = selectionState.map;
  const kind = followupBucketKind(task);
  const selectedCount = selectedFollowupCount(task, selections);
  const incompleteCount = incompleteFollowupCount(task, selections);
  const done = isFollowupDone(task);

  const select = useCallback(
    (stepIndex: number, decision: FollowupDecision) => {
      setSelectionState((current) => {
        const base = current.taskId === task.id ? current : { taskId: task.id, map: {} };
        return { taskId: task.id, map: { ...base.map, [stepIndex]: decision } };
      });
    },
    [task.id],
  );

  const submit = useCallback(async () => {
    if (submittingRef.current) return;
    const decisions = buildFollowupDecisions(task, selections);
    if (decisions.length === 0) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const response = await submitFollowupDecisions(task.id, decisions);
      const next = applyFollowupResponse(task, response);
      setLocal({
        taskId: next.id,
        steps: Object.fromEntries(next.steps.map((step) => [step.step_index, step])),
        status: next.status,
      });
      setSelectionState({ taskId: next.id, map: {} });
      message.success(
        response.idempotent
          ? t("followupSweep.toast.idempotent")
          : t("followupSweep.toast.submitted", {
              count: response.decided > 0 ? response.decided : decisions.length,
            }),
      );
    } catch (error) {
      message.error(
        error instanceof Error && error.message.trim()
          ? error.message
          : t("followupSweep.error.submit"),
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [message, selections, task]);

  return {
    task,
    kind,
    selections,
    select,
    selectedCount,
    incompleteCount,
    submitting,
    done,
    submit,
  };
}
