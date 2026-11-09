// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「语音转写」卡：读取掩码、厂商切换、协议、保存、测试连接、拉取模型、清除 Key。
 *
 * 断言一律走 `t()`：中文写进 `getByText` 会撞 i18n 棘轮（本文件基线为 0）。
 *
 * 覆盖的重点是「UI 改造不丢功能」（问题清单 03 的功能保全清单）：
 * 掩码回显与留空不修改、测试连接与耗时、10 MB / 3 分钟提示、隐私主机提示、未配置徽标，
 * 以及新增的厂商预设与「···」里的清除 Key。
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";

const apiMocks = vi.hoisted(() => ({
  getAsrSettings: vi.fn(),
  saveAsrSettings: vi.fn(),
  testAsrSettings: vi.fn(),
  fetchAsrModels: vi.fn(),
  providerHostOf: vi.fn((baseUrl: string) => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return "";
    }
  }),
}));

vi.mock("./asrApi", () => ({
  ...apiMocks,
  CLEAR_ASR_KEY: "__clear__",
}));

import AsrSettingsCard from "./AsrSettingsCard";

const SAVED = {
  base_url: "https://api.groq.com/openai/v1",
  api_key: "********",
  model: "whisper-large-v3",
  protocol: "openai",
  configured: true,
};

const DASHSCOPE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

function renderCard() {
  return render(
    <AntdApp>
      <AsrSettingsCard />
    </AntdApp>,
  );
}

async function waitLoaded() {
  await screen.findByLabelText(t("voiceInput.settings.baseUrl.aria"));
}

/** 厂商网格是独立的一组 radio：协议那组也有同名的「阿里云百炼」，必须按组取。 */
function providerGrid() {
  return screen.getByRole("radiogroup", { name: t("voiceInput.settings.provider.aria") });
}

