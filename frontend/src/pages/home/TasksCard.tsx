// SPDX-License-Identifier: Apache-2.0
/**
 * 首页的任务区块（T02/T04 + CR-19 拆卡）：**「待你确认」与「任务」两张卡**。
 *
 * - 「待你确认」：`waiting_approval` 的任务——卡上只有一种动作，就是等你做决定；
 *   这里**不设条数上限**：把等你动手的事藏进「还有 N 条」等于替用户漏掉决定。
 * - 「任务」：助手创建的多步任务（进行中），副标题写明口径；**过滤跟进巡检卡**——
 *   巡检卡自带每岗三选一与整卡提交，不是通用任务，不该混进来。
 * - 两张都只显示未结束；已结束（含终态提醒卡）都不上首页（CR-20 口径）。
 *
 * 位置：首页「近期提醒」之后、「接下来做什么（待办）」之前（D11）。任务卡从助手页搬来，
 * 不再按会话过滤（`listAgentTasks(undefined)` = 当前数据集全部任务）。
 *
 * 总开关「任务卡」（设置 → 记忆与技能）：关闭时**不请求、不轮询、两张卡都不渲染**；
 * 显示层由前端 gate，后端列表接口不按开关返回空数组（扫描器已在后端 gate 生成）。
 * 开关状态每次挂载时读一次——设置页切完回首页会重新挂载，因此会拿到新值。
 */
import { Card, Typography } from "antd";
import { useEffect, useState } from "react";
import { getAgentTaskEvents } from "../../api/settings";
import AgentTaskPanel from "../../features/assistant/tasks/AgentTaskPanel";
import {
  runningTaskCards,
  waitingConfirmationTasks,
} from "../../features/assistant/tasks/agentTaskView";
import { useAgentTasks } from "../../features/assistant/tasks/useAgentTasks";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** 「任务」卡进行中最多展示 3 条，超出收成「还有 N 条」（D2）。 */
const HOME_ACTIVE_LIMIT = 3;

function CardHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span>{title}</span>
      {subtitle ? (
        <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
          {subtitle}
        </Typography.Text>
      ) : null}
    </div>
  );
}

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
  if (enabled !== true) return null;

  // D5 空壳过滤与终态提醒卡隐藏都在两个 helper 里（同一份实现，别各写一遍）。
  const confirmations = waitingConfirmationTasks(controller.tasks);
  const running = runningTaskCards(controller.tasks);
  if (confirmations.length === 0 && running.length === 0) return null;

  return (
    <>
      {confirmations.length > 0 ? (
        <Card
          className="home-confirm-card"
          style={{ marginTop: 16 }}
          title={<CardHeading title={t("tasksCard.confirmTitle")} />}
        >
          <AgentTaskPanel
            tasks={confirmations}
            error={controller.error}
            bucketOrder={["waiting"]}
            showBucketLabels={false}
            onStart={(taskId) => void controller.start(taskId)}
            onResume={(taskId) => void controller.resume(taskId)}
            onCancel={(taskId) => void controller.cancel(taskId)}
          />
        </Card>
      ) : null}
      {running.length > 0 ? (
        <Card
          className="home-tasks-card"
          style={{ marginTop: 16 }}
          title={<CardHeading title={t("tasksCard.title")} subtitle={t("tasksCard.subtitle")} />}
        >
          <AgentTaskPanel
            tasks={running}
            error={controller.error}
            bucketOrder={["active"]}
            showBucketLabels={false}
            activeLimit={HOME_ACTIVE_LIMIT}
            onStart={(taskId) => void controller.start(taskId)}
            onResume={(taskId) => void controller.resume(taskId)}
            onCancel={(taskId) => void controller.cancel(taskId)}
          />
        </Card>
      ) : null}
    </>
  );
}
