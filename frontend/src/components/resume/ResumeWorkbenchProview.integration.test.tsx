// SPDX-License-Identifier: Apache-2.0
/**
 * W15-INT / W11 真实入口集成：**从 shell 一路点到真实组件**。
 *
 * 这一层补的是"组件都测了、但用户点不到"的空白：
 * - shell（ResumeZoomModal）→ 画布 → ProviewLayer 的挂载链；
 * - 工作区预设真的只切面板可见性（文档状态不变、偏好只进 localStorage）；
 * - 辅助线/灰度只改 iframe 临时文档：srcdoc 不变、全程零网络请求（导出通道不可能带上它们）；
 * - 命令面板里的宿主动作真的调用保存链路；
 * - 照片裁剪保存/移除真的落到会话级桥与宿主内容保存；
 * - 统一检查从动作条打开，并按真实契约 POST /resumes/{id}/preflight。
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import { makeIssue, makePreflightOut } from "../../test/preflightFixtures";
import type { ResumeContent } from "../../types";
import { GUIDE_LAYER_ID } from "../../features/resume-proview/guideGeometry";
import { PROOF_STYLE_ID } from "../../features/resume-proview/previewOverlays";
import { CONTENT, renderModal } from "./ResumeZoomModal.testkit";

vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
// 精确预览面板会请求 PDF：让它永远悬着（只关心入口，不关心 PDF 渲染）。
vi.mock("../../api/resumes", () => ({
  fetchResumePreviewPdf: vi.fn(() => new Promise(() => undefined)),
}));
// 实时预览的"内容变了就重排"：用本地桩返回 HTML，避免测试打网络。
vi.mock("../../api/resumeLayout", () => ({
  renderResume: vi.fn(async () => "<!doctype html><html><body></body></html>"),
}));
// jsdom 不解码图片：裁剪弹窗要原图尺寸才算得出参数。
vi.mock("../../features/resume-proview/usePhotoDimensions", () => ({
  usePhotoDimensions: () => ({ width: 1000, height: 1000 }),
}));

const PHOTO = "data:image/png;base64,AAAA";

function toolbar(): Promise<HTMLElement> {
  return screen.findByRole("toolbar", { name: t("proview.bar.label") });
}

/** 找到"包含某段标题"的那个 dialog（制作台外壳本身也是一个 dialog）。 */
async function dialogWithText(text: string): Promise<HTMLElement> {
  const dialogs = await screen.findAllByRole("dialog");
  const found = dialogs.find((dialog) => within(dialog).queryByText(text) !== null);
  if (!found) throw new Error("dialog not found");
  return found;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("W15 真实入口（shell → 画布 → 专业视图）", () => {
  it("工具条出现在制作台里；工作区预设只切面板可见性，偏好只进 localStorage", async () => {
    const onApplyLayout = vi.fn();
    renderModal({ onApplyLayout });
    const bar = await toolbar();
    expect(document.querySelector(".resume-wb-col-params")).not.toBeNull();
    expect(document.querySelector(".resume-wb-col-editor")).not.toBeNull();

    fireEvent.click(within(bar).getByText(t("proview.workspace.writing")));
    await waitFor(() => {
      expect(document.querySelector(".resume-wb-col-params")).toBeNull();
    });
    // 共用同一份文档状态：画布与内容栏都在，且没有任何版式落库/重排。
    expect(document.querySelector(".resume-wb-col-editor")).not.toBeNull();
    expect(document.querySelector(".resume-wb-col-canvas")).not.toBeNull();
    expect(onApplyLayout).not.toHaveBeenCalled();
    // 偏好只允许 localStorage；sessionStorage 留给未保存正文草稿。
    expect(localStorage.getItem("resume.proview.workspace.v1")).toBe("writing");
    expect(sessionStorage.getItem("resume.proview.workspace.v1")).toBeNull();
    expect(sessionStorage.getItem("resume.proview.preferences.v1")).toBeNull();

    fireEvent.click(within(bar).getByText(t("proview.workspace.default")));
    await waitFor(() => {
      expect(document.querySelector(".resume-wb-col-params")).not.toBeNull();
    });
  });

  it("辅助线与灰度只改 iframe 临时文档：srcdoc 不变、零网络请求（辅助层无导出通道）", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderModal();
    const bar = await toolbar();
    const frames = screen.getAllByTitle(/^简历预览/) as HTMLIFrameElement[];
    const before = frames.map((frame) => frame.getAttribute("srcdoc"));
    fireEvent.load(frames[0]);

    fireEvent.click(within(bar).getByRole("button", { name: t("proview.guides.label") }));
    fireEvent.click(await screen.findByRole("checkbox", { name: t("proview.guides.margins") }));
    await waitFor(() => {
      expect(frames[0].contentDocument?.getElementById(GUIDE_LAYER_ID)).not.toBeNull();
    });
    fireEvent.click(within(bar).getByRole("button", { name: t("proview.proof.label") }));
    await waitFor(() => {
      expect(frames[0].contentDocument?.getElementById(PROOF_STYLE_ID)).not.toBeNull();
    });

    expect(frames.map((frame) => frame.getAttribute("srcdoc"))).toEqual(before);
    // 基线请求（字体目录等）不算；这里针对"导出/预览/简历写入"这条通道：
    // 辅助线/灰度不该触发任何它，才谈得上"没有进入产物的通道"。
    // W12 来源/事实锁面板会读 /api/provenance/resumes/*，它不是导出/预览/写入通道，不在此断言范围。
    const suspicious = fetchSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => /\/api\/resumes\//.test(url) || /\/export|\/preview|\/render/.test(url));
    expect(suspicious).toEqual([]);
  });

  it("命令面板里的「保存修改」调用宿主的保存链路（不是空按钮）", async () => {
    const onPublishDraft = vi.fn(async () => true);
    const onExport = vi.fn();
    renderModal({ isDraft: true, onPublishDraft, onExport });
    const bar = await toolbar();
    fireEvent.click(
      within(bar).getByRole("button", {
        name: new RegExp("^" + t("proview.command.open")),
      }),
    );
    const palette = await dialogWithText(t("proview.command.title"));
    const input = within(palette).getByRole("combobox", {
      name: t("proview.command.searchAria"),
    });
    // 宿主动作排在命令表最前：第一个就是保存。
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onPublishDraft).toHaveBeenCalledTimes(1));
    expect(within(palette).getByText(t("proview.cmd.export"))).toBeInTheDocument();
  });

  it("照片裁剪：应用参数写入会话级桥；移除照片走宿主内容保存", async () => {
    const content: ResumeContent = { ...CONTENT, photo: PHOTO };
    const onSaveContent = vi.fn(async () => undefined);
    renderModal({ content, onSaveContent });
    const bar = await toolbar();
    const openCrop = () =>
      fireEvent.click(within(bar).getByRole("button", { name: t("proview.photo.button") }));

    openCrop();
    // 制作台外壳本身也是一个 dialog，且工具条里也有「照片裁剪」按钮文本：
    // 用只有裁剪弹窗才有的提示语定位。
    const cropDialog = await dialogWithText(t("proview.photo.hint"));
    fireEvent.click(within(cropDialog).getByRole("button", { name: t("proview.photo.apply") }));
    await waitFor(() => {
      expect(sessionStorage.getItem("resumeforge.proview.photo-crop.v1:42")).not.toBeNull();
    });

    openCrop();
    const removeDialog = await dialogWithText(t("proview.photo.hint"));
    fireEvent.click(within(removeDialog).getByRole("button", { name: t("proview.photo.remove") }));
    const confirms = await screen.findAllByRole("button", {
      name: t("proview.photo.removeConfirm"),
    });
    fireEvent.click(confirms[confirms.length - 1]);
    await waitFor(() => expect(onSaveContent).toHaveBeenCalled());
    const calls = onSaveContent.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall).toBeDefined();
    if (!lastCall) throw new Error("save callback missing");
    // testkit 的 onSaveContent 是零参 vi.fn：先把调用元组放宽成"收到过一次内容保存"。
    const callArgs = lastCall as unknown as [ResumeContent];
    const saved = callArgs[0];
    expect(saved.photo).toBe("");
  });

  it("统一检查：动作条入口打开面板，开始检查走真实 preflight 请求", async () => {
    // 每个请求都要一个新的 Response（body 只能读一次）；字体目录等基线请求返回空对象。
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      const payload = url.includes("/preflight")
        ? makePreflightOut({ issues: [makeIssue({ detail: "E2E issue" })] })
        : {};
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    renderModal();
    fireEvent.click(await screen.findByRole("button", { name: t("preflight.action.openAria") }));
    const panel = await dialogWithText(t("preflight.title"));
    fireEvent.click(within(panel).getByRole("button", { name: t("preflight.action.run") }));
    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some((call) => String(call[0]).includes("/resumes/42/preflight")),
      ).toBe(true);
    });
    const call = fetchSpy.mock.calls.find((item) =>
      String(item[0]).includes("/resumes/42/preflight"),
    );
    if (!call) throw new Error("preflight request missing");
    expect(String(call[0])).toContain("/resumes/42/preflight");
    const body = JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;
    expect(body.layers).toEqual(["content", "layout", "product"]);
    expect(await within(panel).findByText("E2E issue")).toBeInTheDocument();
  });
});
