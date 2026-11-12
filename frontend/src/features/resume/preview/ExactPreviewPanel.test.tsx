// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览面板：请求节流、竞态取消、缓存、双缓冲换图。
 *
 * 这几条都不是"实现细节"：
 * - 不节流 → 拖一次字号滑块会发出几十个排版请求（每个都是服务端的完整重排 + 光栅化）；
 * - 不取消旧请求 → 慢的那次回来得比新的晚，会把新结果覆盖回旧版式（用户改完发现没变）；
 * - 不双缓冲 → 换 `src` 的那一瞬间整叠纸变白（位图没有渐进渲染）。
 *
 * 2026-11（P3-2）起纸面是**逐页 `<img>`**（服务端渲染的 WebP），不再是 `<iframe>` 里的
 * 浏览器 PDF 查看器：查看器自己的两条滚动条、纸边深色描边与 56px 工具栏因此一并消失，
 * 无头 Chromium 也能截出完整页面。断言随之从 `iframe[src]` 换成 `img[src]`。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import ExactPreviewPanel from "./ExactPreviewPanel";
import { clearPreviewCache, previewCacheStats } from "./exactPreviewCache";
import { previewPageImageUrl, previewPdfUrl } from "./previewPages";

const fetchPages = vi.hoisted(() => vi.fn());

vi.mock("./previewPagesApi", () => ({ fetchResumePreviewPages: fetchPages }));

beforeEach(() => {
  fetchPages.mockReset();
  // 缓存是模块级的：用例之间必须清干净，否则"第一次会请求"这条断言会被上一条用例喂饱。
  clearPreviewCache();
});

afterEach(() => {
  cleanup();
});

/**
 * 等一次请求落地（真实定时器：`findBy*` 自己要用真实定时器轮询，假定时器会把它卡死）。
 *
 * 620ms 的依据：改参数之后的合并窗口是 500ms（`usePreviewPages.ts::DEBOUNCE_MS`，#23 X2
 * 由 150 提到 500），再留 120ms 给请求与渲染。**首次打开**不排队（手上一版都没有时不进
 * 合并窗口），所以这个数对首屏用例只是"多等一点"，不会改变它们的结论。
 *
 * 调 `DEBOUNCE_MS` 时必须回来同步这个数，否则"第二次请求"类用例会静默变成
 * "expected 2 times, got 1"——那种失败看起来像状态机坏了，实际只是等得不够。
 */
function waitForRequest() {
  return new Promise((resolve) => setTimeout(resolve, 620));
}

/**
 * 一版的结果。`width/height` 用 `900 × 1 × 2` 那档的真实量级（1800 × 2546）：
 * 于是"794 CSS 宽 → 1123 高"和旧实现的 A4 常数逐像素重合，高度断言能直接对上。
 */
function meta(pageCount = 1, extra: { pagesNeeded?: number; overflow?: boolean } = {}) {
  return {
    token: `token-${pageCount}`,
    pages: Array.from({ length: pageCount }, (_, index) => ({
      index,
      width: 1800,
      height: 2546,
    })),
    pagesNeeded: extra.pagesNeeded ?? pageCount,
    overflow: extra.overflow ?? false,
  };
}

type PanelProps = Parameters<typeof ExactPreviewPanel>[0];

