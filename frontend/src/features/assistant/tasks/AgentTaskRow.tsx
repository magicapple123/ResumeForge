// SPDX-License-Identifier: Apache-2.0
/**
 * 任务区块里的一行（T20）：标题 + 状态标签 + **[来源徽标]** + 进度 + 操作按钮 + 可展开的步骤清单。
 *
 * 按钮口径按任务状态给，**不按分区猜**：
 * - draft → 开始；paused → 继续；waiting_approval → 去确认（展开步骤给用户看等哪一步）；
 * - running/draft/paused/waiting_approval → 取消任务；终态不提供任何操作。
 * 进度与状态文案全部走语言包；展开只影响本行，不需要请求后端。
 *
 * 来源徽标（T26 收尾）：提醒到期自动生成的任务卡没有会话归属，出现在任何会话的任务区里
 * 时用户需要知道"它不是我刚建的"。`manual` 不加徽标，其余来源由 `sourceBadgeKey` 决定。
 */
import { Button, Space, Tag, Typography } from "antd";
import { useState } from "react";
import type { AgentTask } from "../../../api/agentTasks";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import {
  STATUS_LABEL_KEYS,
  STATUS_TAG_COLORS,
  STEP_STATUS_LABEL_KEYS,
  bucketOf,
  progressOf,
  sourceBadgeKey,
} from "./agentTaskView";

interface Props {
  task: AgentTask;
  onStart: (taskId: number) => void;
  onResume: (taskId: number) => void;
  onCancel: (taskId: number) => void;
}

export default function AgentTaskRow({ task, onStart, onResume, onCancel }: Props) {
  useLocale();
  const [expanded, setExpanded] = useState(false);
  const { current, total } = progressOf(task);
  const waiting = task.status === "waiting_approval";
  const sourceKey = sourceBadgeKey(task);

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
            <Button size="small" type="primary" onClick={() => setExpanded(true)}>
              {t("assistantUi.tasks.action.review")}
            </Button>
          ) : null}
          {bucketOf(task.status) !== "finished" ? (
            <Button size="small" danger onClick={() => onCancel(task.id)}>
              {t("assistantUi.tasks.action.cancel")}
            </Button>
          ) : null}
          <Button size="small" type="link" onClick={() => setExpanded((value) => !value)}>
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
          {task.steps.map((step) => (
            <li key={step.step_index}>
              <Typography.Text type="secondary">{step.step_index + 1}. </Typography.Text>
              {step.title}
              <Tag style={{ marginLeft: 6 }}>{t(STEP_STATUS_LABEL_KEYS[step.status])}</Tag>
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}
