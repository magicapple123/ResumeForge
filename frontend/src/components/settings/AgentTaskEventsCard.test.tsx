// SPDX-License-Identifier: Apache-2.0
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import AgentTaskEventsCard from "./AgentTaskEventsCard";

const apiMocks = vi.hoisted(() => ({
  getAgentTaskEvents: vi.fn(),
  setAgentTaskEvents: vi.fn(),
}));

vi.mock("../../api/settings", () => apiMocks);

afterEach(() => cleanup());

beforeEach(() => {
  apiMocks.getAgentTaskEvents.mockResolvedValue({ enabled: false });
  apiMocks.setAgentTaskEvents.mockImplementation(async (setting: { enabled: boolean }) => setting);
});

function renderCard() {
  return render(
    <AntdApp>
      <AgentTaskEventsCard />
    </AntdApp>,
  );
}

// 断言文案一律走 t()：cjkRatchet 规定测试里的 ByText 中文断言行数只能降不能升。
async function findToggle() {
  const toggle = await screen.findByRole("switch", {
    name: t("settingsUi.agentTaskEvents.toggleAria"),
  });
  await waitFor(() => expect(toggle).not.toBeDisabled());
  return toggle;
}

describe("AgentTaskEventsCard", () => {
  it("默认关闭态：写明只建卡、不执行写操作，且已生成的卡保留", async () => {
    renderCard();

    const toggle = await findToggle();
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(t("settingsUi.agentTaskEvents.intro"))).toBeInTheDocument();
    expect(screen.getByText(t("settingsUi.agentTaskEvents.stateOff"))).toBeInTheDocument();
    expect(screen.getByText(t("settingsUi.agentTaskEvents.keepCards"))).toBeInTheDocument();
  });

  it("开启后调用 PUT 并同步状态与成功提示", async () => {
    apiMocks.setAgentTaskEvents.mockResolvedValue({ enabled: true });
    renderCard();

    const toggle = await findToggle();
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(apiMocks.setAgentTaskEvents).toHaveBeenCalledWith({ enabled: true }),
    );
    expect(await screen.findByText(t("settingsUi.agentTaskEvents.stateOn"))).toBeInTheDocument();
    expect(
      await screen.findByText(t("settingsUi.agentTaskEvents.enableToast")),
    ).toBeInTheDocument();
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("保存失败时回滚开关并提示失败原因", async () => {
    apiMocks.setAgentTaskEvents.mockRejectedValue(new Error("save failed"));
    renderCard();

    const toggle = await findToggle();
    fireEvent.click(toggle);

    expect(await screen.findByText("save failed")).toBeInTheDocument();
    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  it("读取失败显示错误态，重试成功后展示开关", async () => {
    apiMocks.getAgentTaskEvents.mockRejectedValueOnce(new Error("network error"));
    apiMocks.getAgentTaskEvents.mockResolvedValueOnce({ enabled: true });
    renderCard();

    expect(await screen.findByText(t("settingsUi.agentTaskEvents.loadFailed"))).toBeInTheDocument();
    // antd 会在两个汉字的按钮文案中间插入空格（重 试），用正则匹配更稳。
    const retryName = new RegExp(t("common.retry").split("").join("\\s*"));
    fireEvent.click(screen.getByRole("button", { name: retryName }));

    const toggle = await screen.findByRole("switch", {
      name: t("settingsUi.agentTaskEvents.toggleAria"),
    });
    await waitFor(() => expect(toggle).toBeChecked());
    expect(apiMocks.getAgentTaskEvents).toHaveBeenCalledTimes(2);
  });
});
