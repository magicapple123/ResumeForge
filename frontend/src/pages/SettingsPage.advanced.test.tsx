// SPDX-License-Identifier: Apache-2.0
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import SettingsPage from "./SettingsPage";

const apiMocks = vi.hoisted(() => ({
  acknowledgeUpdateInstallResult: vi.fn(),
  getAppForm: vi.fn(),
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

// 打开记录编辑弹窗（编辑/删除收进「···」菜单，菜单项 accessible name 带图标名前缀）。
async function openRecordEditByName(name: string) {
  fireEvent.click(screen.getByRole("button", { name: `更多操作（${name}）` }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /编\s*辑$/ }));
  await screen.findByText(new RegExp(`编辑配置记录「${name}」`));
}

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

beforeEach(() => {
  // 形态探测（桌面壳 / 浏览器）必须给一个明确答复：UpdateCard 挂载时会问一次。
  apiMocks.getAppForm.mockResolvedValue({
    desktop: false,
    platform: "win32",
    app_version: "1.0.2",
  });
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
  skillMocks.listSkills.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SettingsPage 记录编辑参数往返", () => {
  it("fetches models with this record's saved key reference when the key field is blank", async () => {
    const record = makeRecord({ base_url: "https://models.example.com/v1" });
    apiMocks.listLLMConfigRecords.mockResolvedValue([record]);
    apiMocks.listLLMModels.mockResolvedValue({
      models: ["example-model"],
      message: "找到 1 个模型",
    });
    render(
      <MemoryRouter>
        <AntdApp>
          <SettingsPage />
        </AntdApp>
      </MemoryRouter>,
    );
    await screen.findByText("测试记录");
    await openRecordEditByName("测试记录");
    fireEvent.click(screen.getByRole("button", { name: /获取可用模型/ }));
    await waitFor(() =>
      expect(apiMocks.listLLMModels).toHaveBeenCalledWith({
        base_url: record.base_url,
        api_key: record.api_key,
      }),
    );
    expect(await screen.findByText("example-model")).toBeInTheDocument();
  });

  it("uses the newly typed key and endpoint without requiring a model or a saved record", async () => {
    apiMocks.listLLMModels.mockResolvedValue({ models: [], message: "暂无模型" });
    render(
      <MemoryRouter>
        <AntdApp>
          <SettingsPage />
        </AntdApp>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /新建配置/ }));
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: " https://models.example.com/v1 " },
    });
    fireEvent.change(screen.getByPlaceholderText("sk-…"), { target: { value: " fake-new-key " } });
    fireEvent.click(screen.getByRole("button", { name: /获取可用模型/ }));
    await waitFor(() =>
      expect(apiMocks.listLLMModels).toHaveBeenCalledWith({
        base_url: "https://models.example.com/v1",
        api_key: "fake-new-key",
      }),
    );
    const emptyModelsMessage = await screen.findByText("暂无模型");
    expect(emptyModelsMessage.closest('[role="alert"]')).toBeInTheDocument();
    expect(apiMocks.saveLLMConfigRecord).not.toHaveBeenCalled();
  });

  /** 后端 LLMConfig 的字段前端必须在编辑弹窗里全部声明：记录接口同样是整份替换语义，
   * 弹窗里没有的字段要靠「从原记录展开」兜住，缺一个就会在保存时被清掉。 */
  const configured = makeRecord({
    api_style: "anthropic",
    top_k: 40,
    repetition_penalty: 1.05,
    stop: ["###"],
    thinking_budget: 4096,
    extra_body: { chat_template_kwargs: { thinking: true } },
  });

  it("keeps the protocol and advanced parameters when saving a record", async () => {
    apiMocks.listLLMConfigRecords.mockResolvedValue([configured]);
    apiMocks.saveLLMConfigRecord.mockImplementation(async (payload) => ({
      ...configured,
      ...(payload as object),
    }));

    render(
      <MemoryRouter>
        <AntdApp>
          <SettingsPage />
        </AntdApp>
      </MemoryRouter>,
    );
    await screen.findByText("测试记录");

    await openRecordEditByName("测试记录");
    // 此前这几个字段没进前端类型，保存时被 Pydantic 默认值填回：api_style 变回 openai，
    // 配好的原生 Claude 被静默打回兼容模式，其余几个参数被清空。弹窗表单只覆盖常用
    // 字段，其余全靠从原记录展开——这条守住的就是“弹窗里没有的字段原样保留”。
    fireEvent.click(screen.getByRole("button", { name: /^保\s*存$/ }));

    await waitFor(() =>
      expect(apiMocks.saveLLMConfigRecord).toHaveBeenCalledWith(
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

describe("SettingsPage 提醒弹窗开关", () => {
  async function renderAppTab() {
    render(
      <MemoryRouter>
        <AntdApp>
          <SettingsPage />
        </AntdApp>
      </MemoryRouter>,
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
      <MemoryRouter>
        <AntdApp>
          <SettingsPage />
        </AntdApp>
      </MemoryRouter>,
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
