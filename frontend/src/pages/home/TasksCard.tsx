// SPDX-License-Identifier: Apache-2.0
/**
 * 首页「任务」卡（T02/T04）：助手正在推进的事——待确认在前、进行中在后，合计最多 3 条；
 * 「已结束(N)」默认收起，展开最近 5 条 + 「查看全部」。
 *
 * 位置：首页「近期提醒」之后、「接下来做什么（待办）」之前（D11）。任务卡从助手页搬来，
 * 不再按会话过滤（`listAgentTasks(undefined)` = 当前数据集全部任务）。
 *
 * 总开关「任务卡」（设置 → 记忆与技能）：关闭时**不请求、不轮询、整卡不渲染**；
 * 显示层由前端 gate，后端列表接口不按开关返回空数组（扫描器已在后端 gate 生成）。
 * 开关状态每次挂载时读一次——设置页切完回首页会重新挂载，因此会拿到新值。
 */
import { Card, Typography } from "antd";
import { useEffect, useState } from "react";
import { getAgentTaskEvents } from "../../api/settings";
import AgentTaskPanel from "../../features/assistant/tasks/AgentTaskPanel";
import { HOME_BUCKET_ORDER, visibleTasks } from "../../features/assistant/tasks/agentTaskView";
import { useAgentTasks } from "../../features/assistant/tasks/useAgentTasks";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** 待确认 + 进行中合计最多展示 3 条，超出收成「还有 N 条」（D2）。 */
const HOME_ACTIVE_LIMIT = 3;
/** 已结束展开先显示最近 5 条（D3）。 */
const HOME_FINISHED_PREVIEW = 5;

export function TasksCard() {
  useLocale();
  // null = 开关状态还没读到：先不渲染、也不请求任务列表（避免"闪一下又消失"）。
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await getAgentTaskEvents();
        if (!cancelled) setEnabled(saved.enabled);
      } catch {
        // 读不到开关就按关闭处理：不展示、不轮询（错误不打扰首页）。
        if (!cancelled) setEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const controller = useAgentTasks({ enabled: enabled === true });
  // D5：空任务不显示，也不计入任何计数（activeLimit / 已结束 N 都基于过滤后的列表）。
  const tasks = visibleTasks(controller.tasks);
  if (enabled !== true || tasks.length === 0) return null;

  return (
    <Card
      className="home-tasks-card"
      style={{ marginTop: 16 }}
      title={
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span>{t("tasksCard.title")}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
            {t("tasksCard.subtitle")}
          </Typography.Text>
        </div>
      }
    >
      <AgentTaskPanel
        tasks={tasks}
        error={controller.error}
        bucketOrder={HOME_BUCKET_ORDER}
        activeLimit={HOME_ACTIVE_LIMIT}
        finishedPreviewLimit={HOME_FINISHED_PREVIEW}
        onStart={(taskId) => void controller.start(taskId)}
        onResume={(taskId) => void controller.resume(taskId)}
        onCancel={(taskId) => void controller.cancel(taskId)}
      />
    </Card>
  );
}
