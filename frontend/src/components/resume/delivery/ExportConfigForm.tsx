// SPDX-License-Identifier: Apache-2.0
/**
 * 导出配置表单（W19 / D18）：格式（按能力矩阵标注近似/不支持）、命名规则（占位符 + 即时
 * 文件名预览）、水印、脱敏、照片、归档原件。
 *
 * 只做受控展示与校验，不直接调接口；保存预设/导出由 `ExportConfigModal` 负责。
 * 能力矩阵的"近似"必须给出原因（Word 版面/字体由查看器重排），不能只标一个灰点。
 */
import { InfoCircleOutlined } from "@ant-design/icons";
import { Alert, Button, Checkbox, Input, Switch, Tag, Tooltip } from "antd";
import type { ReactNode } from "react";
import type { MessageKey } from "../../../i18n";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import {
  DEFAULT_NAMING,
  MAX_FILENAME_STEM,
  NAMED_TOKENS,
  availableExportFormats,
  formatCapability,
  renderFilenamePreview,
  validatePresetConfig,
  type ExportCapabilityReason,
  type ExportFormat,
  type ExportPresetConfig,
  type NamingContext,
  type NamingToken,
  type PresetIssue,
} from "../../../features/resume-delivery";

const FORMAT_LABEL: Record<ExportFormat, MessageKey> = {
  pdf: "delivery.format.pdf",
  docx: "delivery.format.docx",
  html: "delivery.format.html",
  md: "delivery.format.md",
  txt: "delivery.format.txt",
  json: "delivery.format.json",
};

const CAPABILITY_REASON_KEY: Record<ExportCapabilityReason, MessageKey> = {
  layout: "delivery.capability.layout",
  fonts: "delivery.capability.fonts",
  "not-applicable": "delivery.capability.not-applicable",
};

const TOKEN_LABEL: Record<NamingToken, MessageKey> = {
  name: "delivery.naming.token.name",
  company: "delivery.naming.token.company",
  job_title: "delivery.naming.token.job_title",
  template: "delivery.naming.token.template",
  date: "delivery.naming.token.date",
  revision: "delivery.naming.token.revision",
  language: "delivery.naming.token.language",
};

const ISSUE_KEY: Record<PresetIssue["code"], MessageKey> = {
  "no-formats": "delivery.issue.no-formats",
  "bad-naming": "delivery.issue.bad-naming",
  "watermark-too-long": "delivery.issue.watermark-too-long",
  "duplicate-format": "delivery.issue.duplicate-format",
  "unknown-format": "delivery.issue.unknown-format",
};

export interface ExportConfigFormProps {
  config: ExportPresetConfig;
  onChange: (next: ExportPresetConfig) => void;
  namingContext: NamingContext;
  disabled?: boolean;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="resume-delivery-field">
      <span className="resume-delivery-label">{label}</span>
      {hint ? <span className="resume-delivery-hint">{hint}</span> : null}
      {children}
    </div>
  );
}

export default function ExportConfigForm({
  config,
  onChange,
  namingContext,
  disabled = false,
}: ExportConfigFormProps) {
  useLocale();
  const patch = (next: Partial<ExportPresetConfig>) => onChange({ ...config, ...next });
  const previewFormat = config.formats[0] ?? "pdf";
  const preview = renderFilenamePreview(config.naming, namingContext, previewFormat);
  const issues = validatePresetConfig(config);

  const toggleFormat = (format: ExportFormat, checked: boolean) => {
    const formats = checked
      ? [...config.formats.filter((item) => item !== format), format]
      : config.formats.filter((item) => item !== format);
    patch({ formats });
  };

  return (
    <div className="resume-delivery-form">
      <fieldset className="resume-delivery-fieldset" disabled={disabled}>
        <legend className="resume-delivery-label">{t("delivery.config.formats")}</legend>
        <div className="resume-delivery-formats">
          {availableExportFormats().map((format) => {
            const capability = formatCapability(format);
            const reason = capability.reason
              ? t(CAPABILITY_REASON_KEY[capability.reason])
              : capability.level === "full"
                ? t("delivery.capability.full")
                : "";
            return (
              <span key={format} className="resume-delivery-format">
                <Checkbox
                  checked={config.formats.includes(format)}
                  onChange={(event) => toggleFormat(format, event.target.checked)}
                >
                  {t(FORMAT_LABEL[format])}
                </Checkbox>
                {capability.level === "approx" ? (
                  <Tooltip title={reason}>
                    <Tag className="resume-delivery-capability">
                      {t("delivery.capability.approx")}
                    </Tag>
                  </Tooltip>
                ) : null}
              </span>
            );
          })}
        </div>
      </fieldset>

      <Field label={t("delivery.naming.label")} hint={t("delivery.naming.hint")}>
        <Input
          aria-label={t("delivery.naming.label")}
          value={config.naming}
          placeholder={DEFAULT_NAMING}
          maxLength={MAX_FILENAME_STEM}
          disabled={disabled}
          onChange={(event) => patch({ naming: event.target.value })}
          suffix={
            <Tooltip title={t("delivery.naming.tokens")}>
              <InfoCircleOutlined aria-label={t("delivery.naming.tokens")} />
            </Tooltip>
          }
        />
        <div className="resume-delivery-tokens">
          {NAMED_TOKENS.map((token) => (
            <Button
              key={token}
              size="small"
              type="text"
              disabled={disabled}
              onClick={() => patch({ naming: `${config.naming}{${token}}` })}
            >
              {t(TOKEN_LABEL[token])}
            </Button>
          ))}
        </div>
        <p className="resume-delivery-preview" aria-live="polite">
          {t("delivery.naming.preview")}: <code>{preview}</code>
        </p>
      </Field>

      <Field label={t("delivery.config.watermark")}>
        <Input
          aria-label={t("delivery.config.watermark")}
          value={config.watermark}
          placeholder={t("delivery.config.watermarkPlaceholder")}
          maxLength={64}
          disabled={disabled}
          onChange={(event) => patch({ watermark: event.target.value })}
        />
      </Field>

      <div className="resume-delivery-switches">
        <label className="resume-delivery-switch">
          <Switch
            size="small"
            checked={config.include_photo}
            disabled={disabled}
            aria-label={t("delivery.config.includePhoto")}
            onChange={(checked) => patch({ include_photo: checked })}
          />
          <span>{t("delivery.config.includePhoto")}</span>
        </label>
        <label className="resume-delivery-switch">
          <Switch
            size="small"
            checked={config.redact}
            disabled={disabled}
            aria-label={t("delivery.config.redact")}
            onChange={(checked) => patch({ redact: checked })}
          />
          <span>{t("delivery.config.redact")}</span>
        </label>
        <label className="resume-delivery-switch">
          <Switch
            size="small"
            checked={config.archive_original}
            disabled={disabled}
            aria-label={t("delivery.config.archive")}
            onChange={(checked) => patch({ archive_original: checked })}
          />
          <span>{t("delivery.config.archive")}</span>
        </label>
      </div>
      <p className="resume-delivery-hint">{t("delivery.config.archiveHint")}</p>

      {issues.ok ? null : (
        <Alert
          type="warning"
          showIcon
          title={issues.issues
            .map((issue) => t(ISSUE_KEY[issue.code], { tokens: issue.token ?? "" }))
            .join(" / ")}
        />
      )}
    </div>
  );
}
