// SPDX-License-Identifier: Apache-2.0
/**
 * 「导出交付包」弹层（W19 / D18–D20）：保存/复用导出配置 → D20 核对 → 成套导出 zip。
 *
 * 弹层规范：含表单 → `mask={{ closable: false }}`；footer 只放动作（取消 / 导出交付包），
 * 不另加「关闭」；版本冲突用**页内 Alert + 刷新按钮**，不新开第二个弹层。
 */
import { Alert, App, Button, Input, Modal, Radio, Select, Space, Switch } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResumeDocument } from "../../../types/resumeDocument";
import type { ExportRequest } from "../../../types";
import { t } from "../../../i18n";
import type { MessageKey } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import {
  renderFilenamePreview,
  runSingleFileExports,
  validatePresetConfig,
  type ExportBundleDownload,
  type ExportDeliveryApi,
  type ExportFormat,
  type ExportPresetConfig,
  type NamingContext,
  type SingleExportProgress,
} from "../../../features/resume-delivery";
import { exportResumeWithOptions } from "../../../api/resumes";
import { downloadBlob } from "../../../utils/download";
import ExportCheckCard from "./ExportCheckCard";
import ExportConfigForm from "./ExportConfigForm";
import ConfigPreviewPanel from "./ConfigPreviewPanel";
import VariantPicker, { type VariantOption } from "./VariantPicker";
import { useExportBundle } from "../../../features/resume-delivery/useExportBundle";
import { useExportPresets } from "../../../features/resume-delivery/useExportPresets";
import { productPreflightRequest, useExportPreflightGate } from "../exportPreflightGate";
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
  content?: ResumeDocument | null;
  /** 服务端当前 revision；null = 还没拿到（此时只读核对，不允许 strict 导出）。 */
  revision: number | null;
  resumeTitle: string;
  company: string;
  jobTitle: string;
  template?: string;
  /** 具名版式（服务端核对 / 配置预览按它解析；缺省 = 记录值）。 */
  formatName?: string;
  language?: string;
  documentMode?: string;
  /** 草稿版式：给了才随请求发，保证"导出 = 眼前这一版排版"。 */
  pageLimit?: number;
  fontScale?: string;
  formatConfig?: Record<string, unknown>;
  marginMm?: number;
  /** W16 岗位变体列表（宿主用 useVariants 取）；空列表 = 不显示选择器。 */
  variants?: VariantOption[];
  variantLoading?: boolean;
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
  formatName = "",
  language = "",
  documentMode,
  pageLimit,
  fontScale,
  formatConfig,
  marginMm,
  variants = [],
  variantLoading = false,
  onReloadRevision,
  onExported,
}: ExportConfigModalProps) {
  useLocale();
  const { message } = App.useApp();
  const presets = useExportPresets(api);
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
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
    template,
    formatName,
    pageLimit,
    fontScale,
    formatConfig,
    marginMm,
    variantId: selectedVariantId,
  });
  const [today] = useState(todayStamp);
  // 导出闸门（问题 3 主路径）：点导出时才预检，选中 pdf/docx 才有页数结论可问；
  // bundle 与单文件共用同一次 confirm（同一读数不二问，见 gate 模块）。
  const preflightGate = useExportPreflightGate({
    recordId: resumeId,
    buildRequest: () =>
      productPreflightRequest(bundle.config.formats, {
        page_limit: pageLimit,
        font_scale: fontScale,
        language: language || undefined,
        format_config: formatConfig,
      }),
  });
  // 打开弹层就按"导出同一快照"取一次服务端核对（后端未就绪时自动回退本地并标注）。
  // 用 ref 持有 refreshCheck，避免把它（随输入变化的 useCallback）放进 effect 依赖导致循环刷新。
  const refreshCheckRef = useRef(bundle.refreshCheck);
  useEffect(() => {
    refreshCheckRef.current = bundle.refreshCheck;
  }, [bundle.refreshCheck]);
  useEffect(() => {
    if (open && resumeId !== null) void refreshCheckRef.current();
  }, [open, resumeId]);
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(null);
  const [presetName, setPresetName] = useState("");
  const [presetDefault, setPresetDefault] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  // R-21：导出形式与"单独文件"的串行进度（交付包走 bundle 自己的 exporting）。
  const [progress, setProgress] = useState<SingleExportProgress | null>(null);
  const [singleRunning, setSingleRunning] = useState(false);
  const mode = bundle.config.mode ?? "bundle";
  const busy = bundle.exporting || singleRunning;

  const setMode = (next: NonNullable<ExportPresetConfig["mode"]>) => {
    // 切到单独文件时清掉归档开关：归档只属于交付包，留着会让人以为这份也会存原件。
    bundle.setConfig({
      ...bundle.config,
      mode: next,
      ...(next === "single" ? { archive_original: false } : {}),
    });
  };

  const documentName =
    content?.header.items.find((item) => item.kind === "field" && item.key === "name")?.value ?? "";
  const namingContext = useMemo<NamingContext>(
    () => ({
      name: documentName,
      company,
      job_title: jobTitle,
      template,
      date: today,
      revision: revision ?? 0,
      language,
    }),
    [company, documentName, jobTitle, language, revision, template, today],
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
          // 导出形式是这次操作的开关，不是预设的一部分（读回时也不恢复），不写进预设。
          config: { ...bundle.config, mode: undefined },
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

  const formatLabel = (format: ExportFormat) => t(`delivery.format.${format}` as MessageKey);

  /** 单独文件：与交付包同一份草稿版式/后处理，只是把"打包"换成"逐个导出"。 */
  const buildSingleRequest = useCallback(
    (format: ExportFormat): ExportRequest => ({
      format,
      watermark: bundle.config.watermark.trim() || undefined,
      redact: bundle.config.redact || undefined,
      include_photo: bundle.config.include_photo,
      ...(pageLimit !== undefined ? { page_limit: pageLimit } : {}),
      ...(fontScale ? { font_scale: fontScale as ExportRequest["font_scale"] } : {}),
      ...(formatConfig ? { format_config: formatConfig as ExportRequest["format_config"] } : {}),
      ...(language ? { language: language as ExportRequest["language"] } : {}),
      ...(marginMm !== undefined ? { margin_mm: marginMm } : {}),
    }),
    [bundle.config, formatConfig, fontScale, language, marginMm, pageLimit],
  );

  const runSingleExport = async () => {
    if (resumeId === null) return;
    const plans = bundle.config.formats.map((format) => ({
      format,
      filename: renderFilenamePreview(bundle.config.naming, namingContext, format),
    }));
    setSingleRunning(true);
    try {
      const outcome = await runSingleFileExports({
        plans,
        fetchOne: (plan) => exportResumeWithOptions(resumeId, buildSingleRequest(plan.format)),
        save: downloadBlob,
        onProgress: setProgress,
      });
      if (outcome.failed) {
        message.error(
          t("delivery.export.singleFailed", {
            done: outcome.completed,
            total: outcome.total,
            format: formatLabel(outcome.failed.format),
            reason: outcome.failed.reason,
          }),
        );
        return;
      }
      message.success(t("delivery.export.singleSuccess", { count: outcome.completed }));
    } finally {
      setProgress(null);
      setSingleRunning(false);
    }
  };

  const runExport = async () => {
    if (!issues.ok) {
      message.warning(t("delivery.export.emptyFormats"));
      return;
    }
    // 问题 3：发导出请求前预检一次；超页先问一句，选「先调整」就整批停手。
    const needsPreflight =
      resumeId !== null &&
      bundle.config.formats.some((format) => format === "pdf" || format === "docx");
    if (needsPreflight && !(await preflightGate.confirm())) return;
    if (mode === "single") {
      await runSingleExport();
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
    await bundle.refreshCheck();
  };

  return (
    <Modal
      open={open}
      title={t("delivery.config.title")}
      onCancel={onClose}
      // 表单弹层：误点遮罩会丢配置草稿，必须显式禁掉。
      mask={{ closable: false }}
      // R-21：动作放原生 footer——内容再长也只滚 body，按钮始终贴在弹层底部。
      footer={
        <div className="resume-delivery-footer">
          {progress ? (
            <span className="resume-delivery-progress" role="status">
              {t("delivery.export.singleProgress", {
                index: progress.index,
                total: progress.total,
                format: formatLabel(progress.format),
              })}
            </span>
          ) : null}
          <Space>
            <Button onClick={onClose} disabled={busy}>
              {t("common.action.cancel")}
            </Button>
            <Button type="primary" loading={busy} onClick={() => void runExport()}>
              {mode === "single"
                ? busy
                  ? t("delivery.export.singleExporting")
                  : t("delivery.export.actionSingle")
                : busy
                  ? t("delivery.export.exporting")
                  : t("delivery.export.action")}
            </Button>
          </Space>
        </div>
      }
      width="min(760px, 94vw)"
      styles={{ body: { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto" } }}
      destroyOnHidden
    >
      <div className="resume-delivery">
        <div className="resume-delivery-mode">
          <span className="resume-delivery-label">{t("delivery.mode.label")}</span>
          <Radio.Group
            value={mode}
            disabled={busy}
            optionType="button"
            buttonStyle="solid"
            onChange={(event) =>
              setMode(event.target.value as NonNullable<ExportPresetConfig["mode"]>)
            }
            options={[
              { value: "bundle", label: t("delivery.mode.bundle") },
              { value: "single", label: t("delivery.mode.single") },
            ]}
          />
          <p className="resume-delivery-hint">
            {mode === "single"
              ? t("delivery.mode.singleHint", { count: bundle.config.formats.length })
              : t("delivery.mode.bundleHint")}
          </p>
        </div>
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
          disabled={busy}
          archiveDisabled={mode === "single"}
        />

        {variants.length > 0 || variantLoading ? (
          <VariantPicker
            variants={variants}
            loading={variantLoading}
            value={selectedVariantId}
            onChange={setSelectedVariantId}
            disabled={bundle.exporting}
          />
        ) : null}

        <ConfigPreviewPanel
          resumeId={resumeId}
          disabled={bundle.exporting}
          template={template || undefined}
          formatName={formatName || undefined}
          pageLimit={pageLimit}
          fontScale={fontScale}
          language={language || undefined}
          formatConfig={formatConfig}
          includePhoto={bundle.config.include_photo}
          content={content}
          watermark={bundle.config.watermark}
          redact={bundle.config.redact}
          variantId={selectedVariantId}
        />

        <p className="resume-delivery-hint">{t("delivery.export.snapshotKept")}</p>
        {mode === "bundle" && bundle.config.archive_original ? (
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

        {preflightGate.node}
        <ExportCheckCard
          summary={bundle.summary}
          source={bundle.checkSource}
          checking={bundle.checking}
          checkFailed={bundle.checkFailed}
          onRefresh={() => void bundle.refreshCheck()}
        />
      </div>
    </Modal>
  );
}
