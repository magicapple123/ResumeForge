/** 采集条件历史：保存写入 localStorage、去重、回填、清空。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplyTaskDetail, CollectConfigOut } from "../../types";
import CollectPanel from "./CollectPanel";

const apiMocks = vi.hoisted(() => ({
  getCollectConfig: vi.fn(),
  updateCollectConfig: vi.fn(),
  createCollectTask: vi.fn(),
  getCollectFilterOptions: vi.fn(),
}));

vi.mock("../../api/apply", () => ({
  getCollectConfig: apiMocks.getCollectConfig,
  updateCollectConfig: apiMocks.updateCollectConfig,
  createCollectTask: apiMocks.createCollectTask,
  getCollectFilterOptions: apiMocks.getCollectFilterOptions,
}));

const CONFIG: CollectConfigOut = {
  keywords: ["后端"],
  city: "北京",
  salary_min: null,
  experience: "",
  education: "",
  per_task_limit: 50,
  interval_seconds: 3,
  interval_jitter_seconds: 1,
  job_type: "社招",
  filters: {},
  defaults: {} as CollectConfigOut,
};

const HISTORY_KEY = "rf.collect.configHistory";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  apiMocks.getCollectConfig.mockResolvedValue(CONFIG);
  apiMocks.updateCollectConfig.mockResolvedValue(CONFIG);
  apiMocks.createCollectTask.mockResolvedValue({ id: 1 });
  apiMocks.getCollectFilterOptions.mockResolvedValue({
    site_key: "boss",
    display_name: "BOSS直聘",
    groups: [],
    session_read: false,
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderPanel() {
  return render(
    <AntdApp>
      <MemoryRouter>
        <CollectPanel disabled={false} onStarted={vi.fn()} collectTask={null} />
      </MemoryRouter>
    </AntdApp>,
  );
}

describe("CollectPanel 条件历史", () => {
  it("保存条件成功后把整份表单快照写入 localStorage", async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /保存条件/ }));

    await waitFor(() => expect(localStorage.getItem(HISTORY_KEY)).not.toBeNull());
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) as string);
    expect(history).toHaveLength(1);
    expect(history[0].config.city).toBe("北京");
    expect(history[0].config.keywords).toEqual(["后端"]);
    expect(typeof history[0].savedAt).toBe("string");
  });

  it("与上一条完全相同的条件不重复入栈（去重）", async () => {
    renderPanel();
    const saveBtn = await screen.findByRole("button", { name: /保存条件/ });

    fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(HISTORY_KEY) as string)).toHaveLength(1),
    );
    fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(HISTORY_KEY) as string)).toHaveLength(1),
    );
  });

  it("历史下拉回填表单字段", async () => {
    renderPanel();
    const saveBtn = await screen.findByRole("button", { name: /保存条件/ });
    // 保存「北京」，改成「上海」再保存一条 → 两条历史（各自自动选中）。
    fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(HISTORY_KEY) as string)).toHaveLength(1),
    );
    const cityInput = (await screen.findByPlaceholderText("例如：北京")) as HTMLInputElement;
    fireEvent.change(cityInput, { target: { value: "上海" } });
    fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(HISTORY_KEY) as string)).toHaveLength(2),
    );

    // 选中第一条（北京）历史：当前已选中「上海」，切到「北京」才会触发 onChange 回填。
    const select = screen.getByRole("combobox", { name: "历史条件" });
    fireEvent.mouseDown(select, { button: 0 });
    const option = await screen.findByText(
      (content, element) =>
        content.includes("北京") && !!element?.closest(".ant-select-item-option"),
    );
    fireEvent.click(option);

    await waitFor(() => expect(cityInput.value).toBe("北京"));
  });

  it("清空历史按钮可删除全部快照", async () => {
    renderPanel();
    const saveBtn = await screen.findByRole("button", { name: /保存条件/ });
    fireEvent.click(saveBtn);
    await waitFor(() => expect(localStorage.getItem(HISTORY_KEY)).not.toBeNull());

    // 清空历史收进了「···」菜单（不可恢复的破坏性入口不裸露）；确认键无 locale 是 "OK"。
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(await screen.findByText("清空历史"));
    fireEvent.click(await screen.findByRole("button", { name: "OK" }));

    await waitFor(() => expect(localStorage.getItem(HISTORY_KEY)).toBeNull());
  });
});

/** 用一批带站点筛选账目的采集结果渲染面板。 */
function renderWithCollectTask(config: Record<string, unknown>) {
  const task = {
    id: 9,
    kind: "collect",
    status: "completed",
    total: 5,
    processed: 3,
    succeeded: 3,
    failed: 0,
    skipped: 0,
    current_step: "",
    stop_reason: "done",
    config,
    message: "",
    started_at: null,
    finished_at: null,
    created_at: "2026-09-21T00:00:00",
    items: [],
  } as unknown as ApplyTaskDetail;
  return render(
    <AntdApp>
      <MemoryRouter>
        <CollectPanel disabled={false} onStarted={vi.fn()} collectTask={task} />
      </MemoryRouter>
    </AntdApp>,
  );
}

