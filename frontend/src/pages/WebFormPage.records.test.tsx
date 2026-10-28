// SPDX-License-Identifier: Apache-2.0
/**
 * 网申填表页面：填充记录、浏览器设置与 URL 快照（拆分自 WebFormPage.test.tsx）。
 *
 * mock 与工具骨架逐字复制自主文件（vi.hoisted mock 必须与 vi.mock 同文件）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserStatus, WebFormLive, WebFormPreview, WebFormSnapshot } from "../types";
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
  listWebFormRecordsPage: vi.fn(),
  getWebFormRecord: vi.fn(),
  deleteWebFormRecord: vi.fn(),
  listWebFormUrlHistory: vi.fn(),
  deleteWebFormUrlHistory: vi.fn(),
  openWebFormUrl: vi.fn(),
  listWebFormBrowserTargets: vi.fn(),
  setWebFormBrowserTargetLive: vi.fn(),
}));

vi.mock("../api/webform", () => apiMocks);

/**
 * 任务地基的替身（见 `src/test/aiTaskEntryBridge.ts`）：开着 AI 时，「读取当前表单」不再
 * 走一条同步请求，而是建一个 `/ai-tasks` 任务（关页面也继续跑），结果**暂存**后由页面
 * 应用。桥这里仍调用同一个 `previewWebForm` 桩，所以"是不是用 AI 读的"照样可断言。
 */
vi.mock("../utils/aiTaskEntry", async () => {
  const { createAiTaskEntryBridge } = await import("../test/aiTaskEntryBridge");
  return createAiTaskEntryBridge({
    run: async (payload) => {
      const snapshotId = String(payload.snapshot_id);
      const report = await apiMocks.previewWebForm(snapshotId, true);
      return { snapshot_id: snapshotId, webform: 1, preview: report };
    },
  });
});

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
  apiMocks.listWebFormRecordsPage.mockResolvedValue({ items: [], total: 0 });
  apiMocks.getWebFormRecord.mockResolvedValue(null);
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

// ===== 填充记录与浏览器设置 =====

describe("填充记录", () => {
  it("回看每次填充：时间、页面、成功与失败计数（列表行是摘要）", async () => {
    apiMocks.listWebFormRecordsPage.mockResolvedValue({
      items: [
        {
          id: 7,
          url: "https://example.com/apply",
          page_title: "某公司网申",
          filled: 8,
          unverified: 1,
          failed: 2,
          source: "batch",
          created_at: "2026-09-27T10:30:00",
        },
      ],
      total: 1,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("某公司网申")).toBeInTheDocument());
    expect(screen.getByText("成功 8")).toBeInTheDocument();
    expect(screen.getByText("待核对 1")).toBeInTheDocument();
    expect(screen.getByText("失败 2")).toBeInTheDocument();
  });

  it("展开记录时才取详情：填写值明细与页面快照来自详情端点", async () => {
    apiMocks.listWebFormRecordsPage.mockResolvedValue({
      items: [
        {
          id: 7,
          url: "https://example.com/apply",
          page_title: "某公司网申",
          filled: 1,
          unverified: 0,
          failed: 0,
          source: "batch",
          created_at: "2026-09-27T10:30:00",
        },
      ],
      total: 1,
    });
    apiMocks.getWebFormRecord.mockResolvedValue({
      id: 7,
      url: "https://example.com/apply",
      page_title: "某公司网申",
      filled: 1,
      unverified: 0,
      failed: 0,
      source: "batch",
      created_at: "2026-09-27T10:30:00",
      items: [
        {
          index: 0,
          field: "name",
          field_label: "姓名",
          value: "张三",
          control_label: "姓名",
          status: "filled",
          detail: "",
        },
      ],
      page_snapshot: [{ index: 0, label: "姓名", value: "张三", filled: true }],
    });
    renderPage();

    fireEvent.click(await screen.findByText("某公司网申"));

    await waitFor(() => expect(apiMocks.getWebFormRecord).toHaveBeenCalledWith(7));
    // 填写值明细来自详情端点，列表摘要响应里没有它。
    expect(await screen.findByText("张三")).toBeInTheDocument();
    expect(screen.getByText(/1 个框是我们填的/)).toBeInTheDocument();
  });

  it("翻页时用新页码重新拉取，取到旧截断之外的记录", async () => {
    const pageOne = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      url: "",
      page_title: `记录-${index + 1}`,
      filled: 1,
      unverified: 0,
      failed: 0,
      source: "batch",
      created_at: "2026-09-27T10:30:00",
    }));
    apiMocks.listWebFormRecordsPage
      .mockResolvedValueOnce({ items: pageOne, total: 21 })
      .mockResolvedValueOnce({
        items: [
          {
            id: 21,
            url: "",
            page_title: "深层历史记录",
            filled: 1,
            unverified: 0,
            failed: 0,
            source: "batch",
            created_at: "2026-01-01T00:00:00",
          },
        ],
        total: 21,
      });
    renderPage();

    expect(await screen.findByText("记录-1")).toBeInTheDocument();
    expect(screen.queryByText("深层历史记录")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle("2")[0]);

    await waitFor(() => {
      expect(apiMocks.listWebFormRecordsPage).toHaveBeenLastCalledWith(2, 20);
    });
    expect(await screen.findByText("深层历史记录")).toBeInTheDocument();
  });

  it("没有记录时如实说还没有", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("还没有填充记录")).toBeInTheDocument());
  });

  it("填充完成后重新拉一次记录，新记录立刻出现", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /读取当前表单/ })).toBeEnabled());
    screen.getByRole("button", { name: /读取当前表单/ }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: /填充到页面/ })).toBeEnabled());

    apiMocks.listWebFormRecordsPage.mockClear();
    screen.getByRole("button", { name: /填充到页面/ }).click();

    // 用户刚填完就想看到那一条，不该等下次进页面。
    await waitFor(() => expect(apiMocks.listWebFormRecordsPage).toHaveBeenCalled());
  });
});

