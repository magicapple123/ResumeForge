// SPDX-License-Identifier: Apache-2.0
/** 批量分析的「进行中」视图：进度、当前岗位、取消 / 转后台。 */
import { Alert, Button, Progress, Space, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { JobMatchBackgroundTaskView } from "../../utils/jobMatchBackgroundTasks";

export default function JobMatchBatchRunning({
  task,
  cancelling,
  onCancel,
  onClose,
}: {
  task: JobMatchBackgroundTaskView;
  cancelling: boolean;
  onCancel: () => void;
  onClose: () => void;
}) {
  useLocale();
  const done = task.completedCount + task.failedCount;
  const percent = task.requestedCount > 0 ? Math.round((done / task.requestedCount) * 100) : 0;
  // 问题 13：「完成」只能由任务状态给，不能由 percent 给。
  // antd 在 percent === 100 且未指定 status 时会自动切成 success（对勾）——
  // 而最后一项完成的瞬间任务仍是 running（还在落库、生成对比），于是出现
  // 「对勾 + 已完成 3/3 + 正在分析 X」三件互相矛盾的事。
  const finished = task.status === "completed";
  // 计满但任务仍在跑 = 正在落库 / 生成横向对比，此时没有"正在分析"的岗位。
  // 只看 `running`：取消/失败虽然也可能停在 N/N，但那不是"正在收尾"。
  const finalizing =
    task.status === "running" && task.requestedCount > 0 && done >= task.requestedCount;
  return (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        title={t("jobMatchBatch.running.title")}
        description={t("jobMatchBatch.running.body")}
      />
      <div style={{ textAlign: "center" }}>
        <Progress
          type="circle"
          percent={percent}
          size={96}
          // running / pending / cancelled 一律 active：不出现对勾，与"已完成"可区分。
          status={finished ? "success" : "active"}
        />
        <div style={{ marginTop: 8 }}>
          <Typography.Text strong>
            {t("jobMatchBatch.running.progress", { done, total: task.requestedCount })}
          </Typography.Text>
          {task.failedCount > 0 ? (
            <Typography.Text type="secondary">
              {t("jobMatchBatch.running.failed", { count: task.failedCount })}
            </Typography.Text>
          ) : null}
        </div>
        {finalizing ? (
          <Typography.Text type="secondary">
            {t("jobMatchBatch.running.finalizing")}
          </Typography.Text>
        ) : task.currentJobTitle ? (
          <Typography.Text type="secondary">
            {t("jobMatchBatch.running.current", { title: task.currentJobTitle })}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">{t("jobMatchBatch.running.waiting")}</Typography.Text>
        )}
      </div>
      <Space wrap style={{ justifyContent: "center", width: "100%" }}>
        <Button danger loading={cancelling} onClick={onCancel}>
          {t("jobMatchBatch.action.cancel")}
        </Button>
        <Button onClick={onClose}>{t("jobMatchBatch.action.background")}</Button>
      </Space>
    </Space>
  );
}