describe("CollectPanel 站点筛选账目", () => {
  it("把生效的站点筛选如实列出来", async () => {
    renderWithCollectTask({
      site_filter_applied: ["学历要求：本科", "融资阶段：A轮"],
      site_filter_unapplied: [],
    });
    expect(await screen.findByText(/招聘网站已按这些条件筛掉不符合的岗位/)).toBeInTheDocument();
    expect(screen.getByText(/学历要求：本科/)).toBeInTheDocument();
  });

  it("没能生效的条件必须明说——否则用户以为筛过了", async () => {
    // 这是本功能最危险的一种失效：编码没核对上就没发出去，用户却以为筛了。
    renderWithCollectTask({
      site_filter_applied: [],
      site_filter_unapplied: ["公司规模"],
    });
    expect(await screen.findByText(/有筛选条件没能生效/)).toBeInTheDocument();
    expect(screen.getByText(/公司规模/)).toBeInTheDocument();
    expect(screen.getByText(/没有发出去/)).toBeInTheDocument();
  });

  it("没配站点筛选时不多显示任何东西", async () => {
    renderWithCollectTask({});
    // 该批次没有任何筛选账目 → 面板不该凭空多出一句让人以为自己筛过的话。
    await waitFor(() => expect(apiMocks.getCollectConfig).toHaveBeenCalled());
    expect(screen.queryByText(/招聘网站已按这些条件/)).not.toBeInTheDocument();
    expect(screen.queryByText(/有筛选条件没能生效/)).not.toBeInTheDocument();
  });
});

describe("CollectPanel 采集进行中与翻页账目", () => {
  const runningTask: ApplyTaskDetail = {
    id: 9,
    kind: "collect",
    status: "running",
    total: 5,
    processed: 2,
    succeeded: 2,
    failed: 0,
    skipped: 3,
    current_step: "正在采集第 2 页",
    stop_reason: "",
    config: {},
    message: "",
    started_at: "2026-10-09T01:00:00",
    finished_at: null,
    created_at: "2026-10-09T00:59:00",
    items: [],
  };

  function renderWithTask(task: ApplyTaskDetail) {
    return render(
      <AntdApp>
        <MemoryRouter>
          <CollectPanel disabled={false} onStarted={vi.fn()} collectTask={task} />
        </MemoryRouter>
      </AntdApp>,
    );
  }

  it("站点从某页起重复推送时，账目区显示「提前停止翻页」说明", async () => {
    renderWithTask({
      ...runningTask,
      status: "completed",
      finished_at: "2026-10-09T01:05:00",
      config: { pagination_stopped_at: 5 },
    });

    expect(await screen.findByText(/已在第 5 页提前停止翻页/)).toBeInTheDocument();
  });
});
