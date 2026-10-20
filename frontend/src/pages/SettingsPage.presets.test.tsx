// SPDX-License-Identifier: Apache-2.0
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
  activateDataset: vi.fn(),
  clearLLMSessionKey: vi.fn(),
  deleteDataset: vi.fn(),
  activateLLMRecord: vi.fn(),
  deleteLLMConfigRecord: vi.fn(),
  exportAllDatasets: vi.fn(),
  exportDataset: vi.fn(),
  getLLMConfig: vi.fn(),
  getLLMSessionKeyStatus: vi.fn(),
  getNavigationVisibility: vi.fn(),
  getReminderPopupSetting: vi.fn(),
  getSearchConfig: vi.fn(),
  getUpdateDownloadStatus: vi.fn(),
  getUpdateInstallResult: vi.fn(),
  installDownloadedUpdate: vi.fn(),
  importDataset: vi.fn(),
  listDatasets: vi.fn(),
  listLLMConfigRecords: vi.fn(),
  listLLMModels: vi.fn(),
  renameDataset: vi.fn(),
  saveLLMConfig: vi.fn(),
  saveLLMConfigRecord: vi.fn(),
  saveAssistantOrbSetting: vi.fn(),
  saveReminderPopupSetting: vi.fn(),
  saveSearchConfig: vi.fn(),
  setLLMSessionKey: vi.fn(),
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

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    name: "测试记录",
    provider: "openai",
    base_url: llmConfig.base_url,
    api_key: "********:record:7",
    model: llmConfig.model,
    temperature: 0.1,
    timeout_seconds: 120,
    max_tokens: 4096,
    created_at: "2026-08-20T10:00:00",
    updated_at: "2026-08-20T10:00:00",
    ...overrides,
  };
}

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

// 单区块后没有「编辑配置」入口：预设交互全部发生在新增/编辑共用的弹窗里。
async function openCreateModal() {
  await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: /新增配置/ }));
  await screen.findByText("新增配置记录");
}

async function openRecordEditByName(name: string) {
  fireEvent.click(screen.getByRole("button", { name: `更多操作（${name}）` }));
  // 菜单项的 accessible name 带图标名前缀（"edit编辑"），按结尾匹配。
  fireEvent.click(await screen.findByRole("menuitem", { name: /编\s*辑$/ }));
  await screen.findByText(new RegExp(`编辑配置记录「${name}」`));
}

