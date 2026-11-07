// SPDX-License-Identifier: Apache-2.0
/**
 * 助手页「任务」区块（T20）＝ Tasks + Activity 合并视图。
 *
 * 一条任务是一个多步计划（后端 `agent_task`），按状态分三个区：
 * **进行中**（draft/running/paused）/ **待确认**（waiting_approval）/ **已结束**
 * （done/failed/cancelled）。可以整块折叠；当前会话没有任务时不渲染——任务区块
 * 不能为了"可能有用"白占一屏。
 *
 * 复用边界：Inbox 的写入提案卡（ActionProposalCard）继续负责"确认一次写操作"，
 * 这里只负责"计划走到哪、下一步该谁动"，两类东西不互相冒充。
 */
import { CaretDownOutlined, CaretRightOutlined } from "@ant-design/icons";
import { Button, Divider, Typography } from "antd";
import { useState } from "react";
import type { AgentTask } from "../../../api/agentTasks";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import AgentTaskRow from "./AgentTaskRow";
import { BUCKET_LABEL_KEYS, BUCKET_ORDER, groupTasks } from "./agentTaskView";

interface Props {
  tasks: AgentTask[];
  error: string | null;
  onStart: (taskId: number) => void;
  onResume: (taskId: number) => void;
  onCancel: (taskId: number) => void;
}

export default function AgentTaskPanel({ tasks, error, onStart, onResume, onCancel }: Props) {
  useLocale();
  const [collapsed, setCollapsed] = useState(false);

  // 没有任务就不占大块：加载中也先不出现（避免空区块闪一下又消失）。
  if (tasks.length === 0) {
    return error ? (
      <section aria-label={t("assistantUi.tasks.aria.panel")} style={{ padding: "4px 12px" }}>
        <Typography.Text type="danger" role="status">
          {error}
        </Typography.Text>
      </section>
    ) : null;
  }

  const grouped = groupTasks(tasks);
  return (
    <section aria-label={t("assistantUi.tasks.aria.panel")} style={{ padding: "4px 12px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Button
          type="text"
          size="small"
          aria-expanded={!collapsed}
          aria-label={t(collapsed ? "assistantUi.tasks.expand" : "assistantUi.tasks.collapse")}
          icon={collapsed ? <CaretRightOutlined /> : <CaretDownOutlined />}
          onClick={() => setCollapsed((value) => !value)}
        >
          {t("assistantUi.tasks.title")}
        </Button>
        <Typography.Text type="secondary">
          {t("assistantUi.tasks.count", { count: tasks.length })}
        </Typography.Text>
        {error ? (
          <Typography.Text type="danger" role="status">
            {error}
          </Typography.Text>
        ) : null}
      </div>
      {collapsed ? (
        <Divider style={{ margin: "4px 0 0" }} />
      ) : (
        <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
          {BUCKET_ORDER.map((bucket) =>
            grouped[bucket].length > 0 ? (
              <div key={bucket} style={{ display: "grid", gap: 6 }}>
                <Typography.Text type="secondary" strong>
                  {t(BUCKET_LABEL_KEYS[bucket])}
                </Typography.Text>
                <ul
                  aria-label={t(BUCKET_LABEL_KEYS[bucket])}
                  style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}
                >
                  {grouped[bucket].map((task) => (
                    <AgentTaskRow
                      key={task.id}
                      task={task}
                      onStart={onStart}
                      onResume={onResume}
                      onCancel={onCancel}
                    />
                  ))}
                </ul>
              </div>
            ) : null,
          )}
          <Divider style={{ margin: "4px 0 0" }} />
        </div>
      )}
    </section>
  );
}
