// SPDX-License-Identifier: Apache-2.0
/** 生成进行中阶段：阶段步骤条 + 进度消息 + 后台继续/取消按钮。
 *
 * 纯展示——轮询与取消逻辑留在 GenerateResumeModal（竞态敏感区红线），经 props 回传；
 * 零 api 导入。
 */
import { Alert, Button, Space, Steps, Typography } from "antd";
import type { ResumeGenerateTask } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import {
  RESUME_GENERATION_STAGES,
  stageForProgressMessage,
  stageIndexOf,
} from "../resumeGenerationStages";

interface Props {
  task: ResumeGenerateTask | null;
  taskId: number | null;
  onClose: () => void;
  onCancel: () => void;
}

export default function GenerationProgressStage({ task, taskId, onClose, onCancel }: Props) {
  useLocale();
  return (
    <div>
      <Steps
        size="small"
        current={stageIndexOf(stageForProgressMessage(task?.message ?? ""))}
        items={RESUME_GENERATION_STAGES.map((item) => ({ title: t(item.titleKey) }))}
        style={{ marginBottom: 8 }}
      />
      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
        {t("generateStages.progress.status", {
          message: task?.message || t("generateStages.progress.preparing"),
          count: task?.received_chars ?? 0,
        })}
      </Typography.Text>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title={t("generateStages.progress.backgroundAlert")}
      />
      <div style={{ marginTop: 16, textAlign: "right" }}>
        <Space>
          <Button onClick={onClose}>{t("generateStages.action.continueInBackground")}</Button>
          <Button danger disabled={taskId == null} onClick={onCancel}>
            {t("generateStages.action.cancel")}
          </Button>
        </Space>
      </div>
    </div>
  );
}
