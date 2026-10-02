import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AssistantOrbCard from "./AssistantOrbCard";

const apiMocks = vi.hoisted(() => ({
  getAssistantOrbSetting: vi.fn(),
  saveAssistantOrbSetting: vi.fn(),
}));

vi.mock("../../api/settings", () => apiMocks);

afterEach(() => cleanup());

beforeEach(() => {
  apiMocks.getAssistantOrbSetting.mockResolvedValue({ enabled: true, tips_enabled: true });
  apiMocks.saveAssistantOrbSetting.mockImplementation(async (setting) => setting);
});

function renderCard() {
  return render(
    <AntdApp>
      <AssistantOrbCard />
    </AntdApp>,
  );
}

describe("AssistantOrbCard", () => {
  it("loads the persisted switch and saves the new value", async () => {
    renderCard();

    const toggle = await screen.findByRole("switch", { name: "开启投投悬浮球" });
    await waitFor(() => expect(toggle).toBeChecked());

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(apiMocks.saveAssistantOrbSetting).toHaveBeenCalledWith({
        enabled: false,
        tips_enabled: true,
      }),
    );
  });

  it("rolls back the switch when saving fails", async () => {
    apiMocks.saveAssistantOrbSetting.mockRejectedValue(new Error("保存失败"));
    renderCard();

    const toggle = await screen.findByRole("switch", { name: "开启投投悬浮球" });
    await waitFor(() => expect(toggle).toBeChecked());
    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("saves the full setting so the two switches never overwrite each other", async () => {
    /** 后端是整份替换语义：关掉标语时必须带上入口开关的当前值，反之亦然。 */
    apiMocks.getAssistantOrbSetting.mockResolvedValue({ enabled: false, tips_enabled: true });
    renderCard();

    const tipsToggle = await screen.findByRole("switch", { name: "开启投投提示标语" });
    await waitFor(() => expect(tipsToggle).toBeChecked());
    const orbToggle = screen.getByRole("switch", { name: "开启投投悬浮球" });
    expect(orbToggle).not.toBeChecked();

    fireEvent.click(tipsToggle);

    await waitFor(() =>
      expect(apiMocks.saveAssistantOrbSetting).toHaveBeenCalledWith({
        enabled: false,
        tips_enabled: false,
      }),
    );
  });

  it("toggling the tips switch does not touch the orb switch state", async () => {
    renderCard();

    const orbToggle = await screen.findByRole("switch", { name: "开启投投悬浮球" });
    const tipsToggle = screen.getByRole("switch", { name: "开启投投提示标语" });
    await waitFor(() => expect(tipsToggle).toBeChecked());

    fireEvent.click(tipsToggle);
    await waitFor(() => expect(tipsToggle).not.toBeChecked());

    expect(orbToggle).toBeChecked();
  });
});
