// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「数据」页的**附件完整性 / 增量结果提示**（RR-03、R16）用例。
 *
 * 从 `SettingsPage.datasets.test.tsx` 里拆出来：那边已经贴住 500 行预算（见
 * `backend/tests/test_file_size_budget.py`）。两边的 mock 脚手架刻意各自完整复制——
 * `vi.mock` 的工厂是被提升到模块顶部的，没法从共享模块引用 hoisted 对象；为了让两个
 * 文件都能**独立**跑，宁可重复这几十行声明。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  getBackupStatus: vi.fn(),
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

describe("SettingsPage dataset assets", () => {
  const imported = {
    id: "0123456789abcdef",
    name: "备份 A",
    source: "导入",
    size_bytes: 2_048_000,
    created_at: "2026-09-15T10:00:00+08:00",
    is_active: false,
    exists: true,
  };

  function chooseBackupFile(container: HTMLElement) {
    // 设置页上有多个上传入口（技能、数据集），按 aria-label 定位而不是取第一个。
    const input = container.querySelector(
      'input[type="file"][aria-label="选择备份文件"]',
    ) as HTMLInputElement;
    const file = new File(["zip-bytes"], "backup.zip", { type: "application/zip" });
    fireEvent.change(input, { target: { files: [file] } });
    return file;
  }

  async function renderPage() {
    const view = render(
      <AntdApp>
        <SettingsPage />
      </AntdApp>,
    );
    await waitFor(() => expect(apiMocks.listDatasets).toHaveBeenCalled());
    // 设置默认停在「AI 模型」页，先切到「数据」页（不切换就看不到这张卡片）。
    fireEvent.click(screen.getByRole("tab", { name: "数据" }));
    return view;
  }

  /** 导出下拉的触发按钮：命名弹窗里也有「导出」，只按名字找会命中两个。 */
  function exportTrigger(): HTMLElement {
    const buttons = screen.getAllByRole("button", { name: /导\s*出$/ });
    const candidates = buttons.filter((el) => el.classList.contains("ant-dropdown-trigger"));
    if (candidates.length !== 1) throw new Error("没找到唯一的导出下拉按钮");
    return candidates[0];
  }

  async function openExportMenu(itemName: string | RegExp): Promise<string> {
    // antd 按钮的 accessible name 含图标名（"download导出"），按结尾匹配。
    fireEvent.click(exportTrigger());
    fireEvent.click(await screen.findByRole("menuitem", { name: itemName }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("导出文件名") as HTMLInputElement;
    const name = input.value;
    fireEvent.click(within(dialog).getByRole("button", { name: /导\s*出/ }));
    return name;
  }

  // ===== RR-03：附件不完整时不得播报成"完整恢复/完整备份" =====

  it("does not report a partial import as a clean success", async () => {
    apiMocks.importDataset.mockResolvedValue({
      ...imported,
      assets_incomplete: true,
      asset_issues: [
        "活动数据集 user_files/x.bin：本机已有同名但内容不同的附件，已保留本机文件（绝不覆盖）",
      ],
    });
    const { container } = await renderPage();

    chooseBackupFile(container);

    // 导入确实完成了，但界面必须说明这份备份不完整、问题在哪。
    expect(await screen.findByText(/不完整/)).toBeInTheDocument();
    expect(screen.getByText(/绝不覆盖/)).toBeInTheDocument();
  });

  it("names the datasets that failed to restore from a collection", async () => {
    // R16：整包逐份恢复，坏一份不影响其它份。只报"导入成功"会让用户以为整包都回来了。
    apiMocks.importDataset.mockResolvedValue({
      ...imported,
      restored_datasets: [{ id: "fedcba0987654321", name: "社招线" }],
      failed: [
        {
          id: "aaa",
          name: "校招线",
          error: "子包内容与清单的 SHA-256 不符（文件可能已损坏或被改动）",
        },
        { id: "bbb", name: "实习线", error: "包内缺少这份数据集的子包" },
      ],
      skipped: [],
      summary: { restored: 2, skipped: 0, failed: 2 },
    });
    const { container } = await renderPage();

    chooseBackupFile(container);

    expect(await screen.findByText(/2 份数据集失败/)).toBeInTheDocument();
    expect(screen.getByText(/校招线：子包内容与清单的 SHA-256 不符/)).toBeInTheDocument();
    expect(screen.getByText(/实习线：包内缺少/)).toBeInTheDocument();
    // 成功路径的既有文案不变。
    expect(screen.getByText(/已导入数据集「备份 A」/)).toBeInTheDocument();
  });

  it("offers an explicit opt-in before importing a package with broken assets", async () => {
    apiMocks.importDataset.mockRejectedValueOnce(
      new Error(
        "备份包的附件未通过校验，已停止导入（没有写入任何数据）：活动数据集 user_files/x.bin：备份包中缺少该附件",
      ),
    );
    const { container } = await renderPage();

    chooseBackupFile(container);

    // 默认拒绝：不重试、不静默降级，先让用户看到问题。
    expect(await screen.findByText(/附件未通过校验/)).toBeInTheDocument();
    expect(apiMocks.importDataset).toHaveBeenCalledTimes(1);

    // 用户显式点「跳过附件继续导入」后才带着 allow_partial_assets 重试。
    apiMocks.importDataset.mockResolvedValueOnce(imported);
    fireEvent.click(await screen.findByRole("button", { name: "跳过附件继续导入" }));

    await waitFor(() => expect(apiMocks.importDataset).toHaveBeenCalledTimes(2));
    expect(apiMocks.importDataset.mock.calls[1][1]).toBe("backup");
    expect(apiMocks.importDataset.mock.calls[1][2]).toBe(true);
  });

  it("warns that an exported archive with missing attachments is incomplete", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    apiMocks.exportDataset.mockResolvedValue({
      blob: new Blob(["zip-bytes"], { type: "application/zip" }),
      filename: "resumeforge-backup-20260915.zip",
      incompleteBackup: true,
      assetIssues: { missing: 2, mismatched: 0, missingAtImport: 0, incomplete: true },
    });
    await renderPage();

    await openExportMenu(/导出当前数据集/);

    expect(await screen.findByText(/不完整/)).toBeInTheDocument();
    expect(await screen.findByText(/有 2 个被引用的附件在磁盘上找不到/)).toBeInTheDocument();
    click.mockRestore();
  });

  it("treats attachments missing at import as a note, not an incomplete backup", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    apiMocks.exportDataset.mockResolvedValue({
      blob: new Blob(["zip-bytes"], { type: "application/zip" }),
      filename: "resumeforge-backup-20260915.zip",
      incompleteBackup: false,
      assetIssues: { missing: 0, mismatched: 0, missingAtImport: 3, incomplete: false },
    });
    await renderPage();

    await openExportMenu(/导出当前数据集/);

    // 成功提示 + 一条说明，而不是"备份不完整"的警告。
    expect(await screen.findByText(/另有 3 个附件在该数据集导入时就已缺失/)).toBeInTheDocument();
    expect(screen.queryByText(/备份「不完整」/)).toBeNull();
    click.mockRestore();
  });

  // ===== H3：包外的数据目录项（未纳入备份）与自定义字体的恢复结果 =====

  /**
   * 当前所有轻提示（antd message）的文本。
   *
   * 负向断言只看提示条：设置页正文里的隐私卡本来就写着「另有 N 项未纳入备份」这类说明
   * 文案，整页搜文本会把页面文案误判成"多弹了一条提示"。
   */
  function toastTexts(): string[] {
    return Array.from(document.querySelectorAll(".ant-message-notice-content")).map(
      (node) => node.textContent ?? "",
    );
  }

  it("names the data-directory items the archive did not cover", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    apiMocks.exportDataset.mockResolvedValue({
      blob: new Blob(["zip-bytes"], { type: "application/zip" }),
      filename: "resumeforge-backup-20260915.zip",
      incompleteBackup: false,
      assetIssues: { missing: 0, mismatched: 0, missingAtImport: 0, incomplete: false },
      coverage: { count: 2, bytes: 2048, truncated: false },
    });
    await renderPage();

    await openExportMenu(/导出当前数据集/);

    // 项数与体积都要说，并把用户指到包内 manifest.json 的 uncovered 段。
    expect(await screen.findByText(/另有 2 项（2 KB）未纳入备份/)).toBeInTheDocument();
    expect(screen.getByText(/manifest\.json 的 uncovered 段/)).toBeInTheDocument();
    // 这是"范围"说明，不是"备份不完整"：附件没丢就不该报那个警告。
    expect(screen.queryByText(/备份「不完整」/)).toBeNull();
    click.mockRestore();
  });

  it("stays silent about coverage when the archive covers everything", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    apiMocks.exportDataset.mockResolvedValue({
      blob: new Blob(["zip-bytes"], { type: "application/zip" }),
      filename: "resumeforge-backup-20260915.zip",
      incompleteBackup: false,
      assetIssues: { missing: 0, mismatched: 0, missingAtImport: 0, incomplete: false },
      coverage: { count: 0, bytes: 0, truncated: false },
    });
    await renderPage();

    await openExportMenu(/导出当前数据集/);

    // 成功提示照旧，且**不许多出**任何"未纳入备份"的话（既有提示被测试钉住）。
    expect(await screen.findByText(/已导出「主数据」到浏览器的下载目录/)).toBeInTheDocument();
    expect(toastTexts().some((text) => text.includes("未纳入备份"))).toBe(false);
    click.mockRestore();
  });

  it("reports the custom fonts restored with the archive", async () => {
    apiMocks.importDataset.mockResolvedValue({
      ...imported,
      restored_fonts: 2,
      skipped_fonts: 1,
      active_font_set: true,
    });
    const { container } = await renderPage();

    chooseBackupFile(container);

    // 恢复了几份、有几份保本机版本，都要在同一句成功提示里说清楚。
    expect(await screen.findByText(/恢复了 2 个自定义字体/)).toBeInTheDocument();
    expect(screen.getByText(/1 个同名字体保留本机版本/)).toBeInTheDocument();
  });

  it("warns about fonts that could not be restored without calling the archive incomplete", async () => {
    apiMocks.importDataset.mockResolvedValue({
      ...imported,
      restored_fonts: 1,
      font_issues: ["字体「x.ttf」校验失败"],
    });
    const { container } = await renderPage();

    chooseBackupFile(container);

    expect(await screen.findByText(/字体未完全恢复：字体「x\.ttf」校验失败/)).toBeInTheDocument();
    // 字体问题不属于"附件不完整"：否则用户会以为简历里的附件丢了。
    expect(toastTexts().some((text) => text.includes("不完整"))).toBe(false);
    // 成功提示也照旧在（数据集本身恢复完整）。
    expect(screen.getByText(/已导入数据集「备份 A」/)).toBeInTheDocument();
  });
});
