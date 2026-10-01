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
  apiMocks.getAssistantOrbSetting.mockResolvedValue({ enabled: true });
  apiMocks.saveAssistantOrbSetting.mockImplementation(async (enabled) => ({ enabled }));
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

    await waitFor(() => expect(apiMocks.saveAssistantOrbSetting).toHaveBeenCalledWith(false));
  });

  it("rolls back the switch when saving fails", async () => {
    apiMocks.saveAssistantOrbSetting.mockRejectedValue(new Error("保存失败"));
    renderCard();

    const toggle = await screen.findByRole("switch", { name: "开启投投悬浮球" });
    await waitFor(() => expect(toggle).toBeChecked());
    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).toBeChecked());
  });
});
