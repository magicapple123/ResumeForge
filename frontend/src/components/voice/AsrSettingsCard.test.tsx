// SPDX-License-Identifier: Apache-2.0
/** 设置页「语音转写」卡：读取掩码、保存、测试连接、清除 Key。 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";

const apiMocks = vi.hoisted(() => ({
  getAsrSettings: vi.fn(),
  saveAsrSettings: vi.fn(),
  testAsrSettings: vi.fn(),
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
  configured: true,
};

function renderCard() {
  return render(
    <AntdApp>
      <AsrSettingsCard />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.getAsrSettings.mockResolvedValue(SAVED);
  apiMocks.saveAsrSettings.mockImplementation(async (payload: { api_key: string }) => ({
    ...payload,
    api_key: payload.api_key === "__clear__" ? "" : "********",
    configured: payload.api_key !== "__clear__",
  }));
  apiMocks.testAsrSettings.mockResolvedValue({ ok: true, message: "连接成功" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AsrSettingsCard", () => {
  it("读取已保存配置：Key 显示为掩码、状态为已配置", async () => {
    renderCard();
    const address = await screen.findByLabelText(t("voiceInput.settings.baseUrl.aria"));
    expect((address as HTMLInputElement).value).toBe(SAVED.base_url);
    expect(
      (screen.getByLabelText(t("voiceInput.settings.key.aria")) as HTMLInputElement).value,
    ).toBe("********");
    expect(screen.getByText(t("voiceInput.settings.badge.configured"))).toBeInTheDocument();
  });

  it("保存时提交表单当前值（Key 掩码原样回传，由后端保留旧 Key）", async () => {
    renderCard();
    await screen.findByLabelText(t("voiceInput.settings.baseUrl.aria"));
    // antd 会给两个汉字的按钮文案自动插一个空格（「保 存」），所以可访问名用正则。
    const saveName = new RegExp("^" + [...t("voiceInput.settings.save")].join("\\s*") + "$");
    fireEvent.click(screen.getByRole("button", { name: saveName }));
    await waitFor(() => expect(apiMocks.saveAsrSettings).toHaveBeenCalledTimes(1));
    expect(apiMocks.saveAsrSettings).toHaveBeenCalledWith({
      base_url: SAVED.base_url,
      model: SAVED.model,
      api_key: "********",
    });
  });

  it("测试连接：结果用 Alert 展示，失败也给出原因", async () => {
    apiMocks.testAsrSettings.mockResolvedValue({ ok: false, message: "auth-failed" });
    renderCard();
    await screen.findByLabelText(t("voiceInput.settings.baseUrl.aria"));
    fireEvent.click(screen.getByRole("button", { name: t("voiceInput.settings.test") }));
    await waitFor(() => expect(apiMocks.testAsrSettings).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/auth-failed/)).toBeInTheDocument();
  });

  it("清除已保存的 Key 发送 __clear__ 哨兵", async () => {
    renderCard();
    await screen.findByLabelText(t("voiceInput.settings.key.aria"));
    fireEvent.click(screen.getByRole("button", { name: t("voiceInput.settings.key.clear") }));
    await waitFor(() => expect(apiMocks.saveAsrSettings).toHaveBeenCalledTimes(1));
    expect(apiMocks.saveAsrSettings.mock.calls[0]?.[0]).toMatchObject({
      api_key: "__clear__",
    });
  });

  it("读取失败时给出可读警告，并显示空配置", async () => {
    apiMocks.getAsrSettings.mockRejectedValue(new Error("backend-down"));
    renderCard();
    expect(await screen.findByText(/backend-down/)).toBeInTheDocument();
    expect(screen.getByText(t("voiceInput.settings.badge.notConfigured"))).toBeInTheDocument();
  });

  it("已配置时显示音频会发到哪个主机", async () => {
    renderCard();
    await screen.findByLabelText(t("voiceInput.settings.baseUrl.aria"));
    expect(screen.getByText(/api\.groq\.com/)).toBeInTheDocument();
  });
});
