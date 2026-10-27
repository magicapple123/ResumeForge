// SPDX-License-Identifier: Apache-2.0
/**
 * #9 回归（精确预览一侧）：在「板块顺序」里上移一项，**服务端 PDF 必须重排**。
 *
 * 精确预览显示的是导出产物本身；它的缓存键（`formatKey`）里必须包含整组版式覆盖
 * （含 `format_config.section_order`），否则用户改完顺序、PDF 却命中旧缓存——
 * 界面一切正常，纸面一个字都不动。
 *
 * 这里用真实组件链路：`ResumeTemplateControls`（点 上移）→ 宿主 state（版式）→
 * `ExactPreviewPanel`（`formatConfig` 变了 → 重新请求 `/preview-pdf`），只把 API 换成替身。
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeLayout } from "../../types";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import { DEFAULT_LAYOUT } from "../ResumeLayoutControls.testkit";
import ResumeTemplateControls from "../resume/ResumeTemplateControls";
import ExactPreviewPanel from "./ExactPreviewPanel";
import { clearPreviewCache } from "./exactPreviewCache";

const fetchPreview = vi.hoisted(() => vi.fn());
vi.mock("../../api/resumes", () => ({ fetchResumePreviewPdf: fetchPreview }));

const pdf = () => ({
  blob: new Blob(["%PDF-1.3"], { type: "application/pdf" }),
  pages: 1,
  pagesNeeded: 1,
  pageLimit: 1,
  overflow: false,
});

/** 等过去抖窗口（真实定时器，见 ExactPreviewPanel.test.tsx 的同一写法）。 */
function waitForRequest() {
  return new Promise((resolve) => setTimeout(resolve, 420));
}

function Harness() {
  const [layout, setLayout] = useState<ResumeLayout>({ ...DEFAULT_LAYOUT, format_config: {} });
  return (
    <div>
      <ResumeTemplateControls
        layout={layout}
        catalog={TEMPLATE_CATALOG}
        onChange={(next) => setLayout(next)}
      />
      <ExactPreviewPanel
        resumeId={42}
        template={layout.template}
        formatName={layout.format_name}
        pageLimit={1}
        fontScale={layout.font_scale}
        language={layout.language ?? "zh-CN"}
        formatConfig={(layout.format_config ?? {}) as Record<string, unknown>}
        contentSignature="c1"
        height={600}
      />
    </div>
  );
}

const orderOf = (call: unknown[] | undefined): string[] | undefined => {
  const request = call?.[1] as { format_config?: { section_order?: string[] } } | undefined;
  return request?.format_config?.section_order;
};

beforeEach(() => {
  fetchPreview.mockReset();
  fetchPreview.mockResolvedValue(pdf());
  clearPreviewCache();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:preview",
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: () => undefined,
  });
});

afterEach(() => {
  cleanup();
});

describe("板块顺序 → 精确预览（PDF 重排）", () => {
  it("上移一项后重新请求 PDF，且请求体带新顺序（不会命中旧缓存）", async () => {
    render(<Harness />);
    await waitForRequest();
    expect(fetchPreview).toHaveBeenCalledTimes(1);
    // 没调过顺序：请求体里不应出现 section_order（缺省 = 内置默认顺序）。
    expect(orderOf(fetchPreview.mock.calls[0])).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "调整简历板块顺序" }));
    const list = await waitFor(() => {
      const node = document.querySelector<HTMLElement>(".resume-section-order-list");
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });
    const rows = within(list).getAllByRole("listitem");
    fireEvent.click(within(rows[1]).getByRole("button", { name: /^把.+上移$/ }));

    await waitFor(() => expect(fetchPreview.mock.calls.length).toBeGreaterThan(1), {
      timeout: 4000,
    });
    const latest = fetchPreview.mock.calls[fetchPreview.mock.calls.length - 1];
    // 目录默认顺序第一项是 education，把第 2 项（experience）上移后它排第一。
    expect(orderOf(latest)?.[0]).toBe("experience");
  }, 15000);
});