beforeEach(() => {
  apiMocks.getAsrSettings.mockReset().mockResolvedValue(SAVED);
  apiMocks.saveAsrSettings.mockReset().mockImplementation(async (payload: { api_key: string }) => ({
    ...payload,
    api_key: payload.api_key === "__clear__" ? "" : "********",
    configured: payload.api_key !== "__clear__",
  }));
  apiMocks.testAsrSettings.mockReset().mockResolvedValue({ ok: true, message: "ok" });
  apiMocks.fetchAsrModels.mockReset().mockResolvedValue({ models: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AsrSettingsCard", () => {
  it("读取已保存配置：Key 显示为掩码、状态为已配置、显示音频发往的主机", async () => {
    renderCard();
    const address = await screen.findByLabelText(t("voiceInput.settings.baseUrl.aria"));
    expect((address as HTMLInputElement).value).toBe(SAVED.base_url);
    expect(
      (screen.getByLabelText(t("voiceInput.settings.key.aria")) as HTMLInputElement).value,
    ).toBe("********");
    expect(screen.getByText(t("voiceInput.settings.badge.configured"))).toBeInTheDocument();
    expect(screen.getByText(/api\.groq\.com/)).toBeInTheDocument();
  });

  it("保存时提交表单当前值（含 protocol；Key 掩码原样回传）", async () => {
    renderCard();
    await waitLoaded();
    // antd 会给两个汉字的按钮文案自动插一个空格（「保 存」），所以可访问名用正则。
    const saveName = new RegExp("^" + [...t("voiceInput.settings.save")].join("\\s*") + "$");
    fireEvent.click(screen.getByRole("button", { name: saveName }));
    await waitFor(() => expect(apiMocks.saveAsrSettings).toHaveBeenCalledTimes(1));
    expect(apiMocks.saveAsrSettings).toHaveBeenCalledWith({
      base_url: SAVED.base_url,
      model: SAVED.model,
      api_key: "********",
      protocol: "openai",
    });
  });

  it("选中阿里云百炼预设：自动填地址、协议与默认模型", async () => {
    renderCard();
    await waitLoaded();

    fireEvent.click(
      within(providerGrid()).getByRole("radio", {
        name: t("voiceInput.settings.provider.dashscope"),
      }),
    );

    expect(screen.getByLabelText(t("voiceInput.settings.baseUrl.aria"))).toHaveValue(DASHSCOPE_URL);
    expect(screen.getByLabelText(t("voiceInput.settings.model.aria"))).toHaveValue(
      "qwen3-asr-flash",
    );

    const saveName = new RegExp("^" + [...t("voiceInput.settings.save")].join("\\s*") + "$");
    fireEvent.click(screen.getByRole("button", { name: saveName }));
    await waitFor(() => expect(apiMocks.saveAsrSettings).toHaveBeenCalledTimes(1));
    expect(apiMocks.saveAsrSettings.mock.calls[0]?.[0]).toMatchObject({
      base_url: DASHSCOPE_URL,
      model: "qwen3-asr-flash",
      protocol: "dashscope",
    });
  });

  it("切换到自定义后仍可手改协议，且清空上一次的测试结论", async () => {
    apiMocks.testAsrSettings.mockResolvedValue({ ok: true, message: "first-pass" });
    renderCard();
    await waitLoaded();

    fireEvent.click(screen.getByRole("button", { name: t("voiceInput.settings.test") }));
    expect(await screen.findByText(/first-pass/)).toBeInTheDocument();

    fireEvent.click(
      within(providerGrid()).getByRole("radio", { name: t("voiceInput.settings.provider.custom") }),
    );
    // 换服务商/协议后旧结论必须消失：不能把"连接成功"留在错的地址旁边。
    expect(screen.queryByText(/first-pass/)).toBeNull();
  });

  it("选中厂商卡片用主题感知的品牌浅底与 1.5px 主色边框", async () => {
    renderCard();
    await waitLoaded();
    fireEvent.click(
      within(providerGrid()).getByRole("radio", {
        name: t("voiceInput.settings.provider.dashscope"),
      }),
    );

    // 回归点：colorPrimaryBg 是灰的；换成浅色专用 palette.brandTint 后深色主题白底白字。
    // 所以必须引用 CSS 变量（design-tokens.css / dark-tokens.css 各给一套值）。
    const selected = within(providerGrid()).getByRole("radio", {
      name: t("voiceInput.settings.provider.dashscope"),
    });
    const selectedStyle = selected.getAttribute("style") ?? "";
    expect(selectedStyle).toContain("var(--rf-brand-tint)");
    expect(selectedStyle).toContain("var(--rf-brand)");
    expect(selectedStyle).not.toMatch(/#eaf1f8|rgb\(234, 241, 248\)/i);
    expect(getComputedStyle(selected).borderTopWidth).toBe("1.5px");

    const other = within(providerGrid()).getByRole("radio", {
      name: t("voiceInput.settings.provider.custom"),
    });
    expect(other.getAttribute("style") ?? "").toContain("var(--rf-border)");
  });

  it("测试连接：成功文案带耗时", async () => {
    apiMocks.testAsrSettings.mockResolvedValue({ ok: true, latency_ms: 321, message: "ok" });
    renderCard();
    await waitLoaded();
    fireEvent.click(screen.getByRole("button", { name: t("voiceInput.settings.test") }));
    await waitFor(() => expect(apiMocks.testAsrSettings).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(t("voiceInput.settings.testOk", { ms: 321 })),
    ).toBeInTheDocument();
  });

  it("测试连接失败：把原因原样展示", async () => {
    apiMocks.testAsrSettings.mockResolvedValue({ ok: false, message: "auth-failed" });
    renderCard();
    await waitLoaded();
    fireEvent.click(screen.getByRole("button", { name: t("voiceInput.settings.test") }));
    expect(await screen.findByText(/auth-failed/)).toBeInTheDocument();
  });

  it("清除 Key 收进「···」并二次确认，确认后发送 __clear__ 哨兵", async () => {
    renderCard();
    await waitLoaded();

    // 不许再有裸露的红色「清除」按钮。
    expect(screen.queryByRole("button", { name: t("voiceInput.settings.key.clear") })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t("common.rowActions.more") }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: t("voiceInput.settings.key.clear") }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: t("voiceInput.settings.key.clear") }),
    );

    await waitFor(() => expect(apiMocks.saveAsrSettings).toHaveBeenCalledTimes(1));
    expect(apiMocks.saveAsrSettings.mock.calls[0]?.[0]).toMatchObject({
      api_key: "__clear__",
    });
  });

  it("拉取模型列表：成功提示数量，失败只提示不影响手填", async () => {
    apiMocks.fetchAsrModels.mockResolvedValue({ models: ["whisper-large-v3", "gpt-4o"] });
    renderCard();
    await waitLoaded();

    fireEvent.click(screen.getByRole("button", { name: t("voiceInput.settings.model.fetch") }));
    await waitFor(() => expect(apiMocks.fetchAsrModels).toHaveBeenCalledTimes(1));
    expect(apiMocks.fetchAsrModels.mock.calls[0]?.[0]).toMatchObject({ protocol: "openai" });
    expect(
      await screen.findByText(t("voiceInput.settings.model.fetched", { count: 2 })),
    ).toBeInTheDocument();

    // 拉取后出现「显示全部模型」开关，手填仍然可用。
    expect(
      screen.getByRole("checkbox", { name: t("voiceInput.settings.model.showAll") }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(t("voiceInput.settings.model.aria"))).not.toBeDisabled();
  });

  it("拉取模型列表失败：提示可手填，不抛错", async () => {
    apiMocks.fetchAsrModels.mockRejectedValue(new Error("boom"));
    renderCard();
    await waitLoaded();

    fireEvent.click(screen.getByRole("button", { name: t("voiceInput.settings.model.fetch") }));
    expect(await screen.findByText(t("voiceInput.settings.model.fetchFailed"))).toBeInTheDocument();
    expect(screen.getByLabelText(t("voiceInput.settings.model.aria"))).toHaveValue(SAVED.model);
  });

  it("读取失败时给出可读警告，并显示未配置与限额提示", async () => {
    apiMocks.getAsrSettings.mockRejectedValue(new Error("backend-down"));
    renderCard();
    expect(await screen.findByText(/backend-down/)).toBeInTheDocument();
    expect(screen.getByText(t("voiceInput.settings.badge.notConfigured"))).toBeInTheDocument();
    expect(screen.getByText(t("voiceInput.settings.limitHint"))).toBeInTheDocument();
  });
});
