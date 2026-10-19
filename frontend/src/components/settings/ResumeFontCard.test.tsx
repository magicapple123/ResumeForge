/**
 * 简历字体卡（R10）：上传 → 设为当前 → 删除。
 *
 * 关键边界是"预览、HTML 与 PDF 同一款字"，界面上必须写明（旧文案说"只影响 PDF"，
 * 会让用户以为预览没变是 bug）；以及删除当前字体后要回到系统字体。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResumeFontCard from "./ResumeFontCard";

const apiMocks = vi.hoisted(() => ({
  listResumeFonts: vi.fn(),
  uploadResumeFont: vi.fn(),
  activateResumeFont: vi.fn(),
  deleteResumeFont: vi.fn(),
}));

vi.mock("../../api/settings", () => apiMocks);

const FONT = {
  name: "思源黑体.ttf",
  size: 1024 * 1024,
  uploaded_at: "2026-10-19T10:00:00",
  active: false,
};

function renderCard() {
  return render(
    <AntdApp>
      <ResumeFontCard />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.listResumeFonts
    .mockReset()
    .mockResolvedValue({ items: [], active: null, max_bytes: 20971520 });
  apiMocks.uploadResumeFont.mockReset();
  apiMocks.activateResumeFont.mockReset().mockResolvedValue({ active: "思源黑体.ttf" });
  apiMocks.deleteResumeFont.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumeFontCard", () => {
  it("写明预览、HTML 与 PDF 用同一款字，避免「预览没变」被当成 bug", async () => {
    renderCard();
    expect(await screen.findByText(/用于预览、HTML 与 PDF/)).toBeInTheDocument();
    expect(screen.queryByText(/只影响 PDF 导出/)).not.toBeInTheDocument();
  });

  it("列表里显示当前使用，并可设为当前", async () => {
    apiMocks.listResumeFonts.mockResolvedValue({
      items: [FONT],
      active: null,
      max_bytes: 20971520,
    });
    renderCard();

    expect(await screen.findByText("思源黑体.ttf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /设为当前/ }));

    await waitFor(() => expect(apiMocks.activateResumeFont).toHaveBeenCalledWith("思源黑体.ttf"));
  });

  it("当前字体所在行的「设为当前」不可点，且可以从系统字体切回", async () => {
    apiMocks.listResumeFonts.mockResolvedValue({
      items: [{ ...FONT, active: true }],
      active: FONT.name,
      max_bytes: 20971520,
    });
    renderCard();

    expect(await screen.findByText("当前使用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /设为当前/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /回到系统字体/ }));
    await waitFor(() => expect(apiMocks.activateResumeFont).toHaveBeenCalledWith(null));
  });
});
