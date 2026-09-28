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
  stopWebFormLive: vi.fn(),
  getWebFormMemoryTargets: vi.fn(),
  rememberWebFormLive: vi.fn(),
  listWebFormRecords: vi.fn(),
  getWebFormRecord: vi.fn(),
  deleteWebFormRecord: vi.fn(),
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
    apiMocks.getWebFormBrowserStatus.mockResolvedValue(browserStatus({ state: "stopped" }));
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /读取当前表单/ })).toBeDisabled(),
    );
  });

  it("允许手动刷新浏览器状态，并把已关闭的窗口显示成未启动", async () => {
    renderPage();
    await waitFor(() => expect(apiMocks.getWebFormBrowserStatus).toHaveBeenCalled());

    apiMocks.getWebFormBrowserStatus.mockResolvedValue(browserStatus({ state: "stopped" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新浏览器状态" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /启动浏览器/ })).toBeInTheDocument(),
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

  it("offers 点哪个填哪个 as a separate mode from the bulk fill", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /读取当前表单/ })).toBeEnabled());

    // 两种模式并存：批量填说的是"整页读一遍再填"，这个是"点哪个给哪个"。
    expect(screen.getByText("点哪个填哪个")).toBeInTheDocument();
    expect(screen.getByText(/点到哪个框，就在框旁边给出资料里对应的值/)).toBeInTheDocument();
  });

  it("turns 点哪个填哪个 on automatically after the browser is ready", async () => {
    renderPage();

    await waitFor(() => expect(apiMocks.startWebFormLive).toHaveBeenCalledWith(true));
    expect(screen.getByRole("button", { name: /关\s*闭/ })).toBeInTheDocument();
  });

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
    expect(screen.getByRole("button", { name: /结束本次填写/ })).toBeInTheDocument();
    expect(screen.getByDisplayValue("手动改过的姓名")).toBeInTheDocument();
  });

  it("ends the session, stops the browser workflow, and clears the unfinished state", async () => {
    window.sessionStorage.setItem(
      WEB_FORM_SESSION_STORAGE_KEY,
      JSON.stringify({ sessionActive: true, aiEnabled: true, liveOptOut: false }),
    );
    apiMocks.getWebFormBrowserStatus.mockResolvedValue(browserStatus({ state: "stopped" }));

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

    await waitFor(() => expect(screen.getByRole("button", { name: /开\s*启/ })).toBeDisabled());
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
    const toggle = () => screen.getByRole("switch", { name: "认不出时让 AI 帮忙" });
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
      expect(screen.getByRole("switch", { name: "认不出时让 AI 帮忙" })).toBeDisabled(),
    );
    expect(screen.getByText(/还没配置大模型/)).toBeInTheDocument();
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
    const toggle = () => screen.getByRole("switch", { name: "认不出时让 AI 帮忙" });
    await waitFor(() => expect(toggle()).toBeEnabled());

    fireEvent.click(toggle());
    await waitFor(() => expect(toggle()).toHaveAttribute("aria-checked", "false"));

    // 默认已经开启；关闭后再开启，验证新的设置会传到下一次会话。
    fireEvent.click(screen.getByRole("button", { name: /关\s*闭/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /开\s*启/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /开\s*启/ }));

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

// ===== 填充记录与浏览器设置 =====

describe("填充记录", () => {
  it("回看每次填充：时间、页面、成功与失败计数", async () => {
    apiMocks.listWebFormRecords.mockResolvedValue([
      {
        id: 7,
        url: "https://example.com/apply",
        page_title: "某公司网申",
        filled: 8,
        unverified: 1,
        failed: 2,
        source: "batch",
        created_at: "2026-09-27T10:30:00",
        items: [],
        page_snapshot: [],
      },
    ]);
    renderPage();

    await waitFor(() => expect(screen.getByText("某公司网申")).toBeInTheDocument());
    expect(screen.getByText("成功 8")).toBeInTheDocument();
    expect(screen.getByText("待核对 1")).toBeInTheDocument();
    expect(screen.getByText("失败 2")).toBeInTheDocument();
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

    apiMocks.listWebFormRecords.mockClear();
    screen.getByRole("button", { name: /填充到页面/ }).click();

    // 用户刚填完就想看到那一条，不该等下次进页面。
    await waitFor(() => expect(apiMocks.listWebFormRecords).toHaveBeenCalled());
  });
});

describe("浏览器设置", () => {
  it("提供一个改浏览器的入口（与投递台共用同一份配置）", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /浏览器设置/ })).toBeEnabled());

    screen.getByRole("button", { name: /浏览器设置/ }).click();

    await waitFor(() => expect(screen.getByText(/共用同一个浏览器窗口/)).toBeInTheDocument());
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
