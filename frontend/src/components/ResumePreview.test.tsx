// SPDX-License-Identifier: Apache-2.0
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
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
  it("预览 iframe 不执行排页探针脚本（Q22）：srcdoc 里没有 script", () => {
    render(
      <ResumePreview
        html={"<!doctype html><html><body><p>hi</p><script>void 0;</script></body></html>"}
        warnings={[]}
      />,
    );
    const iframe = getPreviewFrame();
    const srcdoc = iframe.getAttribute("srcdoc") ?? "";
    expect(srcdoc).not.toContain("<script");
    // 正文照常进 iframe —— 去的只是脚本，不是整块 HTML。
    expect(srcdoc).toContain("<p>hi</p>");
  });

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
    // 触底时读数是 `55% · 已到最小可读缩放`，所以取前导数字，不能直接 Number()。
    const percent = () => Number.parseInt(label(), 10);
    const before = percent();
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
    expect(percent()).toBeGreaterThan(before);

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
    // 2026 年样式表拆分后，页间隙规则落在 resume-canvas.css（resume.css 现为 @import 清单）。
    const css: string = readFileSync(
      [process.cwd(), "src", "styles", "resume-canvas.css"].join("/"),
      "utf8",
    );
    const separator = css.match(/\.resume-preview-page-separator-line\s*\{([^}]*)\}/)?.[1] ?? "";
    const shadows = separator.match(/box-shadow:\s*([\s\S]*?);/)?.[1] ?? "";

    expect(shadows).not.toBe("");
    const layers = shadows.split(",").map((layer: string) => layer.trim());
    expect(layers).toHaveLength(4);
    expect(layers.every((layer) => layer.startsWith("inset "))).toBe(true);
  });

  it("草稿模式编辑打开时，指针要还给 iframe（否则纸面点不动、光标一直是抓手）", () => {
    // 2026-10-23 用户实测：「勾选后鼠标放在预览简历上仍然是抓手，无法点击」。
    // 根因在 `.resume-iframe { pointer-events: none }`：平时把指针交给父容器做拖拽平移，
    // 于是点击也落在父容器上，iframe 文档里的 click 监听永远收不到事件。
    // 这两条覆盖一旦被删，JS 侧无论怎么测都不会红——所以只能钉样式表本身。
    const css: string = readFileSync(
      [process.cwd(), "src", "styles", "resume-canvas.css"].join("/"),
      "utf8",
    );
    const ruleOf = (selector: string) => {
      const start = css.indexOf(selector);
      expect(start, `找不到规则：${selector}`).toBeGreaterThanOrEqual(0);
      return css.slice(start, css.indexOf("}", start));
    };

    expect(ruleOf(".resume-preview-viewport.is-click-to-edit .resume-iframe")).toContain(
      "pointer-events: auto",
    );
    expect(ruleOf(".resume-preview-viewport.is-click-to-edit {")).toContain("cursor: default");
  });
});

