// SPDX-License-Identifier: Apache-2.0
/**
 * 成套导出 + D20 核对的状态机（W19 / D18–D20）。
 *
 * 三条职责：
 * 1. 持有"这次导出"的配置（默认 / 从预设载入 / 用户修改），不碰文档内容；
 * 2. 核对摘要：**优先用服务端** `POST /preflight {purpose:"export"}` 的 `export_summary`
 *    （与导出同一份 content/layout/revision/variant 快照）；后端尚未具备该能力时
 *    （feature-detect 返回 null）回退到"同一份导出输入本地核对"，并在卡片上**如实标注来源**；
 * 3. 导出：请求带当前草稿 content / 版式 / variant_id / `strict_revision`；后端 409
 *    `resume_revision_changed` 转成 `revisionChanged` 状态，**不自动重试**。
 */
import { useCallback, useMemo, useState } from "react";
import type { ResumeDocument } from "../../types/resumeDocument";
import { buildExportCheckSummary } from "./check";
import type { ExportBundleDownload, ExportDeliveryApi } from "./exportApi";
import { toRevisionChangedError } from "./exportApi";
import { toBundleRequest } from "./presets";
import type {
  ExportBundleRequest,
  ExportCheckRequest,
  ExportCheckSummary,
  ExportPreset,
  ExportPresetConfig,
} from "./types";
import { defaultPresetConfig } from "./types";
import { configFromPreset } from "./useExportPresets";

/** 核对摘要的来源：server = 服务端按导出同一快照算的；local = 后端未就绪时的同输入回退。 */
export type ExportCheckSource = "server" | "local";

export interface ExportBundleOptions {
  api: ExportDeliveryApi;
  resumeId: number | null;
  /** 当前草稿正文：随请求发给后端做"同快照"（不落库、不冻结）。 */
  content?: ResumeDocument | null;
  /** 服务端当前 revision；null = 还没拿到（此时不允许 strict 导出）。 */
  revision: number | null;
  resumeTitle: string;
  company: string;
  jobTitle: string;
  documentMode?: string;
  /** 草稿版式（可选；不传则后端用记录里的已保存版式）。 */
  language?: string;
  template?: string;
  /** 具名版式（format_name）：服务端核对按它解析；缺省 = 记录值。 */
  formatName?: string;
  pageLimit?: number;
  fontScale?: string;
  formatConfig?: Record<string, unknown>;
  marginMm?: number;
  /** W16 岗位变体：导出与核对都带它，服务端按变体导出输入算。 */
  variantId?: number | null;
}

export interface ExportBundleState {
  config: ExportPresetConfig;
  setConfig: (next: ExportPresetConfig) => void;
  applyPreset: (preset: ExportPreset | null) => void;
  /** 当前核对摘要（服务端优先；服务端不可用时是同一份导出输入的本地计算）。 */
  summary: ExportCheckSummary;
  /** 摘要来源（UI 必须标注，不能把本地回退说成服务端核对）。 */
  checkSource: ExportCheckSource;
  checking: boolean;
  checkFailed: boolean;
  /** 真刷新：发一次服务端核对；不可用/失败时保留本地摘要并置 checkFailed。 */
  refreshCheck: () => Promise<void>;
  exporting: boolean;
  exportFailed: boolean;
  /** 服务端版本已前进（strict_revision 409）；为真时禁止直接重试导出。 */
  revisionChanged: boolean;
  exportNow: () => Promise<ExportBundleDownload | null>;
}

