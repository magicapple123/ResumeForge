import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AssistantRelaxedModeCard from "./AssistantRelaxedModeCard";

const apiMocks = vi.hoisted(() => ({
  getAssistantRelaxedMode: vi.fn(),
  saveAssistantRelaxedMode: vi.fn(),
}));

vi.mock("../../api/settings", () => apiMocks);

afterEach(() => cleanup());

beforeEach(() => {
  apiMocks.getAssistantRelaxedMode.mockResolvedValue({ enabled: false });
  apiMocks.saveAssistantRelaxedMode.mockImplementation(
    async (setting: { enabled: boolean }) => setting,
  );
});

function renderCard() {
  return render(
    <AntdApp>
      <AssistantRelaxedModeCard />
    </AntdApp>,
  );
}

describe("AssistantRelaxedModeCard", () => {
  it("默认关闭态：提前告知解锁范围与凭据边界", async () => {
    renderCard();

    const toggle = await screen.findByRole("switch", { name: "求职助手放宽模式" });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).not.toBeChecked();
    // 提前告知：默认态就写明开启后会读到什么
    expect(screen.getByText(/开启前请知悉/)).toBeInTheDocument();
    expect(screen.getByText(/任何模式下都不会发送：API 密钥/)).toBeInTheDocument();
  });

  it("开启后状态与提示同步为已解锁，并调用保存", async () => {
    apiMocks.saveAssistantRelaxedMode.mockResolvedValue({ enabled: true });
    renderCard();

    const toggle = await screen.findByRole("switch", { name: "求职助手放宽模式" });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(apiMocks.saveAssistantRelaxedMode).toHaveBeenCalledWith({ enabled: true }),
    );
    expect(await screen.findByText(/已开启：助手可以读取完整资料/)).toBeInTheDocument();
  });

  it("关闭回默认态并保存", async () => {
    apiMocks.getAssistantRelaxedMode.mockResolvedValue({ enabled: true });
    renderCard();

    const toggle = await screen.findByRole("switch", { name: "求职助手放宽模式" });
    await waitFor(() => expect(toggle).toBeChecked());
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(apiMocks.saveAssistantRelaxedMode).toHaveBeenCalledWith({ enabled: false }),
    );
    expect(await screen.findByText(/开启前请知悉/)).toBeInTheDocument();
  });

  it("保存失败时回滚开关并提示", async () => {
    apiMocks.saveAssistantRelaxedMode.mockRejectedValue(new Error("保存失败"));
    renderCard();

    const toggle = await screen.findByRole("switch", { name: "求职助手放宽模式" });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    fireEvent.click(toggle);

    expect(await screen.findByText("保存失败")).toBeInTheDocument();
    await waitFor(() => expect(toggle).not.toBeChecked());
  });
});
