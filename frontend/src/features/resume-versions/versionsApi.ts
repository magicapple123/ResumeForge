// SPDX-License-Identifier: Apache-2.0
/** W13 命名版本 / 岗位变体接口（真实端点，契约见 ResumeForge-w13-versions-contract）。 */
import { request } from "../../api/client";
import type {
  ScenarioVariantAdoptRequest,
  ScenarioVariantCreateRequest,
  ScenarioVariantPreviewOut,
  ScenarioVariantPreviewRequest,
  VariantCreateRequest,
  VariantOut,
  VariantDetailOut,
  VariantListOut,
  VariantSyncOut,
  VariantSyncRequest,
  VersionCompareOut,
  VersionCreateRequest,
  VersionDetailOut,
  VersionListOut,
  VersionOut,
  VersionRestoreOut,
} from "./types";

const base = (resumeId: number) => `/resumes/${resumeId}`;

export function listVersions(resumeId: number): Promise<VersionListOut> {
  return request(`${base(resumeId)}/versions`);
}

export function createVersion(
  resumeId: number,
  payload: VersionCreateRequest,
): Promise<VersionOut> {
  return request(`${base(resumeId)}/versions`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getVersion(resumeId: number, versionId: number): Promise<VersionDetailOut> {
  return request(`${base(resumeId)}/versions/${versionId}`);
}

export function freezeVersion(
  resumeId: number,
  versionId: number,
  frozen: boolean,
): Promise<VersionOut> {
  return request(`${base(resumeId)}/versions/${versionId}/freeze`, {
    method: "POST",
    body: JSON.stringify({ frozen }),
  });
}

/** 比较两个版本；against 可传版本 id 或 "current"（与当前简历比）。 */
export function compareVersions(
  resumeId: number,
  baseVersionId: number,
  against: number | "current",
): Promise<VersionCompareOut> {
  return request(`${base(resumeId)}/versions/${baseVersionId}/compare/${against}`);
}

export function restoreVersion(
  resumeId: number,
  versionId: number,
  expectedRevision?: number,
): Promise<VersionRestoreOut> {
  const body = expectedRevision === undefined ? {} : { expected_revision: expectedRevision };
  return request(`${base(resumeId)}/versions/${versionId}/restore`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listVariants(resumeId: number): Promise<VariantListOut> {
  return request(`${base(resumeId)}/variants`);
}

export function createVariant(
  resumeId: number,
  payload: VariantCreateRequest,
): Promise<VariantOut> {
  return request(`${base(resumeId)}/variants`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getVariant(resumeId: number, variantId: number): Promise<VariantDetailOut> {
  return request(`${base(resumeId)}/variants/${variantId}`);
}

// ===== A5：按职业场景派生变体（创建 → 预览候选 → 采纳）=====

/** 先派生独立变体；source 简历零写入。 */
export function createScenarioVariant(
  resumeId: number,
  payload: ScenarioVariantCreateRequest,
): Promise<VariantOut> {
  return request(`${base(resumeId)}/scenario-variants`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** 生成候选（不落库）；采纳前用户先看差异。 */
export function previewScenarioVariant(
  resumeId: number,
  variantId: number,
  payload: ScenarioVariantPreviewRequest,
  signal?: AbortSignal,
): Promise<ScenarioVariantPreviewOut> {
  return request(`${base(resumeId)}/variants/${variantId}/scenario-preview`, {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
}

/** 采纳候选到这条变体（双条件写；源简历零写入）。 */
export function adoptScenarioVariant(
  resumeId: number,
  variantId: number,
  payload: ScenarioVariantAdoptRequest,
): Promise<VariantDetailOut> {
  return request(`${base(resumeId)}/variants/${variantId}/scenario-adopt`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function syncVariants(
  resumeId: number,
  payload: VariantSyncRequest,
): Promise<VariantSyncOut> {
  return request(`${base(resumeId)}/variants/sync`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
