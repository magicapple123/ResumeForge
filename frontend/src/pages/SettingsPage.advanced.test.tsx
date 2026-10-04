import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./SettingsPage";

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
describe("SettingsPage 高级参数往返", () => {
  /** 后端 LLMConfig 的字段前端必须全部声明：接口是整份替换语义，缺一个就会在保存时被清掉。 */
  const configured = {
    ...llmConfig,
    api_style: "anthropic" as const,
    top_k: 40,
    repetition_penalty: 1.05,
    stop: ["###"],
    thinking_budget: 4096,
    extra_body: { chat_template_kwargs: { thinking: true } },
  };

  it("keeps the protocol and advanced parameters when saving", async () => {
    apiMocks.getLLMConfig.mockResolvedValue(configured);
    apiMocks.saveLLMConfig.mockImplementation(async (config) => config);

    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: /编辑设置/ }));
    fireEvent.click(screen.getByRole("button", { name: /保存配置/ }));

    // 此前这几个字段没进前端类型，保存时被 Pydantic 默认值填回：api_style 变回 openai，
    // 配好的原生 Claude 被静默打回兼容模式，其余几个参数被清空。
    await waitFor(() =>
      expect(apiMocks.saveLLMConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          api_style: "anthropic",
          top_k: 40,
          repetition_penalty: 1.05,
          stop: ["###"],
          thinking_budget: 4096,
          extra_body: { chat_template_kwargs: { thinking: true } },
        }),
      ),
    );
  });
});

describe("SettingsPage 思考模式", () => {
  const thinkingConfig = {
    ...llmConfig,
    thinking_enabled: true,
    thinking_effort: "low",
    thinking_style: "auto",
  };

  async function renderEditing(config: unknown = llmConfig) {
    apiMocks.getLLMConfig.mockResolvedValue(config);
    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: /编辑设置/ }));
  }

  it("saves the switch, the effort and the style along with the rest", async () => {
    apiMocks.saveLLMConfig.mockImplementation(async (config) => config);
    await renderEditing(thinkingConfig);

    fireEvent.click(screen.getByRole("button", { name: /保存配置/ }));

    // 与 api_style 同一类坑：整份替换语义下，前端没声明的字段会被默认值填回去——
    // 那意味着用户开好的思考模式在下次保存时被静默关掉。
    await waitFor(() =>
      expect(apiMocks.saveLLMConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking_enabled: true,
          thinking_effort: "low",
          thinking_style: "auto",
        }),
      ),
    );
  });

  it("takes the effort options from the backend when the switch is turned on", async () => {
    await renderEditing();

    fireEvent.click(screen.getByRole("switch", { name: /思考模式/ }));

    // 只读能力表那一次（probe=false）：**不发上游请求**，所以打开开关不花钱。
    await waitFor(() =>
      expect(apiMocks.checkLLMThinking).toHaveBeenCalledWith(
        expect.objectContaining({ base_url: "https://api.openai.com/v1" }),
        false,
      ),
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /思考强度/ }));
    // 各家档位不同，所以选项必须来自接口而不是写死在前端。
    expect(await screen.findByText("最低（minimal）")).toBeTruthy();
  });

  it("lets the user type a custom effort and saves it with the rest", async () => {
    apiMocks.saveLLMConfig.mockImplementation(async (config) => config);
    await renderEditing();

    fireEvent.click(screen.getByRole("switch", { name: /思考模式/ }));
    await waitFor(() => expect(apiMocks.checkLLMThinking).toHaveBeenCalled());

    // 各家档位词汇不同（xhigh / max / adaptive…），选「自定义…」自己填。
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /思考强度/ }));
    fireEvent.click(await screen.findByText("自定义…"));

    const input = screen.getByPlaceholderText("如 xhigh / max / 4096");
    fireEvent.change(input, { target: { value: "xhigh" } });

    fireEvent.click(screen.getByRole("button", { name: /保存配置/ }));

    await waitFor(() =>
      expect(apiMocks.saveLLMConfig).toHaveBeenCalledWith(
        expect.objectContaining({ thinking_enabled: true, thinking_effort: "xhigh" }),
      ),
    );
  });

  it("shows a stored custom effort in the input instead of an unknown select value", async () => {
    await renderEditing({ ...thinkingConfig, thinking_effort: "xhigh" });

    expect(await screen.findByPlaceholderText("如 xhigh / max / 4096")).toHaveValue("xhigh");
  });

  it("shows the probe verdict and tells the user it costs a request", async () => {
    apiMocks.checkLLMThinking.mockResolvedValue({
      style: "reasoning_effort",
      efforts: ["minimal", "low", "medium", "high"],
      supported: true,
      note: "内置表给的说明",
      probed: true,
      accepted: true,
      reasoning_seen: true,
      message: "已确认生效：这次调用真的产出了思考内容。",
    });
    await renderEditing();

    expect(screen.getByText(/会发一次最小请求/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /检测思考支持/ }));

    expect(await screen.findByText(/已确认生效/)).toBeTruthy();
    expect(apiMocks.checkLLMThinking).toHaveBeenCalledWith(expect.anything(), true);
  });
});

describe("SettingsPage 提醒弹窗开关", () => {
  async function renderAppTab() {
    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("tab", { name: "应用" }));
  }

  it("toggles the startup reminder popup switch", async () => {
    apiMocks.saveReminderPopupSetting.mockImplementation(async (enabled) => ({ enabled }));
    await renderAppTab();

    const toggle = await screen.findByRole("switch", { name: "打开应用时弹出提醒" });
    await waitFor(() => expect(toggle).toBeChecked());

    fireEvent.click(toggle);

    await waitFor(() => expect(apiMocks.saveReminderPopupSetting).toHaveBeenCalledWith(false));
  });
});

describe("SettingsPage 投投悬浮球开关", () => {
  async function renderAppTab() {
    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("tab", { name: "应用" }));
  }

  it("toggles and persists the assistant orb switch", async () => {
    await renderAppTab();

    const toggle = await screen.findByRole("switch", { name: "开启投投悬浮球" });
    await waitFor(() => expect(toggle).toBeChecked());

    fireEvent.click(toggle);

    // 保存走整对象：入口开关变更时也带上标语开关的当前值，互不覆盖。
    await waitFor(() =>
      expect(apiMocks.saveAssistantOrbSetting).toHaveBeenCalledWith({
        enabled: false,
        tips_enabled: true,
      }),
    );
  });
});
