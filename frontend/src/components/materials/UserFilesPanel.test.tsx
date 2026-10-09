/** 文件副本面板：列表渲染与「打开」动作必须有测试守着——它是这一页的核心交互。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserFileItem } from "../../api/userFiles";
import UserFilesPanel from "./UserFilesPanel";

const apiMocks = vi.hoisted(() => ({
  listUserFiles: vi.fn(),
  revealUserFile: vi.fn(),
  lookupUserFiles: vi.fn(),
  userFileRawUrl: vi.fn((id: number) => `/api/user-files/${id}/raw`),
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
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("UserFilesPanel", () => {
  it("渲染文件副本列表（名称、大小、来源）", async () => {
    renderPanel();

    expect(await screen.findByText("证书.png")).toBeInTheDocument();
    expect(screen.getByText("2 KB")).toBeInTheDocument();
    expect(screen.getByText("资料箱")).toBeInTheDocument();
  });

  it("空列表显示「暂无文件副本」空态", async () => {
    apiMocks.listUserFiles.mockResolvedValue({ items: [], total: 0 });
    renderPanel();

    expect(await screen.findByText("暂无文件副本")).toBeInTheDocument();
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
});
