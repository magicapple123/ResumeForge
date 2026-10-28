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
  deleteDataset: vi.fn(),
  activateLLMRecord: vi.fn(),
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
  listLLMModels: vi.fn(),
  renameDataset: vi.fn(),
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

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "p_7",
    name: "DeepSeek 校招",
    provider: "deepseek",
    base_url: "https://api.deepseek.com",
    api_key: "********:profile:p_7",
    model: "deepseek-chat",
    temperature: 0.1,
    timeout_seconds: 120,
    max_tokens: 4096,
    models: ["deepseek-chat"],
    is_active: false,
    created_at: "2026-08-20T10:00:00",
    updated_at: "2026-08-20T10:00:00",
    ...overrides,
  };
}

function renderSettingsPage() {
  render(
    <MemoryRouter>
      <AntdApp>
        <SettingsPage />
      </AntdApp>
    </MemoryRouter>,
  );
}

// 单区块后没有「编辑配置」入口：所有表单交互都从「新建配置」或记录卡的「···」菜单进入。
async function openCreateModal() {
  await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: /新建配置/ }));
  await screen.findByText("新建配置记录");
}

async function openRecordEditByName(name: string) {
  fireEvent.click(screen.getByRole("button", { name: `更多操作（${name}）` }));
  // 菜单项的 accessible name 带图标名前缀（"edit编辑"），按结尾匹配。
  fireEvent.click(await screen.findByRole("menuitem", { name: /编\s*辑$/ }));
  await screen.findByText(new RegExp(`编辑配置记录「${name}」`));
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

describe("SettingsPage configuration record lifecycle", () => {
  it("refreshes the current config after deleting the active record", async () => {
    apiMocks.getLLMConfig
      // 第一次：当前配置与记录一致，该记录是“使用中”的那条。
      .mockResolvedValueOnce({
        ...llmConfig,
        ...makeRecord(),
        scope: "global",
        record_id: "p_7",
        record_name: "DeepSeek 校招",
      })
      // 删除使用中的记录后重新拉取当前配置（刷新摘要，甩掉已删记录的密钥引用）。
      .mockResolvedValueOnce({
        ...llmConfig,
        provider: "deepseek",
        base_url: "https://api.deepseek.com",
        model: "deepseek-chat",
        scope: "dataset",
        record_id: null,
      });
    apiMocks.listLLMConfigRecords.mockResolvedValue([makeRecord()]);
    apiMocks.deleteLLMConfigRecord.mockResolvedValue(undefined);

    renderSettingsPage();

    await screen.findByText("DeepSeek 校招");
    // 该记录与当前配置一致，是“使用中”的那条。
    expect(screen.getByText("使用中")).toBeInTheDocument();
    // 编辑/删除收进了「···」下拉：删除走菜单项 + confirm 二次确认。
    fireEvent.click(screen.getByRole("button", { name: "更多操作（DeepSeek 校招）" }));
    // 菜单项的 accessible name 带图标名前缀（"delete删除"），按结尾匹配。
    fireEvent.click(await screen.findByRole("menuitem", { name: /删\s*除$/ }));
    // antd 6 的 confirm 会渲染两份标题文本，断言“至少出现”即可。
    await screen.findAllByText("删除记录“DeepSeek 校招”？");
    const confirmDelete = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>(
        ".ant-modal-confirm .ant-btn-dangerous",
      );
      if (!button) throw new Error("未找到删除确认按钮");
      return button;
    });
    fireEvent.click(confirmDelete);

    await waitFor(() => expect(apiMocks.deleteLLMConfigRecord).toHaveBeenCalledWith("p_7"));
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledTimes(2), { timeout: 1000 });
    await screen.findByText(/还没有配置记录/);
    // 记录卡已移除（confirm 的标题不是纯文本匹配，不受其关闭动画影响）。
    expect(screen.queryByText("DeepSeek 校招")).not.toBeInTheDocument();
  });

  it("shows the upgrade banner while the effective config still comes from the dataset", async () => {
    apiMocks.listLLMConfigRecords.mockResolvedValue([makeRecord()]);
    // scope=dataset：还在用数据集里的旧配置（全局尚无生效记录）。

    renderSettingsPage();

    await screen.findByText("DeepSeek 校招");
    expect(screen.queryByText("使用中")).toBeNull();
    expect(
      await screen.findByText("当前沿用本数据集旧配置，保存后将升级为全局配置"),
    ).toBeInTheDocument();
  });
});

