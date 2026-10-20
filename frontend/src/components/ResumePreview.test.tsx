// SPDX-License-Identifier: Apache-2.0
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ResumePreview from "./ResumePreview";

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

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  measureState.value = null;
});

function getPreviewFrame(): HTMLIFrameElement {
  return screen.getByTitle("简历预览") as HTMLIFrameElement;
}

describe("ResumePreview", () => {
  it("returns the structured field path when a preview value is clicked in edit mode", () => {
    const onEditTarget = vi.fn();
    render(
      <ResumePreview
        html="<!doctype html><html><body></body></html>"
        warnings={[]}
        onEditTarget={onEditTarget}
      />,
    );

    const iframe = getPreviewFrame();
    if (!iframe.contentDocument) throw new Error("测试环境未创建 iframe document");
    iframe.contentDocument.body.innerHTML =
      '<span data-resume-path="projects.0.description.1">项目要点</span>';

    fireEvent.click(screen.getByText("编辑"));
    fireEvent.load(iframe);
    const target = iframe.contentDocument.querySelector("[data-resume-path]");
    if (!target) throw new Error("可编辑字段未渲染");
    fireEvent.click(target);

    expect(onEditTarget).toHaveBeenCalledWith("projects.0.description.1");
  });

  it("shows which field the pointer is on, and rewrites that exact field on demand", () => {
    const onEditTarget = vi.fn();
    render(
      <ResumePreview
        html="<!doctype html><html><body></body></html>"
        warnings={[]}
        onEditTarget={onEditTarget}
        describePath={(path) => `栏目「${path}」`}
      />,
    );

    const iframe = getPreviewFrame();
    if (!iframe.contentDocument) throw new Error("测试环境未创建 iframe document");
    iframe.contentDocument.body.innerHTML =
      '<span data-resume-path="projects.0.description.1">项目要点</span>';

    fireEvent.click(screen.getByText("编辑"));
    fireEvent.load(iframe);
    const target = iframe.contentDocument.querySelector("[data-resume-path]");
    if (!target) throw new Error("可编辑字段未渲染");

    // 鼠标停在某一条要点上：工具栏要说清"现在指向的是哪一栏"。
    fireEvent.mouseMove(target);
    expect(screen.getByText(/栏目「projects\.0\.description\.1」/)).toBeInTheDocument();

    // 一键让 AI 改"这一栏"——精确到刚才指的那一条。
    fireEvent.click(screen.getByRole("button", { name: "让 AI 改这一栏" }));
    expect(onEditTarget).toHaveBeenCalledWith("projects.0.description.1");
  });

  it("clears the hover hint when the pointer leaves the field", () => {
    const onEditTarget = vi.fn();
    render(
      <ResumePreview
        html="<!doctype html><html><body></body></html>"
        warnings={[]}
        onEditTarget={onEditTarget}
      />,
    );

    const iframe = getPreviewFrame();
    if (!iframe.contentDocument) throw new Error("测试环境未创建 iframe document");
    iframe.contentDocument.body.innerHTML = '<span data-resume-path="summary">总结</span>';
    fireEvent.click(screen.getByText("编辑"));
    fireEvent.load(iframe);
    const target = iframe.contentDocument.querySelector("[data-resume-path]");
    if (!target) throw new Error("可编辑字段未渲染");

    fireEvent.mouseMove(target);
    // 提示由 DOM 直更（见 useFrameInteractions 的注释），断言显隐与内容而不是 React 文本节点。
    const chip = document.querySelector(".resume-preview-hover-chip") as HTMLElement | null;
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain("summary");
    // R14：chip 是 flex（不是 inline-flex）容器，内部按「label 收缩 + 按钮不换行」排版。
    expect(chip?.style.display).toBe("flex");
    fireEvent.mouseOut(target, { relatedTarget: iframe.contentDocument.body });
    expect(chip?.style.display).toBe("none");
  });

  it("chip 用 flex 排版：长 label 只压缩文字，动作按钮仍在 DOM 且可点击（R14）", () => {
    const onEditTarget = vi.fn();
    const longPath = "experience.0.description.0";
    render(
      <ResumePreview
        html="<!doctype html><html><body></body></html>"
        warnings={[]}
        onEditTarget={onEditTarget}
        // 真实文案比这还长（「实习/工作经历 · 第 1 条 · 工作内容 · 第 1 条」）；
        // 这里要的是"长度不可控"，所以给它一段明显超宽的文字。
        describePath={() =>
          "实习/工作经历 · 第 1 条 · 工作内容 · 第 1 条（负责服务端接口设计与实现，覆盖订单、支付与对账链路）"
        }
      />,
    );

    const iframe = getPreviewFrame();
    if (!iframe.contentDocument) throw new Error("测试环境未创建 iframe document");
    iframe.contentDocument.body.innerHTML = `<span data-resume-path="${longPath}">项目要点</span>`;
    fireEvent.click(screen.getByText("编辑"));
    fireEvent.load(iframe);
    const target = iframe.contentDocument.querySelector("[data-resume-path]");
    if (!target) throw new Error("可编辑字段未渲染");

    fireEvent.mouseMove(target);

    const chip = document.querySelector<HTMLElement>(".resume-preview-hover-chip");
    expect(chip).not.toBeNull();
    expect(chip?.style.display).toBe("flex");
    // 结构契约：label 与按钮是 chip 内的同级 flex 子项（CSS 靠这两级分别做收缩/不收缩）。
    const label = chip?.querySelector(".resume-preview-hover-label");
    expect(label).not.toBeNull();
    expect(label?.textContent).toContain("工作内容");
    const action = chip?.querySelector("button");
    expect(action).not.toBeNull();
    expect(action).toHaveTextContent("让 AI 改这一栏");

    // 长 label 不影响按钮可用：点它仍然精确回传刚才指向的字段。
    fireEvent.click(action as HTMLElement);
    expect(onEditTarget).toHaveBeenCalledWith(longPath);
    expect(chip?.style.display).toBe("flex");
  });

  it("exposes editable fields as keyboard controls", () => {
    const onEditTarget = vi.fn();
    render(
      <ResumePreview
        html="<!doctype html><html><body></body></html>"
        warnings={[]}
        onEditTarget={onEditTarget}
      />,
    );
    const iframe = getPreviewFrame();
    if (!iframe.contentDocument) throw new Error("测试环境未创建 iframe document");
    iframe.contentDocument.body.innerHTML = '<span data-resume-path="summary">个人总结</span>';

    fireEvent.click(screen.getByText("编辑"));
    fireEvent.load(iframe);
    const target = iframe.contentDocument.querySelector<HTMLElement>("[data-resume-path]");
    if (!target) throw new Error("可编辑字段未渲染");

    expect(target).toHaveAttribute("role", "button");
    expect(target).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(target, { key: "Enter" });
    fireEvent.keyDown(target, { key: " " });

    expect(onEditTarget).toHaveBeenNthCalledWith(1, "summary");
    expect(onEditTarget).toHaveBeenNthCalledWith(2, "summary");
  });

  it("restores template attributes and removes edit listeners in pan mode", () => {
    const onEditTarget = vi.fn();
    render(
      <ResumePreview
        html="<!doctype html><html><body></body></html>"
        warnings={[]}
        onEditTarget={onEditTarget}
      />,
    );
    const iframe = getPreviewFrame();
    if (!iframe.contentDocument) throw new Error("测试环境未创建 iframe document");
    iframe.contentDocument.body.innerHTML =
      '<span role="note" tabindex="-1" data-resume-path="name">姓名</span>';

    fireEvent.click(screen.getByText("编辑"));
    fireEvent.load(iframe);
    const target = iframe.contentDocument.querySelector<HTMLElement>("[data-resume-path]");
    if (!target) throw new Error("可编辑字段未渲染");
    expect(target).toHaveAttribute("role", "button");

    fireEvent.click(screen.getByText("抓手"));
    expect(target).toHaveAttribute("role", "note");
    expect(target).toHaveAttribute("tabindex", "-1");
    fireEvent.click(target);

    expect(onEditTarget).not.toHaveBeenCalled();
  });
});

