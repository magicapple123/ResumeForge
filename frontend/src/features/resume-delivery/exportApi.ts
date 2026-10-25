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
import { ApiError } from "../../api/apiError";
import type { ResumeContent } from "../../types/resume";
import { buildExportCheckSummary } from "./check";
import {
  defaultPresetConfig,
  EXPORT_REVISION_CHANGED_CODE,
  type ExportArtifactRecord,
  type ExportBundleRequest,
  type ExportCheckRequest,
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
  /**
   * D20 核对摘要：走 W11 preflight 的 `purpose:"export"`。
   *
   * 返回 `null` = 当前后端还没有这项能力（feature-detect，旧后端 extra="forbid" 会 422）——
   * 调用方必须回退到"同一份导出输入本地核对"并如实标注来源；网络/超时/5xx 等真失败
   * 仍然抛错，不能静默降级成一份看起来没问题的本地摘要。
   */
  checkExport(resumeId: number, body: ExportCheckRequest): Promise<ExportCheckSummary | null>;
  listArtifacts(resumeId: number): Promise<ExportArtifactRecord[]>;
  /** 删除原件：后端路径必须带 resume_id（契约 §6）。 */
  deleteArtifact(resumeId: number, artifactId: number): Promise<void>;
}

/** 后端还没有 `purpose:"export"` 能力时的 HTTP 状态（feature-detect 用，不是业务失败）。 */
const CHECK_UNAVAILABLE_STATUSES = new Set([400, 404, 422]);

function isCheckUnavailable(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    typeof error.status === "number" &&
    CHECK_UNAVAILABLE_STATUSES.has(error.status)
  );
}

/**
 * 只接受**完整**的 `export_summary`：缺一个字段就当作"后端未就绪"返回 null。
 *
 * 为什么不给缺字段补默认值：核对卡会把 target/contact/revision 直接展示给用户，
 * 补出来的"未关联 / 无联系方式"会被当成真实结论——那正是 D20 要避免的误导。
 */
function normalizeExportSummary(raw: unknown): ExportCheckSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const revision = value.revision;
  const hidden = value.hidden_count;
  if (
    typeof value.target_company !== "string" ||
    typeof value.target_job_title !== "string" ||
    typeof value.resume_title !== "string" ||
    typeof value.contact_present !== "boolean" ||
    typeof value.document_mode !== "string" ||
    typeof value.revision_changed !== "boolean" ||
    typeof revision !== "number" ||
    !Number.isFinite(revision) ||
    typeof hidden !== "number" ||
    !Number.isFinite(hidden)
  ) {
    return null;
  }
  return {
    target_company: value.target_company,
    target_job_title: value.target_job_title,
    resume_title: value.resume_title,
    contact_present: value.contact_present,
    document_mode: value.document_mode,
    revision,
    revision_changed: value.revision_changed,
    hidden_count: hidden,
  };
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
        // requestRaw 不像 request() 那样补 Content-Type：这里是 JSON body，
        // 缺这个头后端会把 body 当原始字符串解析，直接 422
        // "Input should be a valid dictionary or object to extract fields from"。
        headers: { "Content-Type": "application/json" },
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
      let data: { export_summary?: unknown };
      try {
        data = await request<{ export_summary?: unknown }>(`/resumes/${resumeId}/preflight`, {
          method: "POST",
          body: JSON.stringify({ purpose: "export", ...body }),
        });
      } catch (caught) {
        // 能力缺失（旧后端 400/404/422）→ null 由调用方回退本地核对；其余照抛。
        if (isCheckUnavailable(caught)) return null;
        throw caught;
      }
      // 字段缺失 = 仍是旧后端（或契约未对齐）→ 当能力缺失处理，而不是把半份摘要当真。
      return normalizeExportSummary(data.export_summary);
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
  /**
   * 模拟服务端 D20 核对能力的三种形态：
   * - `ok`（缺省）：返回与本地同形的摘要（服务端已就绪）；
   * - `unavailable`：返回 null（旧后端 422 → feature-detect 回退本地）；
   * - `error`：抛 502（真失败，UI 要显示"核对失败"而不是假装核对过）。
   */
  serverCheck?: "ok" | "unavailable" | "error";
}

export interface MockExportDeliveryApi extends ExportDeliveryApi {
  presetsSnapshot(): ExportPreset[];
  artifactsSnapshot(): ExportArtifactRecord[];
  /** 已发出的成套导出请求体（断言 variant_id / content 等同快照字段）。 */
  bundleRequests: ExportBundleRequest[];
  /** 已发出的 D20 核对请求体。 */
  checkRequests: ExportCheckRequest[];
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
  const bundleRequests: ExportBundleRequest[] = [];
  const checkRequests: ExportCheckRequest[] = [];
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
    bundleRequests,
    checkRequests,
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
      bundleRequests.push({ ...body });
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
    async checkExport(_resumeId, body) {
      calls.push("check-export");
      checkRequests.push({ ...body });
      if (options.serverCheck === "unavailable") return null;
      if (options.serverCheck === "error") {
        // i18n-ok: 传输层错误文案（ApiError.message 兜底，不是界面常驻文案）
        throw new ApiError("核对服务暂时不可用", 502, { code: "http" });
      }
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
