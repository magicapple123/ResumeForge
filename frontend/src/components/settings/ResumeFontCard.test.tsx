// SPDX-License-Identifier: Apache-2.0
/**
 * 简历字体卡（R10）：选用 → 设为当前 → 删除。
 *
 * 关键边界是"预览、HTML 与 PDF 同一款字"，界面上必须写明（旧文案说"只影响 PDF"，
 * 会让用户以为预览没变是 bug）；以及删除当前字体后要回到系统字体。
 *
 * 2026-11：**上传入口下线**。字体只剩两条路——内置的思源黑体（按需下载）与升级前导入的
 * 历史字体。所以这里还钉一条"页面上没有上传按钮"，防止旧入口被合并回来。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import ResumeFontCard from "./ResumeFontCard";

const apiMocks = vi.hoisted(() => ({
  listResumeFonts: vi.fn(),
  uploadResumeFont: vi.fn(),
  activateResumeFont: vi.fn(),
  deleteResumeFont: vi.fn(),
  /** 内置字体状态：默认"还没下载"，于是那一行只出现「下载」，不干扰下面的列表断言。 */
  getBuiltinFont: vi.fn(),
  resumeFontPreviewUrl: vi.fn(
    (name: string) => `/api/settings/fonts/${encodeURIComponent(name)}/file`,
  ),
}));

vi.mock("../../api/settings", () => apiMocks);

/** 内置字体的未下载态（与后端 `GET /settings/fonts/builtin` 同一形状）。 */
const BUILTIN_IDLE = {
  id: "source-han-sans-sc",
  label: "思源黑体",
  size_total: 33493260,
  downloaded: false,
  downloaded_bytes: 0,
  total_bytes: 33493260,
  state: "idle" as const,
  error: "",
};

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
  apiMocks.getBuiltinFont.mockReset().mockResolvedValue(BUILTIN_IDLE);
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

  it("字体上传入口已下线，内置思源黑体那一行常驻", async () => {
    // 后端把内置条目放在 `items` 第 1 位（`builtin: true`）。它必须**只由内置行渲染一次**，
    // 不能同时出现在下面的历史列表里——那里还挂着「删除 / 重命名」，对内置文件没有意义。
    apiMocks.listResumeFonts.mockResolvedValue({
      items: [
        {
          name: "SourceHanSansSC-Regular.otf",
          display_name: "思源黑体",
          size: 33493260,
          uploaded_at: "",
          active: false,
          builtin: true,
          downloaded: true,
        },
        FONT,
      ],
      active: null,
      max_bytes: 20971520,
    });
    renderCard();

    // 内置行：名字 + 体积提示 + 下载按钮（未下载态）。
    expect(await screen.findByText(t("fonts.builtin.name"))).toBeInTheDocument();
    // 名字只出现一次（历史列表里没有重复的第二条内置条目）。
    expect(screen.getAllByText(t("fonts.builtin.name"))).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: t("fonts.builtin.download-aria", { size: "32 MB" }) }),
    ).toBeInTheDocument();
    // 上传按钮与"上传字体"这类说明都不该再出现。
    expect(screen.queryByRole("button", { name: /上传/ })).toBeNull();
    expect(apiMocks.uploadResumeFont).not.toHaveBeenCalled();
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

  it("点字体名先预览，弹窗里可以「设为当前」", async () => {
    apiMocks.listResumeFonts.mockResolvedValue({
      items: [FONT],
      active: null,
      max_bytes: 20971520,
    });
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "思源黑体.ttf" }));

    expect(await screen.findByText(/字体预览「思源黑体.ttf」/)).toBeInTheDocument();
    expect(screen.getByText("张三 · 后端开发工程师")).toBeInTheDocument();
    expect(apiMocks.resumeFontPreviewUrl).toHaveBeenCalledWith("思源黑体.ttf");

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "设为当前" }));
    await waitFor(() => expect(apiMocks.activateResumeFont).toHaveBeenCalledWith("思源黑体.ttf"));
  });

  it("删除收进「···」菜单，并保留二次确认", async () => {
    apiMocks.listResumeFonts.mockResolvedValue({
      items: [FONT],
      active: null,
      max_bytes: 20971520,
    });
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /更多字体操作/ }));
    fireEvent.click(await screen.findByText("删除"));

    // 确认弹窗出现且删除尚未发生（antd 6 的 confirm 标题会渲染两份，用容器断言）。
    await waitFor(() =>
      expect(document.querySelector(".ant-modal-confirm-title")?.textContent).toContain(
        "删除字体「思源黑体.ttf」",
      ),
    );
    expect(apiMocks.deleteResumeFont).not.toHaveBeenCalled();
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
