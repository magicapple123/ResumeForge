// SPDX-License-Identifier: Apache-2.0
/**
 * 成套导出 + D20 核对的状态机（W19 / D18–D20）。
 *
 * 三条职责：
 * 1. 持有"这次导出"的配置（默认 / 从预设载入 / 用户修改），不碰文档内容；
 * 2. 核对摘要：**与导出同一份输入**（当前草稿 + 版式 + revision）本地算六项，
 *    不发 preflight——W19-BE 契约 §8 明确 preflight 的 export_summary 复用留 W11/W21
 *    联调，当前 bundle manifest 才带 target 摘要；在这里调 preflight 只会得到 422；
 * 3. 导出：请求带当前草稿 content / 版式 / `strict_revision`；后端 409
 *    `resume_revision_changed` 转成 `revisionChanged` 状态，**不自动重试**。
 */
import { useCallback, useMemo, useState } from "react";
import type { ResumeContent } from "../../types/resume";
import { buildExportCheckSummary } from "./check";
import type { ExportBundleDownload, ExportDeliveryApi } from "./exportApi";
import { toRevisionChangedError } from "./exportApi";
import { toBundleRequest } from "./presets";
import type {
  ExportBundleRequest,
  ExportCheckSummary,
  ExportPreset,
  ExportPresetConfig,
} from "./types";
import { defaultPresetConfig } from "./types";
import { configFromPreset } from "./useExportPresets";

export interface ExportBundleOptions {
  api: ExportDeliveryApi;
  resumeId: number | null;
  /** 当前草稿正文：随请求发给后端做"同快照"（不落库、不冻结）。 */
  content?: ResumeContent | null;
  /** 服务端当前 revision；null = 还没拿到（此时不允许 strict 导出）。 */
  revision: number | null;
  resumeTitle: string;
  company: string;
  jobTitle: string;
  documentMode?: string;
  /** 草稿版式（可选；不传则后端用记录里的已保存版式）。 */
  language?: string;
  pageLimit?: number;
  fontScale?: string;
  formatConfig?: Record<string, unknown>;
  marginMm?: number;
}

export interface ExportBundleState {
  config: ExportPresetConfig;
  setConfig: (next: ExportPresetConfig) => void;
  applyPreset: (preset: ExportPreset | null) => void;
  /** 本地即时摘要（与请求同一份输入；形状与后端 manifest.target 对齐）。 */
  summary: ExportCheckSummary;
  checking: boolean;
  checkFailed: boolean;
  refreshCheck: () => void;
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
  pageLimit,
  fontScale,
  formatConfig,
  marginMm,
}: ExportBundleOptions): ExportBundleState {
  const [config, setConfig] = useState<ExportPresetConfig>(defaultPresetConfig);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [revisionChanged, setRevisionChanged] = useState(false);

  const summary = useMemo(
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

  const refreshCheck = useCallback(() => undefined, []);

  const applyPreset = useCallback((preset: ExportPreset | null) => {
    setConfig(configFromPreset(preset));
  }, []);

  const buildRequest = useCallback(
    (strictRevision: boolean): ExportBundleRequest => ({
      ...toBundleRequest(config, { revision: revision ?? undefined, strictRevision }),
      ...(content ? { content } : {}),
      ...(language ? { language } : {}),
      ...(pageLimit !== undefined ? { page_limit: pageLimit } : {}),
      ...(fontScale ? { font_scale: fontScale } : {}),
      ...(formatConfig ? { format_config: formatConfig } : {}),
      ...(marginMm !== undefined ? { margin_mm: marginMm } : {}),
    }),
    [config, content, formatConfig, fontScale, language, marginMm, pageLimit, revision],
  );

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
    summary,
    checking: false,
    checkFailed: false,
    refreshCheck,
    exporting,
    exportFailed,
    revisionChanged,
    exportNow,
  };
}