describe("ResumePreview 两行工具栏与缩放下移（P2b）", () => {
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

  it("两个插槽各归各行：结构类在第一行，度量类与「正指向」chip 同在第二行", () => {
    const { container } = render(
      <ResumePreview
        html="<!doctype html><html><body></body></html>"
        warnings={[]}
        onEditTarget={vi.fn()}
        templateControls={<span data-testid="template-controls">结构类</span>}
        measureControls={<span data-testid="measure-controls">度量类</span>}
      />,
    );

    const template = screen.getByTestId("template-controls");
    const measure = screen.getByTestId("measure-controls");
    const chip = container.querySelector(".resume-preview-hover-chip");

    const primaryRow = template.closest(".resume-preview-toolbar-row-primary");
    const measureRow = measure.closest(".resume-preview-toolbar-row-measure");
    expect(primaryRow).not.toBeNull();
    expect(measureRow).not.toBeNull();
    expect(primaryRow).not.toBe(measureRow);

    // 计划书 P2 风险表最后一条：chip 与结构类控件**不可能重叠**，因为它们是两行。
    expect(chip).not.toBeNull();
    expect(chip!.parentElement).toBe(measureRow);
    expect(chip!.parentElement).not.toBe(primaryRow);
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

  it("选 2 页时横向并排（columns），不是上下叠", () => {
    const { container } = render(
      <ResumePreview html="<!doctype html><html><body></body></html>" warnings={[]} pages={2} />,
    );
    const iframe = getPreviewFrame();
    fireEvent.load(iframe);

    // 注入的样式用 CSS columns 横向铺开（单流、单一 fit-scale）。列宽/列间距的具体数值
    // 由正文实际宽度算出来；量不到时必须落到"14mm 页边距"的兜底（688 / 106），
    // 绝不能退化成"列宽 = 整页、间隙 0"——那会把两页糊成一张。
    const injected = iframe.contentDocument?.getElementById("resume-preview-style")?.textContent;
    expect(injected).toContain("column-count:2");
    expect(injected).toContain("column-fill");
    expect(injected).toContain("column-width:688.00px");
    expect(injected).toContain("column-gap:106.00px");

    // iframe 是一页高、两页宽：并排的两张 A4。
    expect(iframe.getAttribute("height")).toBe("1123");
    expect(iframe.getAttribute("width")).toBe(String(794 * 2));

    // 页间隙是竖直的：用 left 定位（水平），不是 top。
    const separator = container.querySelector(
      ".resume-preview-page-separator",
    ) as HTMLElement | null;
    expect(separator).toBeTruthy();
    expect(separator?.style.left).toBeTruthy();
    expect(separator?.style.top).toBe("");
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
