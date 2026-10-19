/**
 * 全局模型卡（R21）：多套 profile 的列表、新增、编辑、删除与切换。
 *
 * 钉住四件事：列表如实显示当前/默认；新增走 profiles 接口；编辑留空密钥表示保留；
 * 删除与"设为当前"分别命中对应接口。密钥永远不回显。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GlobalLLMCard from "./GlobalLLMCard";

const apiMocks = vi.hoisted(() => ({
  getGlobalLLM: vi.fn(),
  saveGlobalLLM: vi.fn(),
  clearGlobalLLM: vi.fn(),
  createGlobalLLMProfile: vi.fn(),
  updateGlobalLLMProfile: vi.fn(),
  deleteGlobalLLMProfile: vi.fn(),
  activateGlobalLLMProfile: vi.fn(),
}));

vi.mock("../../api/settings", () => apiMocks);

const profile = (overrides: Record<string, unknown> = {}) => ({
  id: "p_1",
  name: "DeepSeek 日常",
  provider: "custom",
  model: "deepseek-chat",
  base_url: "https://api.deepseek.com/v1",
  configured: true,
  is_default: true,
  ...overrides,
});

const EMPTY = {
  enabled: false,
  configured: false,
  provider: "",
  model: "",
  base_url: "",
  active_profile_id: "",
  active_name: "",
  profiles: [],
};

const TWO_PROFILES = {
  enabled: true,
  configured: true,
  provider: "custom",
  model: "deepseek-chat",
  base_url: "https://api.deepseek.com/v1",
  active_profile_id: "p_1",
  active_name: "DeepSeek 日常",
  profiles: [
    profile(),
    profile({
      id: "p_2",
      name: "便宜模型",
      model: "deepseek-lite",
      base_url: "https://b.example/v1",
      is_default: false,
    }),
  ],
};

function renderCard() {
  return render(
    <AntdApp>
      <GlobalLLMCard />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.getGlobalLLM.mockReset().mockResolvedValue(EMPTY);
  apiMocks.saveGlobalLLM.mockReset().mockResolvedValue(EMPTY);
  apiMocks.clearGlobalLLM.mockReset().mockResolvedValue(undefined);
  apiMocks.createGlobalLLMProfile.mockReset().mockResolvedValue(TWO_PROFILES);
  apiMocks.updateGlobalLLMProfile.mockReset().mockResolvedValue(TWO_PROFILES);
  apiMocks.deleteGlobalLLMProfile.mockReset().mockResolvedValue(TWO_PROFILES);
  apiMocks.activateGlobalLLMProfile.mockReset().mockResolvedValue(TWO_PROFILES);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("GlobalLLMCard", () => {
  it("列出所有配置，并标明当前与默认", async () => {
    apiMocks.getGlobalLLM.mockResolvedValue(TWO_PROFILES);
    renderCard();

    expect(await screen.findByText("DeepSeek 日常")).toBeInTheDocument();
    expect(screen.getByText("便宜模型")).toBeInTheDocument();
    expect(screen.getByText("当前")).toBeInTheDocument();
    expect(screen.getByText("默认")).toBeInTheDocument();
    expect(screen.getByText(/全局模型正在生效：DeepSeek 日常 · deepseek-chat/)).toBeInTheDocument();
    expect(screen.getByText(/下方「模型服务」里保存的配置此刻不生效/)).toBeInTheDocument();
  });

  it("新增配置走 profiles 接口，名称与地址模型一起提交", async () => {
    renderCard();
    await screen.findByText(/还没有全局模型配置/);

    fireEvent.click(screen.getByRole("button", { name: /新\s*增/ }));
    fireEvent.change(screen.getByLabelText("配置名称"), { target: { value: " 新配置 " } });
    fireEvent.change(screen.getByLabelText("接口地址"), {
      target: { value: "https://api.example.com/v1 " },
    });
    fireEvent.change(screen.getByLabelText("模型"), { target: { value: "example-model" } });
    fireEvent.change(screen.getByLabelText("密钥"), { target: { value: "sk-new" } });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));

    await waitFor(() => expect(apiMocks.createGlobalLLMProfile).toHaveBeenCalledTimes(1));
    expect(apiMocks.createGlobalLLMProfile).toHaveBeenCalledWith({
      name: "新配置",
      config: { base_url: "https://api.example.com/v1", model: "example-model" },
      api_key: "sk-new",
    });
  });

  it("编辑留空密钥时不提交 api_key，避免把已存密钥覆盖成空", async () => {
    apiMocks.getGlobalLLM.mockResolvedValue(TWO_PROFILES);
    renderCard();
    await screen.findByText("DeepSeek 日常");

    const editButtons = screen.getAllByRole("button", { name: /编\s*辑/ });
    fireEvent.click(editButtons[0]);
    const modelInput = await screen.findByLabelText("模型");
    fireEvent.change(modelInput, { target: { value: "deepseek-chat-v2" } });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));

    await waitFor(() => expect(apiMocks.updateGlobalLLMProfile).toHaveBeenCalledTimes(1));
    expect(apiMocks.updateGlobalLLMProfile).toHaveBeenCalledWith("p_1", {
      name: "DeepSeek 日常",
      config: {
        base_url: "https://api.deepseek.com/v1",
        model: "deepseek-chat-v2",
        provider: "custom",
      },
    });
  });

  it("设为当前调用 activate 接口", async () => {
    apiMocks.getGlobalLLM.mockResolvedValue(TWO_PROFILES);
    renderCard();
    await screen.findByText("便宜模型");

    fireEvent.click(screen.getByRole("button", { name: "设为当前" }));

    await waitFor(() => expect(apiMocks.activateGlobalLLMProfile).toHaveBeenCalledWith("p_2"));
  });

  it("删除先二次确认，再按 id 调删除接口", async () => {
    apiMocks.getGlobalLLM.mockResolvedValue(TWO_PROFILES);
    renderCard();
    await screen.findByText("便宜模型");

    const deleteButtons = screen.getAllByRole("button", { name: /删\s*除/ });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    const dialogs = await screen.findAllByRole("dialog");
    const confirm = dialogs[dialogs.length - 1];
    fireEvent.click(within(confirm).getByRole("button", { name: /删\s*除/ }));

    await waitFor(() => expect(apiMocks.deleteGlobalLLMProfile).toHaveBeenCalledWith("p_2"));
  });
});
