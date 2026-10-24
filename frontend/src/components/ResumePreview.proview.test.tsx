// SPDX-License-Identifier: Apache-2.0
/**
 * W15 专业视图在**真实画布组件**上的接线（D04/D05/D10/D13 + D09 入口）。
 *
 * 为什么必须有这一层：纯函数测试证明"几何算得对"，但证明不了"用户能不能点到"。
 * 这里挂真实的 `ResumePreview` + 真 iframe（jsdom 的 srcdoc 文档），逐条断言：
 * 工具条出现、缩放档位真的改读数、页导航真的翻页、辅助线/灰度真的注入到纸面 iframe、
 * 命令面板快捷键真的打开面板、照片裁剪入口真的打开弹窗。
 *
 * 同时钉住 D05 的产物隔离：注入只发生在 iframe 的 contentDocument，纸面 HTML
 * （`srcdoc`）在开关前后完全一致。
 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import ResumePreview from "./ResumePreview";
import { ProviewProvider } from "../features/resume-proview/ProviewContext";
import type { ProviewShellConfig } from "../features/resume-proview/ProviewContext";
import { PROOF_STYLE_ID } from "../features/resume-proview/previewOverlays";
import { GUIDE_LAYER_ID } from "../features/resume-proview/guideGeometry";
import { runShortcut } from "../features/shortcuts/useShortcutKeymap";

// 精确预览会请求服务端 PDF：这里永远悬着（= 还在排版），避免 jsdom 里伪造 objectURL。
vi.mock("../api/resumes", () => ({
  fetchResumePreviewPdf: vi.fn(() => new Promise(() => undefined)),
}));
// jsdom 不解码图片：裁剪弹窗要拿到原图尺寸才算得出参数。
vi.mock("../features/resume-proview/usePhotoDimensions", () => ({
  usePhotoDimensions: () => ({ width: 1000, height: 1000 }),
}));

const HTML = `<!doctype html><html><body><p data-resume-path="summary">hello</p></body></html>`;
const PHOTO = "data:image/png;base64,AAAA";

function renderCanvas(config: ProviewShellConfig = {}, pages = 2) {
  return render(
    <AntdApp>
      <ProviewProvider config={config}>
        <ResumePreview html={HTML} warnings={[]} pages={pages} />
      </ProviewProvider>
    </AntdApp>,
  );
}

function frames(): HTMLIFrameElement[] {
  return screen.getAllByTitle(/^简历预览/) as HTMLIFrameElement[];
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
});

describe("专业视图真实入口（D04/D05/D10）", () => {
  it("没有 ProviewProvider 时零新增 DOM（主预览行为不变）", () => {
    render(
      <AntdApp>
        <ResumePreview html={HTML} warnings={[]} pages={2} />
      </AntdApp>,
    );
    expect(screen.queryByRole("toolbar", { name: t("proview.bar.label") })).toBeNull();
  });

  it("制作台里出现工具条：三个缩放档位、页导航、辅助线、灰度校样、打印检查、命令", () => {
    renderCanvas();
    expect(screen.getByRole("toolbar", { name: t("proview.bar.label") })).toBeInTheDocument();
    expect(screen.getByText(t("proview.zoom.page"))).toBeInTheDocument();
    expect(screen.getByText(t("proview.zoom.width"))).toBeInTheDocument();
    expect(screen.getByText(t("proview.zoom.actual"))).toBeInTheDocument();
    expect(
      screen.getByText(t("proview.pageNav.status", { page: 1, total: 2 })),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("proview.proof.label") })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("proview.diagnostics.label") }),
    ).toBeInTheDocument();
  });

  it("100% 档真的改缩放读数，并显示系统缩放声明（逻辑像素，不是物理尺寸）", () => {
    const { container } = renderCanvas();
    const label = () => container.querySelector(".resume-preview-zoom-label")?.textContent ?? "";
    expect(label()).not.toBe("100%");
    fireEvent.click(screen.getByText(t("proview.zoom.actual")));
    expect(label()).toBe("100%");
    expect(screen.getByText(t("proview.zoom.actualNote"))).toBeInTheDocument();
    fireEvent.click(screen.getByText(t("proview.zoom.page")));
    expect(label()).not.toBe("100%");
  });

  it("页导航：下一页 / 上一页更新当前页读数（键盘可达的按钮）", () => {
    renderCanvas();
    const next = screen.getByRole("button", { name: t("proview.pageNav.next") });
    const prev = screen.getByRole("button", { name: t("proview.pageNav.prev") });
    expect(prev).toBeDisabled();
    fireEvent.click(next);
    expect(
      screen.getByText(t("proview.pageNav.status", { page: 2, total: 2 })),
    ).toBeInTheDocument();
    // 当前页高亮：类名只挂在第 2 张纸上（D04 的"当前页可辨认"）。
    const pages = Array.from(document.querySelectorAll(".resume-preview-page"));
    expect(pages[1].classList.contains("is-proview-current")).toBe(true);
    expect(pages[0].classList.contains("is-proview-current")).toBe(false);
    fireEvent.click(prev);
    expect(
      screen.getByText(t("proview.pageNav.status", { page: 1, total: 2 })),
    ).toBeInTheDocument();
    expect(pages[0].classList.contains("is-proview-current")).toBe(true);
  });

  it("辅助线注入纸面 iframe，不改进导出用的 HTML（srcdoc 前后一致）", async () => {
    renderCanvas();
    const frame = frames()[0];
    fireEvent.load(frame);
    const srcdocBefore = frame.getAttribute("srcdoc");

    fireEvent.click(screen.getByRole("button", { name: t("proview.guides.label") }));
    fireEvent.click(screen.getByRole("checkbox", { name: t("proview.guides.margins") }));
    await waitFor(() => {
      expect(frame.contentDocument?.getElementById(GUIDE_LAYER_ID)).not.toBeNull();
    });
    expect(frame.getAttribute("srcdoc")).toBe(srcdocBefore);
    expect(frame.getAttribute("srcdoc")).not.toContain("data-proview-guide");

    // 关掉即移除（不留空层）。
    fireEvent.click(screen.getByRole("checkbox", { name: t("proview.guides.margins") }));
    await waitFor(() => {
      expect(frame.contentDocument?.getElementById(GUIDE_LAYER_ID)).toBeNull();
    });
  });

  it("灰度校样只在预览里生效：纸面 iframe 注入样式，原始 HTML 不带该样式", async () => {
    renderCanvas();
    const frame = frames()[0];
    fireEvent.load(frame);
    const srcdocBefore = frame.getAttribute("srcdoc");
    fireEvent.click(screen.getByRole("button", { name: t("proview.proof.label") }));
    await waitFor(() => {
      expect(frame.contentDocument?.getElementById(PROOF_STYLE_ID)).not.toBeNull();
    });
    expect(frame.getAttribute("srcdoc")).toBe(srcdocBefore);
    expect(frame.getAttribute("srcdoc")).not.toContain("grayscale");
    fireEvent.click(screen.getByRole("button", { name: t("proview.proof.label") }));
    await waitFor(() => {
      expect(frame.contentDocument?.getElementById(PROOF_STYLE_ID)).toBeNull();
    });
  });
});

describe("命令面板与照片裁剪的真实入口（D13/D09）", () => {
  it("点击「命令」打开面板；快捷键 commandPalette 打开同一面板", async () => {
    renderCanvas();
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp("^" + t("proview.command.open")),
      }),
    );
    expect(await screen.findByText(t("proview.command.title"))).toBeInTheDocument();

    // 快捷键走同一个动作 id：Esc 关闭语义由 CommandPalette.test.tsx 单独钉住，这里只验证
    // "注册表动作 → 真面板"这条接线（不需要和 antd 的关闭动画在 jsdom 里较劲）。
    cleanup();
    renderCanvas();
    act(() => {
      runShortcut("commandPalette", new KeyboardEvent("keydown", { key: "p" }));
    });
    expect(await screen.findByText(t("proview.command.title"))).toBeInTheDocument();
  });

  it("宿主注入命令后可在面板里执行（保存/导出不是摆设）", async () => {
    const save = vi.fn();
    renderCanvas({
      commands: [{ id: "save", label: t("proview.cmd.save"), keywords: ["persist"], run: save }],
    });
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp("^" + t("proview.command.open")) }),
    );
    const input = await screen.findByRole("combobox", {
      name: t("proview.command.searchAria"),
    });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("有照片时出现裁剪入口，打开弹窗后可应用并保存会话级参数", async () => {
    renderCanvas({ resumeId: 42, photo: { photo: PHOTO } });
    const entry = screen.getByRole("button", { name: t("proview.photo.button") });
    fireEvent.click(entry);
    expect(
      await screen.findByRole("dialog", { name: t("proview.photo.title") }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("proview.photo.apply") }));
    await waitFor(() => {
      expect(sessionStorage.getItem("resumeforge.proview.photo-crop.v1:42")).not.toBeNull();
    });
  });

  it("工作区预设由宿主注入后可见（面板显隐归 shell，入口在这里）", () => {
    renderCanvas({
      workspace: { value: "default", onChange: vi.fn(), onReset: vi.fn() },
    });
    expect(screen.getByText(t("proview.workspace.default"))).toBeInTheDocument();
    expect(screen.getByText(t("proview.workspace.writing"))).toBeInTheDocument();
  });
});