export function useExportBundle({
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
  variantId,
}: ExportBundleOptions): ExportBundleState {
  const [config, setConfig] = useState<ExportPresetConfig>(defaultPresetConfig);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [revisionChanged, setRevisionChanged] = useState(false);
  const [serverSummary, setServerSummary] = useState<ExportCheckSummary | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);

  // 服务端摘要只在**同一份输入**上有效：内容/版式/版本/变体一变就丢弃，回退本地。
  const checkSignature = useMemo(
    () =>
      JSON.stringify([
        content ?? null,
        revision,
        template ?? null,
        formatName ?? null,
        pageLimit ?? null,
        fontScale ?? null,
        formatConfig ?? null,
        language ?? null,
        variantId ?? null,
        documentMode ?? null,
      ]),
    [
      content,
      revision,
      template,
      formatName,
      pageLimit,
      fontScale,
      formatConfig,
      language,
      variantId,
      documentMode,
    ],
  );
  const [checkedSignature, setCheckedSignature] = useState<string | null>(null);
  if (checkedSignature !== null && checkedSignature !== checkSignature) {
    // 输入已变：上一次服务端核对结果不能再展示（复检失败）。渲染期守卫，避免 effect 竞态。
    setCheckedSignature(null);
    setServerSummary(null);
  }

  /** 本地回退摘要：与导出请求同一份输入（当前实现），不冒充服务端结论。 */
  const localSummary = useMemo(
    () =>
      buildExportCheckSummary({
        resumeTitle,
        company,
        jobTitle,
        content,
        revision: revision ?? 0,
        expectedRevision: revision,
        documentMode,
      }),
    [company, content, documentMode, jobTitle, resumeTitle, revision],
  );

  const buildRequest = useCallback(
    (strictRevision: boolean): ExportBundleRequest => ({
      ...toBundleRequest(config, { revision: revision ?? undefined, strictRevision }),
      ...(content ? { content } : {}),
      ...(language ? { language } : {}),
      ...(pageLimit !== undefined ? { page_limit: pageLimit } : {}),
      ...(fontScale ? { font_scale: fontScale } : {}),
      ...(formatConfig ? { format_config: formatConfig } : {}),
      ...(marginMm !== undefined ? { margin_mm: marginMm } : {}),
      ...(variantId != null ? { variant_id: variantId } : {}),
    }),
    [config, content, formatConfig, fontScale, language, marginMm, pageLimit, revision, variantId],
  );

  const buildCheckRequest = useCallback(
    (): ExportCheckRequest => ({
      ...(content ? { content } : {}),
      layout: {
        template: template ?? null,
        format_name: formatName ?? null,
        page_limit: pageLimit ?? null,
        font_scale: fontScale ?? null,
        format_config: formatConfig ?? null,
        language: language ?? null,
      },
      ...(variantId != null ? { variant_id: variantId } : {}),
    }),
    [content, formatConfig, fontScale, formatName, language, pageLimit, template, variantId],
  );

  const refreshCheck = useCallback(async () => {
    if (resumeId === null) return;
    setChecking(true);
    setCheckFailed(false);
    try {
      const next = await api.checkExport(resumeId, buildCheckRequest());
      setServerSummary(next);
      setCheckedSignature(next ? checkSignature : null);
    } catch {
      // 真失败：保留本地回退摘要，但必须让用户看到"核对失败"，不能假装核对过。
      setServerSummary(null);
      setCheckedSignature(null);
      setCheckFailed(true);
    } finally {
      setChecking(false);
    }
  }, [api, buildCheckRequest, checkSignature, resumeId]);

  // 换 revision（别的窗口保存过 / 刷新后）时旧的"版本已更新"横幅要跟着更新。
  // 用渲染期守卫而不是 effect：effect 内同步 setState 会触发级联渲染（react-hooks 规则）。
  const [prevRevision, setPrevRevision] = useState(revision);
  if (prevRevision !== revision) {
    setPrevRevision(revision);
    setRevisionChanged(false);
  }

  const applyPreset = useCallback((preset: ExportPreset | null) => {
    setConfig(configFromPreset(preset));
  }, []);

  const exportNow = useCallback(async (): Promise<ExportBundleDownload | null> => {
    if (resumeId === null) return null;
    setExporting(true);
    setExportFailed(false);
    // 每次重试都重新判断：上一次的"版本已更新"横幅不能永远挡住下一次导出。
    setRevisionChanged(false);
    try {
      return await api.exportBundle(resumeId, buildRequest(revision !== null));
    } catch (error) {
      if (toRevisionChangedError(error)) {
        // 版本冲突不是失败：要求用户刷新核对后重来，绝不自动覆盖/重试。
        setRevisionChanged(true);
      } else {
        setExportFailed(true);
      }
      return null;
    } finally {
      setExporting(false);
    }
  }, [api, buildRequest, resumeId, revision]);

  return {
    config,
    setConfig,
    applyPreset,
    summary: serverSummary ?? localSummary,
    checkSource: serverSummary ? "server" : "local",
    checking,
    checkFailed,
    refreshCheck,
    exporting,
    exportFailed,
    revisionChanged,
    exportNow,
  };
}
