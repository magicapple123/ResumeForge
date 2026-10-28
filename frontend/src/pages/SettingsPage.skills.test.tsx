// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「助手能力 → 助手技能」：**只读摘要**。
 *
 * 本轮把技能管理入口收归工作台（`/skills`）：同一份技能数据只有一个能改的地方。
 * 所以这个文件的重点从"能导入 / 能开关 / 能删除"翻转成"这些写入口在设置页真的不存在"，
 * 外加"点技能名只是只读查看"与"去工作台管理能跳过去"。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./SettingsPage";

const apiMocks = vi.hoisted(() => ({
  acknowledgeUpdateInstallResult: vi.fn(),
  getAssistantOrbSetting: vi.fn(),
  checkForUpdate: vi.fn(),
  checkLLMThinking: vi.fn(),
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

// 设置页只用到 listSkills（读取）与 getSkill（只读查看详情）。整个 `../api/skill` 模块
// 都被 mock 掉了，所以这里把同模块的其余导出也一并列上，避免测试里出现 undefined 调用。
const skillMocks = vi.hoisted(() => ({
  deleteSkill: vi.fn(),
  importSkill: vi.fn(),
  listSkills: vi.fn(),
  setSkillEnabled: vi.fn(),
  getSkill: vi.fn(),
  createSkill: vi.fn(),
  updateSkill: vi.fn(),
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
      <MemoryRouter>
        <AntdApp>
          <SettingsPage />
        </AntdApp>
      </MemoryRouter>,
    );
    await waitFor(() => expect(skillMocks.listSkills).toHaveBeenCalled());
    // 助手技能卡从「AI 模型」迁到「助手与 AI 行为」：不切过去这张卡还没挂载。
    fireEvent.click(screen.getByRole("tab", { name: "助手与 AI 行为" }));
    return view;
  }

  it("lists skills with their status and knowledge file count", async () => {
    await renderPage([interviewSkill, disabledSkill]);

    expect(await screen.findByText("面试模拟官")).toBeInTheDocument();
    expect(screen.getByText("启用中")).toBeInTheDocument();
    expect(screen.getByText("已停用")).toBeInTheDocument();
    expect(screen.getByText(/2 份知识文件/)).toBeInTheDocument();
    expect(screen.getByText(/仅提示词/)).toBeInTheDocument();
  });

  it("says the workbench is where skills live when nothing is there yet", async () => {
    await renderPage([]);

    // 措辞随收权改过：这里不再有导入入口，空态不能说「还没有导入技能」。
    expect(await screen.findByText("还没有技能")).toBeInTheDocument();
  });

  it("给出去工作台管理的链接（技能的唯一管理入口）", async () => {
    await renderPage();

    const link = await screen.findByRole("link", { name: "去工作台管理" });
    expect(link).toHaveAttribute("href", "/skills");
  });

  it("没有任何技能写入口：导入 / 启用开关 / 删除都不在这页", async () => {
    const { container } = await renderPage([interviewSkill, disabledSkill]);

    // 页面上别处还有开关（放宽模式等），所以断言要限定在「助手技能」这张卡里。
    const card = (await screen.findByText("助手技能")).closest(".settings-card") as HTMLElement;
    expect(card).not.toBeNull();

    // 导入：既是按钮，也是一个真实的文件选择框。
    expect(within(card).queryByRole("button", { name: /导入技能/ })).toBeNull();
    expect(card.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    // 启用停用：行内开关。
    expect(within(card).queryByRole("switch")).toBeNull();
    // 删除：收在「更多操作」菜单里。
    expect(within(card).queryByRole("button", { name: "更多操作" })).toBeNull();
    expect(within(card).queryByText("删除技能")).toBeNull();
    // 从没因为"界面上的按钮"去调这三个写接口。
    expect(skillMocks.importSkill).not.toHaveBeenCalled();
    expect(skillMocks.setSkillEnabled).not.toHaveBeenCalled();
    expect(skillMocks.deleteSkill).not.toHaveBeenCalled();
  });

  it("点技能名只读查看详情：有「关闭」，没有「保存」", async () => {
    skillMocks.getSkill.mockResolvedValue({
      ...interviewSkill,
      prompt: "逐条追问，不许放宽标准。",
      file_details: [{ path: "题库.md", size_bytes: 12, content: "题一" }],
      files_truncated: false,
    });
    await renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "面试模拟官" }));

    // 标题与工作台的可编辑弹窗不同：这里只有「技能详情」。
    expect(await screen.findByText("技能详情")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
    // 没有任何一条路径能在设置页写回技能。
    expect(skillMocks.updateSkill).not.toHaveBeenCalled();
  });
});
