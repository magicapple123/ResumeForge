// SPDX-License-Identifier: Apache-2.0
/**
 * 助手任务条（18A）：本页只列**助手创建**的进行中 / 待确认任务，进度与暂停/取消复用
 * 首页任务卡同一套组件与轮询（useAgentTasks + AgentTaskPanel）。
 *
 * 为什么按 source 过滤：数据集级任务里还有提醒到期卡、跟进巡检卡，那些属于首页；
 * 助手页只展示"这次助手帮你排的批量活"，否则每页都会冒出一堆无关卡片。
 * 助手建的任务 conversation_id 为空（数据集级），所以轮询不按会话过滤、前端再过滤 source。
 */
import { RightOutlined, DownOutlined } from "@ant-design/icons";
import { Button, Card, Typography } from "antd";
import { useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import AgentTaskPanel from "./AgentTaskPanel";
import { bucketOf, visibleTasks } from "./agentTaskView";
import { useAgentTasks } from "./useAgentTasks";

/** 与后端 task_tools.ASSISTANT_TASK_SOURCE 逐字一致。 */
export const ASSISTANT_TASK_SOURCE = "assistant";

export default function AssistantTaskStrip({ enabled = true }: { enabled?: boolean }) {
  useLocale();
  const [open, setOpen] = useState(true);
  const { tasks, error, start, resume, pause, cancel } = useAgentTasks({ enabled });
  const assistantTasks = visibleTasks(tasks).filter(
    (task) => task.source === ASSISTANT_TASK_SOURCE,
  );
  if (!enabled) return null;
  // 没有进行中/待确认的助手任务时整条不渲染：完成的卡在首页任务区看，助手页保持干净。
  const activeTasks = assistantTasks.filter((task) => bucketOf(task.status) !== "finished");
  if (activeTasks.length === 0) return null;

  return (
    <Card
      size="small"
      className="assistant-task-strip"
      title={t("assistantBreadth.tasks.title")}
      extra={
        <Button
          type="text"
          size="small"
          icon={open ? <DownOutlined /> : <RightOutlined />}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {t(open ? "assistantBreadth.tasks.hide" : "assistantBreadth.tasks.show")}
        </Button>
      }
    >
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("assistantBreadth.tasks.hint")}
      </Typography.Text>
      {open ? (
        <div style={{ marginTop: 8 }}>
          <AgentTaskPanel
            tasks={activeTasks}
            error={error}
            activeLimit={3}
            finishedPreviewLimit={0}
            onStart={(id) => void start(id)}
            onResume={(id) => void resume(id)}
            onCancel={(id) => void cancel(id)}
            onPause={(id) => void pause(id)}
          />
        </div>
      ) : null}
    </Card>
  );
}
