// SPDX-License-Identifier: Apache-2.0
/**
 * W19 导出配置/成套导出/归档原件的**唯一适配层**（契约 §6.5）。
 *
 * 面板只依赖 `ExportDeliveryApi`：
 * - `createExportDeliveryApi()` 走真实 HTTP（W19-BE 就绪后可用）；
 * - `createMockExportDeliveryApi()` 是测试/联调前的有状态假实现（预设 CRUD、bundle 下载、
 *   版本冲突 409、核对摘要、归档列表），行为与契约同形。
 *
 * 为什么放在 feature 目录：task-25 写入范围是 `features/resume-delivery/**` +
 * `components/resume/delivery/**` + i18n；`api/` 与 `types/` 由 lead 统一登记。
 */
import type { ResumeContent } from "../../types/resume";
import { buildExportCheckSummary } from "./check";
import {
  defaultPresetConfig,
  EXPORT_REVISION_CHANGED_CODE,
  type ExportArtifactRecord,
  type ExportBundleRequest,
  type ExportCheckSummary,
  type ExportPreset,
  type ExportPresetConfig,
} from "./types";
import { getFilenameFromDisposition, request, requestRaw } from "../../api/client";

export interface ExportPresetInput {
  name: string;
  description?: string;
  config: ExportPresetConfig;
  is_default?: boolean;
}

/** 严格版本核对失败（`strict_revision` + 服务端 revision 已变）。 */
export class ExportRevisionChangedError extends Error {
  readonly code = EXPORT_REVISION_CHANGED_CODE;
  constructor(readonly currentRevision: number | null) {
    super(EXPORT_REVISION_CHANGED_CODE);
    this.name = "ExportRevisionChangedError";
  }
}

/** 把后端 409（业务码 `resume_revision_changed`）识别成强类型错误。 */
export function toRevisionChangedError(error: unknown): ExportRevisionChangedError | null {
  if (error instanceof ExportRevisionChangedError) return error;
  // 后端（contract §4）把业务码包在 409 的 detail 里：
  // {"detail":{"detail":"...","code":"resume_revision_changed","revision":N}}，
  // 顶层没有 code，必须双处都看，否则冲突会被当成普通失败。
  const shaped = error as {
    businessCode?: string;
    code?: string;
    payload?: {
      revision?: number;
      detail?: { code?: string; revision?: number } | string;
    };
  };
  const nested = typeof shaped?.payload?.detail === "object" ? shaped.payload.detail : undefined;
  // 注意 `ApiError.code` 是**传输层分类**（http/network/timeout/cancelled），不是业务码；
  // 业务码只在 businessCode（顶层 code）或嵌套 detail.code 里。
  const code =
    shaped?.businessCode ??
    nested?.code ??
    (shaped?.code === EXPORT_REVISION_CHANGED_CODE ? shaped.code : undefined);
  if (code !== EXPORT_REVISION_CHANGED_CODE) return null;
  return new ExportRevisionChangedError(shaped?.payload?.revision ?? nested?.revision ?? null);
}

export interface ExportBundleDownload {
  blob: Blob;
  filename: string;
}

export interface ExportDeliveryApi {
  listPresets(): Promise<ExportPreset[]>;
  createPreset(input: ExportPresetInput): Promise<ExportPreset>;
  updatePreset(id: number, input: ExportPresetInput): Promise<ExportPreset>;
  deletePreset(id: number): Promise<void>;
  /** 成套导出 zip（文件名由服务端 Content-Disposition 给）。 */
  exportBundle(resumeId: number, body: ExportBundleRequest): Promise<ExportBundleDownload>;
  /** D20 核对摘要（复用 W11 preflight 的 `export_summary`）。 */
  checkExport(resumeId: number, body: ExportBundleRequest): Promise<ExportCheckSummary>;
  listArtifacts(resumeId: number): Promise<ExportArtifactRecord[]>;
  /** 删除原件：后端路径必须带 resume_id（契约 §6）。 */
  deleteArtifact(resumeId: number, artifactId: number): Promise<void>;
}

