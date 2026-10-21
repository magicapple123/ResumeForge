// SPDX-License-Identifier: Apache-2.0
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ResumePreview from "./ResumePreview";
import { clearPreviewCache } from "./resume-preview/exactPreviewCache";

declare const process: { cwd(): string };

// jsdom 不做真实排版，要让"内容溢出"能被确定地触发，只能把测量函数打桩成指定结果。
// 用一个可变量控制返回值：默认为 null（等同于"没量到"），各用例按需改成"装得下/装不下"。
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

// 精确预览会去服务端要 PDF；这里只关心"切过去以后草稿那套东西有没有退场"，
// 让请求永远悬着（等于"还在排版"），就不必在 jsdom 里伪造 objectURL。
const fetchPreviewPdf = vi.hoisted(() => vi.fn(() => new Promise(() => {})));
vi.mock("../api/resumes", () => ({ fetchResumePreviewPdf: fetchPreviewPdf }));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  measureState.value = null;
  fetchPreviewPdf.mockReset();
  // 默认回到"永远悬着"（= 还在排版）：多数用例只想看草稿那套东西有没有退场。
  fetchPreviewPdf.mockImplementation(() => new Promise(() => {}));
  clearPreviewCache();
});

function getPreviewFrame(): HTMLIFrameElement {
  return screen.getByTitle("简历预览") as HTMLIFrameElement;
}

describe("ResumePreview", () => {
  it("预览只读：不给纸面字段注入任何点击 / 键盘语义", () => {
    render(<ResumePreview html="<!doctype html><html><body></body></html>" warnings={[]} />);
    const iframe = getPreviewFrame();
    if (!iframe.contentDocument) throw new Error("测试环境未创建 iframe document");
    // 模板自己写了 role/tabindex：预览不该改动它们（编辑模式会给每栏挂 role=button）。
    iframe.contentDocument.body.innerHTML =
      '<span role="note" tabindex="-1" data-resume-path="name">姓名</span>';
    fireEvent.load(iframe);

    const target = iframe.contentDocument.querySelector("[data-resume-path]");
    if (!target) throw new Error("字段未渲染");
    expect(target).toHaveAttribute("role", "note");
    expect(target).toHaveAttribute("tabindex", "-1");
    // 那套「可点字段」的交互样式表也随编辑模式一起退场。
    expect(iframe.contentDocument.getElementById("resume-preview-interaction-style")).toBeNull();
  });

  it("工具栏只剩「看」的入口：没有抓手 / 编辑切换，也没有「让 AI 改这一栏」", () => {
    render(<ResumePreview html="<!doctype html><html><body></body></html>" warnings={[]} />);
    fireEvent.load(getPreviewFrame());

    // 修改入口统一在「选中文字 → 右键 → AI 润色」与「手动调整」；预览里再放一套
    // 命中区等于同一件事两个入口，且与按住拖动平移互斥（见 useFrameInteractions）。
    expect(screen.queryByText("编辑")).toBeNull();
    expect(screen.queryByText("抓手")).toBeNull();
    expect(screen.queryByRole("button", { name: "让 AI 改这一栏" })).toBeNull();
    expect(screen.queryByText("简历预览交互模式")).toBeNull();
  });
});

