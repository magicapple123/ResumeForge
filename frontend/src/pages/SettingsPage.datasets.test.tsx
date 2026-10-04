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
describe("SettingsPage datasets", () => {
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
    // 数据集在「数据」页里，而设置默认停在「AI 模型」页——先切过去，
    // 与真实用户的操作一致（不切换就看不到这份卡片）。
    fireEvent.click(screen.getByRole("tab", { name: "数据" }));
    return view;
  }

  it("lists the available datasets and marks the active one", async () => {
    apiMocks.listDatasets.mockResolvedValue([mainDataset, imported]);
    await renderPage();

    expect(await screen.findByText("主数据")).toBeInTheDocument();
    expect(screen.getByText("备份 A")).toBeInTheDocument();
    expect(screen.getByText("当前")).toBeInTheDocument();
  });

  it("downloads the active dataset", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    apiMocks.exportDataset.mockResolvedValue({
      blob: new Blob(["zip-bytes"], { type: "application/zip" }),
      filename: "resumeforge-backup-20260915.zip",
    });
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: /导出当前数据集/ }));

    await waitFor(() => expect(apiMocks.exportDataset).toHaveBeenCalledWith("main"));
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it("offers to export everything once there is more than one dataset", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    apiMocks.exportAllDatasets.mockResolvedValue({
      blob: new Blob(["zip-bytes"], { type: "application/zip" }),
      filename: "resumeforge-backup-all.zip",
    });
    apiMocks.listDatasets.mockResolvedValue([mainDataset, imported]);
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: /导出全部数据集/ }));

    await waitFor(() => expect(apiMocks.exportAllDatasets).toHaveBeenCalledOnce());
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it("hides the export-all button when there is only one dataset", async () => {
    // 只有一份时两个按钮做的事一模一样，多一个选择只是噪声；它出现本身才是信号。
    apiMocks.listDatasets.mockResolvedValue([mainDataset]);
    await renderPage();

    expect(await screen.findByText("主数据")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /导出全部数据集/ })).not.toBeInTheDocument();
  });

  it("imports a chosen archive as a new dataset without switching to it", async () => {
    apiMocks.importDataset.mockResolvedValue(imported);
    const { container } = await renderPage();

    const file = chooseBackupFile(container);

    await waitFor(() => expect(apiMocks.importDataset).toHaveBeenCalledOnce());
    // antd 会把 File 包一层再交给 beforeUpload，按属性断言更稳。
    expect((apiMocks.importDataset.mock.calls[0][0] as File).name).toBe(file.name);
    expect(apiMocks.importDataset.mock.calls[0][1]).toBe("backup");
    // 导入只新增数据集：既不会切过去，也不会重载页面。
    expect(apiMocks.activateDataset).not.toHaveBeenCalled();
    expect(navigationMocks.reloadPage).not.toHaveBeenCalled();
  });

  it("switches to another dataset and reloads the page", async () => {
    apiMocks.listDatasets.mockResolvedValue([mainDataset, imported]);
    apiMocks.activateDataset.mockResolvedValue({ ...imported, is_active: true });
    await renderPage();

    // 列表顺序即渲染顺序：主数据在前，可切换的那份在后。
    fireEvent.click(screen.getAllByRole("button", { name: /切换/ })[1]);

    await waitFor(() => expect(apiMocks.activateDataset).toHaveBeenCalledWith(imported.id));
    await waitFor(() => expect(navigationMocks.reloadPage).toHaveBeenCalled(), { timeout: 3000 });
  });

  it("renames a dataset", async () => {
    apiMocks.listDatasets.mockResolvedValue([mainDataset, imported]);
    apiMocks.renameDataset.mockResolvedValue({ ...imported, name: "校招专用" });
    await renderPage();

    // 重命名收进所在行的「···」菜单：主数据在前，可操作的那份在后。
    fireEvent.click(screen.getAllByRole("button", { name: "更多操作" })[1]);
    fireEvent.click(await screen.findByText("重命名"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "校招专用" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /保\s*存/ }));

    await waitFor(() =>
      expect(apiMocks.renameDataset).toHaveBeenCalledWith(imported.id, "校招专用"),
    );
  });

  it("keeps the rename dialog open when renaming fails", async () => {
    apiMocks.listDatasets.mockResolvedValue([mainDataset, imported]);
    apiMocks.renameDataset.mockRejectedValue(new Error("名称不能为空"));
    await renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: "更多操作" })[1]);
    fireEvent.click(await screen.findByText("重命名"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /保\s*存/ }));

    await waitFor(() => expect(apiMocks.renameDataset).toHaveBeenCalledOnce());
    // 失败时弹窗保留，用户可以改个名字重试。
    expect(screen.getByText("重命名数据集")).toBeInTheDocument();
  });

  it("deletes a dataset only after confirmation", async () => {
    apiMocks.listDatasets.mockResolvedValue([mainDataset, imported]);
    apiMocks.deleteDataset.mockResolvedValue(undefined);
    await renderPage();

    // 删除收进所在行的「···」菜单，且必须二次确认。
    fireEvent.click(screen.getAllByRole("button", { name: "更多操作" })[1]);
    fireEvent.click(await screen.findByText("删除"));

    expect(apiMocks.deleteDataset).not.toHaveBeenCalled();
    const confirm = await waitFor(() =>
      document.querySelector<HTMLButtonElement>(".ant-modal-confirm-btns .ant-btn-primary")!,
    );
    fireEvent.click(confirm);

    await waitFor(() => expect(apiMocks.deleteDataset).toHaveBeenCalledWith(imported.id));
  });

  it("does not offer switching or deleting the active dataset", async () => {
    await renderPage();

    expect(screen.getByRole("button", { name: /切换/ })).toBeDisabled();

    // 保护项的「重命名/删除」不再用禁用按钮表达，而是收进「···」菜单的禁用菜单项。
    fireEvent.click(screen.getAllByRole("button", { name: "更多操作" })[0]);
    const renameItem = await screen.findByRole("menuitem", { name: "重命名" });
    expect(renameItem).toHaveAttribute("aria-disabled", "true");
    const deleteItem = await screen.findByRole("menuitem", { name: "删除" });
    expect(deleteItem).toHaveAttribute("aria-disabled", "true");
  });
});
