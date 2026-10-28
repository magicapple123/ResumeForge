// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页的**页签结构**守卫：六个顶层页签都在、默认停在「AI 模型」、以及
 * "语言 / 简历字体 / 界面与导航三张卡在外观页签里同级连续排列"。
 *
 * 为什么要单独一条：用户提的原始诉求就是"语言要单独成一张卡、和字体、导航平级"。
 * 卡片摆在哪一页、和谁挨着，是这一页设计的一部分，光靠人眼看截图守不住。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import SettingsPage from "./SettingsPage";
import { t } from "../i18n";

const apiMocks = vi.hoisted(() => ({
  acknowledgeUpdateInstallResult: vi.fn(),
  activateDataset: vi.fn(),
  activateLLMRecord: vi.fn(),
  activateResumeFont: vi.fn(),
  checkForUpdate: vi.fn(),
  checkLLMThinking: vi.fn(),
  deleteDataset: vi.fn(),
  deleteLLMConfigRecord: vi.fn(),
  deleteResumeFont: vi.fn(),
  exportAllDatasets: vi.fn(),
  exportDataset: vi.fn(),
  getAppForm: vi.fn(),
  getAssistantOrbSetting: vi.fn(),
  getBackupStatus: vi.fn(),
  getBuiltinFont: vi.fn(),
  getLLMConfig: vi.fn(),
  getNavigationVisibility: vi.fn(),
  getReminderPopupSetting: vi.fn(),
  getSearchConfig: vi.fn(),
  getUpdateDownloadStatus: vi.fn(),
  getUpdateInstallResult: vi.fn(),
  importDataset: vi.fn(),
  installDownloadedUpdate: vi.fn(),
  listDatasets: vi.fn(),
  listLLMConfigRecords: vi.fn(),
  listResumeFonts: vi.fn(),
  renameDataset: vi.fn(),
  renameResumeFont: vi.fn(),
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
  name: "main",
  source: "local",
  size_bytes: 4096,
  created_at: null,
  is_active: true,
  exists: true,
};

const builtinStatus = {
  id: "source-han-sans-sc",
  label: "Source Han Sans",
  size_total: 0,
  downloaded: false,
  downloaded_bytes: 0,
  total_bytes: 0,
  state: "idle",
  error: "",
};

beforeEach(() => {
  apiMocks.getAppForm.mockResolvedValue({
    desktop: false,
    platform: "win32",
    app_version: "1.0.2",
  });
  apiMocks.getLLMConfig.mockResolvedValue({
    provider: "openai",
    base_url: "https://api.openai.com/v1",
    api_key: "********",
    model: "gpt-4o-mini",
    temperature: 0.1,
    timeout_seconds: 120,
    max_tokens: 4096,
  });
  apiMocks.checkLLMThinking.mockResolvedValue({
    style: "reasoning_effort",
    efforts: ["low", "medium", "high"],
    supported: false,
    note: "",
    probed: false,
    accepted: null,
    reasoning_seen: false,
    message: "",
  });
  apiMocks.listLLMConfigRecords.mockResolvedValue([]);
  apiMocks.listDatasets.mockResolvedValue([mainDataset]);
  apiMocks.revealLLMApiKey.mockResolvedValue({ api_key: "sk-revealed" });
  apiMocks.getNavigationVisibility.mockResolvedValue({ hidden: [] });
  apiMocks.getAssistantOrbSetting.mockResolvedValue({ enabled: true, tips_enabled: true });
  apiMocks.getReminderPopupSetting.mockResolvedValue({ enabled: true });
  apiMocks.getSearchConfig.mockResolvedValue({
    sources: ["bing", "duckduckgo"],
    searxng_url: "",
    fetch_pages: 0,
    max_results: 8,
  });
  apiMocks.getBuiltinFont.mockResolvedValue(builtinStatus);
  apiMocks.listResumeFonts.mockResolvedValue({ items: [], active: null, max_bytes: 0 });
  apiMocks.getBackupStatus.mockResolvedValue({
    dataset_id: "main",
    protected: false,
    last_success: null,
    last_attempt: null,
    consecutive_failures: 0,
    last_error: "",
    interval_days: 7,
    overdue: false,
    snapshot_count: 0,
    snapshots: [],
  });
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
  // 有待汇报的更新结果时 UpdateCard 会弹确认框，把页签用例搅乱。
  apiMocks.getUpdateInstallResult.mockResolvedValue(null);
  apiMocks.acknowledgeUpdateInstallResult.mockResolvedValue(undefined);
  skillMocks.listSkills.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage() {
  render(
    <MemoryRouter>
      <AntdApp>
        <SettingsPage />
      </AntdApp>
    </MemoryRouter>,
  );
}

/**
 * 当前页签里所有 `settings-card` 的标题（按 DOM 顺序）。
 *
 * 页签容器在 antd 6 里的类名是 `.ant-tabs-content` + `-active`（不是旧版的
 * `-tabpane`），且**非当前页签的内容仍留在 DOM 里**（只是 hidden），所以必须按
 * active 那一层限定，否则会把别的页签的卡一起数进来。
 */
function activeCardTitles(): string[] {
  const pane = document.querySelector(".ant-tabs-content-active");
  if (pane === null) return [];
  return Array.from(pane.querySelectorAll(".settings-card > .ant-card-head .ant-card-head-title"))
    .map((node) => (node.textContent ?? "").trim())
    .filter((text) => text.length > 0);
}

describe("SettingsPage 页签结构", () => {
  it("renders the six top-level tabs", async () => {
    renderPage();
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    const labels = screen.getAllByRole("tab").map((node) => (node.textContent ?? "").trim());
    expect(labels).toEqual([
      t("settings.tab.model"),
      t("settings.tab.assistant"),
      t("settings.tab.appearance"),
      t("settings.tab.data"),
      t("settings.tab.backup"),
      t("settings.tab.about"),
    ]);
  });

  it("starts on the model tab", async () => {
    renderPage();
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    expect(screen.getByRole("tab", { name: t("settings.tab.model") })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // 模型页的第一张卡就是模型配置卡（不依赖"人去点一下才有内容"）。
    expect(await screen.findByText(t("settings.model.group.title"))).toBeInTheDocument();
  });

  it("keeps language, font and navigation cards side by side in the appearance tab", async () => {
    renderPage();
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("tab", { name: t("settings.tab.appearance") }));

    // 语言卡现在有自己的 Card 外壳，因此这三张（以及快捷键）都是同级 .settings-card。
    await waitFor(() => expect(apiMocks.listResumeFonts).toHaveBeenCalled());

    const titles = activeCardTitles();
    const languageIndex = titles.indexOf(t("settings.locale.title"));
    const fontIndex = titles.indexOf(t("fonts.card.title"));
    const navigationIndex = titles.indexOf(t("navigation.settings.title"));

    expect(languageIndex).toBeGreaterThanOrEqual(0);
    // 同级且连续：中间不许插别的卡（分组标题不是卡，不算打断）。
    expect(fontIndex).toBe(languageIndex + 1);
    expect(navigationIndex).toBe(languageIndex + 2);
  });

  it("shows the search and skills cards on the assistant tab, not on the model tab", async () => {
    renderPage();
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    // 模型页只有模型配置与外发用量：搜索与技能已经搬走。
    expect(activeCardTitles()).not.toContain(t("searchCard.title"));

    fireEvent.click(screen.getByRole("tab", { name: t("settings.tab.assistant") }));

    await waitFor(() => expect(skillMocks.listSkills).toHaveBeenCalled());
    expect(await screen.findByText(t("searchCard.title"))).toBeInTheDocument();
  });
});