describe("ResumePreview 两行工具栏与缩放下移（P2b）", () => {
  it("按住 Ctrl 在纸面上滚滚轮可以缩放：**每一页的 iframe 都要绑上**", () => {
    // 2026-10-21 把交互改成"每个 iframe 各自绑 wheel"（多页竖排后画布上有 N 个 iframe，
    // 而 iframe 是独立文档、事件不冒泡到父文档）。这条用例钉住两件事：
    // ① Ctrl+wheel 真的改缩放；② **第 2 页也灵**——只绑第 1 页时用户在多页视图里
    // 滚第二页会以为"整个缩放功能坏了"。
    const { container } = render(
      <ResumePreview html="<!doctype html><html><body></body></html>" warnings={[]} pages={2} />,
    );
    const frames = screen.getAllByTitle(/^简历预览/) as HTMLIFrameElement[];
    expect(frames).toHaveLength(2);
    fireEvent.load(frames[0]);
    fireEvent.load(frames[1]);

    // 基准不是 100%：jsdom 没有真实布局，fitScale 由"窗口高度预算"算出来是个小数。
    // 这里只关心"滚了之后变大"，不关心起点落在哪。
    const label = () => container.querySelector(".resume-preview-zoom-label")?.textContent ?? "";
    const before = Number(label().replace("%", ""));
    expect(before).toBeGreaterThan(0);

    const wheel = new WheelEvent("wheel", {
      ctrlKey: true,
      deltaY: -120,
      bubbles: true,
      cancelable: true,
    });
    // 监听器是原生 `addEventListener`（不是 React 的合成事件），setState 得靠 `act` 收尾。
    act(() => {
      frames[1].contentDocument!.dispatchEvent(wheel);
    });

    // 阻止浏览器的默认"整页缩放"是这条功能的另一半——没拦住的后果是简历没变、
    // 整个应用连同弹窗一起被放大。
    expect(wheel.defaultPrevented).toBe(true);
    expect(Number(label().replace("%", ""))).toBeGreaterThan(before);

    // 不带 Ctrl 的滚轮不缩放（交给外层滚动）。
    const zoomed = label();
    const plain = new WheelEvent("wheel", { deltaY: -120, bubbles: true, cancelable: true });
    act(() => {
      frames[1].contentDocument!.dispatchEvent(plain);
    });
    expect(label()).toBe(zoomed);
  });

  it("缩放条在纸面**之后**，三个按钮的可访问名不变", () => {
    const { container } = render(
      <ResumePreview html="<!doctype html><html><body></body></html>" warnings={[]} />,
    );

    const zoomRow = container.querySelector(".resume-preview-zoom-row");
    // 画布没有统一根 class（warnings / overflow / viewport 是兄弟），取视口这一层：
    // 缩放条必须排在它之后——"看图 → 想放大 → 手就在图旁边"。
    const canvas = container.querySelector(".resume-preview-viewport");
    expect(zoomRow).not.toBeNull();
    expect(canvas).not.toBeNull();
    expect(
      canvas!.compareDocumentPosition(zoomRow!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    for (const name of ["缩小预览", "放大预览", "适应页面"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    // 工具栏里不再有缩放百分比：控件整体搬走，不留第二份。
    expect(
      container.querySelector(".resume-preview-toolbar .resume-preview-zoom-label"),
    ).toBeNull();
  });

  it("两个插槽各归各行：结构类在第一行，度量类在第二行", () => {
    const { container } = render(
      <ResumePreview
        html="<!doctype html><html><body></body></html>"
        warnings={[]}
        templateControls={<span data-testid="template-controls">结构类</span>}
        measureControls={<span data-testid="measure-controls">度量类</span>}
      />,
    );

    const template = screen.getByTestId("template-controls");
    const measure = screen.getByTestId("measure-controls");

    const primaryRow = template.closest(".resume-preview-toolbar-row-primary");
    const measureRow = measure.closest(".resume-preview-toolbar-row-measure");
    expect(primaryRow).not.toBeNull();
    expect(measureRow).not.toBeNull();
    expect(primaryRow).not.toBe(measureRow);
    // 两行的理由（P2 风险表最后一条）：结构类与度量类性质不同，挤一行会互相抢位置。
    // 曾经还有一枚「正指向」chip 住在第二行；它随编辑模式一起退场（2026-10-21）。
    expect(container.querySelector(".resume-preview-hover-chip")).toBeNull();
  });
});

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
});

describe("ResumePreview 溢出时的多页视图", () => {
  it("内容装得下时不切页、不显示近似分页标注，行为与之前一致", () => {
    render(
      <ResumePreview html="<!doctype html><html><body></body></html>" warnings={[]} pages={1} />,
    );
    const iframe = getPreviewFrame();
    fireEvent.load(iframe);

    expect(screen.queryByText(/近似分页/)).toBeNull();
    expect(screen.queryByText(/约需/)).toBeNull();
    expect(screen.queryByText(/第 2 页/)).toBeNull();
    // 单页时 iframe 仍是一张 A4 的高度，不会被改成"连续流总高"。
    expect(iframe.getAttribute("height")).toBe("1123");
  });

  it("超出时显示真实页数与超出量，而不是静默", () => {
    measureState.value = { usedHeight: 1300, pageContentHeight: 1000, pageLimit: 1 };
    render(
      <ResumePreview html="<!doctype html><html><body></body></html>" warnings={[]} pages={1} />,
    );
    fireEvent.load(getPreviewFrame());

    expect(screen.getByText(/约需 2 页/)).toBeTruthy();
    expect(screen.getByText(/上限 1 页/)).toBeTruthy();
    expect(screen.getByText(/正文还多出约 30%/)).toBeTruthy();
    // 2026-10-21：不再缩字号，提示必须说明这一点——否则用户会以为纸面上的字
    // 是被缩过之后的"最小字号"。
    expect(screen.getByText(/不会自动缩小/)).toBeTruthy();
    expect(screen.queryByText(/字号已降到最小/)).toBeNull();
  });

  it("只有一张 A4：内容溢出且上限 1 页时不再分出「第 2 页」", () => {
    measureState.value = { usedHeight: 1300, pageContentHeight: 1000, pageLimit: 1 };
    const { container } = render(
      <ResumePreview html="<!doctype html><html><body></body></html>" warnings={[]} pages={1} />,
    );
    const iframe = getPreviewFrame();
    fireEvent.load(iframe);

    // 溢出只影响提示文案：纸面仍是一张 A4（iframe 高度 = 1123），也**没有**第 2 页。
    expect(iframe.getAttribute("height")).toBe("1123");
    expect(container.querySelector(".resume-preview-page-separator")).toBeNull();
    // 1 页不分列 → 不该留下多列标记（模板脚本仍要能正常按宽度自适应）。
    expect(iframe.contentDocument?.body.dataset.previewColumns).toBeUndefined();
    expect(screen.queryByText(/第 2 页/)).toBeNull();
    // 用户要能知道"超出的部分去哪了"。
    expect(screen.getByText(/超出上限的部分不会显示/)).toBeTruthy();
  });

  it("多页展示不改动 page_limit：上报的 pages 仍是用户设的上限", () => {
    measureState.value = { usedHeight: 1300, pageContentHeight: 1000, pageLimit: 1 };
    const onLayoutStatus = vi.fn();
    render(
      <ResumePreview
        html="<!doctype html><html><body></body></html>"
        warnings={[]}
        pages={1}
        onLayoutStatus={onLayoutStatus}
      />,
    );
    fireEvent.load(getPreviewFrame());

    const lastCall = onLayoutStatus.mock.calls.slice(-1)[0]?.[0];
    expect(lastCall?.pages).toBe(1); // 溢出只上调提示，上报的页数仍是用户设的上限
    expect(lastCall?.overflow).toBe(true);
  });

  it("选 2 页时竖向堆叠：每页一张 A4，页标在页脚下方", () => {
    const { container } = render(
      <ResumePreview html="<!doctype html><html><body></body></html>" warnings={[]} pages={2} />,
    );
    const frames = screen.getAllByTitle(/^简历预览/) as HTMLIFrameElement[];
    expect(frames).toHaveLength(2);
    // 每张纸都是 A4；不再是一个"两页宽"的大 iframe（2026-10-21 从横排改竖排）。
    expect(frames[0].getAttribute("width")).toBe("794");
    expect(frames[0].getAttribute("height")).toBe("1123");

    fireEvent.load(frames[0]);
    // 分页本身仍是 CSS 多列：第 1 页显示第 1 列，第 2 页滚到第 2 列。
    const injected = frames[0].contentDocument?.getElementById("resume-preview-style")?.textContent;
    expect(injected).toContain("column-count:2");
    expect(injected).toContain("column-fill");
    expect(injected).toContain("column-width:688.00px");
    expect(injected).toContain("column-gap:106.00px");
    // 多列标记仍在：模板的自适应脚本据此退出（否则会把 1588 当成"宽度超一倍"）。
    expect(frames[0].contentDocument?.body.dataset.previewColumns).toBe("1");

    // 竖排后不再有横向的"页间隙条"：页与页之间是真实空白 + 每页自己的边框。
    expect(container.querySelector(".resume-preview-page-separator")).toBeNull();
    expect(container.querySelectorAll(".resume-preview-page")).toHaveLength(2);
    expect(screen.getByText(/第 1 页 \/ 共 2 页（近似）/)).toBeTruthy();
    expect(screen.getByText(/第 2 页 \/ 共 2 页（近似）/)).toBeTruthy();
  });

  it("分页阴影收在页间隙内，不覆盖紧贴页边的简历内容", () => {
    const css: string = readFileSync(
      [process.cwd(), "src", "styles", "resume.css"].join("/"),
      "utf8",
    );
    const separator = css.match(/\.resume-preview-page-separator-line\s*\{([^}]*)\}/)?.[1] ?? "";
    const shadows = separator.match(/box-shadow:\s*([\s\S]*?);/)?.[1] ?? "";

    expect(shadows).not.toBe("");
    const layers = shadows.split(",").map((layer: string) => layer.trim());
    expect(layers).toHaveLength(4);
    expect(layers.every((layer) => layer.startsWith("inset "))).toBe(true);
  });
});
