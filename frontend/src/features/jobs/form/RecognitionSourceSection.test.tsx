// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位识别区块：完整招聘信息（粘贴点）的长度治理。
 *
 * 硬上限走 maxLength（与后端 JobTextParseRequest.text 的 max_length=50_000 对齐），
 * 顶到上限才出现一行提示——全仓禁用 antd showCount 常驻计数。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RecognitionSourceSection from "./RecognitionSourceSection";

const baseProps = {
  rawText: "",
  files: [],
  reading: false,
  parsing: false,
  recognizedText: "",
  recognitionSource: null,
  parseWarnings: [],
  onRawTextChange: vi.fn(),
  onAddFiles: vi.fn(),
  onRemoveFile: vi.fn(),
  onPaste: vi.fn(),
  onParse: vi.fn(),
};

afterEach(cleanup);

describe("RecognitionSourceSection", () => {
  it("完整招聘信息有 50000 字硬上限；顶到上限时出现提示（不使用 showCount 计数器）", () => {
    render(<RecognitionSourceSection {...baseProps} rawText={"好".repeat(50000)} />);

    const raw = screen.getByLabelText("完整招聘信息") as HTMLTextAreaElement;
    expect(raw.maxLength).toBe(50000);
    expect(screen.getByText("已达 50000 字上限")).toBeInTheDocument();
    expect(screen.queryByText(/\d+\s*\/\s*50000/)).not.toBeInTheDocument();
  });

  it("未达上限时不出现长度提示；输入回调照常触发", () => {
    const onRawTextChange = vi.fn();
    render(<RecognitionSourceSection {...baseProps} onRawTextChange={onRawTextChange} />);

    expect(screen.queryByText(/已达/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("完整招聘信息"), { target: { value: "JD 文本" } });
    expect(onRawTextChange).toHaveBeenCalled();
  });

  it("识别警告每条一个列表项，不再拼成带「。；」的长句（I-34）", () => {
    render(
      <RecognitionSourceSection
        {...baseProps}
        parseWarnings={["请手动填写。", "未识别到岗位信息。"]}
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe("请手动填写。");
    expect(items[1].textContent).toBe("未识别到岗位信息。");
    // 旧写法 `join("；")` 留下的痕迹不能出现在任何文本节点里。
    expect(document.body.textContent).not.toContain("。；");
  });
});
