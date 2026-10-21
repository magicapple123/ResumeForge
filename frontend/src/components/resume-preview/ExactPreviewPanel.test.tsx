// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览面板：请求节流、竞态取消、objectURL 生命周期。
 *
 * 这三条都不是"实现细节"：
 * - 不节流 → 拖一次字号滑块会发出几十个 PDF 请求；
 * - 不取消旧请求 → 慢的那次回来得比新的晚，会把新结果覆盖回旧版式（用户改完发现没变）；
 * - 不释放 objectURL → 每请求一份整 PDF 的内存，翻几次页就泄漏几十 MB。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExactPreviewPanel from "./ExactPreviewPanel";
import { clearPreviewCache, previewCacheStats } from "./exactPreviewCache";

const fetchPreview = vi.hoisted(() => vi.fn());

vi.mock("../../api/resumes", () => ({
  fetchResumePreviewPdf: fetchPreview,
}));

const created: string[] = [];
const revoked: string[] = [];
let counter = 0;

beforeEach(() => {
  created.length = 0;
  revoked.length = 0;
  counter = 0;
  fetchPreview.mockReset();
  // 缓存是模块级的：用例之间必须清干净，否则"第一次会请求"这条断言会被上一条用例喂饱。
  clearPreviewCache();
  // jsdom 没有 objectURL：这里用可观测的桩，才能断言"每个 URL 都被释放"。
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => {
      counter += 1;
      const url = `blob:preview-${counter}`;
      created.push(url);
      return url;
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: (url: string) => {
      revoked.push(url);
    },
  });
});

afterEach(() => {
  cleanup();
});

/** 等过去抖窗口（真实定时器：`findBy*` 自己要用真实定时器轮询，假定时器会把它卡死）。 */
function waitForRequest() {
  return new Promise((resolve) => setTimeout(resolve, 420));
}

