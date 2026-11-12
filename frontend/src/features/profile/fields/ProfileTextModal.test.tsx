// SPDX-License-Identifier: Apache-2.0
/** 个人资料识别弹窗：截图与文档暂存、识别原文与警告的展示。 */

import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProfileTextModal from "./ProfileTextModal";

const IMAGE = {
  id: 1,
  name: "截图.png",
  mime_type: "image/png",
  kind: "image" as const,
  data: "data:image/png;base64,iVBORw0KGgo=",
  size: 128,
};

const DOCX = {
  id: 2,
  name: "简历.docx",
  mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  kind: "document" as const,
  data: "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,eA==",
  size: 256,
};

function renderModal(overrides: Partial<React.ComponentProps<typeof ProfileTextModal>> = {}) {
  const props = {
    open: true,
    text: "",
    warnings: [] as string[],
    parsing: false,
    uploadPercent: null,
    recognizedText: "",
    recognitionSource: null,
    files: [] as (typeof IMAGE | typeof DOCX)[],
    filesReading: false,
    onTextChange: vi.fn(),
    onAddFiles: vi.fn(),
    onRemoveFile: vi.fn(),
    onPasteFiles: vi.fn(),
    onClose: vi.fn(),
    onParse: vi.fn(),
    mode: "profile" as const,
    rows: null,
    onRowsChange: vi.fn(),
    onApply: vi.fn(),
    onDiscard: vi.fn(),
    onCancelParse: vi.fn(),
    ...overrides,
  };
  render(
    <AntdApp>
      <ProfileTextModal {...props} />
    </AntdApp>,
  );
  return props;
}

afterEach(() => cleanup());

describe("ProfileTextModal", () => {
  it("renders staged screenshots and reports removal", () => {
    const props = renderModal({ files: [IMAGE] });

    expect(screen.getByAltText("截图.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移除文件 截图.png" }));

    expect(props.onRemoveFile).toHaveBeenCalledWith(IMAGE.id);
  });

  it("renders documents as file tags rather than trying to preview them", () => {
    renderModal({ files: [DOCX] });

    expect(screen.getByText("简历.docx")).toBeInTheDocument();
    expect(screen.queryByAltText("简历.docx")).not.toBeInTheDocument();
  });

  it("forwards pasted images from the textarea", () => {
    const props = renderModal();

    fireEvent.paste(screen.getByLabelText("个人资料文本"), { clipboardData: { items: [] } });

    expect(props.onPasteFiles).toHaveBeenCalledOnce();
  });

  it("forwards files chosen from the picker", () => {
    const onAddFiles = vi.fn();
    renderModal({ onAddFiles });
    const input = document.querySelector(
      'input[type="file"][aria-label="添加截图或文档"]',
    ) as HTMLInputElement;
    const file = new File([new Uint8Array(8)], "picker.png", { type: "image/png" });

    fireEvent.change(input, { target: { files: [file] } });

    expect(onAddFiles).toHaveBeenCalledOnce();
    expect((onAddFiles.mock.calls[0][0] as File[])[0].name).toBe("picker.png");
  });

  it("shows warnings and the text the model read", async () => {
    renderModal({
      warnings: ["图片识别失败，可能是当前模型不支持图片输入（需要多模态模型）。"],
      recognizedText: "张三\n13800000000",
    });

    // 用警告自身的措辞，别用"多模态"——弹窗说明里也有这四个字
    expect(screen.getByText(/图片识别失败/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("查看模型识别到的原文（请对照截图核对）"));

    await waitFor(() => expect(screen.getByText(/13800000000/)).toBeInTheDocument());
  });

  it("renders no recognition block when there is nothing to show", () => {
    renderModal();

    expect(screen.queryByText("查看模型识别到的原文（请对照截图核对）")).not.toBeInTheDocument();
    expect(screen.queryByText("AI 识别")).not.toBeInTheDocument();
    expect(screen.queryByText("本地规则")).not.toBeInTheDocument();
  });

  it("上传中显示附件进度条：真实字节只映射到 0-15%，不会一上传完就画满（R5）", () => {
    renderModal({ parsing: true, uploadPercent: 40 });

    // 40% 的上传字节 = 整条等待的 6%——剩下 85% 的时间都在解析。
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "6");
  });

  it("字节发完（100）后切成不确定态：转圈 + 「正在解析资料…」，不再显示百分比（R5）", () => {
    renderModal({ parsing: true, uploadPercent: 100 });

    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText("正在解析资料…")).toBeInTheDocument();
  });

  it("解析结束（uploadPercent 回到 null）后进度条与解析提示都消失", () => {
    renderModal({ parsing: false, uploadPercent: null });

    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText("正在解析资料…")).toBeNull();
  });

  it("识别中主按钮是「取消识别」，点了调 onCancelParse（不是转圈到底）", () => {
    const onCancelParse = vi.fn();
    renderModal({ parsing: true, onCancelParse });

    // 识别中不该还有一个"看起来在等待"的主按钮：用户此刻唯一想做的事是取消。
    expect(screen.queryByRole("button", { name: /识别并填入/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "取消识别" }));

    expect(onCancelParse).toHaveBeenCalledOnce();
  });

  it("rows 非空即进入校对阶段：渲染清单与「确认填入 N 项」，输入视图让位", () => {
    renderModal({
      rows: [
        { id: "name", section: "基本信息", label: "姓名", value: "张三" },
        { id: "educations.0.school", section: "教育经历", label: "学校", value: "示例大学" },
      ],
    });

    expect(document.querySelector('[data-row-id="name"]')).not.toBeNull();
    expect(document.querySelector('[data-row-id="educations.0.school"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: /确认填入 2 项/ })).toBeInTheDocument();
    // 阶段由 rows 推导：校对时不再显示粘贴框。
    expect(screen.queryByLabelText("个人资料文本")).toBeNull();
  });

  it("N=0（只有未勾选的新字段）时「确认填入」禁用", () => {
    renderModal({
      rows: [
        {
          id: "CUSTOM_是否有驾照",
          section: "待确认的新字段",
          label: "是否有驾照",
          value: "C1",
          isNew: true,
          selected: false,
        },
      ],
    });

    expect(screen.getByRole("button", { name: /确认填入 0 项/ })).toBeDisabled();
  });

  it("mode='webform' 换成网申的标题与占位文案（链路下一轮接）", () => {
    renderModal({ mode: "webform" });

    expect(screen.getByText("粘贴网申资料并识别")).toBeInTheDocument();
    expect(screen.queryByText("粘贴个人资料并识别")).toBeNull();
    expect(screen.getByLabelText("个人资料文本")).toHaveAttribute(
      "placeholder",
      expect.stringContaining("政治面貌"),
    );
  });

  it("keeps saying whether AI or local rules produced the fields", async () => {
    renderModal({ recognitionSource: "local", recognizedText: "" });

    // 本地规则的结果只有来源标记、没有抄录原文，这时标记更不能省。
    const badge = screen.getByText("本地规则");
    fireEvent.mouseEnter(badge);

    expect(await screen.findByRole("tooltip")).toHaveTextContent("请重点核对");
  });
});
