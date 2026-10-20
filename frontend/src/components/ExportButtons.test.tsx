/**
 * 导出入口：全页面只有一个「导出」按钮，点击打开统一面板。
 *
 * 这里只钉"入口形态"与"参数同源"两件事：以前是「下载 PDF」+「更多格式」两个入口、
 * 预览页另有「导出选项」「一键脱敏」，四条路径各自拼参数；漏一条就会出现"预览里调过的
 * 字号没进导出"。面板内部的行为（格式多选、脱敏、409 草稿闸门）在
 * `ExportOptionsModal.test.tsx` 里。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResumeLayout } from "../types";
import ExportButtons from "./ExportButtons";

const apiMocks = vi.hoisted(() => ({
  exportResumeWithOptions: vi.fn(),
  redactResume: vi.fn(),
}));

const downloadMocks = vi.hoisted(() => ({
  downloadBlob: vi.fn(),
  printHtml: vi.fn(),
}));

vi.mock("../api/resumes", () => apiMocks);
vi.mock("../utils/download", () => downloadMocks);

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 2,
  font_scale: "small",
  format_config: { font_scale_adjust: 0.636 },
};

function renderButtons(props: Partial<React.ComponentProps<typeof ExportButtons>> = {}) {
  return render(
    <AntdApp>
      <ExportButtons recordId={7} layout={LAYOUT} {...props} />
    </AntdApp>,
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ExportButtons", () => {
  it("只有一个「导出」入口，旧的「下载 PDF / 更多格式」不再出现", () => {
    renderButtons();

    expect(screen.getByRole("button", { name: /导\s*出/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /下载 PDF/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /更多格式/ })).not.toBeInTheDocument();
  });

  it("点击后打开导出面板（版式与「跟随预览」文案已随 T5 移出面板）", async () => {
    renderButtons({
      layout: { ...LAYOUT, format_config: { font_scale_adjust: 0.636, line_height: 1.55 } },
    });

    fireEvent.click(screen.getByRole("button", { name: /导\s*出/ }));

    // 面板照旧打开（「格式」是它的第一块）。
    expect(await screen.findByText("格式")).toBeInTheDocument();
    // 只读的「跟随预览：行距 / 字号系数」随版式栏一起下线：版式现在只在预览的版式栏里改。
    expect(screen.queryByText(/跟随预览/)).not.toBeInTheDocument();
  });

  it("父组件接管面板时只画按钮，不挂第二份弹窗（两份表单会互相覆盖）", () => {
    const onOpen = vi.fn();
    renderButtons({ onOpen });

    fireEvent.click(screen.getByRole("button", { name: /导\s*出/ }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    // 自己没有挂第二份面板（否则页面上会出现两个「格式」区块 / 两个「导出」按钮）。
    expect(screen.queryByText("格式")).not.toBeInTheDocument();
  });
});
