// SPDX-License-Identifier: Apache-2.0
/**
 * 译文预览（只读抽屉）#18：Ctrl+滚轮缩放。
 *
 * 只 mock 取数两条链路（`features/resume/bilingual/api` 与 `api/resumeLayout`），
 * 断言重点：缩放只作用于预览内容（iframe 的 transform）、不按 Ctrl 时滚动行为不变、
 * 关闭抽屉复位 100%。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResumeLayout } from "../../../types";
import VariantReadOnlyPreviewDrawer from "./VariantReadOnlyPreviewDrawer";

const apiMocks = vi.hoisted(() => ({ fetchVariantExportInput: vi.fn() }));
vi.mock("./api", () => apiMocks);
const renderMocks = vi.hoisted(() => ({ renderResume: vi.fn() }));
vi.mock("../../../api/resumeLayout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/resumeLayout")>()),
  renderResume: renderMocks.renderResume,
}));

const FALLBACK: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  language: "zh-CN",
};

function setup() {
  apiMocks.fetchVariantExportInput.mockResolvedValue({
    content: {},
    layout: {},
    language: "en-US",
  });
  renderMocks.renderResume.mockResolvedValue("<html><body>preview</body></html>");
  const onClose = vi.fn();
  render(
    <VariantReadOnlyPreviewDrawer
      open
      resumeId={1}
      variantId={2}
      fallbackLayout={FALLBACK}
      onClose={onClose}
    />,
  );
  return { onClose };
}

/** 预览滚动容器（滚轮事件绑在这一层）。 */
function scrollBox(): HTMLElement {
  const box = document.querySelector<HTMLElement>(".bilingual-variant-preview-scroll");
  if (!box) throw new Error("preview scroll container not rendered");
  return box;
}

function frame(): HTMLIFrameElement {
  const element = document.querySelector("iframe");
  if (!element) throw new Error("preview iframe not rendered");
  return element as HTMLIFrameElement;
}

function transformOf(): string {
  return frame().style.transform;
}

afterEach(() => {
  cleanup();
  apiMocks.fetchVariantExportInput.mockReset();
  renderMocks.renderResume.mockReset();
});

describe("VariantReadOnlyPreviewDrawer 缩放（#18）", () => {
  it("Ctrl+滚轮缩放：transform 按步进变化，且被限制在 0.5–2.0", async () => {
    setup();
    await waitFor(() => expect(frame()).toBeInTheDocument());
    expect(transformOf()).toBe("scale(1)");
    const box = scrollBox();
    // wheel 监听器是提交后异步 flush 的 effect：首帧事件可能落在绑定前，轮询派发直到生效。
    await waitFor(() => {
      fireEvent.wheel(box, { ctrlKey: true, deltaY: -120 });
      return expect(transformOf()).toBe("scale(1.1)");
    });
    expect(document.querySelector(".bilingual-variant-preview-zoom")?.textContent).toBe("110%");
    // 缩到下限 0.5 后继续滚不再变小。
    for (let step = 0; step < 10; step += 1) fireEvent.wheel(box, { ctrlKey: true, deltaY: 120 });
    await waitFor(() => expect(transformOf()).toBe("scale(0.5)"));
    // 放大到上限 2 后继续滚不再变大。
    for (let step = 0; step < 20; step += 1) fireEvent.wheel(box, { ctrlKey: true, deltaY: -120 });
    await waitFor(() => expect(transformOf()).toBe("scale(2)"));
  });

  it("不按 Ctrl 的滚轮：缩放不动（滚动行为保持默认）", async () => {
    setup();
    await waitFor(() => expect(frame()).toBeInTheDocument());
    fireEvent.wheel(scrollBox(), { deltaY: -120 });
    expect(transformOf()).toBe("scale(1)");
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("关闭抽屉再打开：缩放复位 100%", async () => {
    apiMocks.fetchVariantExportInput.mockResolvedValue({
      content: {},
      layout: {},
      language: "en-US",
    });
    renderMocks.renderResume.mockResolvedValue("<html><body>preview</body></html>");
    const drawer = (open: boolean) => (
      <VariantReadOnlyPreviewDrawer
        open={open}
        resumeId={1}
        variantId={2}
        fallbackLayout={FALLBACK}
        onClose={vi.fn()}
      />
    );
    const view = render(drawer(true));
    await waitFor(() => expect(frame()).toBeInTheDocument());
    const box = scrollBox();
    // 同上：轮询派发直到缩放生效（监听器是提交后异步 flush 的 effect）。
    await waitFor(() => {
      fireEvent.wheel(box, { ctrlKey: true, deltaY: -120 });
      return expect(transformOf()).toBe("scale(1.1)");
    });
    fireEvent.wheel(box, { ctrlKey: true, deltaY: -120 });
    await waitFor(() => expect(transformOf()).toBe("scale(1.2)"));
    // 关闭（含 Esc 关抽屉的路径）→ 复位；重新打开是干净的 100%。
    view.rerender(drawer(false));
    view.rerender(drawer(true));
    await waitFor(() => expect(frame()).toBeInTheDocument());
    expect(transformOf()).toBe("scale(1)");
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
