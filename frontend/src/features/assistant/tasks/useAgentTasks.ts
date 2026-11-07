// SPDX-License-Identifier: Apache-2.0
/**
 * 助手页「任务」区块的取数与轮询（T20）。
 *
 * 后端 Agent 任务与对话绑定：本 hook 按当前会话 id 拉列表，每 `AGENT_TASK_POLL_MS`
 * 轮询一次（任务可能由助手后台推进、也可能在别的标签页变化，不轮询就会看到旧状态）。
 * 三个必须处理的并发窗口：
 * - **会话切换**：旧会话的慢响应不得覆盖新会话的列表（`requestSeq` 单调递增，过期即丢）；
 * - **页面卸载**：清理 interval，卸载后不再 setState；
 * - **写操作**：成功后立刻重拉一次（不等下一轮轮询），失败用 toast 提示并保留旧列表。
 */
import { App } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelAgentTask,
  listAgentTasks,
  pauseAgentTask,
  resumeAgentTask,
  startAgentTask,
  type AgentTask,
} from "../../../api/agentTasks";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

export const AGENT_TASK_POLL_MS = 5000;

export interface AgentTaskController {
  tasks: AgentTask[];
  loading: boolean;
  error: string | null;
  start: (taskId: number) => Promise<void>;
  resume: (taskId: number) => Promise<void>;
  pause: (taskId: number) => Promise<void>;
  cancel: (taskId: number) => Promise<void>;
}

export function useAgentTasks(conversationId: number | null | undefined): AgentTaskController {
  useLocale();
  const { message } = App.useApp();
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async (id: number) => {
    const seq = ++requestSeq.current;
    try {
      const items = await listAgentTasks(id);
      if (seq !== requestSeq.current) return;
      setTasks(items);
      setError(null);
    } catch {
      if (seq !== requestSeq.current) return;
      setError(t("assistantUi.tasks.error"));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 会话切换先清空：不能在新会话下先闪一遍旧会话的任务。
    requestSeq.current += 1;
    setTasks([]);
    setError(null);
    if (!conversationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void load(conversationId);
    const timer = window.setInterval(() => void load(conversationId), AGENT_TASK_POLL_MS);
    return () => {
      // 卸载/切换：在途请求作废，轮询停止。
      requestSeq.current += 1;
      window.clearInterval(timer);
    };
  }, [conversationId, load]);

  const runAction = useCallback(
    async (taskId: number, action: (id: number) => Promise<AgentTask>) => {
      if (!conversationId) return;
      try {
        await action(taskId);
        await load(conversationId);
      } catch {
        message.error(t("assistantUi.tasks.actionFailed"));
      }
    },
    [conversationId, load, message],
  );

  const start = useCallback((id: number) => runAction(id, startAgentTask), [runAction]);
  const resume = useCallback((id: number) => runAction(id, resumeAgentTask), [runAction]);
  const pause = useCallback((id: number) => runAction(id, pauseAgentTask), [runAction]);
  const cancel = useCallback((id: number) => runAction(id, cancelAgentTask), [runAction]);

  return { tasks, loading, error, start, resume, pause, cancel };
}
