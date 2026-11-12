// SPDX-License-Identifier: Apache-2.0
/**
 * 记忆的「补一条画像 / 编辑」弹层（#18D 手填入口 + #31C 逐条编辑）。
 *
 * 独立组件的两个原因：① 主卡已经要放列表 + 开关 + 清空，挤在 500 行内会失控；
 * ② 弹层由卡片**按需挂载**（关掉即卸载），所以不必写"打开时把 props 同步进 state"的
 * effect——初值直接用 props，不会出现"上一轮编辑内容残留在下一次"。
 *
 * 约束（来自后端契约）：kind 创建后不可改（分类体系固定）；内容 ≤200 字；
 * 手机号/身份证/密钥由后端拒绝（UI 只提示，不复制第二套校验）。
 */
import { Alert, Input, Modal, Select, Typography } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { AssistantMemory, MemoryKindOption } from "./assistantMemoryApi";
import { memoryKindLabel } from "./assistantMemoryLabels";

interface Props {
  mode: "create" | "edit";
  /** edit 时必填：被编辑的那条（kind 锁定展示）。 */
  memory: AssistantMemory | null;
  kindOptions: MemoryKindOption[];
  onCancel: () => void;
  /** 提交成功由调用方关闭弹层；失败时抛 Error，弹层内联显示原因。 */
  onSubmit: (input: { kind: string; value: string; key: string }) => Promise<void>;
}

export default function AssistantMemoryEditModal({
  mode,
  memory,
  kindOptions,
  onCancel,
  onSubmit,
}: Props) {
  useLocale();
  const editing = mode === "edit" && memory !== null;
  const [kind, setKind] = useState(editing ? memory.kind : (kindOptions[0]?.kind ?? "target_role"));
  const [value, setValue] = useState(editing ? memory.value : "");
  const [key, setKey] = useState(editing ? memory.key : "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError(t("assistantMemory.error.valueRequired"));
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await onSubmit({ kind, value: trimmed, key: key.trim() });
    } catch (err) {
      // 后端 422 的中文原因（敏感信息/空内容/未知 kind）原样展示，不吞。
      setError(err instanceof Error ? err.message : t("assistantMemory.toast.failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const options = kindOptions.map((option) => ({
    value: option.kind,
    label: memoryKindLabel(option.kind, option.label),
  }));

  return (
    <Modal
      open
      title={t(editing ? "assistantMemory.form.editTitle" : "assistantMemory.form.createTitle")}
      onCancel={onCancel}
      onOk={() => void submit()}
      okText={t(editing ? "assistantMemory.action.save" : "assistantMemory.action.create")}
      cancelText={t("assistantMemory.action.cancel")}
      confirmLoading={submitting}
      // 这个弹层有提交动作：蒙层关闭必须禁用（与仓库弹层规范一致）。
      mask={{ closable: false }}
      destroyOnHidden
    >
      <div style={{ display: "grid", gap: 12 }}>
        <label>
          <Typography.Text strong style={{ marginRight: 8 }}>
            {t("assistantMemory.form.kind")}
          </Typography.Text>
          <Select
            style={{ width: "100%", marginTop: 4 }}
            value={kind}
            disabled={editing}
            aria-label={t("assistantMemory.form.kind")}
            onChange={(next) => setKind(next)}
            options={options}
          />
          <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
            {t(editing ? "assistantMemory.form.kindLocked" : "assistantMemory.form.kindHint")}
          </Typography.Paragraph>
        </label>
        <label>
          <Typography.Text strong style={{ marginRight: 8 }}>
            {t("assistantMemory.form.value")}
          </Typography.Text>
          <Input.TextArea
            style={{ marginTop: 4 }}
            value={value}
            maxLength={200}
            showCount
            rows={3}
            placeholder={t("assistantMemory.form.valuePlaceholder")}
            aria-label={t("assistantMemory.form.value")}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <label>
          <Typography.Text strong style={{ marginRight: 8 }}>
            {t("assistantMemory.form.key")}
          </Typography.Text>
          <Input
            style={{ marginTop: 4 }}
            value={key}
            maxLength={128}
            placeholder={t("assistantMemory.form.keyPlaceholder")}
            aria-label={t("assistantMemory.form.key")}
            onChange={(event) => setKey(event.target.value)}
          />
          <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
            {t("assistantMemory.form.keyHint")}
          </Typography.Paragraph>
        </label>
        <Typography.Text type="warning">{t("assistantMemory.form.sensitiveHint")}</Typography.Text>
        {error ? <Alert type="error" showIcon title={error} /> : null}
      </div>
    </Modal>
  );
}
