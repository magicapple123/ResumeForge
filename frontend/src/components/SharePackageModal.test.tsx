// SPDX-License-Identifier: Apache-2.0
/** 离线分享包：生成只读快照、展示文件清单、下载文件、导入评论。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SharePackageModal from "./SharePackageModal";

const apiMocks = vi.hoisted(() => ({
  createSharePackage: vi.fn(),
  getSharePackageComments: vi.fn(),
  importSharePackageComments: vi.fn(),
  downloadSharePackageFile: vi.fn(),
  deleteSharePackage: vi.fn(),
  revealSharePackage: vi.fn(),
}));

const downloadMocks = vi.hoisted(() => ({
  downloadBlob: vi.fn(),
}));

const clipboardMocks = vi.hoisted(() => ({
  copyText: vi.fn(),
}));

vi.mock("../api/sharePackages", () => apiMocks);
vi.mock("../utils/download", () => downloadMocks);
vi.mock("../utils/clipboard", () => clipboardMocks);

const READ_ONLY = {
  id: 1,
  title: "张三-分享包-20260101",
  resume_id: 7,
  job_id: null,
  permission: "read_only",
  files: [
    {
      name: "resume.html",
      path: "C:\\tmp\\share\\1\\resume.html",
      format: "html",
      size: 100,
      sha256: "abc",
      download_url: "/api/share-packages/1/files/resume.html",
    },
    {
      name: "resume.pdf",
      path: "C:\\tmp\\share\\1\\resume.pdf",
      format: "pdf",
      size: 200,
      sha256: "def",
      download_url: "/api/share-packages/1/files/resume.pdf",
    },
  ],
  snapshot: { name: "***" },
  comments_file: "",
  share_token: "token123",
  redaction_config: {},
  created_at: "2026-01-01T00:00:00",
  updated_at: "2026-01-01T00:00:00",
};

const COMMENT = {
  ...READ_ONLY,
  id: 2,
  permission: "comment",
  comments_file: "C:\\tmp\\share\\2\\comments.md",
  files: [
    ...READ_ONLY.files,
    {
      name: "comments.md",
      path: "C:\\tmp\\share\\2\\comments.md",
      format: "markdown",
      size: 50,
      sha256: "ghi",
      download_url: "/api/share-packages/2/files/comments.md",
    },
  ],
};

function renderModal() {
  return render(
    <AntdApp>
      <SharePackageModal recordId={7} open onClose={vi.fn()} />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.createSharePackage.mockReset().mockResolvedValue(READ_ONLY);
  apiMocks.getSharePackageComments.mockReset().mockResolvedValue({
    filename: "comments.md",
    format: "markdown",
    content: "初始评论",
  });
  apiMocks.importSharePackageComments.mockReset().mockResolvedValue({
    filename: "comments.md",
    format: "markdown",
    content: "新评论",
  });
  apiMocks.downloadSharePackageFile.mockReset().mockResolvedValue({
    blob: new Blob(["html"]),
    filename: "resume.html",
  });
  apiMocks.deleteSharePackage.mockReset().mockResolvedValue(undefined);
  apiMocks.revealSharePackage.mockReset().mockResolvedValue({
    directory: "C:\\tmp\\share\\1",
  });
  downloadMocks.downloadBlob.mockReset();
  clipboardMocks.copyText.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("SharePackageModal", () => {
  it("生成只读分享包并展示分享码与文件清单", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "生成分享包" }));

    expect(await screen.findByText("token123")).toBeInTheDocument();
    expect(screen.getByText("resume.html")).toBeInTheDocument();
    expect(screen.getByText("resume.pdf")).toBeInTheDocument();
    expect(apiMocks.createSharePackage).toHaveBeenCalledWith(
      expect.objectContaining({
        resume_id: 7,
        permission: "read_only",
        redact_options: expect.objectContaining({ mask_name: true, mask_company: true }),
      }),
    );
  });

  it("默认勾选「包含照片」，请求体带 include_photo: true", async () => {
    renderModal();

    const photo = screen.getByRole("checkbox", { name: "包含照片" }) as HTMLInputElement;
    expect(photo.checked).toBe(true);
    // 格式开关本批不做：固定两份产物要写清楚，用户不会以为能只出 PDF。
    expect(screen.getByText(/分享包固定包含 HTML 与 PDF/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "生成分享包" }));

    await waitFor(() =>
      expect(apiMocks.createSharePackage).toHaveBeenCalledWith(
        expect.objectContaining({ include_photo: true }),
      ),
    );
  });

  it("取消勾选后请求体带 include_photo: false", async () => {
    renderModal();
    // 脱敏范围里也有勾选框，按名字精确取「包含照片」这一个。
    fireEvent.click(screen.getByRole("checkbox", { name: "包含照片" }));

    fireEvent.click(screen.getByRole("button", { name: "生成分享包" }));

    await waitFor(() =>
      expect(apiMocks.createSharePackage).toHaveBeenCalledWith(
        expect.objectContaining({ include_photo: false }),
      ),
    );
  });

  it("下载文件走下载接口并触发浏览器下载", async () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "生成分享包" }));
    await screen.findByText("token123");

    fireEvent.click(screen.getByRole("button", { name: "resume.html" }));

    await waitFor(() =>
      expect(apiMocks.downloadSharePackageFile).toHaveBeenCalledWith(1, "resume.html"),
    );
    expect(downloadMocks.downloadBlob).toHaveBeenCalledTimes(1);
  });

  it("comment 权限生成后导入回传评论", async () => {
    apiMocks.createSharePackage.mockResolvedValue(COMMENT);
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "生成分享包" }));
    expect(await screen.findByText("初始评论")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("评论回传内容"), {
      target: { value: "新评论" },
    });
    fireEvent.click(screen.getByRole("button", { name: "导入评论" }));

    await waitFor(() =>
      expect(apiMocks.importSharePackageComments).toHaveBeenCalledWith(2, {
        content: "新评论",
        format: "markdown",
      }),
    );
  });

  it("删除分享包需二次确认，确认后走删除接口并清空结果", async () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "生成分享包" }));
    await screen.findByText("token123");

    // 删除收进了「···」菜单：打开菜单 → 点删除 → 确认（无 locale 时确认键是 "OK"）。
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(await screen.findByText("删除此分享包"));
    fireEvent.click(await screen.findByRole("button", { name: "OK" }));

    await waitFor(() => expect(apiMocks.deleteSharePackage).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.queryByText("token123")).not.toBeInTheDocument());
  });

  it("展示使用说明，可打开所在文件夹并复制路径", async () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "生成分享包" }));
    await screen.findByText("token123");

    expect(screen.getByText(/把整个文件夹发给对方/)).toBeInTheDocument();
    expect(screen.getByText("使用说明")).toBeInTheDocument();
    // R3：不再写「以 PDF 为准」这种过度保守的说法，也不写死「HTML 已内嵌字体」。
    expect(screen.getByText(/HTML 与 PDF 由同一份版式生成/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /打开所在文件夹/ }));
    await waitFor(() => expect(apiMocks.revealSharePackage).toHaveBeenCalledWith(1));

    fireEvent.click(screen.getByRole("button", { name: /复制路径/ }));
    await waitFor(() => expect(clipboardMocks.copyText).toHaveBeenCalledWith("C:\\tmp\\share\\1"));
  });

  it("生成前不编造体积，只说明里面有什么", () => {
    renderModal();

    expect(screen.getByText(/生成后在这里显示实际体积/)).toBeInTheDocument();
    expect(screen.queryByText("预计体积")).toBeNull();
  });

  it("生成后按后端文件清单的实际大小给出预计体积", async () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "生成分享包" }));
    await screen.findByText("token123");

    expect(screen.getByText("预计体积")).toBeInTheDocument();
    // 100 B + 200 B，条目数同样取自后端清单。
    expect(screen.getByText("约 300 B（2 个文件）")).toBeInTheDocument();
  });
});
