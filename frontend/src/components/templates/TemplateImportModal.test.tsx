/** 「导入参考模板」弹窗：识别草稿 → 预览微调 → 保存样式模板。 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TemplateImportModal from "./TemplateImportModal";

const apiMocks = vi.hoisted(() => ({
  analyzeTemplateFromFiles: vi.fn(),
  createResumeTemplate: vi.fn(),
}));
const previewMocks = vi.hoisted(() => ({ previewResumeTemplate: vi.fn() }));

vi.mock("../../api/resumeTemplates", () => ({
  analyzeTemplateFromFiles: apiMocks.analyzeTemplateFromFiles,
  createResumeTemplate: apiMocks.createResumeTemplate,
}));
vi.mock("../../api/resumes", () => previewMocks);

function renderModal(overrides: Partial<{ open: boolean }> = {}) {
  const onClose = vi.fn();
  const onImported = vi.fn();
  const view = render(
    <AntdApp>
      <TemplateImportModal
        open={overrides.open ?? true}
        onClose={onClose}
        onImported={onImported}
      />
    </AntdApp>,
  );
  return { ...view, onClose, onImported };
}

/** 造一个能塞进 Upload 的 File。 */
function pngFile(name = "目标模板.png"): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: "image/png" });
}

beforeEach(() => {
  apiMocks.analyzeTemplateFromFiles.mockReset();
  apiMocks.createResumeTemplate.mockReset();
  previewMocks.previewResumeTemplate.mockReset().mockResolvedValue("<html></html>");
});

afterEach(() => {
  // 不 cleanup 的话，上一个用例的弹窗还挂在 DOM 里，下一个用例就会"找到多个同名按钮"。
  cleanup();
  vi.clearAllMocks();
});

describe("TemplateImportModal", () => {
  it("没选文件时不能提交（按钮禁用）", () => {
    renderModal();
    expect(screen.getByRole("button", { name: /识别并预览/ })).toBeDisabled();
  });

  it("提交后把文件与名称交给接口，成功后关闭并通知父组件刷新", async () => {
    apiMocks.analyzeTemplateFromFiles.mockResolvedValue({
      name: "导入的样式",
      description: "按图片识别",
      kind: "style",
      html: "<html><head></head><body></body></html>",
      config: { accent: "#123456" },
      confidence: { accent: 0.9 },
      evidence: ["深蓝强调色"],
      warnings: [],
      source_names: ["目标模板.png"],
    });
    apiMocks.createResumeTemplate.mockResolvedValue({
      id: 9,
      name: "导入的样式",
      kind: "style",
    });
    const { onClose, onImported } = renderModal();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile()] } });
    fireEvent.change(screen.getByRole("textbox", { name: "模板名称" }), {
      target: { value: "深蓝简洁" },
    });
    fireEvent.click(screen.getByRole("button", { name: /识别并预览/ }));

    await waitFor(() => expect(apiMocks.analyzeTemplateFromFiles).toHaveBeenCalledTimes(1));
    expect(apiMocks.analyzeTemplateFromFiles.mock.calls[0][1]).toBe("深蓝简洁");
    fireEvent.click(await screen.findByRole("button", { name: /保存为我的模板/ }));

    await waitFor(() =>
      expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ id: 9 })),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("名称留空也能提交（由模型起名）", async () => {
    apiMocks.analyzeTemplateFromFiles.mockResolvedValue({
      name: "模型起的名字",
      description: "",
      kind: "style",
      html: "<html><head></head><body></body></html>",
      config: { line_height: 1.5 },
      confidence: {},
      evidence: [],
      warnings: [],
      source_names: ["目标模板.png"],
    });
    apiMocks.createResumeTemplate.mockResolvedValue({
      id: 10,
      name: "模型起的名字",
      kind: "style",
    });
    renderModal();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile()] } });
    fireEvent.click(screen.getByRole("button", { name: /识别并预览/ }));

    await waitFor(() => expect(apiMocks.analyzeTemplateFromFiles).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: /保存为我的模板/ }));
    await waitFor(() => expect(apiMocks.createResumeTemplate).toHaveBeenCalled());
    expect(apiMocks.createResumeTemplate.mock.calls[0][0].name).toBe("模型起的名字");
  });

  it("接口报错时留在弹窗里，把后端的中文原因显示出来", async () => {
    apiMocks.analyzeTemplateFromFiles.mockRejectedValue(
      new Error("没能从这份文件里读出可用的版式参数"),
    );
    const { onClose } = renderModal();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile()] } });
    fireEvent.click(screen.getByRole("button", { name: /识别并预览/ }));

    expect(await screen.findByText("没能从这份文件里读出可用的版式参数")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
