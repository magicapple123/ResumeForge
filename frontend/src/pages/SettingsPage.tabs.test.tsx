// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页的**分组结构**守卫：九个分组都在、分成三档导航标题、默认落在「AI 模型」、
 * "语言 / 简历字体 / 界面与导航三张卡在外观组里同级连续排列"，以及深链与搜索的落点。
 *
 * 为什么要单独一条：用户提的原始诉求就是"语言要单独成一张卡、和字体、导航平级"。
 * 卡片摆在哪一组、和谁挨着，是这一页设计的一部分，光靠人眼看截图守不住。
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
  // 有待汇报的更新结果时 UpdateCard 会弹确认框，把用例搅乱。
  apiMocks.getUpdateInstallResult.mockResolvedValue(null);
  apiMocks.acknowledgeUpdateInstallResult.mockResolvedValue(undefined);
  skillMocks.listSkills.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage(entry = "/settings") {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AntdApp>
        <SettingsPage />
      </AntdApp>
    </MemoryRouter>,
  );
}

/** 左侧导航项的文案（按 DOM 顺序）。 */
function navLabels(): string[] {
  return Array.from(document.querySelectorAll(".settings-nav-item")).map((node) =>
    (node.textContent ?? "").trim(),
  );
}

/**
 * 当前显示的那一组里所有 `settings-card` 的标题（按 DOM 顺序）。
 *
 * 分组切换不再卸载旧面板（保留各自的取数状态），所以必须按 `:not([hidden])` 限定，
 * 否则会把别的组的卡一起数进来。
 */
function activeCardTitles(): string[] {
  const pane = document.querySelector(".settings-section:not([hidden])");
  if (pane === null) return [];
  return Array.from(pane.querySelectorAll(".settings-card > .ant-card-head .ant-card-head-title"))
    .map((node) => (node.textContent ?? "").trim())
    .filter((text) => text.length > 0);
}

describe("SettingsPage 分组导航", () => {
  it("renders the nine sections under three nav groups", async () => {
    renderPage();
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    expect(navLabels()).toEqual([
      t("settings.tab.model"),
      t("settings.tab.assistant"),
      t("settings.tab.memorySkills"),
      t("settings.tab.voice"),
      t("settings.tab.appearance"),
      t("settings.tab.interaction"),
      t("settings.tab.data"),
      t("settings.tab.backup"),
      t("settings.tab.about"),
    ]);

    // 三档分组标题：导航是"目录"，标题本身也要在。
    const groupTitles = Array.from(document.querySelectorAll(".settings-nav-group-title")).map(
      (node) => (node.textContent ?? "").trim(),
    );
    expect(groupTitles).toEqual([
      t("settings.nav.group.ai"),
      t("settings.nav.group.interface"),
      t("settings.nav.group.data"),
    ]);
  });

  it("starts on the model section", async () => {
    renderPage();
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    expect(screen.getByRole("button", { name: t("settings.tab.model") })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // 内容区顶部是这一组的标题，第一张卡是模型配置卡（不依赖"人去点一下才有内容"）。
    expect(await screen.findByText(t("llmConfigCard.card.title"))).toBeInTheDocument();
    expect(activeCardTitles()[0]).toBe(t("llmConfigCard.card.title"));
  });

  it("keeps language, font and navigation cards side by side in the appearance section", async () => {
    renderPage();
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: t("settings.tab.appearance") }));

    // 语言卡现在有自己的 Card 外壳，因此这三张（以及悬浮球）都是同级 .settings-card。
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

  it("puts the search card in assistant behavior and the skills card in memory & skills", async () => {
    renderPage();
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    // 模型组只有模型配置、窗口参考、语义检索与外发用量：搜索与技能已经搬走。
    expect(activeCardTitles()).not.toContain(t("searchCard.title"));

    fireEvent.click(screen.getByRole("button", { name: t("settings.tab.assistant") }));
    expect(await screen.findByText(t("searchCard.title"))).toBeInTheDocument();
    expect(activeCardTitles()).not.toContain(t("settingsUi.skills.title"));

    fireEvent.click(screen.getByRole("button", { name: t("settings.tab.memorySkills") }));
    await waitFor(() => expect(skillMocks.listSkills).toHaveBeenCalled());
    expect(activeCardTitles()).toContain(t("settingsUi.skills.title"));
  });

  it("maps the legacy ?tab=assistant deep link to assistant behavior", async () => {
    renderPage("/settings?tab=assistant");
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    expect(screen.getByRole("button", { name: t("settings.tab.assistant") })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await screen.findByText(t("searchCard.title"))).toBeInTheDocument();
  });

  it("keeps the ?tab=backup deep link working after the regrouping", async () => {
    renderPage("/settings?tab=backup");
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    expect(screen.getByRole("button", { name: t("settings.tab.backup") })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  // 旧六个页签键一个都不能落空：assistant 走别名，其余五个与正式分组同名。
  it.each([
    ["model", "settings.tab.model"],
    ["assistant", "settings.tab.assistant"],
    ["appearance", "settings.tab.appearance"],
    ["data", "settings.tab.data"],
    ["backup", "settings.tab.backup"],
    ["about", "settings.tab.about"],
  ] as const)(
    "resolves the legacy ?tab=%s deep link to a non-empty group",
    async (tab, titleKey) => {
      renderPage(`/settings?tab=${tab}`);
      await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

      expect(screen.getByRole("button", { name: t(titleKey) })).toHaveAttribute(
        "aria-current",
        "page",
      );
      // 不能只是导航选中了：右侧那一组里必须真的有卡片。
      expect(activeCardTitles().length).toBeGreaterThan(0);
    },
  );

  it("jumps to the voice section and highlights the card when searching 音色", async () => {
    renderPage();
    await waitFor(() => expect(apiMocks.getLLMConfig).toHaveBeenCalledOnce());

    // 窄档的 Select 也叫 combobox，搜索框按它自己的容器取。
    const search = document.querySelector(".settings-search input") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "音色" } });
    // 下拉项按分组归并，命中项就是「面试语音」那张卡。
    const option = await screen.findByText(t("interviewVoice.settings.cardTitle"));
    fireEvent.click(option);

    await waitFor(() => expect(document.querySelector(".settings-card-target")).not.toBeNull());
    const target = document.querySelector(".settings-card-target") as HTMLElement;
    expect(target.textContent).toContain(t("interviewVoice.settings.cardTitle"));
    expect(screen.getByRole("button", { name: t("settings.tab.voice") })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
