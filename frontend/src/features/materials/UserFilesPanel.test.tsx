// SPDX-License-Identifier: Apache-2.0
/** 文件副本面板：列表渲染与「打开」动作必须有测试守着——它是这一页的核心交互。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserFileItem } from "../../api/userFiles";
import { t } from "../../i18n";
import UserFilesPanel from "./UserFilesPanel";

const apiMocks = vi.hoisted(() => ({
  listUserFiles: vi.fn(),
  revealUserFile: vi.fn(),
  lookupUserFiles: vi.fn(),
  userFileRawUrl: vi.fn((id: number) => `/api/user-files/${id}/raw`),
  userFileTextPreview: vi.fn(),
}));

vi.mock("../../api/userFiles", () => apiMocks);

const ITEMS: UserFileItem[] = [
  {
    id: 7,
    original_name: "证书.png",
    mime: "image/png",
    size: 2048,
    source_type: "material",
    source_ref: "material:1",
    created_at: "2026-10-01T08:00:00",
  },
];

function renderPanel() {
  return render(
    <AntdApp>
      <UserFilesPanel />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.listUserFiles.mockReset().mockResolvedValue({ items: ITEMS, total: 1 });
  apiMocks.revealUserFile.mockReset().mockResolvedValue({ ok: true });
  apiMocks.userFileTextPreview.mockReset().mockResolvedValue({ text: "", warnings: [] });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("UserFilesPanel", () => {
  it("渲染我的文件列表（名称、大小、来源）", async () => {
    renderPanel();

    expect(await screen.findByText("证书.png")).toBeInTheDocument();
    expect(screen.getByText("2 KB")).toBeInTheDocument();
    expect(screen.getByText("资料箱")).toBeInTheDocument();
  });

  it("空列表显示「还没有保存过文件」空态", async () => {
    apiMocks.listUserFiles.mockResolvedValue({ items: [], total: 0 });
    renderPanel();

    expect(await screen.findByText("还没有保存过文件")).toBeInTheDocument();
  });

  it("点「打开文件夹」调用 revealUserFile", async () => {
    renderPanel();
    await screen.findByText("证书.png");

    fireEvent.click(screen.getByRole("button", { name: /打开文件夹/ }));

    await waitFor(() => {
      expect(apiMocks.revealUserFile).toHaveBeenCalledWith(7);
    });
  });

  it("搜索按关键词重新拉取列表", async () => {
    renderPanel();
    await screen.findByText("证书.png");

    const input = screen.getByPlaceholderText("搜索文件名");
    fireEvent.change(input, { target: { value: "证书" } });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });

    await waitFor(() => {
      expect(apiMocks.listUserFiles).toHaveBeenCalledWith(
        expect.objectContaining({ keyword: "证书", page: 1 }),
      );
    });
  });

  it("文档类副本点「预览」：后端提取的文字在抽屉里显示出来", async () => {
    apiMocks.listUserFiles.mockResolvedValue({
      items: [
        {
          id: 12,
          original_name: "实习鉴定表.docx",
          mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          size: 4096,
          source_type: "material",
          source_ref: "material:3",
          created_at: "2026-10-02T08:00:00",
        },
      ],
      total: 1,
    });
    apiMocks.userFileTextPreview.mockResolvedValue({
      text: "实习期间负责订单模块，独立完成三个接口。",
      warnings: [],
    });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /预览/ }));

    expect(await screen.findByText(t("materials.files.previewTextNote"))).toBeInTheDocument();
    expect(apiMocks.userFileTextPreview).toHaveBeenCalledWith(12);
    // 正文在 <pre> 里：断言容器文本，避免新增中文 ByText（tests 口径的棘轮只降不升）。
    expect(document.querySelector(".user-file-text-body")?.textContent).toContain(
      "独立完成三个接口",
    );
  });
});
