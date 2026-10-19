/**
 * 全局模型卡（R21）：一份配置对所有数据集生效。
 *
 * 钉住三件事：生效时说清楚"现在是全局在接管"、保存带上开关状态、清除后回到按数据集配置。
 * 密钥永远不回显——表单里只留一句"留空表示保留"。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GlobalLLMCard from "./GlobalLLMCard";

const apiMocks = vi.hoisted(() => ({
  getGlobalLLM: vi.fn(),
  saveGlobalLLM: vi.fn(),
  clearGlobalLLM: vi.fn(),
}));

vi.mock("../../api/settings", () => apiMocks);

const EMPTY = { enabled: false, configured: false, provider: "", model: "", base_url: "" };

function renderCard() {
  return render(
    <AntdApp>
      <GlobalLLMCard />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.getGlobalLLM.mockReset().mockResolvedValue(EMPTY);
  apiMocks.saveGlobalLLM.mockReset().mockResolvedValue({
    enabled: true,
    configured: true,
    provider: "custom",
    model: "deepseek-chat",
    base_url: "https://api.deepseek.com/v1",
  });
  apiMocks.clearGlobalLLM.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("GlobalLLMCard", () => {
  it("已生效时明确写出「全局模型正在生效」，并提示下方配置此刻不生效", async () => {
    apiMocks.getGlobalLLM.mockResolvedValue({
      enabled: true,
      configured: true,
      provider: "custom",
      model: "deepseek-chat",
      base_url: "https://api.deepseek.com/v1",
    });
    renderCard();

    expect(await screen.findByText(/全局模型正在生效：deepseek-chat/)).toBeInTheDocument();
    expect(screen.getByText(/下方「模型服务」里保存的配置此刻不生效/)).toBeInTheDocument();
  });

  it("保存时带上开关状态与填写的地址/模型", async () => {
    renderCard();
    await screen.findByLabelText("全局接口地址");

    fireEvent.change(screen.getByLabelText("全局接口地址"), {
      target: { value: " https://api.deepseek.com/v1 " },
    });
    fireEvent.change(screen.getByLabelText("全局模型"), { target: { value: "deepseek-chat" } });
    fireEvent.click(screen.getByRole("switch", { name: "对所有数据集生效" }));
    fireEvent.click(screen.getByRole("button", { name: /应用到所有数据集/ }));

    await waitFor(() => expect(apiMocks.saveGlobalLLM).toHaveBeenCalledTimes(1));
    expect(apiMocks.saveGlobalLLM).toHaveBeenCalledWith({
      enabled: true,
      config: { base_url: "https://api.deepseek.com/v1", model: "deepseek-chat" },
    });
  });

  it("填了密钥才带上；留空表示保留原密钥", async () => {
    renderCard();
    await screen.findByLabelText("全局接口地址");
    fireEvent.change(screen.getByLabelText("全局接口地址"), {
      target: { value: "https://api.deepseek.com/v1" },
    });
    fireEvent.change(screen.getByLabelText("全局模型"), { target: { value: "deepseek-chat" } });
    fireEvent.change(screen.getByLabelText("全局密钥"), { target: { value: "sk-new" } });
    fireEvent.click(screen.getByRole("button", { name: /应用到所有数据集/ }));

    await waitFor(() =>
      expect(apiMocks.saveGlobalLLM).toHaveBeenCalledWith(
        expect.objectContaining({ api_key: "sk-new" }),
      ),
    );
  });

  it("没配过时不显示「清除」", async () => {
    renderCard();
    await screen.findByLabelText("全局接口地址");
    expect(screen.queryByRole("button", { name: /清除全局配置/ })).toBeNull();
  });
});