describe("ResumePreview · 宿主给的真实高度（简历制作台右栏）", () => {
  /**
   * 主预览按 `window.innerHeight × 0.62` 估算可用高度；制作台右栏的高度由三栏布局决定，
   * 与窗口高度没有固定比例。给了 `availableHeight` 就必须**只**用它，否则"打开制作台
   * 看到一页纸缩在中间、四周一片留白"（2026-10 用户截图）。
   */
  it("给了 availableHeight 就按它算 fit，不再用窗口比例", () => {
    // jsdom 的 innerHeight 是 768 → 旧口径会得到 round(768 × 0.62) = 476px。
    render(
      <ResumePreview
        html="<!doctype html><html><body></body></html>"
        warnings={[]}
        availableHeight={500}
      />,
    );

    // 容器高度仍是宿主给的 500；但 500/1123 ≈ 44.5% 已经低于可读下限（0.55），
    // 2026-10-23 起停在 55%（方案附录 D0：宁可滚动，不把纸缩到看不清）。
    // 于是纸比容器高，viewport 跟着纸长到 618 —— 交给外层滚动，不再制造内部横条。
    const viewport = document.querySelector<HTMLElement>(".resume-preview-viewport");
    expect(viewport).not.toBeNull();
    expect(Number.parseFloat(viewport!.style.height)).toBeCloseTo(1123 * 0.55, 0);
    expect(screen.getByText(t("responsive.a4.minScaleLabel", { value: 55 }))).toBeInTheDocument();
  });

  /**
   * 2026-10-29 用户截图：右栏写着「整页」、读数 88%，纸却被切掉一截、还得滚。成因是旧的
   * "根节点减草稿宿主"推算法：纸比容器高时宿主的盒子反而**更大**，差值被夹成 0，预算退回
   * 整栏高度、纸更高，永远收敛不了。现在直接量纸面那一层（`.resume-preview-body`）——
   * 它的高度是 flex 算出来的，与纸多高无关。
   *
   * jsdom 的 `clientHeight` 恒为 0，所以这里把它打桩成"纸面层 700、其它 0"，并故意给一个
   * 更大的总预算 960：fit 必须按 700 算（62.3%），按 960 会是 85.5%。
   */
  it("纸面那一层量得到高度时，fit 只按它算（头部吃掉的高度不再算漏）", () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains("resume-preview-body") ? 700 : 0;
      },
    });
    try {
      render(
        <ResumePreview
          html="<!doctype html><html><body></body></html>"
          warnings={[]}
          availableHeight={960}
        />,
      );
      const viewport = document.querySelector<HTMLElement>(".resume-preview-viewport");
      expect(viewport).not.toBeNull();
      // 一页恰好装进 700（1123 × 700/1123）；按总预算 960 会算出 960 并多出一条滚动条。
      expect(Number.parseFloat(viewport!.style.height)).toBeCloseTo(700, 0);
    } finally {
      // jsdom 把 `clientHeight` 定义在 `Element.prototype` 上，所以 `original` 通常是
      // `undefined`——这时必须**删掉**本用例加在 `HTMLElement.prototype` 上的假值，
      // 否则它会漏给后面的用例（曾经漏出去一次，「适应页面」那条就从 55% 变成 62%）。
      if (original) Object.defineProperty(HTMLElement.prototype, "clientHeight", original);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
    }
  });

  it("不传 availableHeight 时仍用窗口比例口径，且同样受可读下限约束", () => {
    render(<ResumePreview html="<!doctype html><html><body></body></html>" warnings={[]} />);

    // 预算仍是 round(768 × 0.62) = 476（这一半没变）；但 476/1123 = 42% 低于下限，
    // 纸按 55% 渲染 → 618 高，viewport 随之变高，由页面滚动看全。
    const viewport = document.querySelector<HTMLElement>(".resume-preview-viewport");
    expect(Number.parseFloat(viewport!.style.height)).toBeCloseTo(1123 * 0.55, 0);
  });

  it("「适应页面」把缩放重置回一页完整", () => {
    render(
      <ResumePreview
        html="<!doctype html><html><body></body></html>"
        warnings={[]}
        availableHeight={500}
      />,
    );

    // 读数就是"一页完整可见"的那个比例——而 500/1123 低于下限，所以是触底胶囊 55%。
    const zoomLabel = () =>
      document.querySelector<HTMLElement>(".resume-preview-zoom-label")?.textContent;
    const atFloor = t("responsive.a4.minScaleLabel", { value: 55 });
    expect(zoomLabel()).toBe(atFloor);

    fireEvent.click(screen.getByRole("button", { name: /放大预览/ }));
    // 放大之后不再停在下限上：读数回到普通百分比，胶囊消失。
    expect(zoomLabel()).not.toBe(atFloor);
    expect(document.querySelector(".resume-preview-zoom-label.is-min-scale")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /适应页面/ }));
    expect(zoomLabel()).toBe(atFloor);
  });
});