export function createExportDeliveryApi(): ExportDeliveryApi {
  return {
    async listPresets() {
      const data = await request<{ items: ExportPreset[] }>("/resumes/export-presets");
      return data.items ?? [];
    },
    async createPreset(input) {
      return request<ExportPreset>("/resumes/export-presets", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async updatePreset(id, input) {
      return request<ExportPreset>(`/resumes/export-presets/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    async deletePreset(id) {
      await request<void>(`/resumes/export-presets/${id}`, { method: "DELETE" });
    },
    async exportBundle(resumeId, body) {
      const resp = await requestRaw(`/resumes/${resumeId}/export-bundle`, {
        method: "POST",
        body: JSON.stringify(body),
        budget: "export",
      });
      return {
        blob: await resp.blob(),
        filename:
          getFilenameFromDisposition(resp.headers.get("Content-Disposition")) ??
          "delivery-bundle.zip",
      };
    },
    async checkExport(resumeId, body) {
      const data = await request<{ export_summary?: ExportCheckSummary }>(
        `/resumes/${resumeId}/preflight`,
        {
          method: "POST",
          body: JSON.stringify({ ...body, purpose: "export" }),
        },
      );
      if (!data.export_summary) throw new Error("preflight response is missing export_summary");
      return data.export_summary;
    },
    async listArtifacts(resumeId) {
      const data = await request<{ items: ExportArtifactRecord[] }>(
        `/resumes/${resumeId}/export-artifacts`,
      );
      return data.items ?? [];
    },
    async deleteArtifact(resumeId, artifactId) {
      await request<void>(`/resumes/${resumeId}/export-artifacts/${artifactId}`, {
        method: "DELETE",
      });
    },
  };
}

// ── mock（UI 测试/联调前）────────────────────────────────────────

export interface MockExportApiOptions {
  presets?: ExportPreset[];
  artifacts?: ExportArtifactRecord[];
  /** 当前内容：用于 mock 的 D20 核对摘要。 */
  content?: ResumeContent | null;
  company?: string;
  jobTitle?: string;
  resumeTitle?: string;
  /** `strict_revision` 时模拟"服务端版本已前进"。 */
  currentRevision?: number;
}

export interface MockExportDeliveryApi extends ExportDeliveryApi {
  presetsSnapshot(): ExportPreset[];
  artifactsSnapshot(): ExportArtifactRecord[];
  calls: string[];
}

let nextMockPresetId = 1;
let nextMockArtifactId = 1;

export function createMockExportDeliveryApi(
  options: MockExportApiOptions = {},
): MockExportDeliveryApi {
  let presets = (options.presets ?? []).map((preset) => ({
    ...preset,
    config: { ...defaultPresetConfig(), ...preset.config },
  }));
  let artifacts = (options.artifacts ?? []).map((artifact) => ({ ...artifact }));
  const calls: string[] = [];
  const currentRevision = options.currentRevision ?? 0;
  const summary = (): ExportCheckSummary =>
    buildExportCheckSummary({
      resumeTitle: options.resumeTitle ?? "",
      company: options.company ?? "",
      jobTitle: options.jobTitle ?? "",
      content: options.content ?? null,
      revision: currentRevision,
      expectedRevision: null,
    });

  const toPreset = (id: number, input: ExportPresetInput): ExportPreset => ({
    id,
    name: input.name,
    description: input.description ?? "",
    config: { ...defaultPresetConfig(), ...input.config },
    is_default: input.is_default === true,
    created_at: "2026-10-24T00:00:00Z",
    updated_at: "2026-10-24T00:00:00Z",
  });

  return {
    calls,
    presetsSnapshot: () => presets.map((preset) => ({ ...preset, config: { ...preset.config } })),
    artifactsSnapshot: () => artifacts.map((artifact) => ({ ...artifact })),
    async listPresets() {
      calls.push("list-presets");
      return presets.map((preset) => ({ ...preset, config: { ...preset.config } }));
    },
    async createPreset(input) {
      calls.push("create-preset");
      const preset = toPreset(nextMockPresetId++, input);
      presets = [...presets, preset];
      return preset;
    },
    async updatePreset(id, input) {
      calls.push(`update-preset:${id}`);
      const existing = presets.find((preset) => preset.id === id);
      if (!existing) throw new Error("preset not found");
      const updated = { ...toPreset(id, input), created_at: existing.created_at };
      presets = presets.map((preset) => (preset.id === id ? updated : preset));
      return updated;
    },
    async deletePreset(id) {
      calls.push(`delete-preset:${id}`);
      presets = presets.filter((preset) => preset.id !== id);
    },
    async exportBundle(resumeId, body) {
      calls.push("export-bundle");
      const requested = body.resume_revision;
      if (body.strict_revision && requested !== undefined && requested !== currentRevision) {
        throw new ExportRevisionChangedError(currentRevision);
      }
      if (body.archive_original) {
        artifacts = [
          ...artifacts,
          {
            id: nextMockArtifactId++,
            delivery_id: null,
            resume_id: resumeId,
            kind: "bundle_member",
            export_format: (body.formats ?? ["pdf"])[0] ?? "pdf",
            filename: "delivery-bundle.zip",
            media_type: "application/zip",
            size_bytes: 128,
            sha256: "c".repeat(64),
            resource_manifest: {},
            created_at: "2026-10-24T00:00:00Z",
          },
        ];
      }
      return { blob: new Blob(["zip"]), filename: "delivery-bundle.zip" };
    },
    async checkExport() {
      calls.push("check-export");
      return summary();
    },
    async listArtifacts() {
      calls.push("list-artifacts");
      return artifacts.map((artifact) => ({ ...artifact }));
    },
    async deleteArtifact(_resumeId, artifactId) {
      calls.push(`delete-artifact:${artifactId}`);
      artifacts = artifacts.filter((artifact) => artifact.id !== artifactId);
    },
  };
}
