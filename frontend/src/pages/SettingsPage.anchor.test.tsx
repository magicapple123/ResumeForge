// SPDX-License-Identifier: Apache-2.0
/**
 * #9：「去配置」的落点（`/settings?tab=…#anchor`）在设置页这一层的行为。
 *
 * 为什么单独一条用例：矩阵里的「去配置」拼出的 URL 有两段，缺一段就落不到目标行——
 *
 * - `?tab=` 决定**先切分组**（隐藏分组里的元素 `display:none`，滚过去等于没滚）；
 * - `#anchor` 决定滚到哪一行，而那一行是**异步渲染**的（凭据列表要等一次请求）。
 *
 * 所以这里用替身面板模拟"120ms 后才出现的那一行"，钉住"重试到命中为止"这条契约：
 * 一次性 `scrollIntoView` 在真实数据下必然抢跑，这正是改造前"点了去配置没反应"的根因。
 */
import { App as AntdApp } from "antd";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import SettingsPage from "./SettingsPage";

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

vi.mock("../utils/navigation", () => navigationMocks);

/** 落点锚点：矩阵「去配置」拼进 URL 的 `#` 部分。 */
const ANCHOR = "conn-search-beta";

/**
 * 面板替身：只有「外部连接」那组会**延迟**渲染一行（模拟 `/api/connections` 往返），
 * 其余分组渲染一个标题即可——这条用例只关心"页面能不能等到那一行"。
 */
vi.mock("../features/settings/SettingsPanels", () => {
  const Empty = () => null;
  const ConnectionsPanel = () => {
    const [ready, setReady] = useState(false);
    useEffect(() => {
      const timer = window.setTimeout(() => setReady(true), 120);
      return () => window.clearTimeout(timer);
    }, []);
    if (!ready) return <p>loading connections</p>;
    return (
      <div id={ANCHOR} className="connection-row">
        DeepSeek
      </div>
    );
  };
  return {
    AboutPanel: Empty,
    AppearancePanel: Empty,
    AssistantBehaviorPanel: Empty,
    BackupPanel: Empty,
    ConnectionsPanel,
    DataPanel: Empty,
    InteractionPanel: Empty,
    MemorySkillsPanel: Empty,
    ModelPanel: Empty,
    NotificationsPanel: Empty,
    VoicePanel: Empty,
  };
});

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
    efforts: [],
    supported: false,
    note: "",
    probed: false,
    accepted: null,
    reasoning_seen: false,
    message: "",
  });
  apiMocks.listLLMConfigRecords.mockResolvedValue([]);
  apiMocks.listDatasets.mockResolvedValue([]);
  apiMocks.getNavigationVisibility.mockResolvedValue({ hidden: [] });
  apiMocks.getAssistantOrbSetting.mockResolvedValue({ enabled: true, tips_enabled: true });
  apiMocks.getReminderPopupSetting.mockResolvedValue({ enabled: true });
  apiMocks.getSearchConfig.mockResolvedValue({
    sources: ["bing"],
    searxng_url: "",
    fetch_pages: 0,
    max_results: 8,
  });
  apiMocks.getBuiltinFont.mockResolvedValue({
    id: "source-han-sans-sc",
    label: "Source Han Sans",
    size_total: 0,
    downloaded: false,
    downloaded_bytes: 0,
    total_bytes: 0,
    state: "idle",
    error: "",
  });
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
    current_version: "1.0.2",
    target_version: "",
    progress: 0,
    downloaded_bytes: 0,
    total_bytes: null,
    background: false,
    installable: false,
    message: "",
  });
  apiMocks.getUpdateInstallResult.mockResolvedValue(null);
  skillMocks.listSkills.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // `window.location` 是跨用例共享的：不清掉，下一条会读到上一条的 hash。
  window.history.replaceState(null, "", "/");
});

function renderPage(entry: string) {
  // `MemoryRouter` 只维护自己的内存历史，**不会**改 `window.location`；而页面读的是
  // `window.location.hash`（真实运行时 BrowserRouter 写的也是它）。所以这里手动摆好
  // `location`，否则用例测的是"没有 hash"那条分支。
  window.history.replaceState(null, "", entry);
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AntdApp>
        <SettingsPage />
      </AntdApp>
    </MemoryRouter>,
  );
}

describe("SettingsPage 深链锚点", () => {
  it("等异步行渲染出来后滚到它并高亮（不是一次 scrollIntoView 抢跑）", async () => {
    renderPage(`/settings?tab=connections#${ANCHOR}`);
    expect(window.location.hash).toBe(`#${ANCHOR}`);

    // 面板先渲染 loading，120ms 后才出现目标行：这一刻之前页面必须还在等。
    expect(screen.getByText("loading connections")).toBeInTheDocument();
    expect(document.getElementById(ANCHOR)).toBeNull();

    // 行出现（≈120ms）之后、重试预算（≈2s）之内必须命中并高亮：一次性 scrollIntoView
    // 在这里会抢在渲染之前跑完，永远不会高亮。
    await waitFor(
      () => {
        expect(document.getElementById(ANCHOR)?.classList.contains("settings-card-target")).toBe(
          true,
        );
      },
      { timeout: 1800 },
    );
    const row = document.getElementById(ANCHOR) as HTMLElement;
    expect(row).toHaveClass("connection-row");
  });

  it("锚点属于没切过去的分组时不抢滚动，页面停在该分组（先切 tab 再滚动）", async () => {
    renderPage(`/settings?tab=model#${ANCHOR}`);

    // 「外部连接」这一组没被访问过 = 面板没挂载 = 目标行根本不存在。
    expect(document.querySelector('.settings-nav-item[data-section="model"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(document.getElementById(ANCHOR)).toBeNull();
    // 等满重试预算（≈2s）后仍然没有任何元素被高亮，而且页面没有被拉走。
    await new Promise((resolve) => setTimeout(resolve, 2200));
    expect(document.querySelector(".settings-card-target")).toBeNull();
    // 内容区仍停在一个可见分组上（没有被"滚到别的组"的锚点拽走）。
    expect(document.querySelector(".settings-body .settings-section:not([hidden])")).not.toBeNull();
    expect(document.querySelector('.settings-nav-item[data-section="model"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
