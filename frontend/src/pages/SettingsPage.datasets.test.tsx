// SPDX-License-Identifier: Apache-2.0
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./SettingsPage";
import { ApiError } from "../api/client";

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

// 409 重试路径要"重新同步身份再试一次"：只替换 initializeDatasetScope，
// 保留 datasetScopeHeaders 等真实实现（client.ts 依赖它们）。
const datasetScopeMocks = vi.hoisted(() => ({ initializeDatasetScope: vi.fn() }));

vi.mock("../api/datasetScope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/datasetScope")>();
  return { ...actual, initializeDatasetScope: datasetScopeMocks.initializeDatasetScope };
});

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
  datasetScopeMocks.initializeDatasetScope.mockResolvedValue(undefined);
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
    // 设置默认停在「AI 模型」页，先切到「数据」页（不切换就看不到这张卡片）。
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

  /** 「导出」收进了下拉菜单：先点开菜单，再点对应菜单项。 */
  /**
   * 打开导出菜单并确认命名弹窗（R15：导出前先问下载名）。
   *
   * 返回用户在弹窗里看到并确认的文件名——断言里用它核对"名字真的传出去了"。
   */
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

  it("downloads the active dataset", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    apiMocks.exportDataset.mockResolvedValue({
      blob: new Blob(["zip-bytes"], { type: "application/zip" }),
      filename: "resumeforge-backup-20260915.zip",
    });
    await renderPage();

    const filename = await openExportMenu(/导出当前数据集/);

    // 默认带上配置与密钥；第四个参数是 R15 的下载名（默认 `<数据集名>-<时间戳>`）。
    await waitFor(() =>
      expect(apiMocks.exportDataset).toHaveBeenCalledWith("main", true, true, filename),
    );
    expect(filename).toMatch(/^主数据-\d{8}-\d{6}$/);
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });
  it("couples API keys with the global model config switch", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    apiMocks.exportDataset.mockResolvedValue({
      blob: new Blob(["zip-bytes"], { type: "application/zip" }),
      filename: "resumeforge-backup-20260915.zip",
    });
    await renderPage();

    const checkbox = screen.getByRole("checkbox", {
      name: /备份中包含全局模型配置与 API Key/,
    });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    const filename = await openExportMenu(/导出当前数据集/);
    // 取消勾选 = 配置与密钥都不带（不再有单独的密钥开关）。
    await waitFor(() =>
      expect(apiMocks.exportDataset).toHaveBeenCalledWith("main", false, false, filename),
    );

    fireEvent.click(checkbox);
    await openExportMenu(/导出当前数据集/);
    await waitFor(() =>
      expect(apiMocks.exportDataset).toHaveBeenLastCalledWith(
        "main",
        true,
        true,
        expect.any(String),
      ),
    );
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

    await openExportMenu(/导出全部数据集/);

    await waitFor(() => expect(apiMocks.exportAllDatasets).toHaveBeenCalledOnce());
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it("hides the export-all entry when there is only one dataset", async () => {
    // 只有一份时两个入口做的事一模一样，多一个选择只是噪声；它出现本身才是信号。
    apiMocks.listDatasets.mockResolvedValue([mainDataset]);
    await renderPage();

    expect(await screen.findByText("主数据")).toBeInTheDocument();
    fireEvent.click(exportTrigger());
    expect(await screen.findByRole("menuitem", { name: /导出当前数据集/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /导出全部数据集/ })).not.toBeInTheDocument();
  });

  it("shows only the first 5 datasets until 展开其余 is requested", async () => {
    const extras = Array.from({ length: 6 }, (_, index) => ({
      ...imported,
      id: `extra-${index}`,
      name: `备份 ${index + 2}`,
    }));
    apiMocks.listDatasets.mockResolvedValue([mainDataset, imported, ...extras]);
    await renderPage();

    expect(await screen.findByText("主数据")).toBeInTheDocument();
    // 列表默认只渲染前 5 份，其余收进「显示全部」（展示层折叠，不裁剪接口数据）。
    expect(screen.queryByText("备份 6")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "显示全部 8 条" }));
    expect(await screen.findByText("备份 6")).toBeInTheDocument();
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

  it("reports the global model configs restored with the archive", async () => {
    apiMocks.importDataset.mockResolvedValue({
      ...imported,
      global_llm: { imported: 2, updated: 1, skipped: 1, profiles: 3 },
    });
    const { container } = await renderPage();

    chooseBackupFile(container);

    expect(await screen.findByText(/全局模型配置已恢复 3 条（跳过 1 条同名）/)).toBeInTheDocument();
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

  it("resyncs a stale dataset scope and switches on the retry", async () => {
    // f92d26df：页面手里的 token 过期后，第一个写请求（恰好是"切换数据集"）必吃 409。
    // 这不是"有任务在跑"，重同步身份后重试一次就能成。
    apiMocks.listDatasets.mockResolvedValue([mainDataset, imported]);
    apiMocks.activateDataset
      .mockRejectedValueOnce(
        new ApiError("数据集已切换，请保留草稿并刷新页面后重新打开；本次操作未执行", 409, {
          code: "http",
          businessCode: "dataset_scope_changed",
        }),
      )
      .mockResolvedValueOnce({ ...imported, is_active: true });
    await renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: /切换/ })[1]);

    await waitFor(() => expect(apiMocks.activateDataset).toHaveBeenCalledTimes(2));
    // 重试打的还是同一份数据集（不是"随便再切一次"）。
    expect(apiMocks.activateDataset.mock.calls.map((call) => call[0])).toEqual([
      imported.id,
      imported.id,
    ]);
    expect(datasetScopeMocks.initializeDatasetScope).toHaveBeenCalledOnce();
    // 成功提示只弹一次：重试成功不能变成"一条错误 + 一条成功"。
    expect(await screen.findAllByText(/已切换到「备份 A」/)).toHaveLength(1);
    expect(screen.queryByText(/请先停止或等待当前任务完成/)).toBeNull();
    await waitFor(() => expect(navigationMocks.reloadPage).toHaveBeenCalled(), { timeout: 3000 });
  });

  it("does not retry a 409 that only means a switch is busy or draining", async () => {
    // 「切换中」「排空超时」两类 409 保持原行为：重试只会再撞一次，
    // 给用户的动作也是"等任务停下"，不是"重试"。
    apiMocks.listDatasets.mockResolvedValue([mainDataset, imported]);
    apiMocks.activateDataset.mockRejectedValueOnce(
      new ApiError("数据集正在切换中，请稍后再试", 409, { code: "http" }),
    );
    await renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: /切换/ })[1]);

    expect(await screen.findByText(/请先停止或等待当前任务完成/)).toBeInTheDocument();
    expect(apiMocks.activateDataset).toHaveBeenCalledOnce();
    expect(datasetScopeMocks.initializeDatasetScope).not.toHaveBeenCalled();
    expect(navigationMocks.reloadPage).not.toHaveBeenCalled();
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
