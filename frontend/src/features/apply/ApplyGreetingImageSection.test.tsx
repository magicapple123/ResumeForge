// SPDX-License-Identifier: Apache-2.0
/**
 * T8「招呼语配图」设置区块的单测：默认关、保存的是"开关 + 哪张图"、没有可选图时的指引。
 *
 * 三条判据钉的是**行为**而不是按钮存不存在：
 * 1. 首次打开开关是关的（发图不可撤回，默认必须是最保守的一档）；
 * 2. 保存发出去的是 `{enabled, image_id}` 两个字段，走自己的端点，不混进 `/apply/config`；
 * 3. 「我的文件」里没有图片时不假装能选，而给一句"先去上传"的指引。
 *
 * 断言用的字符串（`cover.png` 之类）都是**测试数据**：产品文案一律通过 `t()` 取，
 * 语言包改词不会让这条用例变红。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getApplyGreetingImage: vi.fn(),
  saveApplyGreetingImage: vi.fn(),
}));

vi.mock("../../api/applyExtras", () => ({
  getApplyGreetingImage: apiMocks.getApplyGreetingImage,
  saveApplyGreetingImage: apiMocks.saveApplyGreetingImage,
}));

import { t } from "../../i18n";
import ApplyGreetingImageSection from "./ApplyGreetingImageSection";

const IMAGE = { id: 7, name: "cover.png", size_bytes: 2048 };

/** 出厂状态：关 + 没有默认图，但「我的文件」里有一张可选。 */
const SETTINGS_OFF = {
  enabled: false,
  image_id: null,
  max_count: 4,
  max_image_bytes: 2 * 1024 * 1024,
  max_total_bytes: 5 * 1024 * 1024,
  options: [IMAGE],
};

const EMPTY_OPTIONS = { ...SETTINGS_OFF, options: [] };

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getApplyGreetingImage.mockResolvedValue(SETTINGS_OFF);
  apiMocks.saveApplyGreetingImage.mockImplementation((payload) =>
    Promise.resolve({ ...SETTINGS_OFF, ...payload }),
  );
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderSection() {
  return render(
    <AntdApp>
      <ApplyGreetingImageSection />
    </AntdApp>,
  );
}

describe("ApplyGreetingImageSection", () => {
  it("首次打开是关的：不可撤回的外发内容必须由用户显式打开", async () => {
    renderSection();

    const toggle = await screen.findByRole("switch", {
      name: t("applySettings.image.enabledLabel"),
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("打开开关后保存发送 enabled=true，且只发两个可编辑字段", async () => {
    renderSection();

    fireEvent.click(
      await screen.findByRole("switch", { name: t("applySettings.image.enabledLabel") }),
    );
    fireEvent.click(screen.getByRole("button", { name: t("applySettings.image.save") }));

    await waitFor(() => expect(apiMocks.saveApplyGreetingImage).toHaveBeenCalledTimes(1));
    expect(apiMocks.saveApplyGreetingImage).toHaveBeenCalledWith({
      enabled: true,
      image_id: null,
    });
  });

  it("回包里的默认图会原样回传（回显就是保存值，不额外改写）", async () => {
    apiMocks.getApplyGreetingImage.mockResolvedValue({ ...SETTINGS_OFF, image_id: IMAGE.id });
    renderSection();

    await screen.findByRole("switch", { name: t("applySettings.image.enabledLabel") });
    fireEvent.click(screen.getByRole("button", { name: t("applySettings.image.save") }));

    await waitFor(() => expect(apiMocks.saveApplyGreetingImage).toHaveBeenCalledTimes(1));
    expect(apiMocks.saveApplyGreetingImage).toHaveBeenCalledWith({
      enabled: false,
      image_id: IMAGE.id,
    });
  });

  it("开了开关却没选图：当场说明「没选图的岗位仍只发文本」", async () => {
    renderSection();

    await screen.findByRole("switch", { name: t("applySettings.image.enabledLabel") });
    expect(screen.queryByText(t("applySettings.image.needImage"))).toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: t("applySettings.image.enabledLabel") }));

    expect(await screen.findByText(t("applySettings.image.needImage"))).toBeInTheDocument();
  });

  it("没有可选图片时给出「先去上传」的指引，而不是一个空下拉", async () => {
    apiMocks.getApplyGreetingImage.mockResolvedValue(EMPTY_OPTIONS);
    renderSection();

    expect(await screen.findByText(t("applySettings.image.empty"))).toBeInTheDocument();
    // 额度提示用的是后端下发的数字（2.0 MB / 4 张），前端不写死第二份。
    expect(screen.getByText(/2\.0 MB/)).toBeInTheDocument();
  });

  it("读取失败时不让整块消失：错误提示照常出现", async () => {
    apiMocks.getApplyGreetingImage.mockRejectedValue(new Error("boom"));
    renderSection();

    expect(await screen.findByText(t("applySettings.image.loadFailed"))).toBeInTheDocument();
  });
});
