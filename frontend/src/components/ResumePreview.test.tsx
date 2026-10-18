import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ResumePreview from "./ResumePreview";

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

  it("多页视图出现且带「近似」标注（去掉标注会红）", () => {
    measureState.value = { usedHeight: 1300, pageContentHeight: 1000, pageLimit: 1 };
    render(
      <ResumePreview html="<!doctype html><html><body></body></html>" warnings={[]} pages={1} />,
    );
    fireEvent.load(getPreviewFrame());

    expect(screen.getByText(/第 2 页 \/ 共 2 页（近似）/)).toBeTruthy();
    expect(screen.getByText(/按 A4 高度切分的近似分页/)).toBeTruthy();
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
    expect(lastCall?.pages).toBe(1); // 视觉切成 2 页，但上报的页数仍是用户设的上限
    expect(lastCall?.overflow).toBe(true);
  });

  it("溢出时多页视图是横向并排（columns），而不是纵向堆叠", () => {
    measureState.value = { usedHeight: 1300, pageContentHeight: 1000, pageLimit: 1 };
    const { container } = render(
      <ResumePreview html="<!doctype html><html><body></body></html>" warnings={[]} pages={1} />,
    );
    const iframe = getPreviewFrame();
    fireEvent.load(iframe);

    // 注入的样式用 CSS columns 横向铺开（单流、单一 fit-scale），而不是把 iframe 拉高后纵向堆叠。
    const injected = iframe.contentDocument?.getElementById("resume-preview-style")?.textContent;
    expect(injected).toContain("column-width");
    expect(injected).toContain("column-fill");
    expect(injected).not.toContain("overflow-y:visible");

    // 页间隙是竖直的：定位用 left（水平），不再用 top（垂直）；宽度随缩放给出的
    // “裁切间隙”——观感是两张并排的独立 A4 纸，不是贯穿虚线。
    const separator = container.querySelector(
      ".resume-preview-page-separator",
    ) as HTMLElement | null;
    expect(separator).toBeTruthy();
    expect(separator?.style.left).toBeTruthy();
    expect(separator?.style.top).toBe("");
    expect(Number.parseFloat(separator?.style.width ?? "")).toBeGreaterThan(0);
  });
});