/** 版式默认值与真实宿主一致（草稿值原样传进来）；各用例只写自己要改的那一项。 */
function panel(overrides: Partial<PanelProps> = {}) {
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

/** 可见层（待换层的图 `aria-hidden` 且没有 alt，用 alt 区分两层）。 */
function visiblePages(): HTMLImageElement[] {
  return Array.from(
    document.querySelectorAll<HTMLImageElement>('.exact-preview-page-image:not([alt=""])'),
  );
}

function pendingPages(): HTMLImageElement[] {
  return Array.from(
    document.querySelectorAll<HTMLImageElement>(".exact-preview-pages-pending img"),
  );
}

describe("ExactPreviewPanel", () => {
  it("放不下时必须醒目提示，且写明「没有缩小字号」（与草稿侧同一口径）", async () => {
    // 服务端按真实参数排：需要 2 页、上限 1 页 → 截断到 1 页并标 overflow。
    fetchPages.mockResolvedValue(meta(1, { pagesNeeded: 2, overflow: true }));

    render(panel());
    await waitForRequest();

    expect(
      await screen.findByText(t("exact.overflow.title", { needed: 2, limit: 1 })),
    ).toBeTruthy();
    // 状态行仍如实说文件里实际排了几页。
    expect(screen.getByText(t("exact.status.pages", { pages: 1, limit: 1 }))).toBeTruthy();
  });

  it("后端是旧版本（不返回真实页数）时要提示「进程可能没重启」，别让用户以为字号没生效", async () => {
    fetchPages.mockResolvedValue({ ...meta(1), pagesNeeded: null });

    render(panel({ fontScale: "large" }));
    await waitForRequest();

    expect(await screen.findByText(t("exact.stale.title"))).toBeTruthy();
    expect(screen.getByText(t("exact.stale.body"))).toBeTruthy();
  });

  it("去抖之后只发一次请求，并把逐页位图挂到 img 上", async () => {
    fetchPages.mockResolvedValue(meta(1));

    render(panel());

    // 去抖窗口内还没发。
    expect(fetchPages).not.toHaveBeenCalled();
    await waitForRequest();

    expect(fetchPages).toHaveBeenCalledTimes(1);
    const [id, options] = fetchPages.mock.calls[0];
    expect(id).toBe(7);
    // 草稿值必须原样带上：少传任何一个，预览就会和导出排得不一样。
    expect(options.page_limit).toBe(1);
    expect(options.font_scale).toBe("standard");
    expect(options.format_config).toEqual({ page_padding: 14 });
    // 分辨率口径：jsdom 量不到宽度 → 按 A4 宽请求（后端再分桶）。dpr 取实际值。
    expect(options.width).toBe(794);
    expect(options.dpr).toBeGreaterThan(0);

    const images = await waitFor(() => {
      const found = visiblePages();
      expect(found).toHaveLength(1);
      return found;
    });
    expect(images[0].getAttribute("src")).toBe(previewPageImageUrl(7, "token-1", 0));
    // 读屏按"第 N 页"念，页序与导出产物一致。
    expect(images[0].getAttribute("alt")).toBe(t("preview.exact.pageAlt", { page: 1 }));
    expect(screen.getByText(t("exact.status.pages", { pages: 1, limit: 1 }))).toBeTruthy();
  });

  it("版式变化时旧图仍然可见，新图全部解码完才顶上来", async () => {
    fetchPages.mockResolvedValueOnce(meta(1));

    const { rerender } = render(panel());
    await waitForRequest();
    expect(visiblePages()[0].getAttribute("src")).toBe(previewPageImageUrl(7, "token-1", 0));

    fetchPages.mockResolvedValueOnce({ ...meta(1), token: "token-b" });
    rerender(panel({ formatConfig: { page_padding: 18 } }));
    await waitForRequest();

    expect(fetchPages).toHaveBeenCalledTimes(2);
    // 新图先挂在透明的待换层上：**旧图仍然可见**，用户不会看到一块白。
    expect(visiblePages()[0].getAttribute("src")).toBe(previewPageImageUrl(7, "token-1", 0));
    const pending = pendingPages();
    expect(pending).toHaveLength(1);
    expect(pending[0].getAttribute("src")).toBe(previewPageImageUrl(7, "token-b", 0));
    // 遮罩与状态行都会说"正在重排"，这里只钉遮罩本身。
    expect(document.querySelector(".exact-preview-overlay")).not.toBeNull();

    // 新图解码完才顶上来。
    fireEvent.load(pending[0]);
    await waitFor(() =>
      expect(visiblePages()[0].getAttribute("src")).toBe(previewPageImageUrl(7, "token-b", 0)),
    );
    expect(pendingPages()).toHaveLength(0);
  });

  it("正文变了（contentSignature 变）要重排：精确预览不能停在旧内容", async () => {
    fetchPages.mockResolvedValue(meta(1));

    const { rerender } = render(panel());
    await waitForRequest();
    expect(fetchPages).toHaveBeenCalledTimes(1);

    rerender(panel({ contentSignature: "c2" }));
    await waitForRequest();
    expect(fetchPages).toHaveBeenCalledTimes(2);
  });

  it("换模板 / 换版式模板也要重排（都是草稿值，没保存也算）", async () => {
    fetchPages.mockResolvedValue(meta(1));

    const { rerender } = render(panel({ formatConfig: {} }));
    await waitForRequest();
    expect(fetchPages).toHaveBeenCalledTimes(1);

    rerender(panel({ formatConfig: {}, template: "modern" }));
    await waitForRequest();
    expect(fetchPages).toHaveBeenCalledTimes(2);
    expect(fetchPages.mock.calls[1][1].template).toBe("modern");

    rerender(panel({ formatConfig: {}, template: "modern", formatName: "compact" }));
    await waitForRequest();
    expect(fetchPages).toHaveBeenCalledTimes(3);
    expect(fetchPages.mock.calls[2][1].format_name).toBe("compact");
  });

  it("只改页面高度不会重新请求", async () => {
    fetchPages.mockResolvedValue(meta(1));

    const { rerender } = render(panel());
    await waitForRequest();

    rerender(panel({ height: 800 }));
    await waitForRequest();

    expect(fetchPages).toHaveBeenCalledTimes(1);
  });

  it("切语言要重排：纸面文案变了，缓存键必须跟着变", async () => {
    fetchPages.mockResolvedValue(meta(1));

    const { rerender } = render(panel({ language: "zh-CN" }));
    await waitForRequest();
    expect(fetchPages).toHaveBeenCalledTimes(1);

    // 只改语言也要真的重排一次，并把这个值送到服务端——否则"选了英文、图一个像素没变"。
    rerender(panel({ language: "en-US" }));
    await waitForRequest();
    expect(fetchPages).toHaveBeenCalledTimes(2);
    expect(fetchPages.mock.calls[1][1].language).toBe("en-US");

    // 切回中文：那一版已经排过了（缓存按语言分开存），直接复用，不再请求。
    rerender(panel({ language: "zh-CN" }));
    await waitForRequest();
    expect(fetchPages).toHaveBeenCalledTimes(2);
  });

  it("请求失败时给出可操作的错误态，而不是空白", async () => {
    fetchPages.mockRejectedValue(new Error("未找到可用的中文字体"));

    render(panel({ formatConfig: {} }));
    await waitForRequest();

    expect(await screen.findByText(t("preview.exact.errorTitle"))).toBeTruthy();
    expect(screen.getByText("未找到可用的中文字体")).toBeTruthy();
    // 关键：告诉用户"草稿预览还能用"，否则他会以为整个预览坏了。
    expect(screen.getByText(t("preview.exact.errorHint"))).toBeTruthy();
    expect(visiblePages()).toHaveLength(0);
  });

  it("隐藏（草稿模式）时不排：参数变化只记在 key 上，切回可见才排一次", async () => {
    fetchPages.mockResolvedValue(meta(1));

    const { rerender } = render(panel({ active: false }));
    await waitForRequest();
    expect(fetchPages).not.toHaveBeenCalled();

    rerender(panel({ active: false, formatConfig: { page_padding: 20 } }));
    await waitForRequest();
    expect(fetchPages).not.toHaveBeenCalled();

    // 切回精确：这时才排，并且带的是**最新**那组参数。
    rerender(panel({ active: true, formatConfig: { page_padding: 20 } }));
    await waitForRequest();
    expect(fetchPages).toHaveBeenCalledTimes(1);
    expect(fetchPages.mock.calls[0][1].format_config).toEqual({ page_padding: 20 });
  });

  it("切到草稿再切回精确、参数没变：一次请求都不发（用户报的就是这条）", async () => {
    fetchPages.mockResolvedValue(meta(1));

    const { rerender } = render(panel());
    await waitForRequest();
    expect(fetchPages).toHaveBeenCalledTimes(1);

    rerender(panel({ active: false }));
    await waitForRequest();
    rerender(panel({ active: true }));
    await waitForRequest();

    expect(fetchPages).toHaveBeenCalledTimes(1);
    // 图还在（切换没有把它弄丢），用户看到的仍是同一版。
    expect(visiblePages()[0].getAttribute("src")).toBe(previewPageImageUrl(7, "token-1", 0));
  });

  it("同一组参数重新挂载（关掉再开「简历制作台」）直接用缓存，不再请求", async () => {
    fetchPages.mockResolvedValue(meta(1));

    const first = render(panel());
    await waitForRequest();
    expect(fetchPages).toHaveBeenCalledTimes(1);
    expect(previewCacheStats().entries).toBe(1);

    first.unmount();

    // 另一个面板实例（大图弹窗就是这种形态）：同样的参数 → 命中缓存，零请求。
    render(panel());
    await waitFor(() => expect(visiblePages()).toHaveLength(1));
    expect(fetchPages).toHaveBeenCalledTimes(1);
  });

  it("请求在飞时切走、再切回已有的一版：不能永久停在「正在排版」（2026-11-06 回归）", async () => {
    fetchPages.mockResolvedValue(meta(1));
    const { rerender } = render(panel());
    await waitForRequest();
    expect(fetchPages).toHaveBeenCalledTimes(1);

    // 切到另一组版式：这次的响应手动控制，先让它挂在"已拿到、图还在载"（pending）。
    let resolveB: (value: ReturnType<typeof meta>) => void = () => undefined;
    fetchPages.mockReturnValue(new Promise((resolve) => (resolveB = resolve)));
    rerender(panel({ formatConfig: { page_padding: 18 } }));
    await waitForRequest();
    resolveB({ ...meta(1), token: "token-b" });
    await waitFor(() => expect(pendingPages()).toHaveLength(1));

    // 立刻切回原来那一版：命中已可见的 key，一次请求都不发——但"重排中"必须收回来，
    // 且那份**另一个版本**的 pending 必须作废（否则它解码完仍会把旧版式顶上来）。
    rerender(panel());
    await waitFor(() => expect(document.querySelector(".exact-preview-overlay")).toBeNull());
    expect(pendingPages()).toHaveLength(0);
    expect(fetchPages).toHaveBeenCalledTimes(2);
  });

  it.each([
    { pages: 1, pageLimit: 3 },
    { pages: 3, pageLimit: 3 },
  ])(
    "按产物实际页数画纸、不为凑上限补空白页（$pages 页 / 上限 $pageLimit 页）",
    async ({ pages, pageLimit }) => {
      fetchPages.mockResolvedValue(meta(pages));

      render(panel({ pageLimit }));
      const stack = await waitFor(() => {
        const node = document.querySelector<HTMLElement>(".exact-preview-stack");
        expect(node).not.toBeNull();
        return node as HTMLElement;
      });

      expect(visiblePages()).toHaveLength(pages);
      expect(stack.dataset.pages).toBe(String(pages));
      // jsdom 量不到宽度 → 纸宽退回 A4（794），单页高 1123，页间距 8。
      // 旧实现还要额外加 56px 的查看器工具栏，现在那 56px 没有了（这正是 P3-2 的一半）。
      expect(stack.dataset.frameHeight).toBe(String(1123 * pages + 8 * (pages - 1)));
      expect(document.querySelectorAll(".exact-preview-blank")).toHaveLength(0);
    },
  );

  it("「在新标签打开」指向服务端那份同字节 PDF（图片化后没有 blob 可开了）", async () => {
    fetchPages.mockResolvedValue(meta(2));
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    render(panel({ pageLimit: 3 }));
    await waitForRequest();

    fireEvent.click(screen.getByText(t("exact.openNewTab")));
    expect(open).toHaveBeenCalledWith(previewPdfUrl(7, "token-2"), "_blank", "noopener,noreferrer");
    open.mockRestore();
  });
});