describe("SettingsPage 新建配置记录", () => {
  it("saves a new record from the modal without applying it", async () => {
    renderSettingsPage();
    await openCreateModal();

    fireEvent.change(screen.getByLabelText("配置名称"), { target: { value: "Ollama 本地" } });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "http://localhost:11434/v1" },
    });
    fireEvent.change(screen.getByLabelText("模型名称"), { target: { value: "qwen3:8b" } });
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));

    await waitFor(() =>
      expect(apiMocks.saveLLMConfigRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Ollama 本地",
          provider: "custom",
          api_style: "openai",
          base_url: "http://localhost:11434/v1",
          model: "qwen3:8b",
          api_key: "",
        }),
      ),
    );
    // 新增保存后不自动生效：当前配置接口不应被调用，列表里也没有「使用中」标记。
    expect(apiMocks.saveLLMConfig).not.toHaveBeenCalled();
    await screen.findByText("Ollama 本地");
    expect(screen.queryByText("使用中")).toBeNull();
    expect(await screen.findByText(/已保存，点记录卡上的「使用」即可生效/)).toBeInTheDocument();
  });

  it("refuses to save without a record name", async () => {
    renderSettingsPage();
    await openCreateModal();

    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "http://localhost:11434/v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));

    await screen.findByText("请填写配置名称");
    expect(apiMocks.saveLLMConfigRecord).not.toHaveBeenCalled();
  });
});

describe("SettingsPage 查看配置详情", () => {
  it("opens a read-only view from the record card body and keeps the key masked", async () => {
    apiMocks.listLLMConfigRecords.mockResolvedValue([makeRecord()]);

    renderSettingsPage();
    await screen.findByText("DeepSeek 校招");

    // 点卡片本体（名称）打开只读详情。
    fireEvent.click(screen.getByText("DeepSeek 校招"));
    await screen.findByText("配置详情「DeepSeek 校招」");
    expect(screen.getAllByText("https://api.deepseek.com").length).toBeGreaterThan(0);
    // 脱敏：详情里只说明“已配置”，密钥本体与 `********:record:N` 引用都不渲染。
    expect(screen.getByText("已配置（********）")).toBeInTheDocument();
    expect(screen.queryByText("********:profile:p_7")).toBeNull();

    // 底部栏那只「关闭」已删除（只读详情只保留右上角 ×，见 LLMRecordViewModal），
    // 所以定位改成关闭图标；断言意图不变：点掉之后详情弹窗消失。
    const closeButton = document.querySelector<HTMLElement>(".ant-modal-close");
    expect(closeButton).not.toBeNull();
    fireEvent.click(closeButton!);
    await waitFor(() => expect(screen.queryByText(/配置详情「/)).toBeNull());
  });
});

describe("SettingsPage 编辑使用中的记录", () => {
  it("syncs the saved edit into the current active config", async () => {
    const record = makeRecord();
    apiMocks.getLLMConfig.mockResolvedValue({
      ...llmConfig,
      provider: "deepseek",
      base_url: record.base_url,
      api_key: "********:profile:p_7",
      model: "deepseek-chat",
      scope: "global",
      record_id: "p_7",
      record_name: "DeepSeek 校招",
    });
    apiMocks.listLLMConfigRecords.mockResolvedValue([record]);
    apiMocks.saveLLMConfigRecord.mockImplementation(async (payload) => ({
      ...record,
      ...payload,
      id: "p_7",
    }));

    renderSettingsPage();
    await screen.findByText("DeepSeek 校招");
    expect(screen.getByText("使用中")).toBeInTheDocument();

    await openRecordEditByName("DeepSeek 校招");
    const modelInput = screen.getByLabelText("模型名称");
    await waitFor(() => expect(modelInput).toHaveValue("deepseek-chat"));
    fireEvent.change(modelInput, { target: { value: "deepseek-v4" } });
    // 精确匹配：页面上还有搜索卡的「保存搜索设置」。
    fireEvent.click(screen.getByRole("button", { name: /^保\s*存$/ }));

    // 编辑保存只改记录本身：同名 upsert，密钥留空沿用脱敏引用。
    await waitFor(() =>
      expect(apiMocks.saveLLMConfigRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "DeepSeek 校招",
          model: "deepseek-v4",
          api_key: "********:profile:p_7",
        }),
      ),
    );
    // C 之后记录与生效配置是同一份：保存记录本身就是改"使用中"的那条，
    // 不再需要额外 PUT /settings/llm 复制一份（旧行为会留下两份真相）。
    await screen.findAllByText("配置记录「DeepSeek 校招」已保存");
  });
});

describe("SettingsPage 快捷键设置", () => {
  it("在外观与交互页签挂载快捷键设置卡", async () => {
    renderSettingsPage();
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    // 快捷键从原来的「应用」页签迁到「外观与交互」（它管的就是"按什么键"）。
    fireEvent.click(screen.getByRole("tab", { name: "外观与交互" }));

    // 卡片标题 + 动作表第一行（撤回）都在，说明整张卡真的挂上了。
    expect(await screen.findByText("快捷键")).toBeInTheDocument();
    expect(screen.getByText("撤回")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /全部恢复默认/ })).toBeInTheDocument();
  });
});
