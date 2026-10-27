// SPDX-License-Identifier: Apache-2.0
/** AI 修改简历：输入修改要求（可留空整体重写），修订结果直接更新当前记录。 */
import { ThunderboltOutlined } from "@ant-design/icons";
import { Alert, App, Input, Modal, Typography } from "antd";
import { useState } from "react";
import { reviseResume } from "../../api/resumes";
import { useI18n } from "../../i18n/i18nContext";
import { MaxLengthHint } from "../common/MaxLengthHint";
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
  const { t } = useI18n();
  const { message } = App.useApp();
  const [instructions, setInstructions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // 预填指令在每次打开时生效（父组件每次带入的都可能是不同条目的指令）。
  // Compiler 规范：随 prop 变化的重置用渲染期守卫式调整。
  const [prevSync, setPrevSync] = useState<{ open: boolean; initialInstructions?: string } | null>(
    null,
  );
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
      message.success(
        instructions.trim() ? t("resume.revise.successTargeted") : t("resume.revise.successFull"),
      );
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("resume.revise.failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const hasInstructions = instructions.trim().length > 0;

  return (
    <Modal
      title={
        <span>
          <ThunderboltOutlined /> {t("resume.revise.title")}
        </span>
      }
      open={open}
      onCancel={close}
      confirmLoading={submitting}
      onOk={() => void submit()}
      okText={hasInstructions ? t("resume.revise.okTargeted") : t("resume.revise.okFull")}
      width={560}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        {hasInstructions ? t("resume.revise.hintTargeted") : t("resume.revise.hintFull")}
      </Typography.Paragraph>
      <Input.TextArea
        value={instructions}
        onChange={(event) => setInstructions(event.target.value.slice(0, MAX_CHARS))}
        placeholder={t("resume.revise.placeholder", { max: MAX_CHARS })}
        autoSize={{ minRows: 4, maxRows: 10 }}
        maxLength={MAX_CHARS}
        disabled={submitting}
      />
      <MaxLengthHint value={instructions} maxLength={MAX_CHARS} />
      {error ? <Alert type="error" showIcon title={error} style={{ marginTop: 12 }} /> : null}
    </Modal>
  );
}