function pdf(pages = 1, extra: { pagesNeeded?: number; overflow?: boolean } = {}) {
  return {
    blob: new Blob(["%PDF-1.3"], { type: "application/pdf" }),
    pages,
    pagesNeeded: extra.pagesNeeded ?? pages,
    pageLimit: pages,
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

describe("ExactPreviewPanel", () => {
  it("放不下时必须醒目提示，且写明「没有缩小字号」（与草稿侧同一口径）", async () => {
    // 服务端按真实参数排：需要 2 页、上限 1 页 → 截断到 1 页并标 overflow。
    fetchPreview.mockResolvedValue(pdf(1, { pagesNeeded: 2, overflow: true }));

    render(
      <ExactPreviewPanel
        resumeId={7}
        template="classic"
        formatName=""
        pageLimit={1}
        fontScale="standard"
        formatConfig={{ page_padding: 14 }}
        contentSignature="c1"
        height={600}
      />,
    );
    await waitForRequest();

    expect(await screen.findByText(/按当前设置约需 2 页（上限 1 页）/)).toBeTruthy();
    // 关键：用户要知道"字号没有被偷偷缩小"，否则他会以为导出就是这个字号。
    expect(screen.getByText(/不会自动缩小/)).toBeTruthy();
    // 状态行仍如实说文件里实际排了几页。
    expect(screen.getByText(/实际 1 页/)).toBeTruthy();
  });

  it("后端是旧版本（不返回真实页数）时要说明「进程可能没重启」，别让用户以为字号没生效", async () => {
    // 旧后端没有 `X-Resume-Pages-Needed`，而它恰恰会自动缩小字号——用户看到"滑杆 18px、
    // PDF 却更小"时，界面上必须有一条能指向真实原因的提示（2026-10-21 实测踩到）。
    fetchPreview.mockResolvedValue({ ...pdf(1), pagesNeeded: null });

    render(
      <ExactPreviewPanel
        resumeId={7}
        template="classic"
        formatName=""
        pageLimit={1}
        fontScale="large"
        formatConfig={{ page_padding: 14 }}
        contentSignature="c1"
        height={600}
      />,
    );
    await waitForRequest();

    expect(await screen.findByText(/这版 PDF 可能不是按你设定的字号排的/)).toBeTruthy();
    expect(screen.getByText(/完全退出应用后重新启动/)).toBeTruthy();
  });

  it("去抖之后只发一次请求，并把 PDF 挂到 iframe 上", async () => {
    fetchPreview.mockResolvedValue(pdf(1));

    render(
      <ExactPreviewPanel
        resumeId={7}
        template="classic"
        formatName=""
        pageLimit={1}
        fontScale="standard"
        formatConfig={{ page_padding: 14 }}
        contentSignature="c1"
        height={600}
      />,
    );

    // 去抖窗口内还没发。
    expect(fetchPreview).not.toHaveBeenCalled();
    await waitForRequest();

    expect(fetchPreview).toHaveBeenCalledTimes(1);
    const [id, options] = fetchPreview.mock.calls[0];
    expect(id).toBe(7);
    // 草稿值必须原样带上：少传任何一个，预览就会和导出排得不一样。
    expect(options.page_limit).toBe(1);
    expect(options.font_scale).toBe("standard");
    expect(options.format_config).toEqual({ page_padding: 14 });

    const frame = await screen.findByTitle("简历精确预览（导出 PDF）");
    expect(frame.getAttribute("src")).toBe("blob:preview-1");
    expect(screen.getByText(/实际 1 页/)).toBeTruthy();
  });

  it("版式变化时释放旧 URL，再请求新的", async () => {
    fetchPreview.mockResolvedValue(pdf(1));

    const { rerender } = render(
      <ExactPreviewPanel
        resumeId={7}
        template="classic"
        formatName=""
        pageLimit={1}
        fontScale="standard"
        formatConfig={{ page_padding: 14 }}
        contentSignature="c1"
        height={600}
      />,
    );
    await waitForRequest();
    expect(created).toEqual(["blob:preview-1"]);

    rerender(
      <ExactPreviewPanel
        resumeId={7}
        template="classic"
        formatName=""
        pageLimit={1}
        fontScale="standard"
        formatConfig={{ page_padding: 18 }}
        contentSignature="c1"
        height={600}
      />,
    );
    await waitForRequest();

    expect(fetchPreview).toHaveBeenCalledTimes(2);
    // 新图先挂在透明的预加载层上：**旧图仍然可见**，用户不会看到一块白。
    expect(screen.getByTitle("简历精确预览（导出 PDF）")).toHaveAttribute("src", "blob:preview-1");
    const pending = screen.getByTitle("正在加载的精确预览");
    expect(pending).toHaveAttribute("src", "blob:preview-2");
    // 遮罩与状态行都会说"正在重排"，这里只钉遮罩本身（它是"旧图仍在、但看得出在算"的载体）。
    expect(document.querySelector(".exact-preview-overlay")).not.toBeNull();

    // 新图 load 之后才顶上来，旧的那份随之释放（否则每改一次版式就多留一份整 PDF 在内存里）。
    fireEvent.load(pending);
    await waitFor(() =>
      expect(screen.getByTitle("简历精确预览（导出 PDF）")).toHaveAttribute(
        "src",
        "blob:preview-2",
      ),
    );
    expect(revoked).toContain("blob:preview-1");
    expect(created).toEqual(["blob:preview-1", "blob:preview-2"]);
  });

  it("正文变了（contentSignature 变）要重排：精确预览不能停在旧内容", async () => {
    fetchPreview.mockResolvedValue(pdf(1));

    const { rerender } = render(
      <ExactPreviewPanel
        resumeId={7}
        template="classic"
        formatName=""
        pageLimit={1}
        fontScale="standard"
        formatConfig={{ page_padding: 14 }}
        contentSignature="c1"
        height={600}
      />,
    );
    await waitForRequest();
    expect(fetchPreview).toHaveBeenCalledTimes(1);

    // 用户改了一段经历：正文签名变，PDF 必须按新内容重排一次。
    rerender(
      <ExactPreviewPanel
        resumeId={7}
        template="classic"
        formatName=""
        pageLimit={1}
        fontScale="standard"
        formatConfig={{ page_padding: 14 }}
        contentSignature="c2"
        height={600}
      />,
    );
    await waitForRequest();
    expect(fetchPreview).toHaveBeenCalledTimes(2);
  });

  it("换模板 / 换版式模板也要重排（都是草稿值，没保存也算）", async () => {
    fetchPreview.mockResolvedValue(pdf(1));

    const { rerender } = render(
      <ExactPreviewPanel
        resumeId={7}
        template="classic"
        formatName=""
        pageLimit={1}
        fontScale="standard"
        formatConfig={{}}
        contentSignature="c1"
        height={600}
      />,
    );
    await waitForRequest();
    expect(fetchPreview).toHaveBeenCalledTimes(1);

    // 换样式模板：请求体要带上新模板，并且真的重排一次。
    rerender(
      <ExactPreviewPanel
        resumeId={7}
        template="modern"
        formatName=""
        pageLimit={1}
        fontScale="standard"
        formatConfig={{}}
        contentSignature="c1"
        height={600}
      />,
    );
    await waitForRequest();
    expect(fetchPreview).toHaveBeenCalledTimes(2);
    expect(fetchPreview.mock.calls[1][1].template).toBe("modern");

    // 换版式模板（预设那一层）：同样要重排。
    rerender(
      <ExactPreviewPanel
        resumeId={7}
        template="modern"
        formatName="compact"
        pageLimit={1}
        fontScale="standard"
        formatConfig={{}}
        contentSignature="c1"
        height={600}
      />,
    );
    await waitForRequest();
    expect(fetchPreview).toHaveBeenCalledTimes(3);
    expect(fetchPreview.mock.calls[2][1].format_name).toBe("compact");
  });

  it("只改页面高度不会重新排 PDF", async () => {
    fetchPreview.mockResolvedValue(pdf(1));

    const { rerender } = render(
      <ExactPreviewPanel
        resumeId={7}
        template="classic"
        formatName=""
        pageLimit={1}
        fontScale="standard"
        formatConfig={{ page_padding: 14 }}
        contentSignature="c1"
        height={600}
      />,
    );
    await waitForRequest();

    rerender(
      <ExactPreviewPanel
        resumeId={7}
        template="classic"
        formatName=""
        pageLimit={1}
        fontScale="standard"
        formatConfig={{ page_padding: 14 }}
        contentSignature="c1"
        height={800}
      />,
    );
    await waitForRequest();

    expect(fetchPreview).toHaveBeenCalledTimes(1);
  });

  it("请求失败时给出可操作的错误态，而不是空白", async () => {
    fetchPreview.mockRejectedValue(new Error("未找到可用的中文字体"));

    render(
      <ExactPreviewPanel
        resumeId={7}
        template="classic"
        formatName=""
        pageLimit={1}
        fontScale="standard"
        formatConfig={{}}
        contentSignature="c1"
        height={600}
      />,
    );
    await waitForRequest();

    expect(await screen.findByText("精确预览生成失败")).toBeTruthy();
    expect(screen.getByText("未找到可用的中文字体")).toBeTruthy();
    // 关键：告诉用户"草稿预览还能用"，否则他会以为整个预览坏了。
    expect(screen.getByText(/切换回「草稿」/)).toBeTruthy();
    expect(screen.queryByTitle("简历精确预览（导出 PDF）")).toBeNull();
  });

  it("隐藏（草稿模式）时不排：参数变化只记在 key 上，切回可见才排一次", async () => {
    fetchPreview.mockResolvedValue(pdf(1));

    const { rerender } = render(panel({ active: false }));
    await waitForRequest();
    expect(fetchPreview).not.toHaveBeenCalled();

    // 草稿模式下拖了页边距：仍然不该排——看不见的东西不值得花一次完整的服务端排版。
    rerender(panel({ active: false, formatConfig: { page_padding: 20 } }));
    await waitForRequest();
    expect(fetchPreview).not.toHaveBeenCalled();

    // 切回精确：这时才排，并且带的是**最新**那组参数。
    rerender(panel({ active: true, formatConfig: { page_padding: 20 } }));
    await waitForRequest();
    expect(fetchPreview).toHaveBeenCalledTimes(1);
    expect(fetchPreview.mock.calls[0][1].format_config).toEqual({ page_padding: 20 });
  });

  it("切到草稿再切回精确、参数没变：一次请求都不发（用户报的就是这条）", async () => {
    fetchPreview.mockResolvedValue(pdf(1));

    const { rerender } = render(panel());
    await waitForRequest();
    expect(fetchPreview).toHaveBeenCalledTimes(1);

    rerender(panel({ active: false }));
    await waitForRequest();
    // 切回来：已经有这一版，不该再问服务端要一次。
    rerender(panel({ active: true }));
    await waitForRequest();

    expect(fetchPreview).toHaveBeenCalledTimes(1);
    // 图还在（切换没有把它弄丢），用户看到的仍是同一份 PDF。
    expect(screen.getByTitle("简历精确预览（导出 PDF）")).toHaveAttribute("src", "blob:preview-1");
  });

  it("同一组参数重新挂载（关掉再开「查看大图」）直接用缓存，不再排一次", async () => {
    fetchPreview.mockResolvedValue(pdf(1));

    const first = render(panel());
    await waitForRequest();
    expect(fetchPreview).toHaveBeenCalledTimes(1);
    expect(previewCacheStats().entries).toBe(1);

    first.unmount();

    // 另一个面板实例（大图弹窗就是这种形态）：同样的参数 → 命中缓存，零请求。
    render(panel());
    await waitFor(() => expect(screen.getByTitle("简历精确预览（导出 PDF）")).toBeTruthy());
    expect(fetchPreview).toHaveBeenCalledTimes(1);
    // 缓存只存字节，URL 仍由面板自己创建 / 释放（所以这里是第 2 个 URL）。
    expect(created).toEqual(["blob:preview-1", "blob:preview-2"]);
  });

  it("卸载时释放 objectURL", async () => {
    fetchPreview.mockResolvedValue(pdf(1));

    const { unmount } = render(
      <ExactPreviewPanel
        resumeId={7}
        template="classic"
        formatName=""
        pageLimit={1}
        fontScale="standard"
        formatConfig={{}}
        contentSignature="c1"
        height={600}
      />,
    );
    await waitForRequest();
    expect(created).toEqual(["blob:preview-1"]);

    unmount();
    expect(revoked).toContain("blob:preview-1");
  });
});
