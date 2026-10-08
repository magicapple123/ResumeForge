/**
 * 网申填表页面。
 *
 * 这个页面要守住的最重要一条是**只填不交**：界面上不得出现任何"提交"按钮——填充做完就
 * 结束，提交必须由用户回到浏览器窗口自己做。如果哪天有人为了"顺手一点"加上一个提交入口，
 * 这里会红。
 *
 * 其次守的是**冲突不覆盖**：页面上已经有值、且与资料不同时，那一行默认不勾选。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserStatus, WebFormLive, WebFormPreview, WebFormSnapshot } from "../types";
import { WEB_FORM_SESSION_STORAGE_KEY } from "../features/webform/webFormSessionStorage";
import WebFormPage from "./WebFormPage";

const apiMocks = vi.hoisted(() => ({
  listWebFormFields: vi.fn(),
  getWebFormBrowserStatus: vi.fn(),
  startWebFormBrowser: vi.fn(),
  stopWebFormBrowser: vi.fn(),
  takeWebFormSnapshot: vi.fn(),
  previewWebForm: vi.fn(),
  fillWebForm: vi.fn(),
  getWebFormLiveStatus: vi.fn(),
  startWebFormLive: vi.fn(),
  setWebFormLiveEnabled: vi.fn(),
  stopWebFormLive: vi.fn(),
  getWebFormMemoryTargets: vi.fn(),
  rememberWebFormLive: vi.fn(),
  listWebFormRecords: vi.fn(),
  getWebFormRecord: vi.fn(),
  deleteWebFormRecord: vi.fn(),
  listWebFormUrlHistory: vi.fn(),
  deleteWebFormUrlHistory: vi.fn(),
  openWebFormUrl: vi.fn(),
  listWebFormBrowserTargets: vi.fn(),
  setWebFormBrowserTargetLive: vi.fn(),
}));

vi.mock("../api/webform", () => apiMocks);

const settingsMocks = vi.hoisted(() => ({ getLLMConfig: vi.fn() }));

vi.mock("../api/settings", () => settingsMocks);

function browserStatus(overrides: Partial<BrowserStatus> = {}): BrowserStatus {
  return {
    state: "running",
    port: 9333,
    profile_dir: "D:/ResumeForge/backend/data/browser-profile",
    browser_path: "C:/chrome.exe",
    browser_name: "Google Chrome",
    entry_url: "",
    logged_in_hint: "",
    ...overrides,
  } as BrowserStatus;
}

function preview(overrides: Partial<WebFormPreview> = {}): WebFormPreview {
  return {
    snapshot_id: "snap-1",
    page: { url: "https://example.com/apply", title: "网申", control_count: 2 },
    items: [
      {
        index: 0,
        field: "name",
        field_label: "姓名",
        value: "张三",
        control_label: "姓名",
        control_type: "text",
        status: "ready",
        source: "rule",
        current_value: "",
        options: [],
        note: "",
      },
      {
        index: 1,
        field: "phone",
        field_label: "手机号",
        value: "13800000000",
        control_label: "手机号",
        control_type: "text",
        status: "conflict",
        source: "rule",
        current_value: "13900000000",
        options: [],
        note: "页面上已填“13900000000”，默认保留它",
      },
    ],
    missing_data: [],
    unrecognized: [],
    blocked: [],
    default_indexes: [0],
    // 默认没有可记的：多数用例关心的是"填进去"，不是"要不要记住"。
    learning: { candidates: [] },
    ...overrides,
  };
}

function liveStatus(overrides: Partial<WebFormLive> = {}): WebFormLive {
  return {
    running: false,
    field_label: "",
    value: "",
    status: "",
    note: "",
    source: "",
    alternatives: [],
    filled: 0,
    remember_pending: null,
    ...overrides,
  };
}

function renderPage(initialEntries: string[] = ["/webform"]) {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={initialEntries}>
        <WebFormPage />
      </MemoryRouter>
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.listWebFormUrlHistory.mockResolvedValue({ items: [] });
  apiMocks.listWebFormBrowserTargets.mockResolvedValue({ items: [] });
  apiMocks.deleteWebFormUrlHistory.mockResolvedValue(undefined);
  apiMocks.openWebFormUrl.mockResolvedValue({ target_id: "target-1", url: "https://example.com" });
  apiMocks.setWebFormBrowserTargetLive.mockImplementation(
    async (targetId: string, enabled: boolean) => ({
      target_id: targetId,
      live_enabled: enabled,
    }),
  );
  window.sessionStorage.clear();
  apiMocks.getWebFormBrowserStatus.mockResolvedValue(browserStatus());
  apiMocks.takeWebFormSnapshot.mockResolvedValue({
    snapshot_id: "snap-1",
    page: { url: "https://example.com/apply", title: "网申", control_count: 2 },
  } as WebFormSnapshot);
  apiMocks.previewWebForm.mockResolvedValue(preview());
  apiMocks.fillWebForm.mockResolvedValue({ outcomes: [], filled: 1, unverified: 0, failed: 0 });
  apiMocks.listWebFormRecords.mockResolvedValue([]);
  apiMocks.getWebFormLiveStatus.mockResolvedValue(liveStatus());
  apiMocks.startWebFormLive.mockResolvedValue(liveStatus());
  apiMocks.setWebFormLiveEnabled.mockResolvedValue(liveStatus({ running: true, enabled: false }));
  apiMocks.stopWebFormLive.mockResolvedValue(liveStatus());
  apiMocks.getWebFormMemoryTargets.mockResolvedValue({ targets: [] });
  apiMocks.rememberWebFormLive.mockResolvedValue({ saved: true, live: liveStatus() });
  settingsMocks.getLLMConfig.mockResolvedValue({
    base_url: "https://api.example.com/v1",
    model: "m",
  });
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.resetAllMocks();
});

describe("WebFormPage", () => {
  it("has no button whose label says 提交", async () => {
    // 这是这个功能的硬边界：程序只填不交。任何文案里带"提交"的按钮都是违规的。
    apiMocks.previewWebForm.mockResolvedValue(preview());
    renderPage();
    await waitFor(() => expect(apiMocks.getWebFormBrowserStatus).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: /提交/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /投递/ })).not.toBeInTheDocument();
  });

  it("says out loud that it will not submit for the user", async () => {
    renderPage();
    await waitFor(() => expect(apiMocks.getWebFormBrowserStatus).toHaveBeenCalled());

    expect(screen.getByText(/这个功能只负责把资料填进页面，不会替你提交/)).toBeInTheDocument();
  });

  it("disables reading the form until the browser is running", async () => {
    apiMocks.getWebFormBrowserStatus.mockResolvedValue(browserStatus({ state: "running" }));
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /读取当前表单/ })).toBeDisabled(),
    );
  });

  it("允许手动刷新浏览器状态，并把已关闭的窗口显示成未启动", async () => {
    apiMocks.getWebFormBrowserStatus
      .mockResolvedValueOnce(browserStatus({ state: "running" }))
      .mockResolvedValue(browserStatus({ state: "stopped" }));
    renderPage();
    await waitFor(() => expect(apiMocks.getWebFormBrowserStatus).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "刷新浏览器状态" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "开启专用浏览器" })).toBeInTheDocument(),
    );
    expect(apiMocks.getWebFormBrowserStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("leaves a conflicting row unchecked by default", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /读取当前表单/ })).toBeEnabled());

    screen.getByRole("button", { name: /读取当前表单/ }).click();

    // 姓名（就绪）默认勾选，手机号（冲突）默认不勾。
    await waitFor(() => expect(screen.getByLabelText("选择填入姓名")).toBeChecked());
    expect(screen.getByLabelText("选择填入手机号")).not.toBeChecked();
  });

  it("only sends the checked rows when filling", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /读取当前表单/ })).toBeEnabled());
    screen.getByRole("button", { name: /读取当前表单/ }).click();
    await waitFor(() => expect(screen.getByLabelText("选择填入姓名")).toBeChecked());

    screen.getByRole("button", { name: /填充到页面/ }).click();

    await waitFor(() => expect(apiMocks.fillWebForm).toHaveBeenCalled());
    const [, items] = apiMocks.fillWebForm.mock.calls[0];
    expect(items).toEqual([{ index: 0, field: "name", value: "张三" }]);
  });

  it("keeps the unrecognized list collapsed with an explanation", async () => {
    // 实测：腾讯校招简历页 69 个控件里有 36 个落在"没认出来"，其中一半以上是
    // 「可添加多条」的区块——一股脑铺开会让人误以为这功能什么都没干成。
    apiMocks.previewWebForm.mockResolvedValue(
      preview({
        unrecognized: [
          { index: 7, label: "请输入导师", required: false, field: "", field_label: "" },
          { index: 8, label: "请输入实验室", required: false, field: "", field_label: "" },
        ],
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /读取当前表单/ })).toBeEnabled());

    screen.getByRole("button", { name: /读取当前表单/ }).click();

    await waitFor(() => expect(screen.getByText(/没认出来（2 项，点开查看）/)).toBeInTheDocument());
    // 收起状态下，里面的条目不该出现在文档里。
    expect(screen.queryByText("请输入导师")).not.toBeInTheDocument();
  });

  it("offers 智能逐项填表 as a separate mode from the bulk fill", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /读取当前表单/ })).toBeEnabled());

    // 两种模式并存：批量填说的是"整页读一遍再填"，这个是"逐项核对后填写"。
    expect(screen.getByText("智能逐项填表")).toBeInTheDocument();
    expect(screen.getByText(/点到哪个框，就在框旁边给出资料里对应的值/)).toBeInTheDocument();
  });

  it("turns 智能逐项填表 on automatically after the browser is ready", async () => {
    renderPage();

    await waitFor(() => expect(apiMocks.startWebFormLive).toHaveBeenCalledWith(true));
    expect(screen.getByRole("button", { name: /关\s*闭/ })).toBeInTheDocument();
  });

  it("关闭智能逐项填表只同步 enabled，不销毁运行中的悬浮球会话", async () => {
    apiMocks.getWebFormLiveStatus.mockResolvedValue(liveStatus({ running: true, enabled: true }));
    renderPage();

    const closeButton = await screen.findByRole("button", { name: "关闭智能逐项填表" });
    fireEvent.click(closeButton);

    await waitFor(() => expect(apiMocks.setWebFormLiveEnabled).toHaveBeenCalledWith(false));
    expect(await screen.findByRole("button", { name: "开启智能逐项填表" })).toBeInTheDocument();
  });

  it("成功率使用页面表单框总数作为分母", async () => {
    window.sessionStorage.setItem(
      WEB_FORM_SESSION_STORAGE_KEY,
      JSON.stringify({
        sessionActive: true,
        result: {
          outcomes: [],
          filled: 2,
          unverified: 0,
          failed: 1,
          form_control_total: 5,
          recognized_total: 3,
        },
      }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText(/成功率 40%（2\/5）/)).toBeInTheDocument());
  });

  it("点「开启专用浏览器」后立刻显示已开启，不等浏览器状态轮询翻牌", async () => {
    // 后端在这两条浏览器路由里已经顺手把逐项填表打开了（见 api/webform/），所以前端
    // 读完一次 /live/status 就该把卡片切成「关闭」。
    apiMocks.getWebFormBrowserStatus.mockResolvedValue(browserStatus({ state: "stopped" }));
    apiMocks.startWebFormBrowser.mockResolvedValue(browserStatus({ state: "running" }));
    // 挂载时那条"从别的界面回来"的 effect 读到的还是"没开"；点击之后才返回"已经开了"。
    // 另外 startWebFormLive 保持默认（返回 running:false）：这样只有"主动读状态"这条路
    // 能让卡片翻开，兜底 effect 走不到——用例才真的在验证新行为。
    apiMocks.getWebFormLiveStatus
      .mockResolvedValueOnce(liveStatus())
      .mockResolvedValue(liveStatus({ running: true }));

    renderPage();
    (await screen.findByRole("button", { name: "开启专用浏览器" })).click();

    await waitFor(() => expect(apiMocks.startWebFormBrowser).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "关闭智能逐项填表" })).toBeEnabled();
  });

  it("表单草稿防抖落盘：手改值稍后写入 sessionStorage，而不是每击键一次", async () => {
    // 持久化已改为 trailing 防抖（击键路径上不再每次全量 JSON.stringify 整份会话）；
    // 这条钉住「手改值最终一定落盘」的语义——恢复逻辑读的就是这份草稿。
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /读取当前表单/ })).toBeEnabled());

    screen.getByRole("button", { name: /读取当前表单/ }).click();
    await waitFor(() => expect(screen.getByLabelText("选择填入姓名")).toBeChecked());

    fireEvent.change(screen.getByDisplayValue("张三"), { target: { value: "手改的姓名" } });

    await waitFor(
      () => {
        const saved = window.sessionStorage.getItem(WEB_FORM_SESSION_STORAGE_KEY);
        expect(saved).not.toBeNull();
        expect(JSON.parse(saved as string).values["0"]).toBe("手改的姓名");
      },
      { timeout: 2000 },
    );
  });
});
