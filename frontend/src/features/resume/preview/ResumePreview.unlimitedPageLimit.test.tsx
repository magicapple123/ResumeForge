// SPDX-License-Identifier: Apache-2.0
/**
 * `ResumePreview` 的「不限篇幅」（`pages={0}`）行为。
 *
 * 缺陷族：0 是合法的语义值（不限），任何一处 `Math.max(1, …)` 都会把"不限"读成"最严的
 * 一页"。在画布上它有两个可见后果，本文件各钉一条：
 *
 * 1. 测页请求按 1 页发出 → 服务端按 1 页排，屏幕上"实际 1 页"、导出却是完整多页；
 * 2. 上限被算成 1 → 第 2 页起被画成「超额页」（红框 / 红带），提示条还会说
 *    "第 2 页起不计入导出"——而导出其实一个字节都没裁。
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  request: clientMocks.request,
}));

// jsdom 不做真实排版：测量永远是"没量到"，页数只由服务端报告决定。
vi.mock("../../../utils/resumeLayoutMeasure", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../utils/resumeLayoutMeasure")>();
  return { ...actual, measureResumeLayout: () => null };
});

// 精确面板常驻（只是藏起来）；不让它真的去要 PDF。
const fetchPreviewPdf = vi.hoisted(() => vi.fn(() => new Promise(() => {})));
vi.mock("../../../api/resumes", () => ({ fetchResumePreviewPdf: fetchPreviewPdf }));

import ResumePreview from "./ResumePreview";
import { clearPreviewCache } from "./exactPreviewCache";

/**
 * `contentSignature` 由调用方给**不同值**：`useReportedPageCount` 的页数缓存是模块级的
 * （同一屏两个画布共用），同一个签名在第二条用例里会直接命中缓存、一个请求都不发。
 */
function exactPreview(contentSignature: string) {
  return {
    resumeId: 7,
    template: "classic",
    formatName: "",
    fontScale: "standard",
    language: "zh-CN",
    formatConfig: {},
    contentSignature,
  };
}

/** 后端报告里「不限篇幅」的实际形状：数字是渲染保护上限，语义在布尔里。 */
const REPORT = {
  pages: 2,
  pages_needed: 2,
  overflow: false,
  page_limit: 10,
  page_limit_is_unlimited: true,
  truncated_at: null,
  manual_breaks: [],
  warnings: [],
  snapshot: { content_sha256: "c".repeat(64), render_config_sha256: "r".repeat(64) },
};

function renderPreview(pages: number, contentSignature: string) {
  return render(
    <ResumePreview
      html="<!doctype html><html><body><p>hi</p></body></html>"
      warnings={[]}
      pages={pages}
      exactPreview={exactPreview(contentSignature)}
    />,
  );
}

function reportBody(): Record<string, unknown> | null {
  const call = clientMocks.request.mock.calls.find((item) =>
    String(item[0]).endsWith("/pagination/report"),
  );
  if (!call) return null;
  return JSON.parse((call[1] as { body?: string }).body ?? "{}") as Record<string, unknown>;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  clientMocks.request.mockReset();
  fetchPreviewPdf.mockReset();
  fetchPreviewPdf.mockImplementation(() => new Promise(() => {}));
  clearPreviewCache();
});

describe("ResumePreview · 不限篇幅（pages=0）", () => {
  it("测页请求发 page_limit: 0（不是被夹出来的 1）", async () => {
    clientMocks.request.mockResolvedValue(REPORT);
    renderPreview(0, "zero-limit-request");

    // 自动取数有 600ms 合并窗口（与草稿实时预览同一防抖）。
    await waitFor(() => expect(reportBody()).not.toBeNull(), { timeout: 5000 });
    expect(reportBody()).toMatchObject({ page_limit: 0, template: "classic" });
  });

  it("按真实页数画纸：2 页就画 2 张，且没有一张是「超额页」", async () => {
    clientMocks.request.mockResolvedValue(REPORT);
    const { container } = renderPreview(0, "zero-limit-papers");

    await act(async () => {
      await waitFor(() => expect(reportBody()).not.toBeNull(), { timeout: 5000 });
    });

    await waitFor(() => {
      expect(container.querySelectorAll(".resume-preview-page")).toHaveLength(2);
    });
    // 不限篇幅：导出不裁剪，所以任何一页都不该带「超额」标记。
    expect(container.querySelectorAll(".resume-preview-page.is-over-limit")).toHaveLength(0);
    expect(container.querySelectorAll("[data-over-limit]")).toHaveLength(0);
  });

  it("不限篇幅不弹「上限 N 页 / 第 N 页起不计入导出」这条告警", async () => {
    clientMocks.request.mockResolvedValue(REPORT);
    const { container } = renderPreview(0, "zero-limit-alert");

    await act(async () => {
      await waitFor(() => expect(reportBody()).not.toBeNull(), { timeout: 5000 });
    });

    expect(container.querySelector(".resume-preview-overflow")).toBeNull();
    // 画布本身照常渲染（提示条没了不等于整块坏了）。
    expect(screen.getByTitle("简历预览")).toBeInTheDocument();
  });
});
