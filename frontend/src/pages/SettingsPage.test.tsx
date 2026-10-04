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

function tooltipTriggerFor(label: string): HTMLElement {
  const labelNode = screen.getByText(label).closest("label");
  const trigger = labelNode?.querySelector<HTMLElement>(".ant-form-item-tooltip");
  if (!trigger) throw new Error(`未找到“${label}”的提示入口`);
  return trigger;
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
describe("SettingsPage parameter help", () => {
  it.each([
    [
      "创意度 temperature",
      "控制输出的随机性。值越低越稳定，适合事实型简历；值越高表达更发散，也会增加内容不一致或虚构风险。",
    ],
    [
      "超时时间（秒）",
      "等待模型返回响应数据的最长时间；超过后请求会终止。网络较慢或生成内容较长时可适当调大，但调大不会让模型生成得更快。",
    ],
    [
      "最大输出 Token",
      "限制模型单次回复的最大输出 Token 数。值越大可能增加费用；过小可能导致内容被截断。它不是模型的上下文长度上限。勾选「不限制」后不再发送该参数，改由服务商决定上限，但并非真的无限——部分服务商的默认值可能比手动设置的值更小。",
    ],
  ])("shows help for %s on hover", async (label, helpText) => {
    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    fireEvent.mouseEnter(tooltipTriggerFor(label));

    expect(await screen.findByRole("tooltip")).toHaveTextContent(helpText);
  });

  it("explains the unlimited-token checkbox itself, not just the number field", async () => {
    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    // 这段解释原本只挂在上面那个数字输入框的 tooltip 上：勾选框自己不说，
    // 而"不限制"的行为恰恰与直觉相反。
    const checkbox = screen.getByRole("checkbox", { name: /不限制（由服务商决定上限）/ });
    fireEvent.mouseEnter(checkbox);

    expect(await screen.findByRole("tooltip")).toHaveTextContent("由服务商决定上限");
    expect(await screen.findByRole("tooltip")).toHaveTextContent("不是真的无限");
  });
});

describe("SettingsPage API key reveal", () => {
  function passwordToggle(): HTMLElement {
    const input = screen.getByLabelText("API Key（选填）");
    const toggle = input
      .closest(".ant-input-affix-wrapper")
      ?.querySelector<HTMLElement>(".ant-input-password-icon");
    if (!toggle) throw new Error("未找到 API Key 显示按钮");
    return toggle;
  }

  it("reveals the saved key only on demand and keeps the form reference masked", async () => {
    apiMocks.getLLMConfig.mockResolvedValue({
      ...llmConfig,
      provider: "custom",
      base_url: "https://api.deepseek.com",
      api_key: "********:record:1",
      model: "deepseek-v4-flash",
    });
    apiMocks.saveLLMConfig.mockImplementation(async (config) => config);

    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );

    const input = await screen.findByLabelText("API Key（选填）");
    await waitFor(() => expect(input).toHaveValue("********"));
    expect(apiMocks.revealLLMApiKey).not.toHaveBeenCalled();

    fireEvent.click(passwordToggle());

    await waitFor(() => expect(apiMocks.revealLLMApiKey).toHaveBeenCalledOnce());
    await waitFor(() => expect(input).toHaveValue("sk-revealed"));
    // antd 6 Password 的受控 visible 通过内部 effect 同步，React 19 下比我们的
    // 状态更新晚一拍落地，type 翻转要用 waitFor 等（真实浏览器同样只是晚几毫秒）。
    await waitFor(() => expect(input).toHaveAttribute("type", "text"));

    fireEvent.click(passwordToggle());
    await waitFor(() => expect(input).toHaveValue("********"));
    await waitFor(() => expect(input).toHaveAttribute("type", "password"));

    fireEvent.click(screen.getByRole("button", { name: /编辑设置/ }));
    fireEvent.click(passwordToggle());
    await waitFor(() => expect(input).toHaveValue("sk-revealed"));
    fireEvent.click(screen.getByRole("button", { name: /保存配置/ }));

    await waitFor(() =>
      expect(apiMocks.saveLLMConfig).toHaveBeenCalledWith(
        expect.objectContaining({ api_key: "********:record:1" }),
      ),
    );
  });

  it("keeps the key masked when the explicit reveal request fails", async () => {
    apiMocks.getLLMConfig.mockResolvedValue({
      ...llmConfig,
      api_key: "********:record:1",
    });
    apiMocks.revealLLMApiKey.mockRejectedValue(new Error("读取密钥失败"));

    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );

    const input = await screen.findByLabelText("API Key（选填）");
    // 必须先等掩码值写进表单：配置加载完成前点击显示按钮，掩码值为空，
    // 组件会直接切到明文态而不发起读取请求，这里也就永远等不到错误提示。
    await waitFor(() => expect(input).toHaveValue("********"));
    fireEvent.click(passwordToggle());

    expect(await screen.findByText("读取密钥失败")).toBeInTheDocument();
    expect(input).toHaveValue("********");
    // 同上：antd 6 的受控 visible 晚一拍同步，type 断言等待落地。
    await waitFor(() => expect(input).toHaveAttribute("type", "password"));
  });
});

