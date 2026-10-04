import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LLM_PRESETS } from "../config";
import SettingsPage from "./SettingsPage";

// 预设里的模型名会随厂商迭代更新，所以断言对着**定义**取，而不是在测试里再抄一份。
const deepseekPreset = LLM_PRESETS.find((preset) => preset.provider === "deepseek")!;
const claudePreset = LLM_PRESETS.find((preset) => preset.provider === "anthropic")!;

const apiMocks = vi.hoisted(() => ({
  acknowledgeUpdateInstallResult: vi.fn(),
  getAssistantOrbSetting: vi.fn(),
  checkForUpdate: vi.fn(),
  checkLLMThinking: vi.fn(),
  activateDataset: vi.fn(),
  deleteDataset: vi.fn(),
  deleteLLMConfigRecord: vi.fn(),
  exportAllDatasets: vi.fn(),
  exportDataset: vi.fn(),
  getLLMConfig: vi.fn(),
  getNavigationVisibility: vi.fn(),
  getReminderPopupSetting: vi.fn(),
  getSearchConfig: vi.fn(),
  getUpdateDownloadStatus: vi.fn(),
  getUpdateInstallResult: vi.fn(),
  installDownloadedUpdate: vi.fn(),
  importDataset: vi.fn(),
  listDatasets: vi.fn(),
  listLLMConfigRecords: vi.fn(),
  renameDataset: vi.fn(),
  revealLLMApiKey: vi.fn(),
  saveLLMConfig: vi.fn(),
  saveLLMConfigRecord: vi.fn(),
  saveAssistantOrbSetting: vi.fn(),
  saveReminderPopupSetting: vi.fn(),
  saveSearchConfig: vi.fn(),
  startUpdateDownload: vi.fn(),
  testLLM: vi.fn(),
}));

vi.mock("../api/settings", () => apiMocks);

const skillMocks = vi.hoisted(() => ({
  deleteSkill: vi.fn(),
  importSkill: vi.fn(),
  listSkills: vi.fn(),
  setSkillEnabled: vi.fn(),
}));

vi.mock("../api/skill", () => skillMocks);

const navigationMocks = vi.hoisted(() => ({ reloadPage: vi.fn() }));

// 整页重载在 jsdom 里不可用，换成可断言的替身。
vi.mock("../utils/navigation", () => navigationMocks);

const mainDataset = {
  id: "main",
  name: "主数据",
  source: "本机",
  size_bytes: 4_947_968,
  created_at: null,
  is_active: true,
  exists: true,
};

const llmConfig = {
  provider: "openai",
  base_url: "https://api.openai.com/v1",
  api_key: "********",
  model: "gpt-4o-mini",
  temperature: 0.1,
  timeout_seconds: 120,
  max_tokens: 4096,
};

const searchConfig = {
  sources: ["bing", "duckduckgo"],
  searxng_url: "",
  fetch_pages: 0,
  max_results: 8,
};

/**
 * 选一个快速预设。
 *
 * 预设现在有 17 项，antd 的下拉是虚拟列表：末尾的两项（自定义模型、纯手动配置）
 * 不滚到就根本没渲染，直接 findByText 是找不到的。先打字筛选——这也正是用户
 * 在这个长度的列表里会做的事，顺带覆盖了搜索本身。
 */
async function choosePreset(label: string) {
  const combobox = screen.getByRole("combobox", { name: /快速预设/ });
  fireEvent.mouseDown(combobox);
  fireEvent.change(combobox, { target: { value: label } });
  // 用回车选中筛出来的那一项，而不是点击选项节点：下拉是虚拟列表，过滤后会重渲染，
  // 查到的节点可能在点击前就失效了（点了个空）。
  fireEvent.keyDown(combobox, { key: "Enter", code: "Enter", keyCode: 13 });
}

