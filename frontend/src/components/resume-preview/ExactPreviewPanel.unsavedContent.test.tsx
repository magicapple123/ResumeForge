// SPDX-License-Identifier: Apache-2.0
/**
 * W04：精确预览要排**还没保存**的正文。
 *
 * 单独成文件的原因：`ExactPreviewPanel.test.tsx` 已经贴着测试行数预算，而这一条守的
 * 是另一件事——"预览与用户眼前的草稿是同一份内容"，不是节流/竞态/URL 生命周期。
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExactPreviewPanel from "./ExactPreviewPanel";
import { clearPreviewCache } from "./exactPreviewCache";

const fetchPreview = vi.hoisted(() => vi.fn());

vi.mock("../../api/resumes", () => ({
  fetchResumePreviewPdf: fetchPreview,
}));

beforeEach(() => {
  fetchPreview.mockReset();
  clearPreviewCache();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:preview",
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => undefined });
});

afterEach(() => {
  cleanup();
});

/** 等过去抖窗口（与主测试文件同一档）。 */
function waitForRequest() {
  return new Promise((resolve) => setTimeout(resolve, 420));
}

function pdf() {
  return {
    blob: new Blob(["%PDF-1.3"], { type: "application/pdf" }),
    pages: 1,
    pagesNeeded: 1,
    pageLimit: 1,
    overflow: false,
  };
}

function panel(overrides: Record<string, unknown> = {}) {
  return (
    <ExactPreviewPanel
      resumeId={7}
      template="classic"
      formatName=""
      pageLimit={1}
      fontScale="standard"
      formatConfig={{ page_padding: 14 }}
      contentSignature="c1"
      height={600}
      {...overrides}
    />
  );
}

describe("ExactPreviewPanel 的未保存正文", () => {
  it("W04：还没保存的正文要原样发给服务端，签名变了才重发", async () => {
    // 同一份内容重复上传没有意义；这里只要证明它**进了请求体**，且换内容会重发。
    fetchPreview.mockResolvedValue(pdf());

    const draft = {
      photo: "",
      name: "张三",
      gender: "",
      birth_year: "",
      phone: "",
      email: "",
      city: "",
      personal_website: "",
      github: "",
      job_intent: "",
      summary: "这条总结还没保存",
      education: [],
      experience: [],
      campus_experience: [],
      projects: [],
      skills: [],
      awards: [],
    };
    const { rerender } = render(panel({ content: draft, contentSignature: "draft-1" }));
    await waitForRequest();

    expect(fetchPreview).toHaveBeenCalledTimes(1);
    const [, options] = fetchPreview.mock.calls[0];
    expect(options.content).toEqual(draft);

    // 内容换了、签名也跟着换 → 必须重发，不能命中上一份缓存。
    const changed = { ...draft, summary: "又改了一句" };
    rerender(panel({ content: changed, contentSignature: "draft-2" }));
    await waitForRequest();
    expect(fetchPreview).toHaveBeenCalledTimes(2);
    expect(fetchPreview.mock.calls[1][1].content.summary).toBe("又改了一句");
  });
});
