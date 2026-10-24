// SPDX-License-Identifier: Apache-2.0
/** 试模板取数层：请求体形状（示例/当前、覆盖策略）与真实测量映射。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeLayout } from "../../types";

const apiMocks = vi.hoisted(() => ({
  previewResumeTemplate: vi.fn(),
  fetchResumePreviewPdf: vi.fn(),
}));

vi.mock("../../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/resumes")>()),
  previewResumeTemplate: apiMocks.previewResumeTemplate,
  fetchResumePreviewPdf: apiMocks.fetchResumePreviewPdf,
}));

import {
  fetchTrialPreview,
  measureOptions,
  measureTrial,
  templatePreviewPayload,
} from "./trialRequests";

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "compact",
  page_limit: 2,
  font_scale: "large",
  format_config: { accent: "#123456" },
};

const CONTENT = { summary: ["x"] } as never;
const CONTEXT = { mode: "current" as const, layout: LAYOUT, resumeId: 7, content: CONTENT };

beforeEach(() => {
  apiMocks.previewResumeTemplate.mockReset();
  apiMocks.fetchResumePreviewPdf.mockReset();
});

describe("trialRequests · 预览请求体", () => {
  it("示例模式不传 resume_id / content", () => {
    const payload = templatePreviewPayload({
      context: { ...CONTEXT, mode: "demo" },
      template: "modern",
      useOverrides: true,
    });
    expect(payload).toEqual({
      template_name: "modern",
      format_name: "compact",
      format_config: { accent: "#123456" },
      page_limit: 2,
      font_scale: "large",
    });
  });

  it("当前内容优先用未保存正文，其次用简历 id", () => {
    expect(
      templatePreviewPayload({ context: CONTEXT, template: "modern", useOverrides: true }).content,
    ).toBe(CONTENT);
    const withoutContent = templatePreviewPayload({
      context: { ...CONTEXT, content: null },
      template: "modern",
      useOverrides: true,
    });
    expect(withoutContent.resume_id).toBe(7);
    expect(withoutContent.content).toBeUndefined();
  });

  it("覆盖策略=false 时预览按模板默认排（format_name 与 format_config 都清空）", () => {
    const payload = templatePreviewPayload({
      context: CONTEXT,
      template: "modern",
      useOverrides: false,
    });
    expect(payload.format_name).toBe("");
    expect(payload.format_config).toEqual({});
  });

  it("fetchTrialPreview 把取消信号交给 fetch", async () => {
    apiMocks.previewResumeTemplate.mockResolvedValue("<html></html>");
    const controller = new AbortController();
    await fetchTrialPreview(
      { context: CONTEXT, template: "modern", useOverrides: true },
      controller.signal,
    );
    expect(apiMocks.previewResumeTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal, template_name: "modern" }),
    );
  });
});

describe("trialRequests · 真实测量", () => {
  it("示例模式 / 没有简历 id 时不测量", () => {
    expect(
      measureOptions({
        context: { ...CONTEXT, mode: "demo" },
        template: "modern",
        useOverrides: true,
      }),
    ).toBeNull();
    expect(
      measureOptions({
        context: { ...CONTEXT, resumeId: null },
        template: "modern",
        useOverrides: true,
      }),
    ).toBeNull();
  });

  it("当前内容 + 简历 id：请求体与导出/精确预览同口径", () => {
    const request = measureOptions({ context: CONTEXT, template: "modern", useOverrides: false });
    expect(request?.resumeId).toBe(7);
    expect(request?.options).toMatchObject({
      template: "modern",
      format_name: "",
      page_limit: 2,
      font_scale: "large",
      format_config: {},
      content: CONTENT,
    });
  });

  it("measureTrial 把响应头映射成页数/溢出", async () => {
    apiMocks.fetchResumePreviewPdf.mockResolvedValue({
      blob: new Blob(),
      pages: 2,
      pagesNeeded: 3,
      pageLimit: 2,
      overflow: true,
    });
    const measurement = await measureTrial({
      context: CONTEXT,
      template: "modern",
      useOverrides: true,
    });
    expect(measurement).toEqual({ pages: 2, pagesNeeded: 3, pageLimit: 2, overflow: true });
  });
});
