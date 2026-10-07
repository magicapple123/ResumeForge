/** AI 修改简历：输入修改要求（可留空整体重写），修订结果直接更新当前记录。 */
import { ThunderboltOutlined } from "@ant-design/icons";
import { Alert, App, Input, Modal, Typography } from "antd";
import { useState } from "react";
import { reviseResume } from "../../api/resumes";
import type { ResumeDetail } from "../../types";

interface Props {
  open: boolean;
  recordId: number | null;
  /** 打开时预填的修改要求（如从警告区「AI 补上这段」带过来的指令）。 */
  initialInstructions?: string;
  onClose: () => void;
  /** 修订成功后把更新后的记录交回父组件刷新预览（弹窗自己负责关闭）。 */
  onApplied: (detail: ResumeDetail) => Promise<void> | void;
}

const MAX_CHARS = 2000;

export default function ResumeReviseModal({
  open,
  recordId,
  initialInstructions = "",
  onClose,
  onApplied,
}: Props) {
  const { message } = App.useApp();
  const [instructions, setInstructions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // 预填指令在每次打开时生效（父组件每次带入的都可能是不同条目的指令）。
  // Compiler 规范：随 prop 变化的重置用渲染期守卫式调整。
  const [prevSync, setPrevSync] = useState<{ open; initialInstructions } | null>(null);
  if (
    prevSync === null ||
    prevSync.open !== open ||
    prevSync.initialInstructions !== initialInstructions
  ) {
    setPrevSync({ open, initialInstructions });
    if (open) setInstructions(initialInstructions);
  }

  const close = () => {
    setInstructions("");
    setError("");
    setSubmitting(false);
    onClose();
  };

  const submit = async () => {
    if (!recordId || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const updated = await reviseResume(recordId, instructions);
      await onApplied(updated);
      message.success(instructions.trim() ? "已按你的要求修改简历" : "已重新生成简历内容");
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "修订简历失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  const hasInstructions = instructions.trim().length > 0;

  return (
    <Modal
      title={
        <span>
          <ThunderboltOutlined /> AI 修改简历
        </span>
      }
      open={open}
      onCancel={close}
      confirmLoading={submitting}
      onOk={() => void submit()}
      okText={hasInstructions ? "按要求修改" : "整体重新生成"}
      width={560}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        {hasInstructions
          ? "AI 只会修改你明确提出的内容，其余部分逐字保留。"
          : "没有填写修改要求时，AI 会整体重新生成：事实与经历保持不变，表达与结构重新组织。"}
      </Typography.Paragraph>
      <Input.TextArea
        value={instructions}
        onChange={(event) => setInstructions(event.target.value.slice(0, MAX_CHARS))}
        placeholder={`可选。例：把个人总结改得更突出数据分析能力；项目经历里补充量化结果。留空则整体重新生成。最多 ${MAX_CHARS} 字。`}
        autoSize={{ minRows: 4, maxRows: 10 }}
        maxLength={MAX_CHARS}
        showCount
        disabled={submitting}
      />
      {error ? <Alert type="error" showIcon message={error} style={{ marginTop: 12 }} /> : null}
    </Modal>
  );
}
