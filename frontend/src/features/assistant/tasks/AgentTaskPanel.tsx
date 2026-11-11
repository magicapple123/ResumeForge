// SPDX-License-Identifier: Apache-2.0
/**
 * 首页「任务」卡的列表体（T02/T03）：分组渲染 + 条数上限 + 已结束折叠 + 手风琴展开。
 *
 * 数据来自 `useAgentTasks({ enabled })`（不按会话过滤），本组件只负责"怎么摆"：
 * - 组顺序由 `bucketOrder` 决定；首页是「待确认 → 进行中 → 已结束」（D2）。
 * - `activeLimit`：待确认 + 进行中合计最多展示几条，超出显示「还有 N 条」就地展开。
 * - `finishedPreviewLimit`：已结束区默认收起，展开显示最近 N 条 + 「查看全部」。
 * - 展开状态在**卡片层**（T03 手风琴）：同一时间只有一条任务展开。
 *
 * 空任务过滤（D5）由调用方在传给本组件前完成（`visibleTasks`），这样卡片能据同一份
 * 过滤结果决定"整卡不渲染"，两处不会各算一套。
 */
import { CaretDownOutlined, CaretRightOutlined } from "@ant-design/icons";
import { Button, Typography } from "antd";
import { useState } from "react";
import type { AgentTask } from "../../../api/agentTasks";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import AgentTaskRow from "./AgentTaskRow";
import { BUCKET_LABEL_KEYS, BUCKET_ORDER, groupTasks, type AgentTaskBucket } from "./agentTaskView";

interface Props {
  tasks: AgentTask[];
  error: string | null;
  onStart: (taskId: number) => void;
  onResume: (taskId: number) => void;
  onCancel: (taskId: number) => void;
  /** 可选：传了才给「进行中」的任务显示暂停（助手页任务条用）。 */
  onPause?: (taskId: number) => void;
  /** 组顺序，默认 `BUCKET_ORDER`；首页传 `HOME_BUCKET_ORDER`。 */
  bucketOrder?: readonly AgentTaskBucket[];
  /** 未结束（待确认 + 进行中）合计最多展示几条；不传 = 不限制。 */
  activeLimit?: number;
  /** 已结束区展开后先显示最近几条（默认 5）；不传 = 展开即全部。 */
  finishedPreviewLimit?: number;
}

export default function AgentTaskPanel({
  tasks,
  error,
  onStart,
  onResume,
  onCancel,
  onPause,
  bucketOrder = BUCKET_ORDER,
  activeLimit,
  finishedPreviewLimit,
}: Props) {
  useLocale();
  // T03 手风琴：展开状态提到卡片层，保证同一时间只有一条任务展开（D12）。
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [showAllActive, setShowAllActive] = useState(false);
  const [finishedOpen, setFinishedOpen] = useState(false);
  const [showAllFinished, setShowAllFinished] = useState(false);

  // 防御性分支：首页卡片在"没有可显示任务"时整卡不渲染，这里正常不会命中。
  if (tasks.length === 0) {
    return error ? (
      <Typography.Text type="danger" role="status">
        {error}
      </Typography.Text>
    ) : null;
  }

  const grouped = groupTasks(tasks);
  const activeBuckets = bucketOrder.filter((bucket) => bucket !== "finished");
  // 把"待确认 + 进行中"按组顺序摊平，再按上限算出可见集合（纯计算，不在渲染期改可变变量）。
  const nonFinished = activeBuckets.flatMap((bucket) => grouped[bucket]);
  const activeTotal = nonFinished.length;
  const visibleActive =
    activeLimit === undefined || showAllActive ? activeTotal : Math.min(activeTotal, activeLimit);
  const visibleActiveIds = new Set(nonFinished.slice(0, visibleActive).map((task) => task.id));
  const activeSections = activeBuckets.map((bucket) => ({
    bucket,
    shown: grouped[bucket].filter((task) => visibleActiveIds.has(task.id)),
  }));
  const hiddenActive = activeTotal - visibleActive;
  const finished = grouped.finished;
  const finishedShown =
    finishedPreviewLimit === undefined || showAllFinished
      ? finished
      : finished.slice(0, finishedPreviewLimit);

  const renderRow = (task: AgentTask) => (
    <AgentTaskRow
      key={task.id}
      task={task}
      expanded={expandedTaskId === task.id}
      onToggleExpanded={() =>
        setExpandedTaskId((current) => (current === task.id ? null : task.id))
      }
      onStart={onStart}
      onResume={onResume}
      onCancel={onCancel}
      onPause={onPause}
    />
  );

  return (
    <section aria-label={t("assistantUi.tasks.aria.panel")} style={{ display: "grid", gap: 10 }}>
      {error ? (
        <Typography.Text type="danger" role="status">
          {error}
        </Typography.Text>
      ) : null}
      {activeSections.map(({ bucket, shown }) =>
        shown.length > 0 ? (
          <div key={bucket} style={{ display: "grid", gap: 6 }}>
            <Typography.Text type="secondary" strong>
              {t(BUCKET_LABEL_KEYS[bucket])}
            </Typography.Text>
            <ul
              aria-label={t(BUCKET_LABEL_KEYS[bucket])}
              style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}
            >
              {shown.map(renderRow)}
            </ul>
          </div>
        ) : null,
      )}
      {hiddenActive > 0 ? (
        <div>
          <Button type="link" size="small" onClick={() => setShowAllActive(true)}>
            {t("tasksCard.more", { count: hiddenActive })}
          </Button>
        </div>
      ) : null}
      {finished.length > 0 ? (
        <div style={{ display: "grid", gap: 6 }}>
          <div>
            <Button
              type="text"
              size="small"
              aria-expanded={finishedOpen}
              // aria-label 必须显式给：图标自带 aria-label（caret-right），否则无障碍名
              // 会变成「caret-right 已结束（N）」——读屏与测试都会拿到这个拼接名。
              aria-label={t("tasksCard.finishedCount", { count: finished.length })}
              icon={finishedOpen ? <CaretDownOutlined /> : <CaretRightOutlined />}
              onClick={() => setFinishedOpen((value) => !value)}
            >
              {t("tasksCard.finishedCount", { count: finished.length })}
            </Button>
          </div>
          {finishedOpen ? (
            <>
              <ul
                aria-label={t("tasksCard.finishedCount", { count: finished.length })}
                style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}
              >
                {finishedShown.map(renderRow)}
              </ul>
              {finished.length > finishedShown.length ? (
                <div>
                  <Button type="link" size="small" onClick={() => setShowAllFinished(true)}>
                    {t("homePage.action.viewAll")}
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
