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
  return (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        title={t("jobMatchBatch.running.title")}
        description={t("jobMatchBatch.running.body")}
      />
      <div style={{ textAlign: "center" }}>
        <Progress type="circle" percent={percent} size={96} />
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
        {task.currentJobTitle ? (
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
