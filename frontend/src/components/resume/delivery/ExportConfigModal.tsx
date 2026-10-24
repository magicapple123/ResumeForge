// SPDX-License-Identifier: Apache-2.0
/**
 * 「导出交付包」弹层（W19 / D18–D20）：保存/复用导出配置 → D20 核对 → 成套导出 zip。
 *
 * 弹层规范：含表单 → `mask={{ closable: false }}`；footer 只放动作（取消 / 导出交付包），
 * 不另加「关闭」；版本冲突用**页内 Alert + 刷新按钮**，不新开第二个弹层。
 */
import { Alert, App, Button, Input, Modal, Select, Space, Switch } from "antd";
import { useMemo, useState } from "react";
import type { ResumeContent } from "../../../types";
import { t } from "../../../i18n";
import {
  validatePresetConfig,
  type ExportBundleDownload,
  type ExportDeliveryApi,
  type ExportPresetConfig,
  type NamingContext,
} from "../../../features/resume-delivery";
import { downloadBlob } from "../../../utils/download";
import ExportCheckCard from "./ExportCheckCard";
import ExportConfigForm from "./ExportConfigForm";
import { useExportBundle } from "../../../features/resume-delivery/useExportBundle";
import { useExportPresets } from "../../../features/resume-delivery/useExportPresets";
import "./delivery.css";

