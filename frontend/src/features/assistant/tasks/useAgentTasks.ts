// SPDX-License-Identifier: Apache-2.0
/**
 * 首页「任务」卡的取数与轮询（T02/T04；原 T20 助手页任务区搬来）。
 *
 * 不按会话过滤：任务卡是"助手正在推进的事"的全局视图，调用
 * `listAgentTasks(undefined)` 取当前数据集全部任务（含提醒到期生成的、没有会话归属的卡）。
 * 每 `AGENT_TASK_POLL_MS` 轮询一次；窗口隐藏时**不跳过**，而是降频到 10s（CR-23），
 * 恢复可见立即补一轮。
 *
 * 三个必须处理的并发窗口：
 * - **开关/会话变化**：旧请求的慢响应不得覆盖新列表（`requestSeq` 单调递增，过期即丢）；
 * - **总开关关闭**（`enabled=false`）：不请求、不轮询、清空列表；
 * - **页面卸载**：清理轮询，卸载后不再 setState。
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
import { HIDDEN_AI_POLL_MS, startVisibilityPolling } from "../../../utils/visibility";

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
    // CR-23：可见 5s、隐藏 10s；恢复可见立即补一轮。
    const stopPolling = startVisibilityPolling({
      visibleIntervalMs: AGENT_TASK_POLL_MS,
      hiddenIntervalMs: HIDDEN_AI_POLL_MS,
      onTick: () => load(conversationId),
    });
    return () => {
      // 卸载/切换：在途请求作废，轮询停止。
      requestSeq.current += 1;
      stopPolling();
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
