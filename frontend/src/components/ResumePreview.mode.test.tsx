// SPDX-License-Identifier: Apache-2.0
/**
 * 预览口径切换（草稿 / 精确）：请求去重、常驻面板、测量来源、缩放解耦。
 *
 * 从 `ResumePreview.test.tsx` 拆出（文件行预算 500）：这一组用例共用"精确面板 + objectURL
 * 桩 + PDF 请求桩"，与工具条/溢出/真实高度三组没有交集；单独成文件后每组仍能独立运行。
 * 断言、夹具与拆分前逐字一致。
 */
import { cleanup, act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import ResumePreview from "./ResumePreview";
import { clearPreviewCache } from "./resume-preview/exactPreviewCache";

// 溢出测量要能被确定地触发：这组用例里只用它验证"测量来源还活着"，默认 null。
const measureState = vi.hoisted(() => ({
  value: null as { usedHeight: number; pageContentHeight: number; pageLimit: number } | null,
}));

vi.mock("../utils/resumeLayoutMeasure", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/resumeLayoutMeasure")>();
  return {
    ...actual,
    measureResumeLayout: () => measureState.value,
  };
});

// 精确预览会去服务端要 PDF；默认让请求永远悬着（= 还在排版），个别用例再给结果。
const fetchPreviewPdf = vi.hoisted(() => vi.fn(() => new Promise(() => {})));
vi.mock("../api/resumes", () => ({ fetchResumePreviewPdf: fetchPreviewPdf }));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  measureState.value = null;
  fetchPreviewPdf.mockReset();
  fetchPreviewPdf.mockImplementation(() => new Promise(() => {}));
  clearPreviewCache();
});

function getPreviewFrame(): HTMLIFrameElement {
  return screen.getByTitle("简历预览") as HTMLIFrameElement;
}

describe("ResumePreview 预览口径切换（精确 / 草稿）", () => {
  /** 精确面板会创建 objectURL；jsdom 没有这份实现，用例里换成可数的桩。 */
  function stubObjectUrls() {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: () => "blob:exact",
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
  }

  const exactPreview = {
    resumeId: 7,
    template: "classic",
    formatName: "",
    fontScale: "standard",
    // 语言是 `ExactPreviewOptions` 的必填项（它决定纸面文案），这里与真实宿主一样显式给出。
    language: "zh-CN",
    formatConfig: {},
    contentSignature: "c1",
  };

  function renderWithExact() {
    return render(
      <ResumePreview
        html="<!doctype html><html><body></body></html>"
        warnings={[]}
        pages={1}
        exactPreview={exactPreview}
      />,
    );
  }

  it("切回精确模式**不重排**：同一组参数只问服务端要一次", async () => {
    stubObjectUrls();
    fetchPreviewPdf.mockResolvedValueOnce({
      blob: new Blob(["%PDF-1.3"], { type: "application/pdf" }),
      pages: 1,
      pagesNeeded: 1,
      pageLimit: 1,
      overflow: false,
    });

    renderWithExact();
    act(() => {
      screen.getByRole("radio", { name: /精确/ }).click();
    });
    // 去抖 150ms + 一次请求：等它把 PDF 拿到、挂上 iframe。
    expect(await screen.findByTitle("简历精确预览（导出 PDF）")).toBeTruthy();
    expect(fetchPreviewPdf).toHaveBeenCalledTimes(1);

    // 草稿 → 精确：面板是**常驻**的（只是藏起来），所以这里既不该发请求，
    // 也不该把已经排好的那份丢掉——用户看到的还是同一份 PDF。
    act(() => {
      screen.getByRole("radio", { name: /草稿/ }).click();
    });
    // 草稿模式下纸面回来了（精确面板只是隐藏，不是卸载）。
    expect(screen.getByTitle("简历预览")).toBeTruthy();
    expect(screen.getByTitle("简历精确预览（导出 PDF）").closest("[hidden]")).not.toBeNull();

    act(() => {
      screen.getByRole("radio", { name: /精确/ }).click();
    });
    await waitFor(() =>
      expect(screen.getByTitle("简历精确预览（导出 PDF）").closest("[hidden]")).toBeNull(),
    );
    expect(fetchPreviewPdf).toHaveBeenCalledTimes(1);
  });

  it("精确模式下草稿画布**不卸载**：版面诊断的测量来源必须还活着", () => {
    stubObjectUrls();
    measureState.value = { usedHeight: 1000, pageContentHeight: 1000, pageLimit: 1 };
    const onMeasure = vi.fn();
    const { container } = render(
      <ResumePreview
        html="<!doctype html><html><body></body></html>"
        warnings={[]}
        pages={1}
        exactPreview={exactPreview}
        onMeasure={onMeasure}
      />,
    );
    fireEvent.load(getPreviewFrame());
    expect(onMeasure).toHaveBeenCalled();

    act(() => {
      screen.getByRole("radio", { name: /精确/ }).click();
    });
    onMeasure.mockClear();

    // 画布仍在：精确模式里它只是被裁成 0 高（`display: none` 会让 iframe 根本不排版，
    // 量出来全是 0，所以不能用 `hidden` 属性）。卸载它等于掐掉唯一的测量来源——
    // 表现就是"在精确模式里改参数，版面诊断整块不动"（2026-10-21 用户实测）。
    const viewport = container.querySelector(".resume-preview-viewport");
    const shell = viewport?.closest('[aria-hidden="true"]') as HTMLElement | null;
    expect(shell).not.toBeNull();
    expect(shell!.style.height).toBe("0px");

    // 而且真的还能量：再触发一次 load，测量结果照旧上报。
    fireEvent.load(screen.getAllByTitle(/^简历预览/)[0] as HTMLIFrameElement);
    expect(onMeasure).toHaveBeenCalled();
  });

  it("精确缩放与草稿解耦：进入精确按适应画布初始化（Q18/Q21）", () => {
    stubObjectUrls();
    renderWithExact();
    const label = () =>
      (document.querySelector(".resume-preview-zoom-label")?.textContent ?? "").trim();
    const percent = () => Number.parseInt(label(), 10);

    // 草稿口径放大两档：读数是 fit × zoom，一定比初始大。
    const initial = percent();
    fireEvent.click(screen.getByRole("button", { name: /放大预览/ }));
    fireEvent.click(screen.getByRole("button", { name: /放大预览/ }));
    const draftZoomed = percent();
    expect(draftZoomed).toBeGreaterThan(initial);

    // 切到精确：精确那一档从「适应画布」开始（100%），不继承草稿的放大。
    act(() => {
      screen.getByRole("radio", { name: /精确/ }).click();
    });
    expect(label()).toBe("100%");

    // 精确里放大 → 缩放条给出「纸面比相框宽」的可见状态，且不影响草稿档位。
    fireEvent.click(screen.getByRole("button", { name: /放大预览/ }));
    expect(percent()).toBeGreaterThan(100);
    expect(screen.getByText(t("preview.zoom.scrollHint"))).toBeInTheDocument();

    // 切回草稿：还是刚才那一档（两套状态互不覆盖）。
    act(() => {
      screen.getByRole("radio", { name: /草稿/ }).click();
    });
    expect(percent()).toBe(draftZoomed);
  });
});
