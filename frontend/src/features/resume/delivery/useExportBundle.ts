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
import type { ResumeDocument } from "../../../types/resumeDocument";
import { buildExportCheckSummary } from "./check";
import type { ExportBundleDownload, ExportDeliveryApi } from "./exportApi";
import { toRevisionChangedError } from "./exportApi";
import { toBundleRequest } from "./presets";
import type {
  ExportBundleRequest,
  ExportCheckRequest,
  ExportCheckSummary,
  ExportFormat,
  ExportPreset,
  ExportPresetConfig,
} from "./types";
import { defaultPresetConfig } from "./types";
import { configFromPreset } from "./useExportPresets";

/** 核对摘要的来源：server = 服务端按导出同一快照算的；local = 后端未就绪时的同输入回退。 */
export type ExportCheckSource = "server" | "local";

// ── 单独文件导出（R-21）───────────────────────────────────────────

/** 一个待导出的文件：格式 + 目标文件名（命名规则在前端渲染，与上面预览同口径）。 */
export interface SingleExportPlan {
  format: ExportFormat;
  filename: string;
}

/** 串行进度（index 从 1 开始）：界面文案「正在导出 2/3：Word」。 */
export interface SingleExportProgress {
  index: number;
  total: number;
  format: ExportFormat;
}

export interface SingleExportOutcome {
  /** 已成功保存的文件数（失败那一个不算）。 */
  completed: number;
  total: number;
  failed: { format: ExportFormat; reason: string } | null;
}

/**
 * 逐个导出多个格式并**串行**保存。
 *
 * 为什么串行：浏览器对"同一手势下的连续下载"会拦掉后几个（且被拒后静默失败），
 * 所以一次只发一个请求、保存完再发下一个；之间留 `gapMs` 让上一份下载先落地。
 * 失败立刻停：后面的文件大概率也是同一个原因（版本冲突 / 后端不可用），
 * 继续发只会让用户以为"部分成功"。
 */
export async function runSingleFileExports({
  plans,
  fetchOne,
  save,
  onProgress,
  gapMs = 300,
}: {
  plans: SingleExportPlan[];
  fetchOne: (plan: SingleExportPlan) => Promise<{ blob: Blob; filename?: string }>;
  save: (blob: Blob, filename: string) => void;
  onProgress?: (progress: SingleExportProgress) => void;
  gapMs?: number;
}): Promise<SingleExportOutcome> {
  let completed = 0;
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    onProgress?.({ index: index + 1, total: plans.length, format: plan.format });
    try {
      const result = await fetchOne(plan);
      save(result.blob, plan.filename || result.filename || `resume.${plan.format}`);
      completed += 1;
    } catch (error) {
      return {
        completed,
        total: plans.length,
        failed: {
          format: plan.format,
          reason: error instanceof Error ? error.message : String(error),
        },
      };
    }
    if (index < plans.length - 1 && gapMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  }
  return { completed, total: plans.length, failed: null };
}

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
