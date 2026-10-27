// SPDX-License-Identifier: Apache-2.0
/**
 * 版式编辑器：调行高、页边距、强调色这类排版参数。
 *
 * 与模板分开是有意的：用户想"压到一页"时不该去改 CSS。这里每个参数都有范围，
 * 越界值后端会直接丢弃，所以界面上也用 InputNumber 限死，不让用户白改一次。
 */
import { App, Button, Form, Input, InputNumber, Space, Typography } from "antd";
import FormModal from "../common/FormModal";
import { useState } from "react";
import { createResumeTemplate, updateResumeTemplate } from "../../api/resumeTemplates";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumeFormatConfig, ResumeFormatField, ResumeTemplateDetail } from "../../types";

interface Props {
  open: boolean;
  /** 可调参数清单与内置预设由 /api/resumes/templates 下发。 */
  fields: ResumeFormatField[];
  template?: ResumeTemplateDetail | null;
  onClose: () => void;
  onSaved: () => void;
}

type ConfigValue = string | number | string[] | null;

export default function FormatTemplateEditorModal({
  open,
  fields,
  template,
  onClose,
  onSaved,
}: Props) {
  useLocale();
  const { message } = App.useApp();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [values, setValues] = useState<Record<string, ConfigValue>>({});
  const [saving, setSaving] = useState(false);

  // 打开时回填模板内容。Compiler 规范：随 open/template 变化的回填用渲染期守卫。
  const [prevSync, setPrevSync] = useState<{
    open: boolean;
    template: ResumeTemplateDetail | null | undefined;
  } | null>(null);
  if (prevSync === null || prevSync.open !== open || prevSync.template !== template) {
    setPrevSync({ open, template });
    if (open) {
      setName(template?.name ?? "");
      setDescription(template?.description ?? "");
      setValues({ ...((template?.config ?? {}) as ResumeFormatConfig) });
    }
  }

  const setValue = (key: string, value: ConfigValue) =>
    setValues((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!name.trim()) {
      message.warning(t("templatesUi.formatEditor.toast.needName"));
      return;
    }
    // 只提交填过的项：空值代表"沿用模板的设置"。
    const config: ResumeFormatConfig = {};
    Object.entries(values).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== "") config[key] = value;
    });
    if (Object.keys(config).length === 0) {
      message.warning(t("templatesUi.formatEditor.toast.needValue"));
      return;
    }
    setSaving(true);
    try {
      if (template) {
        await updateResumeTemplate(template.id, { name, description, config });
        message.success(t("templatesUi.formatEditor.toast.updated"));
      } else {
        await createResumeTemplate({ name, description, config, kind: "format" });
        message.success(t("templatesUi.formatEditor.toast.created"));
      }
      onSaved();
      onClose();
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("templatesUi.formatEditor.error.save"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      title={
        template
          ? t("templatesUi.formatEditor.title.edit")
          : t("templatesUi.formatEditor.title.create")
      }
      open={open}
      onCancel={onClose}
      onSubmit={() => void save()}
      okText={t("templatesUi.formatEditor.action.save")}
      submitting={saving}
      width={620}
    >
      <Form layout="vertical">
        <Form.Item label={t("templatesUi.formatEditor.field.name")} required>
          <Input
            value={name}
            maxLength={40}
            placeholder={t("templatesUi.formatEditor.placeholder.name")}
            onChange={(event) => setName(event.target.value)}
          />
        </Form.Item>
        <Form.Item label={t("templatesUi.formatEditor.field.description")}>
          <Input
            value={description}
            maxLength={255}
            placeholder={t("templatesUi.formatEditor.placeholder.description")}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Form.Item>
        {fields.map((field) => (
          <Form.Item
            key={field.key}
            label={field.label}
            extra={field.description}
            style={{ marginBottom: 12 }}
          >
            {field.type === "color" ? (
              <Space>
                <input
                  type="color"
                  aria-label={field.label}
                  value={
                    typeof values[field.key] === "string" ? String(values[field.key]) : "#16365c"
                  }
                  onChange={(event) => setValue(field.key, event.target.value)}
                  className="format-color-input"
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {typeof values[field.key] === "string"
                    ? String(values[field.key])
                    : t("templatesUi.formatEditor.value.unset")}
                </Typography.Text>
                {values[field.key] ? (
                  <Button size="small" type="link" onClick={() => setValue(field.key, null)}>
                    {t("templatesUi.formatEditor.action.clear")}
                  </Button>
                ) : null}
              </Space>
            ) : (
              <InputNumber
                value={typeof values[field.key] === "number" ? (values[field.key] as number) : null}
                min={field.min}
                max={field.max}
                step={field.step ?? 0.1}
                placeholder={t("templatesUi.formatEditor.value.unset")}
                onChange={(value) => setValue(field.key, value ?? null)}
              />
            )}
          </Form.Item>
        ))}
      </Form>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("templatesUi.formatEditor.hint.blank")}
      </Typography.Text>
    </FormModal>
  );
}
