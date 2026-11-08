// SPDX-License-Identifier: Apache-2.0
/**
 * 首页「任务」卡的取数与轮询（T02/T04；原 T20 助手页任务区搬来）。
 *
 * 不按会话过滤：任务卡是"助手正在推进的事"的全局视图，调用
 * `listAgentTasks(undefined)` 取当前数据集全部任务（含提醒到期生成的、没有会话归属的卡）。
 * 每 `AGENT_TASK_POLL_MS` 轮询一次，页面隐藏（`document.hidden`）时跳过本轮——
 * 后台标签页不必持续打接口，回到前台后的下一轮会自动追上。
 *
 * 三个必须处理的并发窗口：
 * - **开关/会话变化**：旧请求的慢响应不得覆盖新列表（`requestSeq` 单调递增，过期即丢）；
 * - **总开关关闭**（`enabled=false`）：不请求、不轮询、清空列表；
 * - **页面卸载**：清理 interval，卸载后不再 setState。
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

export interface AgentTaskQuery {
  /** 是否启用：false = 不请求、不轮询（首页「任务卡」总开关关闭时传 false）。 */
  enabled?: boolean;
  /** 可选的会话过滤；不传 = 当前数据集全部任务。 */
  conversationId?: number | null;
}

export function useAgentTasks({
  enabled = true,
  conversationId,
}: AgentTaskQuery = {}): AgentTaskController {
  useLocale();
  const { message } = App.useApp();
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async (id: number | null | undefined) => {
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
    // 开关切换/会话切换先清空：不能在新状态下先闪一遍旧列表。
    requestSeq.current += 1;
    setTasks([]);
    setError(null);
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void load(conversationId);
    const timer = window.setInterval(() => {
      // 页面隐藏时暂停本轮（省一次接口；可见性变化不影响状态正确性）。
      if (!document.hidden) void load(conversationId);
    }, AGENT_TASK_POLL_MS);
    return () => {
      // 卸载/切换：在途请求作废，轮询停止。
      requestSeq.current += 1;
      window.clearInterval(timer);
    };
  }, [enabled, conversationId, load]);

  const runAction = useCallback(
    async (taskId: number, action: (id: number) => Promise<AgentTask>) => {
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
