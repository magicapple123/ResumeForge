/** 生成失败阶段：错误信息 + 返回重试 / 重新生成。
 *
 * 纯展示——reset 与 startGenerate 留在 GenerateResumeModal，经 props 回传；零 api 导入。
 */
import { Alert, Button, Space } from "antd";

interface Props {
  errorMsg: string;
  onReset: () => void;
  onRegenerate: () => void;
}

export default function GenerationErrorStage({ errorMsg, onReset, onRegenerate }: Props) {
  return (
    <div style={{ textAlign: "center", padding: "24px 0" }}>
      <Alert
        type="error"
        showIcon
        title={errorMsg || "生成失败"}
        style={{ marginBottom: 24 }}
      />
      <Space>
        <Button onClick={onReset}>返回重试</Button>
        <Button type="primary" onClick={onRegenerate}>
          重新生成
        </Button>
      </Space>
    </div>
  );
}
