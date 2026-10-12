/** 简历照片面板：上传进度条的出现→推进→消失（C2 XHR 进度上传接线）。 */

import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfilePhotoPanel from "./ProfilePhotoPanel";

const apiMocks = vi.hoisted(() => ({
  listProfilePhotos: vi.fn(),
  createProfilePhoto: vi.fn(),
  updateProfilePhoto: vi.fn(),
  deleteProfilePhoto: vi.fn(),
}));

vi.mock("../../api/photo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/photo")>()),
  listProfilePhotos: apiMocks.listProfilePhotos,
  createProfilePhoto: apiMocks.createProfilePhoto,
  updateProfilePhoto: apiMocks.updateProfilePhoto,
  deleteProfilePhoto: apiMocks.deleteProfilePhoto,
}));

// 读文件是 FileReader 路径，与本测试无关：桩成即刻完成的 data URL。
vi.mock("../../utils/attachments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/attachments")>()),
  readAsDataUrl: vi.fn().mockResolvedValue("data:image/png;base64,AA=="),
}));

function renderPanel() {
  return render(
    <AntdApp>
      <ProfilePhotoPanel activePhoto="" onSelect={vi.fn()} />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.listProfilePhotos.mockReset().mockResolvedValue([]);
  apiMocks.createProfilePhoto.mockReset();
  apiMocks.updateProfilePhoto.mockReset();
  apiMocks.deleteProfilePhoto.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ProfilePhotoPanel 上传进度（C2）", () => {
  it("上传中进度条出现并随 onProgress 推进，完成后消失", async () => {
    // 用未 resolve 的 Promise 托住上传，模拟 XHR 的 upload.onprogress 事件序列。
    let reportProgress: ((percent: number) => void) | undefined;
    apiMocks.createProfilePhoto.mockImplementation(
      (_image: string, _name: string, onProgress?: (percent: number) => void) => {
        reportProgress = onProgress;
        return new Promise(() => {});
      },
    );
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /选择照片/ }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(["png"], "photo.png", { type: "image/png" })] },
    });

    await waitFor(() => expect(apiMocks.createProfilePhoto).toHaveBeenCalledOnce());
    expect(reportProgress).toBeTypeOf("function");
    await waitFor(() => expect(screen.getByRole("progressbar")).toBeInTheDocument());

    reportProgress!(40);
    await waitFor(() =>
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40"),
    );
    reportProgress!(100);
    await waitFor(() =>
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100"),
    );
  });

  it("上传成功后进度条回到 null（消失），并提示已保存", async () => {
    apiMocks.createProfilePhoto.mockResolvedValue({
      id: 1,
      name: "photo",
      image: "data:image/png;base64,AA==",
      is_primary: true,
    });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /选择照片/ }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(["png"], "photo.png", { type: "image/png" })] },
    });

    expect(await screen.findByText("照片已保存，可在下方切换使用哪一张")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
  });
});
