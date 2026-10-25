// SPDX-License-Identifier: Apache-2.0
/**
 * mock 导出适配器测试（契约 §6.5）：预设 CRUD、bundle、strict_revision 409、核对摘要、归档。
 * HTTP 适配的 URL/body 形状在 `exportApi.http.test.ts`（mock 与真实接口同形，本文件守住行为）。
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "../../api/apiError";
import { ensureIds } from "../resume-document/identity";
import type { ResumeContent } from "../../types/resume";
import { createMockExportDeliveryApi, toRevisionChangedError } from "./exportApi";
import { defaultPresetConfig } from "./types";

function content(): ResumeContent {
  return ensureIds({
    photo: "",
    name: "张三",
    gender: "",
    birth_year: "",
    phone: "13800000000",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "",
    summary: "",
    education: [],
    experience: [],
    campus_experience: [],
    projects: [],
    skills: [],
    awards: [],
  });
}

describe("mock 导出适配器", () => {
  it("预设 CRUD：创建/更新/删除并保持默认配置补齐", async () => {
    const api = createMockExportDeliveryApi();
    const created = await api.createPreset({
      name: "对外发送",
      config: { ...defaultPresetConfig(), formats: ["pdf", "docx"], redact: true },
    });
    expect(created.id).toBeGreaterThan(0);
    expect(created.config.formats).toEqual(["pdf", "docx"]);
    expect(await api.listPresets()).toHaveLength(1);

    const updated = await api.updatePreset(created.id, {
      name: "对外发送",
      config: { ...created.config, watermark: "机密" },
      is_default: true,
    });
    expect(updated.config.watermark).toBe("机密");
    expect(updated.is_default).toBe(true);

    await api.deletePreset(created.id);
    expect(await api.listPresets()).toHaveLength(0);
  });

  it("strict_revision 不一致 → ExportRevisionChangedError（带当前 revision）", async () => {
    const api = createMockExportDeliveryApi({ currentRevision: 8 });
    await expect(
      api.exportBundle(3, { formats: ["pdf"], resume_revision: 7, strict_revision: true }),
    ).rejects.toMatchObject({ code: "resume_revision_changed", currentRevision: 8 });
    await expect(
      api.exportBundle(3, { formats: ["pdf"], resume_revision: 8, strict_revision: true }),
    ).resolves.toMatchObject({ filename: "delivery-bundle.zip" });
  });

  it("核对摘要来自当前内容（隐藏/联系方式/目标）", async () => {
    const hiddenContent: ResumeContent = {
      ...content(),
      skills: [{ name: "Python", level: "熟练", hidden: true }],
    };
    const api = createMockExportDeliveryApi({
      content: hiddenContent,
      company: "甲公司",
      jobTitle: "后端",
      resumeTitle: "后端简历",
      currentRevision: 3,
    });
    await expect(api.checkExport(3, {})).resolves.toMatchObject({
      target_company: "甲公司",
      target_job_title: "后端",
      resume_title: "后端简历",
      contact_present: true,
      revision: 3,
      hidden_count: 1,
    });
  });

  it("真实后端 409：嵌套 detail.code 优先于传输层 code=http", () => {
    // 真实后端形状：{"detail":{"detail":"...","code":"resume_revision_changed","revision":9}}
    const error = new ApiError("版本已更新", 409, {
      code: "http",
      payload: {
        detail: { detail: "简历版本已变化", code: "resume_revision_changed", revision: 9 },
      },
    });
    expect(toRevisionChangedError(error)?.currentRevision).toBe(9);
    // 普通失败（无业务码）不能被误判成版本冲突。
    expect(
      toRevisionChangedError(new ApiError("请求失败", 502, { code: "http", payload: {} })),
    ).toBeNull();
  });

  it("checkExport 记录请求体；serverCheck=unavailable 时返回 null（feature-detect 回退）", async () => {
    const api = createMockExportDeliveryApi({ serverCheck: "unavailable" });
    const result = await api.checkExport(3, {
      layout: { template: "classic", page_limit: 1 },
      variant_id: 7,
    });
    expect(result).toBeNull();
    expect(api.checkRequests[0]).toMatchObject({
      layout: { template: "classic", page_limit: 1 },
      variant_id: 7,
    });
  });

  it("checkExport 的 serverCheck=error 会把真失败抛给调用方（不静默降级）", async () => {
    const api = createMockExportDeliveryApi({ serverCheck: "error" });
    await expect(api.checkExport(3, {})).rejects.toMatchObject({ status: 502 });
  });

  it("导出请求体记录 variant_id（W16 按变体导出）", async () => {
    const api = createMockExportDeliveryApi();
    await api.exportBundle(3, { formats: ["pdf"], variant_id: 11 });
    expect(api.bundleRequests[0].variant_id).toBe(11);
  });

  it("归档原件：archive_original=true 时列表多一条，可删除", async () => {
    const api = createMockExportDeliveryApi();
    await api.exportBundle(3, { formats: ["pdf"], archive_original: true });
    const artifacts = await api.listArtifacts(3);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].sha256).toHaveLength(64);
    await api.deleteArtifact(3, artifacts[0].id);
    expect(await api.listArtifacts(3)).toHaveLength(0);
  });
});
