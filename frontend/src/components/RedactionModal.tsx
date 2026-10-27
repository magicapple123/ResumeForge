// SPDX-License-Identifier: Apache-2.0
/** 一键脱敏：预览脱敏后的简历 + 下载脱敏版（独立文件，不回写）。 */
import { App, Button, Checkbox, Descriptions, Modal, Space, Spin, Typography } from "antd";
import { useState } from "react";
import { exportResumeWithOptions, redactResume } from "../api/resumes";
import type { ResumeContent } from "../types";
import {
  DEFAULT_REDACTION_OPTIONS,
  REDACTION_FIELDS,
  type RedactionOptions,
} from "../types/export";
import { downloadBlob } from "../utils/download";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

interface Props {
  recordId: number;
  open: boolean;
  onClose: () => void;
}

export default function RedactionModal({ recordId, open, onClose }: Props) {
  const { message } = App.useApp();
  // 本弹窗用模块级 t() 取文案：必须订阅语言变化。
  useLocale();
  const [options, setOptions] = useState<RedactionOptions>(DEFAULT_REDACTION_OPTIONS);
  const [preview, setPreview] = useState<ResumeContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const previewRedacted = async () => {
    setLoading(true);
    try {
      setPreview(await redactResume(recordId, options));
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : t("componentsMisc2.redaction.previewFailed"),
      );
    } finally {
      setLoading(false);
    }
  };

  const downloadRedacted = async () => {
    setExporting(true);
    try {
      const result = await exportResumeWithOptions(recordId, {
        format: "pdf",
        redact: true,
        redact_options: options,
      });
      downloadBlob(result.blob, result.filename);
      if (result.savedTo) {
        message.success(t("componentsMisc2.redaction.savedTo", { path: result.savedTo }));
      }
      message.success(t("componentsMisc2.redaction.downloadStarted"));
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : t("componentsMisc2.redaction.downloadFailed"),
      );
    } finally {
      setExporting(false);
    }
  };

  const setField = (key: keyof RedactionOptions, checked: boolean) => {
    setOptions((prev) => ({ ...prev, [key]: checked }));
  };

  return (
    <Modal
      title={t("componentsMisc2.redaction.title")}
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(560px, 92vw)"
      destroyOnHidden
    >
      <Space orientation="vertical" style={{ width: "100%" }} size="middle">
        <div>
          <Typography.Text strong>{t("componentsMisc2.redaction.scope")}</Typography.Text>
          <div style={{ marginTop: 8 }}>
            {REDACTION_FIELDS.map((field) => (
              <Checkbox
                key={field.key}
                checked={options[field.key]}
                onChange={(event) => setField(field.key, event.target.checked)}
              >
                {t(field.labelKey)}
              </Checkbox>
            ))}
          </div>
        </div>

        <Space>
          <Button type="primary" loading={loading} onClick={() => void previewRedacted()}>
            {t("componentsMisc2.redaction.preview")}
          </Button>
          <Button loading={exporting} onClick={() => void downloadRedacted()}>
            {t("componentsMisc2.redaction.download")}
          </Button>
        </Space>

        {loading && <Spin />}
        {!loading && preview && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label={t("componentsMisc2.redaction.field.name")}>
              {preview.name}
            </Descriptions.Item>
            <Descriptions.Item label={t("componentsMisc2.redaction.field.phone")}>
              {preview.phone}
            </Descriptions.Item>
            <Descriptions.Item label={t("componentsMisc2.redaction.field.email")}>
              {preview.email}
            </Descriptions.Item>
            <Descriptions.Item label={t("componentsMisc2.redaction.field.company")}>
              {preview.experience[0]?.company ?? "-"}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Space>
    </Modal>
  );
}
