// SPDX-License-Identifier: Apache-2.0
/** 首页：快捷入口、全局搜索（含"更多结果"分组跳转）、近期提醒卡片与启动弹窗。 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import HomePage from "./HomePage";

const apiMocks = vi.hoisted(() => ({ getStats: vi.fn(), searchAll: vi.fn() }));

vi.mock("../api/search", () => apiMocks);

const profileApiMocks = vi.hoisted(() => ({ getProfile: vi.fn() }));

vi.mock("../api/profile", () => profileApiMocks);

const reminderApiMocks = vi.hoisted(() => ({
  listUpcomingReminders: vi.fn(),
  // 近期提醒卡内嵌了紧凑月历（E11），它会自拉 listReminders。
  listReminders: vi.fn(),
}));

vi.mock("../api/reminders", () => reminderApiMocks);

const settingsApiMocks = vi.hoisted(() => ({ getReminderPopupSetting: vi.fn() }));

vi.mock("../api/settings", () => settingsApiMocks);

const STATS = {
  job_count: 3,
  open_job_count: 2,
  resume_count: 1,
  week_resume_count: 0,
  latest_jobs: [],
  latest_resumes: [],
  favorite_job_count: 0,
  pending_claim_count: 0,
  pending_claims: [],
  stalled_application_count: 0,
  apply_queue_count: 0,
  // 「第一份交付」两个总量：给成"全部完成"的口径，面板不渲染，不打扰下面的既有断言。
  claim_count: 2,
  resume_with_job_count: 1,
  latest_applications: [],
};

// 空库口径：三个阶段全部未完成，首页顶部应出现「第一份交付」面板。
const EMPTY_STATS: typeof STATS = {
  ...STATS,
  job_count: 0,
  open_job_count: 0,
  resume_count: 0,
  claim_count: 0,
  resume_with_job_count: 0,
};

// 「第一份交付」用的资料基线：关键字段全空（接口返回的真实形态是空串 + 空数组）。
const EMPTY_PROFILE = {
  id: 1,
  photo: "",
  name: "",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  target_city: "",
  job_intent: "",
  personal_website: "",
  github: "",
  summary: "",
  wechat: "",
  birth_date: "",
  id_type: "",
  id_number: "",
  country_region: "",
  native_place: "",
  political_status: "",
  phone_country_code: "+86",
  family_info: "",
  expected_salary: "",
  qq: "",
  advisor: "",
  research_direction: "",
  preferred_industry: "",
  section_order: [],
  educations: [],
  experiences: [],
  campus_experiences: [],
  projects: [],
  skills: [],
  awards: [],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMocks.getStats.mockReset().mockResolvedValue(STATS);
  apiMocks.searchAll.mockReset().mockResolvedValue({ jobs: [], resumes: [], more: [] });
  profileApiMocks.getProfile.mockReset().mockResolvedValue(EMPTY_PROFILE);
  reminderApiMocks.listUpcomingReminders.mockReset().mockResolvedValue([]);
  reminderApiMocks.listReminders.mockReset().mockResolvedValue([]);
  settingsApiMocks.getReminderPopupSetting.mockReset().mockResolvedValue({ enabled: false });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("HomePage", () => {
  it("renders the updated quick entries", async () => {
    renderPage();

    expect(await screen.findByText("岗位广场")).toBeInTheDocument();
    expect(screen.getByText("简历中心")).toBeInTheDocument();
    expect(screen.getByText("投递台")).toBeInTheDocument();
    expect(screen.getByText("求职进度")).toBeInTheDocument();
    expect(screen.getByText("模拟面试")).toBeInTheDocument();
    expect(screen.getByText("求职统计")).toBeInTheDocument();
    expect(screen.getByText("设置")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /岗位广场/ })).toHaveAttribute("href", "/jobs");
    expect(screen.getByRole("link", { name: /简历中心/ })).toHaveAttribute("href", "/resumes");
    expect(screen.getByRole("link", { name: /投递台/ })).toHaveAttribute("href", "/apply");
    expect(screen.getByRole("link", { name: /求职进度/ })).toHaveAttribute("href", "/tracker");
    expect(screen.getByRole("link", { name: /模拟面试/ })).toHaveAttribute("href", "/interview");
    expect(screen.getByRole("link", { name: /求职统计/ })).toHaveAttribute("href", "/analytics");
    expect(screen.getByRole("link", { name: /设置/ })).toHaveAttribute("href", "/settings");
  });

  it("renders the first-delivery panel above the stats when nothing is done yet", async () => {
    apiMocks.getStats.mockResolvedValue(EMPTY_STATS);
    renderPage();

    expect(await screen.findByText("从零到第一份可交付简历")).toBeInTheDocument();
    expect(screen.getByText("准备事实")).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /去我的资料录入/ });
    expect(cta).toHaveAttribute("href", "/profile");
  });

  it("hides the first-delivery panel once everything is done (sample-data shape)", async () => {
    renderPage();
    await screen.findByText("岗位广场");
    expect(screen.queryByText("从零到第一份可交付简历")).toBeNull();
  });

  it("关键字段补全后资料步骤显示已完成（基于 /api/profile 真实字段，非接口外数据）", async () => {
    apiMocks.getStats.mockResolvedValue(EMPTY_STATS);
    profileApiMocks.getProfile.mockResolvedValue({
      ...EMPTY_PROFILE,
      name: "张三",
      phone: "13800000000",
    });
    renderPage();

    expect(await screen.findByText("从零到第一份可交付简历")).toBeInTheDocument();
    const factsTitle = screen.getByText("准备事实");
    expect(factsTitle.parentElement?.textContent).toContain("已完成");
  });

  it("加载失败与空数据可区分：失败态有横幅与重试入口，重试会重新拉取", async () => {
    apiMocks.getStats.mockRejectedValue(new Error("后端没起来"));
    renderPage();

    expect(await screen.findByText(/首页数据加载失败：后端没起来/)).toBeInTheDocument();
    expect(screen.queryByText("从零到第一份可交付简历")).toBeNull();
    expect(apiMocks.getStats).toHaveBeenCalledTimes(1);

    // antd 按钮对两字标签会插入空格（"重 试"），匹配时容忍空白。
    fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
    await waitFor(() => expect(apiMocks.getStats).toHaveBeenCalledTimes(2));
  });

  it("renders grouped more-results that navigate by hit path", async () => {
    apiMocks.searchAll.mockResolvedValue({
      jobs: [],
      resumes: [],
      more: [
        { type: "referral", id: 1, title: "后端内推", subtitle: "字节跳动", path: "/apply" },
        { type: "reminder", id: 2, title: "催HR回复", subtitle: "", path: "/tracker" },
      ],
    });

    renderPage();
    await screen.findByText("求职统计");

    fireEvent.change(screen.getByPlaceholderText(/搜索岗位/), { target: { value: "后端" } });
    fireEvent.click(screen.getByRole("button", { name: /搜\s*索/ }));

    expect(await screen.findByText("更多结果（2）")).toBeInTheDocument();
    expect(screen.getByText("内推（1）")).toBeInTheDocument();
    expect(screen.getByText("提醒（1）")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "后端内推" })).toHaveAttribute("href", "/apply");
    expect(screen.getByRole("link", { name: "催HR回复" })).toHaveAttribute("href", "/tracker");
  });

  it("does not render the more-results block when there are no hits", async () => {
    renderPage();
    await screen.findByText("求职统计");

    fireEvent.change(screen.getByPlaceholderText(/搜索岗位/), { target: { value: "无结果" } });
    fireEvent.click(screen.getByRole("button", { name: /搜\s*索/ }));

    expect(await screen.findByText("匹配的岗位（0）")).toBeInTheDocument();
    expect(screen.queryByText(/更多结果/)).toBeNull();
  });

  it("renders the upcoming reminders list by default and opens the popup on click", async () => {
    reminderApiMocks.listUpcomingReminders.mockResolvedValue([
      {
        id: 1,
        title: "参加某司二面",
        remind_at: "2026-09-21T10:00:00",
        kind: "interview",
        status: "pending",
        track_id: null,
        job_id: null,
        resume_id: null,
        note: "",
        created_at: "2026-09-19T08:00:00",
        updated_at: "2026-09-19T08:00:00",
        urgency: "soon",
        due_label: "明天",
      },
      {
        id: 2,
        title: "催 HR 回复",
        remind_at: "2026-09-18T10:00:00",
        kind: "hr_reply",
        status: "pending",
        track_id: null,
        job_id: null,
        resume_id: null,
        note: "",
        created_at: "2026-09-19T08:00:00",
        updated_at: "2026-09-19T08:00:00",
        urgency: "overdue",
        due_label: "已逾期 2 天",
      },
    ]);

    renderPage();

    expect(await screen.findByText("近期提醒")).toBeInTheDocument();

    // 默认是列表视图：展示提醒条目，且月历（紧凑 CalendarView）不渲染。
    // 「近期提醒」标题不依赖数据就会渲染，条目要等 listUpcomingReminders
    // 返回——直接 await 条目本身，避免 CI 慢机上标题在数据前出现的竞态。
    expect(await screen.findByText("参加某司二面")).toBeInTheDocument();
    expect(screen.getByText("催 HR 回复")).toBeInTheDocument();
    expect(screen.queryByText(/\d{4} 年 \d+ 月/)).toBeNull();

    // 紧急度着色点：soon / overdue 用**不同 token**（R18：色值不再写死在内联样式里，
    // 深色主题下由 dark-tokens.css 统一换一套）。这里断言"两者不同且都走语义 token"，
    // 而不是钉死某个 rgb——钉死 rgb 等于把浅色配色重新写回测试。
    const dots = document.querySelectorAll(".reminder-urgency-dot");
    expect(dots.length).toBe(2);
    const colors = Array.from(dots).map((dot) => (dot as HTMLElement).style.background);
    expect(colors).toContain("var(--rf-accent-amber)"); // soon
    expect(colors).toContain("var(--rf-danger)"); // overdue
    expect(new Set(colors).size).toBe(2);

    // 点击提醒条目打开既有的提醒弹窗（只有弹窗才有「知道了」按钮）。
    fireEvent.click(screen.getByLabelText("查看提醒：参加某司二面"));
    expect(await screen.findByRole("button", { name: /知道了/ })).toBeInTheDocument();
  });

  it("toggles the reminder card between list and calendar, persisting the choice", async () => {
    renderPage();
    await screen.findByText("近期提醒");

    // 默认列表。
    expect(screen.queryByText(/\d{4} 年 \d+ 月/)).toBeNull();

    // 切到月历。
    fireEvent.click(screen.getByRole("radio", { name: "月历" }));
    expect(await screen.findByText(/\d{4} 年 \d+ 月/)).toBeInTheDocument();
    expect(localStorage.getItem("rf.home.reminderView")).toBe("calendar");

    // 切回列表。
    fireEvent.click(screen.getByRole("radio", { name: "列表" }));
    await waitFor(() => expect(screen.queryByText(/\d{4} 年 \d+ 月/)).toBeNull());
    expect(localStorage.getItem("rf.home.reminderView")).toBe("list");
  });

  it("lets the user customize shortcuts and persists the selection", async () => {
    renderPage();
    await screen.findByText("快捷入口");

    // 默认 7 项都在。
    expect(screen.getByRole("link", { name: /设置/ })).toHaveAttribute("href", "/settings");

    fireEvent.click(screen.getByRole("button", { name: /编辑快捷入口/ }));
    expect(await screen.findByText("自定义快捷入口")).toBeInTheDocument();

    // 取消勾选「设置」，再保存。
    fireEvent.click(screen.getByRole("checkbox", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));

    expect(localStorage.getItem("rf.home.shortcuts")).not.toContain("/settings");
    expect(screen.queryByRole("link", { name: /设置/ })).toBeNull();

    // 重新打开，恢复默认。
    fireEvent.click(screen.getByRole("button", { name: /编辑快捷入口/ }));
    fireEvent.click(await screen.findByRole("button", { name: /恢复默认/ }));
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    expect(localStorage.getItem("rf.home.shortcuts")).toContain("/settings");
  });

  it("disables save when no shortcut is selected (keeps at least one)", async () => {
    renderPage();
    await screen.findByText("快捷入口");

    fireEvent.click(screen.getByRole("button", { name: /编辑快捷入口/ }));
    expect(await screen.findByText("自定义快捷入口")).toBeInTheDocument();

    // 取消勾选全部默认 7 项。
    for (const label of [
      "岗位广场",
      "简历中心",
      "投递台",
      "求职进度",
      "模拟面试",
      "求职统计",
      "设置",
    ]) {
      fireEvent.click(screen.getByRole("checkbox", { name: label }));
    }
    expect(screen.getByRole("button", { name: /保\s*存/ })).toBeDisabled();
  });

  it("shows a startup popup only when enabled and reminders exist", async () => {
    settingsApiMocks.getReminderPopupSetting.mockResolvedValue({ enabled: true });
    reminderApiMocks.listUpcomingReminders.mockResolvedValue([
      {
        id: 1,
        title: "参加某司二面",
        remind_at: "2026-09-21T10:00:00",
        kind: "interview",
        status: "pending",
        track_id: null,
        job_id: null,
        resume_id: null,
        note: "",
        created_at: "2026-09-19T08:00:00",
        updated_at: "2026-09-19T08:00:00",
        urgency: "soon",
        due_label: "今天",
      },
    ]);

    renderPage();

    expect(await screen.findByText("参加某司二面")).toBeInTheDocument();
    // 弹窗出现：只有启动弹窗才有「知道了」按钮（卡片里没有）。
    expect(await screen.findByRole("button", { name: /知道了/ })).toBeInTheDocument();
  });

  it("本 SPA 会话内只弹一次：切走再回首页不再弹", async () => {
    settingsApiMocks.getReminderPopupSetting.mockResolvedValue({ enabled: true });
    reminderApiMocks.listUpcomingReminders.mockResolvedValue([
      {
        id: 1,
        title: "参加某司二面",
        remind_at: "2026-09-21T10:00:00",
        kind: "interview",
        status: "pending",
        track_id: null,
        job_id: null,
        resume_id: null,
        note: "",
        created_at: "2026-09-19T08:00:00",
        updated_at: "2026-09-19T08:00:00",
        urgency: "soon",
        due_label: "今天",
      },
    ]);

    // 拿一份全新的 HomePage 模块实例，确保会话标记归零（模拟"本次使用"刚开始）。
    vi.resetModules();
    const { default: HomePageFresh } = await import("./HomePage");

    const first = render(
      <MemoryRouter>
        <HomePageFresh />
      </MemoryRouter>,
    );
    // 首次进入：弹窗出现。
    expect(await screen.findByRole("button", { name: /知道了/ })).toBeInTheDocument();

    // 切走（卸载）再回首页（重新挂载）。
    first.unmount();
    cleanup();
    render(
      <MemoryRouter>
        <HomePageFresh />
      </MemoryRouter>,
    );

    // 第二次挂载：启动弹窗不应再出现。
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /知道了/ })).not.toBeInTheDocument(),
    );
  });
});