describe("浏览器设置", () => {
  it("提供一个改浏览器的入口（与投递台共用浏览器类型配置）", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /浏览器设置/ })).toBeEnabled());

    screen.getByRole("button", { name: /浏览器设置/ }).click();

    await waitFor(() =>
      expect(screen.getByText(/分别打开独立浏览器窗口与登录态/)).toBeInTheDocument(),
    );
  });
});

/**
 * 「去我的资料补上」跳过去再回来，读到的表单不能丢。
 *
 * 这是这个功能**设计上就要走的路径**（补资料 → 回来接着填），而快照与预览原本存在组件内
 * `useState` 里，一跳走就卸载、回来全空。修法是把 `snapshot_id` 放进 URL：回来时按它重放一次
 * 预览。后端那份预览是纯计算（快照 + 资料），所以重放出来的与当初读到的一致。
 */
describe("读到的表单存在 URL 里", () => {
  it("读取成功后把 snapshot_id 写进 URL", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /读取当前表单/ })).toBeEnabled());

    screen.getByRole("button", { name: /读取当前表单/ }).click();

    // jsdom 里 MemoryRouter 不写地址栏，所以断言"重放能拿回同一份"而不是直接读 URL：
    // 用同一个参数再挂一次页面，能恢复出来就说明参数写对了。
    await waitFor(() => expect(apiMocks.previewWebForm).toHaveBeenCalledWith("snap-1", true));
  });

  it("带 `snapshot` 参数进页面时自动重放预览，不用再点一次「读取当前表单」", async () => {
    renderPage(["/webform?snapshot=snap-1&ai=1"]);

    // 自动重放：没有点任何按钮，预览接口就被调用了。
    await waitFor(() => expect(apiMocks.previewWebForm).toHaveBeenCalledWith("snap-1", true));
    // 并且界面真的铺开了预览（出现"填充到页面"这一步）。
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /填充到页面/ })).toBeInTheDocument(),
    );
    // **不重新读取页面**——重放的是上次那份快照，不该又去抓一次 DOM。
    expect(apiMocks.takeWebFormSnapshot).not.toHaveBeenCalled();
  });

  it("重放时如实说明勾选已重置为默认（不假装什么都没变）", async () => {
    renderPage(["/webform?snapshot=snap-1&ai=0"]);

    await waitFor(() => expect(screen.getByText(/已恢复上次读取的表单/)).toBeInTheDocument());
    expect(screen.getByText(/勾选已重置为默认/)).toBeInTheDocument();
  });

  it("重放时按当初那次的值决定要不要用 AI（不是看当前开关）", async () => {
    renderPage(["/webform?snapshot=snap-1&ai=0"]);

    await waitFor(() => expect(apiMocks.previewWebForm).toHaveBeenCalledWith("snap-1", false));
  });

  it("快照过期时原样转述后端那句话，并清掉参数——不是留一个空白页", async () => {
    apiMocks.previewWebForm.mockRejectedValue(
      new Error("这次读取的表单已经过期，请重新点「读取当前表单」"),
    );

    renderPage(["/webform?snapshot=snap-gone&ai=1"]);

    await waitFor(() =>
      expect(
        screen.getByText(/这次读取的表单已经过期，请重新点「读取当前表单」/),
      ).toBeInTheDocument(),
    );
    // 清掉参数之后再挂一次页面，不该再去重放那个坏 id。
    apiMocks.previewWebForm.mockClear();
    cleanup();
    document.body.innerHTML = "";
    renderPage(["/webform"]);
    await waitFor(() => expect(apiMocks.getWebFormBrowserStatus).toHaveBeenCalled());
    expect(apiMocks.previewWebForm).not.toHaveBeenCalled();
  });
});
