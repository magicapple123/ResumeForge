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
describe("SettingsPage skills", () => {
  const interviewSkill = {
    id: 1,
    name: "面试模拟官",
    description: "练面试时使用",
    enabled: true,
    source_name: "面试模拟官.zip",
    prompt_chars: 120,
    files: ["题库.md", "模板.txt"],
    updated_at: "2026-09-15T10:00:00+08:00",
  };

  // 不带知识文件的技能，用来覆盖「仅提示词」那一支的展示。
  const disabledSkill = {
    ...interviewSkill,
    id: 2,
    name: "简历诊断",
    enabled: false,
    prompt_chars: 80,
    files: [],
  };

  async function renderPage(skills = [interviewSkill]) {
    skillMocks.listSkills.mockResolvedValue(skills);
    const view = render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await waitFor(() => expect(skillMocks.listSkills).toHaveBeenCalled());
    return view;
  }

  /** 打开技能行的「更多」菜单（删除收在里面）。 */
  async function openRowActionsMenu() {
    // 技能列表异步渲染，「更多操作」按钮要用 findAllByRole 等它出现，而不是同步
    // getAllByRole——慢速 CI 上后者会因时机不稳报「找不到按钮」。
    fireEvent.click((await screen.findAllByRole("button", { name: "更多操作" }))[0]);
    await screen.findByText("删除技能");
  }

  it("lists skills with their status and knowledge file count", async () => {
    await renderPage([interviewSkill, disabledSkill]);

    expect(await screen.findByText("面试模拟官")).toBeInTheDocument();
    expect(screen.getByText("启用中")).toBeInTheDocument();
    expect(screen.getByText("已停用")).toBeInTheDocument();
    expect(screen.getByText(/2 份知识文件/)).toBeInTheDocument();
    expect(screen.getByText(/仅提示词/)).toBeInTheDocument();
  });

  it("shows an empty state before anything is imported", async () => {
    await renderPage([]);

    expect(await screen.findByText("还没有导入技能")).toBeInTheDocument();
  });

  it("imports the chosen file and refreshes the list", async () => {
    skillMocks.importSkill.mockResolvedValue(interviewSkill);
    const { container } = await renderPage([]);
    const input = container.querySelector(
      'input[type="file"][aria-label="选择技能文件"]',
    ) as HTMLInputElement;
    const file = new File(["skill-bytes"], "面试模拟官.zip", { type: "application/zip" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(skillMocks.importSkill).toHaveBeenCalledOnce());
    // 类型判定在后端，前端只负责把文件原样送过去。
    expect((skillMocks.importSkill.mock.calls[0][0] as File).name).toBe(file.name);
    // 导入成功后重新拉一次列表，让新技能出现在界面上。
    await waitFor(() => expect(skillMocks.listSkills).toHaveBeenCalledTimes(2));
  });

  it("toggles a skill without reloading the list", async () => {
    skillMocks.setSkillEnabled.mockResolvedValue(disabledSkill);
    await renderPage([interviewSkill, disabledSkill]);

    // 技能列表是异步渲染的，用 findByRole 等它出现，而不是同步 getByRole——
    // 慢速 CI 上后者的时机不稳定，会报「找不到 switch」。
    fireEvent.click(await screen.findByRole("switch", { name: "停用技能 面试模拟官" }));

    await waitFor(() => expect(skillMocks.setSkillEnabled).toHaveBeenCalledWith(1, false));
    expect(await screen.findByText("已停用")).toBeInTheDocument();
  });

  it("deletes a skill only after confirmation", async () => {
    skillMocks.deleteSkill.mockResolvedValue(undefined);
    await renderPage();

    // 删除收在「更多」菜单里：同岗位/简历/收藏夹/技能工作台四处一致，
    // 不再是一枚常驻的红色图标。
    await openRowActionsMenu();
    fireEvent.click(await screen.findByText("删除技能"));

    expect(skillMocks.deleteSkill).not.toHaveBeenCalled();
    const confirm = await waitFor(() =>
      document.querySelector<HTMLButtonElement>(".ant-modal-confirm-btns .ant-btn-primary")!,
    );
    fireEvent.click(confirm);

    await waitFor(() => expect(skillMocks.deleteSkill).toHaveBeenCalledWith(1));
    // 删除后就地移除，不需要再拉一次列表。
    await waitFor(() => expect(screen.queryByText("面试模拟官")).not.toBeInTheDocument());
  });

  it("says what deleting a skill takes with it", async () => {
    skillMocks.deleteSkill.mockResolvedValue(undefined);
    await renderPage();

    // 删除范围（含知识文件）要写在确认框里，而不是等用户点下去才发现。
    await openRowActionsMenu();
    fireEvent.click(await screen.findByText("删除技能"));
    const dialog = await screen.findByRole("dialog");

    expect(dialog).toHaveTextContent("提示词和它附带的知识文件都会被删除");
  });
});