beforeEach(() => {
  apiMocks.getLLMConfig.mockResolvedValue(llmConfig);
  apiMocks.getNavigationVisibility.mockResolvedValue({ hidden: [] });
  apiMocks.getAssistantOrbSetting.mockResolvedValue({ enabled: true, tips_enabled: true });
  apiMocks.getReminderPopupSetting.mockResolvedValue({ enabled: true });
  apiMocks.getSearchConfig.mockResolvedValue(searchConfig);
  apiMocks.getUpdateDownloadStatus.mockResolvedValue({
    state: "idle",
    current_version: "0.11.0",
    target_version: "",
    progress: 0,
    downloaded_bytes: 0,
    total_bytes: null,
    background: false,
    installable: false,
    message: "",
  });
  // 没有待汇报的更新结果——有的话 UpdateCard 会弹一个确认框，把设置页的用例搅乱。
  apiMocks.getUpdateInstallResult.mockResolvedValue(null);
  apiMocks.acknowledgeUpdateInstallResult.mockResolvedValue(undefined);
  apiMocks.checkLLMThinking.mockResolvedValue({
    style: "reasoning_effort",
    efforts: ["minimal", "low", "medium", "high"],
    supported: true,
    note: "内置表给的说明",
    probed: false,
    accepted: null,
    reasoning_seen: false,
    message: "",
  });
  apiMocks.listLLMConfigRecords.mockResolvedValue([]);
  apiMocks.saveAssistantOrbSetting.mockImplementation(async (setting) => setting);
  apiMocks.listDatasets.mockResolvedValue([mainDataset]);
  apiMocks.revealLLMApiKey.mockResolvedValue({ api_key: "sk-revealed" });
  skillMocks.listSkills.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("SettingsPage model presets", () => {
  it("recognizes a legacy custom config that uses the official DeepSeek endpoint", async () => {
    apiMocks.getLLMConfig.mockResolvedValue({
      ...llmConfig,
      provider: "custom",
      base_url: "https://api.deepseek.com/",
      api_key: "********:record:1",
      model: "deepseek-v4-flash",
    });
    apiMocks.saveLLMConfig.mockImplementation(async (config) => config);

    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );

    expect(await screen.findByText("DeepSeek（深度求索）")).toBeInTheDocument();
    expect(screen.getByLabelText("模型名称")).toHaveValue("deepseek-v4-flash");

    fireEvent.click(screen.getByRole("button", { name: /编辑设置/ }));
    fireEvent.click(screen.getByRole("button", { name: /保存配置/ }));

    await waitFor(() =>
      expect(apiMocks.saveLLMConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "custom",
          api_key: "********:record:1",
          model: "deepseek-v4-flash",
        }),
      ),
    );
  });

  it("shows an unknown saved configuration as a custom OpenAI-compatible model", async () => {
    apiMocks.getLLMConfig.mockResolvedValue({
      ...llmConfig,
      provider: "private-cloud",
      base_url: "https://llm.example.com/v1",
      model: "company-chat",
    });

    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );

    expect(await screen.findByText("自定义模型（OpenAI 兼容）")).toBeInTheDocument();
    expect(screen.getByLabelText("Base URL")).toHaveValue("https://llm.example.com/v1");
    expect(screen.getByLabelText("模型名称")).toHaveValue("company-chat");
  });

  it("clears the preset fields for a manual configuration", async () => {
    apiMocks.saveLLMConfig.mockImplementation(async (config) => config);

    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: /编辑设置/ }));
    await choosePreset("纯手动配置（不套用任何预设）");

    // 关键区别：自定义模型保留当前内容，纯手动配置要一套空的
    expect(screen.getByLabelText("Base URL")).toHaveValue("");
    expect(screen.getByLabelText("模型名称")).toHaveValue("");
    // 预设本来就不碰密钥，这里也不该替用户清掉它
    expect(screen.getByLabelText("API Key（选填）")).toHaveValue("********");

    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://relay.example.com/v1" },
    });
    fireEvent.change(screen.getByLabelText("模型名称"), { target: { value: "my-model" } });
    fireEvent.click(screen.getByRole("button", { name: /保存配置/ }));

    await waitFor(() =>
      expect(apiMocks.saveLLMConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "manual",
          base_url: "https://relay.example.com/v1",
          model: "my-model",
        }),
      ),
    );
  });

  it("keeps showing 纯手动配置 after it is saved", async () => {
    apiMocks.getLLMConfig.mockResolvedValue({
      ...llmConfig,
      provider: "manual",
      base_url: "https://relay.example.com/v1",
      model: "my-model",
    });

    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );

    // 保存后再打开，下拉要停在自己那一项，而不是跳回「自定义模型」
    expect(await screen.findByText("纯手动配置（不套用任何预设）")).toBeInTheDocument();
  });

  it("saves the provider that belongs to the selected preset", async () => {
    apiMocks.saveLLMConfig.mockImplementation(async (config) => config);

    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: /编辑设置/ }));
    await choosePreset("DeepSeek（深度求索）");
    fireEvent.click(screen.getByRole("button", { name: /保存配置/ }));

    // 对着**预设定义**断言（而不是把模型名抄一遍）：模型名会随厂商迭代更新，
    // 抄进测试里只会让每次更新都要改两处。这条要守的是"预设的内容真的填进了表单"。
    await waitFor(() =>
      expect(apiMocks.saveLLMConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: deepseekPreset.provider,
          base_url: deepseekPreset.base_url,
          model: deepseekPreset.model,
        }),
      ),
    );
  });

  it("switches the protocol on when the Claude preset is chosen", async () => {
    apiMocks.saveLLMConfig.mockImplementation(async (config) => config);

    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: /编辑设置/ }));
    await choosePreset("Claude（Anthropic 原生协议）");
    fireEvent.click(screen.getByRole("button", { name: /保存配置/ }));

    // 只填地址不改协议的话，用户会拿着一整套 Messages 协议的配置去发 Chat
    // Completions 请求，报错只会说 404，看不出是协议选错了。
    await waitFor(() =>
      expect(apiMocks.saveLLMConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: claudePreset.provider,
          api_style: "anthropic",
          // /v1 不能省：provider 拼的是 `{base_url}/messages`。
          base_url: claudePreset.base_url,
          model: claudePreset.model,
        }),
      ),
    );
  });

  it("switches the protocol back when a non-Anthropic preset is chosen", async () => {
    apiMocks.getLLMConfig.mockResolvedValue({
      ...llmConfig,
      provider: "anthropic",
      base_url: "https://api.anthropic.com/v1",
      model: "claude-sonnet-5",
      api_style: "anthropic",
    });
    apiMocks.saveLLMConfig.mockImplementation(async (config) => config);

    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: /编辑设置/ }));
    await choosePreset("DeepSeek（深度求索）");
    fireEvent.click(screen.getByRole("button", { name: /保存配置/ }));

    // 留在 anthropic 的话就成了「DeepSeek 地址 + Messages 协议」，请求必失败。
    await waitFor(() =>
      expect(apiMocks.saveLLMConfig).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "deepseek", api_style: "openai" }),
      ),
    );
  });

  it("saves a custom local model without an API key", async () => {
    apiMocks.saveLLMConfig.mockImplementation(async (config) => config);

    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: /编辑设置/ }));
    await choosePreset("自定义模型（OpenAI 兼容）");

    expect(screen.getByLabelText("Base URL")).toHaveValue("https://api.openai.com/v1");
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "http://localhost:11434/v1" },
    });
    fireEvent.change(screen.getByLabelText("模型名称"), {
      target: { value: "private-model" },
    });
    fireEvent.change(screen.getByLabelText("API Key（选填）"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保存配置/ }));

    await waitFor(() =>
      expect(apiMocks.saveLLMConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "custom",
          base_url: "http://localhost:11434/v1",
          api_key: "",
          model: "private-model",
        }),
      ),
    );
  });
});
