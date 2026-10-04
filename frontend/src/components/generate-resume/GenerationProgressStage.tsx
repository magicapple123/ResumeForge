/** 生成进行中阶段：阶段步骤条 + 进度消息 + 后台继续/取消按钮。
 *
 * 纯展示——轮询与取消逻辑留在 GenerateResumeModal（竞态敏感区红线），经 props 回传；
 * 零 api 导入。
 */
import { Alert, Button, Space, Steps, Typography } from "antd";
import type { ResumeGenerateTask } from "../../types";
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
  return (
    <div>
      <Steps
        size="small"
        current={stageIndexOf(stageForProgressMessage(task?.message ?? ""))}
        items={RESUME_GENERATION_STAGES.map((item) => ({ title: item.title }))}
        style={{ marginBottom: 8 }}
      />
      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
        {task?.message || "正在准备…"} · 已接收 {task?.received_chars ?? 0} 字
      </Typography.Text>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title="生成已在后台开始：现在关闭弹窗不会中断，完成后会自动提醒并打开结果。"
      />
      <div style={{ marginTop: 16, textAlign: "right" }}>
        <Space>
          <Button onClick={onClose}>后台继续（关闭弹窗）</Button>
          <Button danger disabled={taskId == null} onClick={onCancel}>
            取消生成
          </Button>
        </Space>
      </div>
    </div>
  );
}
