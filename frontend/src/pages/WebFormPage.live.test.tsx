/**
 * 网申填表页面：智能逐项填表会话与 AI 兜底（拆分自 WebFormPage.test.tsx）。
 *
 * 覆盖会话恢复、结束会话、面板行为、AI 开关、AI 建议与缺失字段提示。
 * mock 与工具骨架逐字复制自主文件（vi.hoisted mock 必须与 vi.mock 同文件）。
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
  it("restores the unfinished web form session when returning from another page", async () => {
    const savedPreview = preview();
    window.sessionStorage.setItem(
      WEB_FORM_SESSION_STORAGE_KEY,
      JSON.stringify({
        sessionActive: true,
        snapshot: { snapshot_id: "snap-1", page: savedPreview.page },
        preview: savedPreview,
        selected: [0],
        values: { 0: "手动改过的姓名" },
        result: null,
        aiEnabled: true,
        liveOptOut: false,
      }),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /填充到页面/ })).toBeInTheDocument(),
    );
    // 「结束本次填写」除会话恢复外还依赖浏览器状态轮询的 running 落地，
    // 与「填充到页面」不在同一次状态提交里；CI 高负载下可能晚一拍
    // （#58 在 router 7.18.4 上的一次偶发失败）。这里等待它出现再断言，
    // 断言本身（role / name / 值）不放松。
    expect(await screen.findByRole("button", { name: /结束本次填写/ })).toBeInTheDocument();
    expect(await screen.findByDisplayValue("手动改过的姓名")).toBeInTheDocument();
  });

  it("ends the session, stops the browser workflow, and clears the unfinished state", async () => {
    window.sessionStorage.setItem(
      WEB_FORM_SESSION_STORAGE_KEY,
      JSON.stringify({ sessionActive: true, aiEnabled: true, liveOptOut: false }),
    );
    apiMocks.getWebFormBrowserStatus
      .mockResolvedValueOnce(browserStatus({ state: "running" }))
      .mockResolvedValue(browserStatus({ state: "stopped" }));

    renderPage();

    const endButton = await screen.findByRole("button", { name: /结束本次填写/ });
    fireEvent.click(endButton);

    await waitFor(() => expect(apiMocks.stopWebFormLive).toHaveBeenCalled());
    expect(apiMocks.stopWebFormBrowser).toHaveBeenCalled();
    await waitFor(() =>
      expect(window.sessionStorage.getItem(WEB_FORM_SESSION_STORAGE_KEY)).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: /结束本次填写/ })).not.toBeInTheDocument();
  });

  it("cannot start the click-to-fill mode before the browser is up", async () => {
    apiMocks.getWebFormBrowserStatus.mockResolvedValue(browserStatus({ state: "stopped" }));
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "开启智能逐项填表" })).toBeDisabled(),
    );
  });

  it("shows what the panel is doing in the browser window", async () => {
    apiMocks.startWebFormLive.mockResolvedValue({
      running: true,
      field_label: "姓名",
      value: "张三",
      status: "matched",
      note: "",
      filled: 0,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("已给出建议")).toBeInTheDocument());
    expect(screen.getByText(/姓名 → 张三/)).toBeInTheDocument();
  });

  it("has no submit button in this mode either", async () => {
    // 「只填不交」是两种模式共同的红线，不是批量模式专有。
    apiMocks.startWebFormLive.mockResolvedValue({
      running: true,
      field_label: "姓名",
      value: "张三",
      status: "matched",
      note: "",
      filled: 0,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("已给出建议")).toBeInTheDocument());

    expect(screen.queryByRole("button", { name: /提交/ })).not.toBeInTheDocument();
  });

  // ===== AI 兜底 =====

  it("reads the form with the AI fallback on by default", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /读取当前表单/ })).toBeEnabled());

    screen.getByRole("button", { name: /读取当前表单/ }).click();

    await waitFor(() => expect(apiMocks.previewWebForm).toHaveBeenCalledWith("snap-1", true));
  });

  it("honours the AI switch being turned off", async () => {
    renderPage();
    const toggle = () => screen.getByRole("switch", { name: "AI 字段识别辅助" });
    await waitFor(() => expect(toggle()).toBeEnabled());

    // `fireEvent` 会包一层 act——不用它的话状态更新还没落地，下一次点击拿到的仍是有 AI 的那份
    // 处理函数。
    fireEvent.click(toggle());
    await waitFor(() => expect(toggle()).toHaveAttribute("aria-checked", "false"));

    screen.getByRole("button", { name: /读取当前表单/ }).click();

    await waitFor(() => expect(apiMocks.previewWebForm).toHaveBeenCalledWith("snap-1", false));
  });

  it("turns the AI switch off-limits when no model is configured", async () => {
    // 开关能用却毫无效果是最糟的：用户会以为功能坏了。**说清楚为什么**。
    settingsMocks.getLLMConfig.mockResolvedValue({ base_url: "", model: "" });
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "AI 字段识别辅助" })).toBeDisabled(),
    );
    expect(screen.getByText(/尚未配置大模型/)).toBeInTheDocument();
  });

  it("leaves AI suggestions unchecked and offers one click to take them all", async () => {
    apiMocks.previewWebForm.mockResolvedValue(
      preview({
        items: [
          ...preview().items.slice(0, 1),
          {
            index: 2,
            field: "research_direction",
            field_label: "研究方向",
            value: "分布式系统",
            control_label: "实验室名称",
            control_type: "text",
            status: "ready",
            source: "ai",
            current_value: "",
            options: [],
            note: "AI 认出来的，请重点核对",
          },
        ],
        default_indexes: [0],
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /读取当前表单/ })).toBeEnabled());

    screen.getByRole("button", { name: /读取当前表单/ }).click();

    // 默认不勾——失败形态是"我忘了勾"，而不是"悄悄写了个错值"。
    await waitFor(() => expect(screen.getByLabelText("选择填入研究方向")).not.toBeChecked());
    expect(screen.getAllByText("AI 建议").length).toBeGreaterThan(0);

    screen.getByRole("button", { name: /全选 AI 建议/ }).click();

    await waitFor(() => expect(screen.getByLabelText("选择填入研究方向")).toBeChecked());
  });

  it("shows where the live suggestion came from", async () => {
    apiMocks.startWebFormLive.mockResolvedValue({
      running: true,
      field_label: "研究方向",
      value: "分布式系统",
      status: "matched",
      note: "AI 认出来的，请重点核对",
      source: "ai",
      alternatives: [{ label: "导师", value: "王教授" }],
      filled: 0,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText(/另有 1 个候选/)).toBeInTheDocument());
    expect(screen.getByText("AI 建议")).toBeInTheDocument();
  });

  it("passes the AI switch to the click-to-fill mode too", async () => {
    renderPage();
    const toggle = () => screen.getByRole("switch", { name: "AI 字段识别辅助" });
    await waitFor(() => expect(toggle()).toBeEnabled());

    fireEvent.click(toggle());
    await waitFor(() => expect(toggle()).toHaveAttribute("aria-checked", "false"));

    // 默认已经开启；关闭后再开启，验证新的设置会传到下一次会话。
    fireEvent.click(screen.getByRole("button", { name: /关\s*闭/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "开启智能逐项填表" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "开启智能逐项填表" }));

    await waitFor(() => expect(apiMocks.startWebFormLive).toHaveBeenLastCalledWith(false));
  });

  it("lists the fields the page asks for but the profile has not got", async () => {
    apiMocks.previewWebForm.mockResolvedValue(
      preview({
        missing_data: [{ index: 5, label: "政治面貌", required: true, field: "", field_label: "" }],
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /读取当前表单/ })).toBeEnabled());

    screen.getByRole("button", { name: /读取当前表单/ }).click();

    await waitFor(() => expect(screen.getByText(/资料里还没有/)).toBeInTheDocument());
  });
});