describe("SettingsPage configuration record lifecycle", () => {
  it("refreshes the current config after deleting the active record", async () => {
    const record = {
      id: 7,
      name: "DeepSeek 校招",
      provider: "deepseek",
      base_url: "https://api.deepseek.com",
      api_key: "********:record:7",
      model: "deepseek-chat",
      temperature: 0.1,
      timeout_seconds: 120,
      max_tokens: 4096,
      created_at: "2026-08-20T10:00:00",
      updated_at: "2026-08-20T10:00:00",
    };
    apiMocks.getLLMConfig.mockResolvedValueOnce({ ...llmConfig, ...record }).mockResolvedValueOnce({
      ...llmConfig,
      provider: "deepseek",
      base_url: record.base_url,
      model: record.model,
    });
    apiMocks.listLLMConfigRecords.mockResolvedValue([record]);
    apiMocks.deleteLLMConfigRecord.mockResolvedValue(undefined);
    apiMocks.saveLLMConfig.mockImplementation(async (config) => config);

    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );

    await screen.findByText("DeepSeek 校招");
    // 删除收进行内「···」菜单：打开菜单 → 点「删除记录」→ 二次确认。
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(await screen.findByText("删除记录"));
    const confirmDelete = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>(
        ".ant-modal-confirm-btns .ant-btn-primary",
      );
      if (!button) throw new Error("未找到删除确认按钮");
      return button;
    });
    fireEvent.click(confirmDelete);

    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledTimes(2), { timeout: 1000 });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "更多操作" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("DeepSeek 校招")).not.toBeInTheDocument();
    expect(screen.getByLabelText("API Key（选填）")).toHaveValue("********");
  });
});

describe("SettingsPage output limit", () => {
  it("saves the unlimited value and disables the input when the checkbox is ticked", async () => {
    apiMocks.saveLLMConfig.mockImplementation(async (config) => config);

    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    // 非编辑态必须仍然只读：InputNumber 的 disabled 只在为 true 时覆盖 Form 的
    // disabled 上下文，写成 disabled={unlimitedTokens} 传 false 会让这里可编辑。
    const limitInput = screen.getByLabelText("最大输出 Token");
    expect(limitInput).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /编辑设置/ }));
    expect(limitInput).not.toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /不限制/ }));
    // antd 6 的 Form.useWatch 改为异步通知（下一拍才触发重渲染），勾选后输入框
    // 的 disabled 是派生态，必须等它落地。真实浏览器中同样有一帧延迟，jsdom 里
    // 不等的话后续断言会读到旧 DOM。
    await waitFor(() => expect(limitInput).toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: /保存配置/ }));

    await waitFor(() =>
      expect(apiMocks.saveLLMConfig).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 0 }),
      ),
    );
  });

  it("restores the default limit when the checkbox is cleared", async () => {
    apiMocks.getLLMConfig.mockResolvedValue({ ...llmConfig, max_tokens: 0 });
    apiMocks.saveLLMConfig.mockImplementation(async (config) => config);

    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    const checkbox = screen.getByRole("checkbox", { name: /不限制/ });
    await waitFor(() => expect(checkbox).toBeChecked());
    expect(screen.getByLabelText("最大输出 Token")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /编辑设置/ }));
    fireEvent.click(checkbox);
    // antd 6 的 Form.useWatch 异步通知：取消勾选后输入框恢复可用要等一拍。
    await waitFor(() => expect(screen.getByLabelText("最大输出 Token")).not.toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: /保存配置/ }));

    await waitFor(() =>
      expect(apiMocks.saveLLMConfig).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 4096 }),
      ),
    );
  });

  it("restores the value the user had before ticking the checkbox", async () => {
    apiMocks.getLLMConfig.mockResolvedValue({ ...llmConfig, max_tokens: 8192 });
    apiMocks.saveLLMConfig.mockImplementation(async (config) => config);

    render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: /编辑设置/ }));
    const checkbox = screen.getByRole("checkbox", { name: /不限制/ });
    fireEvent.click(checkbox);
    // antd 6 的 Form.useWatch 异步通知：两次点击之间必须等受控 checkbox 的
    // checked 状态落地，否则第二次 click 读到旧 DOM，会再发出一次 checked=true，
    // 「取消勾选恢复原值」就永远不会发生（真实浏览器里两次点击之间必有重渲染）。
    await waitFor(() => expect(checkbox).toBeChecked());
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).not.toBeChecked());

    fireEvent.click(screen.getByRole("button", { name: /保存配置/ }));

    await waitFor(() =>
      expect(apiMocks.saveLLMConfig).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 8192 }),
      ),
    );
  });
});
