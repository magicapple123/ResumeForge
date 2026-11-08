// SPDX-License-Identifier: Apache-2.0
/**
 * 首页「任务」卡里的一行：标题 + 状态标签 + **[来源徽标]** + 进度 + 操作按钮 + 可展开的步骤清单。
 *
 * 按钮口径按任务状态给，**不按分区猜**：
 * - draft → 开始；paused → 继续；waiting_approval → 去确认（展开步骤给用户看等哪一步）；
 * - running/draft/paused/waiting_approval → 取消任务；终态不提供任何操作。
 *
 * 展开状态由卡片层持有（T03 手风琴：同一时间只展开一条），本组件只消费 `expanded` 与
 * `onToggleExpanded`。展开后给「当前这步」加粗并在后面加「当前」标签。
 *
 * 来源徽标（T26 收尾）：提醒到期自动生成的任务卡没有会话归属，用户需要知道它是不是
 * 自己刚建的。`manual` 不加徽标，其余来源由 `sourceBadgeKey` 决定。
 *
 * 跟进巡检卡（T06）是另一种形态：一张卡最多 5 个沉默岗位，每个岗位三选一、整卡一次
 * 提交。它没有"开始/继续/取消"这些通用任务动作，步骤也不藏在展开里（最多 5 条，直接
 * 铺开），所以整行交给 `FollowupCard`，通用按钮一个都不留——「确认状态」桶更不该出现
 * 任何"发跟进"类动作（长期没更新时先请用户确认状态）。
 */
import { Button, Space, Tag, Typography } from "antd";
import type { AgentTask } from "../../../api/agentTasks";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import FollowupCard from "../../followup/FollowupCard";
import { isFollowupTask } from "../../followup/followupDecisions";
import {
  STATUS_LABEL_KEYS,
  STATUS_TAG_COLORS,
  STEP_STATUS_LABEL_KEYS,
  bucketOf,
  currentStepIndex,
  progressOf,
  sourceBadgeKey,
} from "./agentTaskView";

interface Props {
  task: AgentTask;
  expanded: boolean;
  onToggleExpanded: () => void;
  onStart: (taskId: number) => void;
  onResume: (taskId: number) => void;
  onCancel: (taskId: number) => void;
}

export default function AgentTaskRow({
  task,
  expanded,
  onToggleExpanded,
  onStart,
  onResume,
  onCancel,
}: Props) {
  useLocale();
  // 跟进巡检卡：整行交给 FollowupCard（决策按钮 + 整卡提交），不渲染通用任务动作。
  if (isFollowupTask(task)) {
    return (
      <li data-testid={`agent-task-${task.id}`} style={{ display: "grid", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            title={task.title}
            style={{
              flex: "1 1 160px",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {task.title}
          </span>
          <Tag data-testid={`agent-task-source-${task.id}`}>{t("followupSweep.sourceBadge")}</Tag>
        </div>
        <FollowupCard task={task} />
      </li>
    );
  }
  const { current, total } = progressOf(task);
  const waiting = task.status === "waiting_approval";
  const sourceKey = sourceBadgeKey(task);
  // T03：第一个未完成的步骤就是"当前这步"；全部完成时不高亮任何一步。
  const activeStepIndex = currentStepIndex(task);

  return (
    <li data-testid={`agent-task-${task.id}`} style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          title={task.title}
          style={{
            flex: "1 1 160px",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {task.title}
        </span>
        <Tag color={STATUS_TAG_COLORS[task.status]}>{t(STATUS_LABEL_KEYS[task.status])}</Tag>
        {sourceKey ? (
          <Tag data-testid={`agent-task-source-${task.id}`}>
            {t(sourceKey, { source: task.source })}
          </Tag>
        ) : null}
        <Typography.Text type="secondary">
          {t("assistantUi.tasks.progress", { current, total })}
        </Typography.Text>
        <Space size={4}>
          {task.status === "draft" ? (
            <Button size="small" onClick={() => onStart(task.id)}>
              {t("assistantUi.tasks.action.start")}
            </Button>
          ) : null}
          {task.status === "paused" ? (
            <Button size="small" onClick={() => onResume(task.id)}>
              {t("assistantUi.tasks.action.resume")}
            </Button>
          ) : null}
          {waiting ? (
            <Button size="small" type="primary" onClick={onToggleExpanded}>
              {t("assistantUi.tasks.action.review")}
            </Button>
          ) : null}
          {bucketOf(task.status) !== "finished" ? (
            <Button size="small" danger onClick={() => onCancel(task.id)}>
              {t("assistantUi.tasks.action.cancel")}
            </Button>
          ) : null}
          <Button size="small" type="link" onClick={onToggleExpanded}>
            {t(expanded ? "assistantUi.tasks.action.hideSteps" : "assistantUi.tasks.action.steps")}
          </Button>
        </Space>
      </div>
      {waiting ? (
        <Typography.Text type="secondary">{t("assistantUi.tasks.waitingHint")}</Typography.Text>
      ) : null}
      {expanded ? (
        <ol
          aria-label={t("assistantUi.tasks.steps")}
          style={{ margin: "4px 0 0", paddingLeft: 20, display: "grid", gap: 2 }}
        >
          {task.steps.map((step) => {
            const isCurrent = step.step_index === activeStepIndex;
            return (
              <li key={step.step_index} data-current-step={isCurrent || undefined}>
                <Typography.Text type="secondary">{step.step_index + 1}. </Typography.Text>
                <Typography.Text strong={isCurrent}>{step.title}</Typography.Text>
                {isCurrent ? (
                  <Tag
                    color="processing"
                    style={{ marginLeft: 6 }}
                    data-testid={`agent-task-current-${task.id}`}
                  >
                    {t("assistantUi.tasks.current")}
                  </Tag>
                ) : null}
                <Tag style={{ marginLeft: 6 }}>{t(STEP_STATUS_LABEL_KEYS[step.status])}</Tag>
              </li>
            );
          })}
        </ol>
      ) : null}
    </li>
  );
}