function todayStamp(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}${month}${day}`;
}

export interface ExportConfigModalProps {
  open: boolean;
  onClose: () => void;
  api: ExportDeliveryApi;
  resumeId: number | null;
  content?: ResumeContent | null;
  /** 服务端当前 revision；null = 还没拿到（此时只读核对，不允许 strict 导出）。 */
  revision: number | null;
  resumeTitle: string;
  company: string;
  jobTitle: string;
  template?: string;
  language?: string;
  documentMode?: string;
  /** 草稿版式：给了才随请求发，保证"导出 = 眼前这一版排版"。 */
  pageLimit?: number;
  fontScale?: string;
  formatConfig?: Record<string, unknown>;
  marginMm?: number;
  /** 版本冲突后重新取服务端 revision（宿主提供；不提供则只重新核对）。 */
  onReloadRevision?: () => Promise<number | null>;
  onExported?: (file: ExportBundleDownload, config: ExportPresetConfig) => void;
}

export default function ExportConfigModal({
  open,
  onClose,
  api,
  resumeId,
  content,
  revision,
  resumeTitle,
  company,
  jobTitle,
  template = "",
  language = "",
  documentMode,
  pageLimit,
  fontScale,
  formatConfig,
  marginMm,
  onReloadRevision,
  onExported,
}: ExportConfigModalProps) {
  const { message } = App.useApp();
  const presets = useExportPresets(api);
  const bundle = useExportBundle({
    api,
    resumeId,
    content,
    revision,
    resumeTitle,
    company,
    jobTitle,
    documentMode,
    language,
    pageLimit,
    fontScale,
    formatConfig,
    marginMm,
  });
  const [today] = useState(todayStamp);
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(null);
  const [presetName, setPresetName] = useState("");
  const [presetDefault, setPresetDefault] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);

  const namingContext = useMemo<NamingContext>(
    () => ({
      name: content?.name ?? "",
      company,
      job_title: jobTitle,
      template,
      date: today,
      revision: revision ?? 0,
      language,
    }),
    [company, content?.name, jobTitle, language, revision, template, today],
  );

  const issues = validatePresetConfig(bundle.config);
  const selectedPreset = presets.presets.find((preset) => preset.id === selectedPresetId) ?? null;

  const choosePreset = (presetId: number | null) => {
    setSelectedPresetId(presetId);
    bundle.applyPreset(presets.presets.find((preset) => preset.id === presetId) ?? null);
  };

  const savePreset = async () => {
    if (savingPreset) return;
    if (!presetName.trim()) {
      message.warning(t("delivery.config.presetNameRequired"));
      return;
    }
    if (!issues.ok) return;
    setSavingPreset(true);
    try {
      const saved = await presets.savePreset(
        {
          name: presetName.trim(),
          config: bundle.config,
          is_default: presetDefault,
        },
        selectedPresetId ?? undefined,
      );
      setSelectedPresetId(saved.id);
      setPresetName("");
      setPresetDefault(false);
      message.success(t("delivery.config.presetSaved"));
    } catch {
      message.error(t("delivery.config.presetSaveFailed"));
    } finally {
      setSavingPreset(false);
    }
  };

  const removePreset = async () => {
    if (selectedPresetId === null) return;
    try {
      await presets.deletePreset(selectedPresetId);
      setSelectedPresetId(null);
      message.success(t("delivery.config.presetDeleted"));
    } catch {
      message.error(t("delivery.config.presetSaveFailed"));
    }
  };

  const runExport = async () => {
    if (!issues.ok) {
      message.warning(t("delivery.export.emptyFormats"));
      return;
    }
    if (revision === null) {
      message.warning(t("delivery.export.noRevision"));
      return;
    }
    const file = await bundle.exportNow();
    if (!file) {
      if (bundle.exportFailed) message.error(t("delivery.export.failed"));
      return;
    }
    downloadBlob(file.blob, file.filename);
    message.success(t("delivery.export.success"));
    onExported?.(file, bundle.config);
  };

  const refreshAfterConflict = async () => {
    if (onReloadRevision) await onReloadRevision().catch(() => null);
    bundle.refreshCheck();
  };

  return (
    <Modal
      open={open}
      title={t("delivery.config.title")}
      onCancel={onClose}
      // 表单弹层：误点遮罩会丢配置草稿，必须显式禁掉。
      mask={{ closable: false }}
      footer={null}
      width="min(760px, 94vw)"
      styles={{ body: { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto" } }}
      destroyOnHidden
    >
      <div className="resume-delivery">
        <div className="resume-delivery-preset-bar">
          <span className="resume-delivery-label">{t("delivery.config.preset")}</span>
          <Select
            style={{ minWidth: 200 }}
            aria-label={t("delivery.config.preset")}
            placeholder={
              presets.presets.length
                ? t("delivery.config.presetPlaceholder")
                : t("delivery.config.noPresets")
            }
            value={selectedPresetId}
            allowClear
            onChange={(value) => choosePreset(value ?? null)}
            options={presets.presets.map((preset) => ({ value: preset.id, label: preset.name }))}
          />
          <Input
            aria-label={t("delivery.config.presetName")}
            placeholder={t("delivery.config.presetNamePlaceholder")}
            value={presetName}
            maxLength={64}
            onChange={(event) => setPresetName(event.target.value)}
            style={{ width: 200 }}
          />
          <label className="resume-delivery-switch">
            <Switch
              size="small"
              checked={presetDefault}
              aria-label={t("delivery.config.defaultPreset")}
              onChange={setPresetDefault}
            />
            <span>{t("delivery.config.defaultPreset")}</span>
          </label>
          <Button size="small" loading={savingPreset} onClick={() => void savePreset()}>
            {t("delivery.config.savePreset")}
          </Button>
          {selectedPreset ? (
            <Button size="small" type="text" danger onClick={() => void removePreset()}>
              {t("delivery.config.deletePreset")}
            </Button>
          ) : null}
        </div>
        {presets.status === "error" ? (
          <Alert
            type="error"
            showIcon
            title={t("delivery.config.loadFailed")}
            action={
              <Button size="small" onClick={presets.reload}>
                {t("common.retry")}
              </Button>
            }
          />
        ) : null}

        <ExportConfigForm
          config={bundle.config}
          onChange={bundle.setConfig}
          namingContext={namingContext}
          disabled={bundle.exporting}
        />

        <p className="resume-delivery-hint">{t("delivery.export.snapshotKept")}</p>
        {bundle.config.archive_original ? (
          <p className="resume-delivery-hint">{t("delivery.export.archiveKept")}</p>
        ) : null}

        {bundle.revisionChanged ? (
          <Alert
            type="error"
            showIcon
            title={t("delivery.revision.title")}
            description={t("delivery.revision.body")}
            action={
              <Button size="small" onClick={() => void refreshAfterConflict()}>
                {t("delivery.revision.refresh")}
              </Button>
            }
          />
        ) : null}

        <ExportCheckCard
          summary={bundle.summary}
          checking={bundle.checking}
          checkFailed={bundle.checkFailed}
          onRefresh={bundle.refreshCheck}
        />

        <Space className="resume-delivery-actions">
          <Button onClick={onClose}>{t("common.action.cancel")}</Button>
          <Button type="primary" loading={bundle.exporting} onClick={() => void runExport()}>
            {bundle.exporting ? t("delivery.export.exporting") : t("delivery.export.action")}
          </Button>
        </Space>
      </div>
    </Modal>
  );
}