// 配置经异步 setFieldsValue 写进表单：等 Base URL 落地再交互/保存，
// 否则保存时 validateFields 会在空表单上直接失败、断言也会读到旧值。
async function waitForFormLoaded(baseUrl: string) {
  await waitFor(() => expect(screen.getByLabelText("Base URL")).toHaveValue(baseUrl));
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
  apiMocks.listLLMConfigRecords.mockResolvedValue([]);
  apiMocks.getLLMSessionKeyStatus.mockResolvedValue({ configured: false });
  apiMocks.saveAssistantOrbSetting.mockImplementation(async (setting) => setting);
  apiMocks.listDatasets.mockResolvedValue([mainDataset]);
  apiMocks.saveLLMConfigRecord.mockImplementation(async (payload) => ({
    ...payload,
    id: 9,
    created_at: "2026-10-16T00:00:00",
    updated_at: "2026-10-16T00:00:00",
  }));
  skillMocks.listSkills.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SettingsPage model presets", () => {
  it("uses the current DeepSeek model ID while keeping the legacy alias recognizable", () => {
    expect(deepseekPreset.model).toBe("deepseek-flash");
  });

  it("recognizes a legacy custom record that uses the official DeepSeek endpoint", async () => {
    apiMocks.listLLMConfigRecords.mockResolvedValue([
      makeRecord({
        provider: "custom",
        base_url: "https://api.deepseek.com/",
        model: "deepseek-v4-flash",
      }),
    ]);

    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );

    // 记录卡直接给出预设识别结果（官方 DeepSeek 地址即恢复预设名）。
    expect(await screen.findByText("DeepSeek（深度求索）")).toBeInTheDocument();
  });

  it("shows an unknown saved record as a custom OpenAI-compatible model", async () => {
    apiMocks.listLLMConfigRecords.mockResolvedValue([
      makeRecord({
        provider: "private-cloud",
        base_url: "https://llm.example.com/v1",
        model: "company-chat",
      }),
    ]);

    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );

    // 未知 provider 的记录卡上就是「自定义模型（OpenAI 兼容）」。
    expect(await screen.findByText("自定义模型（OpenAI 兼容）")).toBeInTheDocument();
  });

  it("clears the preset fields for a manual configuration", async () => {
    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await openCreateModal();

    await choosePreset("纯手动配置（不套用任何预设）");

    // 关键区别：自定义模型保留当前内容，纯手动配置要一套空的
    await waitFor(() => expect(screen.getByLabelText("Base URL")).toHaveValue(""));
    expect(screen.getByLabelText("模型名称")).toHaveValue("");
    // 预设本来就不碰密钥，这里也不该替用户清掉它
    expect(screen.getByLabelText(/API Key/)).toHaveValue("");

    fireEvent.change(screen.getByLabelText("配置名称"), {
      target: { value: "中转站配置" },
    });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://relay.example.com/v1" },
    });
    fireEvent.change(screen.getByLabelText("模型名称"), { target: { value: "my-model" } });
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));

    await waitFor(() =>
      expect(apiMocks.saveLLMConfigRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "manual",
          base_url: "https://relay.example.com/v1",
          model: "my-model",
        }),
      ),
    );
  });

  it("keeps showing 纯手动配置 when editing a manual record", async () => {
    apiMocks.listLLMConfigRecords.mockResolvedValue([
      makeRecord({
        provider: "manual",
        base_url: "https://relay.example.com/v1",
        model: "my-model",
      }),
    ]);

    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await screen.findByText("测试记录");

    // 编辑弹窗打开时，预设下拉要停在自己那一项，而不是跳回「自定义模型」。
    await openRecordEditByName("测试记录");
    expect(await screen.findByText("纯手动配置（不套用任何预设）")).toBeInTheDocument();
  });

  it("saves the provider that belongs to the selected preset", async () => {
    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await openCreateModal();
    await waitFor(() => expect(screen.getByLabelText("Base URL")).toHaveValue(""));

    fireEvent.change(screen.getByLabelText("配置名称"), { target: { value: "DeepSeek 主力" } });
    await choosePreset("DeepSeek（深度求索）");
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));

    // 对着**预设定义**断言（而不是把模型名抄一遍）：模型名会随厂商迭代更新，
    // 抄进测试里只会让每次更新都要改两处。这条要守的是"预设的内容真的填进了表单"。
    await waitFor(() =>
      expect(apiMocks.saveLLMConfigRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: deepseekPreset.provider,
          base_url: deepseekPreset.base_url,
          model: deepseekPreset.model,
        }),
      ),
    );
  });

  it("switches the protocol on when the Claude preset is chosen", async () => {
    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await openCreateModal();
    await waitFor(() => expect(screen.getByLabelText("Base URL")).toHaveValue(""));

    fireEvent.change(screen.getByLabelText("配置名称"), { target: { value: "Claude 原生" } });
    await choosePreset("Claude（Anthropic 原生协议）");
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));

    // 只填地址不改协议的话，用户会拿着一整套 Messages 协议的配置去发 Chat
    // Completions 请求，报错只会说 404，看不出是协议选错了。
    await waitFor(() =>
      expect(apiMocks.saveLLMConfigRecord).toHaveBeenCalledWith(
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
    apiMocks.listLLMConfigRecords.mockResolvedValue([
      makeRecord({
        provider: "anthropic",
        base_url: "https://api.anthropic.com/v1",
        model: "claude-sonnet-5",
        api_style: "anthropic",
      }),
    ]);

    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await screen.findByText("测试记录");

    await openRecordEditByName("测试记录");
    await waitForFormLoaded("https://api.anthropic.com/v1");
    await choosePreset("DeepSeek（深度求索）");
    fireEvent.click(screen.getByRole("button", { name: /^保\s*存$/ }));

    // 留在 anthropic 的话就成了「DeepSeek 地址 + Messages 协议」，请求必失败。
    await waitFor(() =>
      expect(apiMocks.saveLLMConfigRecord).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "deepseek", api_style: "openai" }),
      ),
    );
  });

  it("saves a custom local model without an API key", async () => {
    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await openCreateModal();
    await waitFor(() => expect(screen.getByLabelText("Base URL")).toHaveValue(""));

    fireEvent.change(screen.getByLabelText("配置名称"), { target: { value: "本地 Ollama" } });
    await choosePreset("自定义模型（OpenAI 兼容）");

    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "http://localhost:11434/v1" },
    });
    fireEvent.change(screen.getByLabelText("模型名称"), {
      target: { value: "private-model" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));

    await waitFor(() =>
      expect(apiMocks.saveLLMConfigRecord).toHaveBeenCalledWith(
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
