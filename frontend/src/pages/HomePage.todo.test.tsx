// SPDX-License-Identifier: Apache-2.0
/**
 * 首页「接下来做什么」：三类待办（未核实主张 / 投递队列 / 超期投递）的**出现与消失**。
 *
 * 判据只看真实数据字段（`pending_claim_count` / `apply_queue_count` /
 * `stalled_application_count`）：>0 时出现对应条目与去处，归零后整块回到空态。
 * 断言一律走 `t(...)`，不在用例里写中文字面量（cjkRatchet 的 tests 口径）。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import HomePage from "./HomePage";
import { t } from "../i18n";

const searchApiMocks = vi.hoisted(() => ({ getStats: vi.fn(), searchAll: vi.fn() }));
vi.mock("../api/search", () => searchApiMocks);

const profileApiMocks = vi.hoisted(() => ({ getProfile: vi.fn() }));
vi.mock("../api/profile", () => profileApiMocks);

const reminderApiMocks = vi.hoisted(() => ({
  listUpcomingReminders: vi.fn(),
  listReminders: vi.fn(),
}));
vi.mock("../api/reminders", () => reminderApiMocks);

const settingsApiMocks = vi.hoisted(() => ({ getReminderPopupSetting: vi.fn() }));
// 桌面标题栏的诊断组装会静态 import ../api/settings 的多个函数（getLLMConfig 等）；
// 只 mock 用到的几个会让「部分模块 mock」缺导出而整文件 import 失败，所以这里保留真实导出再覆盖测试桩。
vi.mock("../api/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/settings")>()),
  ...settingsApiMocks,
}));

/** 概览数据的最小真实形态；三类待办计数默认全 0，用例按需覆盖。 */
const BASE_STATS = {
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
  claim_count: 2,
  resume_with_job_count: 1,
  latest_applications: [],
};

/** 资料基线：关键字段全空（接口返回的真实形态是空串 + 空数组）。 */
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

/** 待办条目数（结构断言，避免把三类文案的缺席写成三行否定查询）。 */
function todoCount(): number {
  return document.querySelectorAll(".home-todo-item").length;
}

/** 一条待办完整的"数据 → 文案 + 去处"断言。 */
async function expectTodo({
  text,
  hint,
  path,
}: {
  text: string;
  hint: string;
  path: string;
}): Promise<void> {
  expect(await screen.findByText(text)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: text })).toHaveAttribute("href", path);
  expect(screen.getByText(hint)).toBeInTheDocument();
}

beforeEach(() => {
  searchApiMocks.getStats.mockReset().mockResolvedValue(BASE_STATS);
  searchApiMocks.searchAll.mockReset().mockResolvedValue({ jobs: [], resumes: [], more: [] });
  profileApiMocks.getProfile.mockReset().mockResolvedValue(EMPTY_PROFILE);
  reminderApiMocks.listUpcomingReminders.mockReset().mockResolvedValue([]);
  reminderApiMocks.listReminders.mockReset().mockResolvedValue([]);
  settingsApiMocks.getReminderPopupSetting.mockReset().mockResolvedValue({ enabled: false });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("首页待办（home_todo）", () => {
  it("未核实主张 > 0 时出现「去核实」，清零后消失", async () => {
    searchApiMocks.getStats.mockResolvedValue({ ...BASE_STATS, pending_claim_count: 3 });
    renderPage();

    await expectTodo({
      text: t("pagesMisc.homePage.todo.claims.text", { count: 3 }),
      hint: t("pagesMisc.homePage.todo.claims.hint"),
      path: "/claims",
    });
    expect(todoCount()).toBe(1);

    cleanup();
    searchApiMocks.getStats.mockResolvedValue({ ...BASE_STATS, pending_claim_count: 0 });
    renderPage();

    expect(await screen.findByText(t("pagesMisc.homePage.todos.empty"))).toBeInTheDocument();
    expect(screen.queryByText(t("pagesMisc.homePage.todo.claims.text", { count: 3 }))).toBeNull();
    expect(todoCount()).toBe(0);
  });

  it("投递队列有岗位时出现「去投递」，清零后消失", async () => {
    searchApiMocks.getStats.mockResolvedValue({ ...BASE_STATS, apply_queue_count: 4 });
    renderPage();

    await expectTodo({
      text: t("pagesMisc.homePage.todo.queue.text", { count: 4 }),
      hint: t("pagesMisc.homePage.todo.queue.hint"),
      path: "/apply",
    });
    expect(todoCount()).toBe(1);

    cleanup();
    searchApiMocks.getStats.mockResolvedValue({ ...BASE_STATS, apply_queue_count: 0 });
    renderPage();

    expect(await screen.findByText(t("pagesMisc.homePage.todos.empty"))).toBeInTheDocument();
    expect(screen.queryByText(t("pagesMisc.homePage.todo.queue.text", { count: 4 }))).toBeNull();
    expect(todoCount()).toBe(0);
  });

  it("有超期投递时出现「去跟进」，清零后消失", async () => {
    searchApiMocks.getStats.mockResolvedValue({ ...BASE_STATS, stalled_application_count: 2 });
    renderPage();

    await expectTodo({
      text: t("pagesMisc.homePage.todo.stalled.text", { count: 2 }),
      hint: t("pagesMisc.homePage.todo.stalled.hint"),
      path: "/tracker",
    });
    expect(todoCount()).toBe(1);

    cleanup();
    searchApiMocks.getStats.mockResolvedValue({ ...BASE_STATS, stalled_application_count: 0 });
    renderPage();

    expect(await screen.findByText(t("pagesMisc.homePage.todos.empty"))).toBeInTheDocument();
    expect(screen.queryByText(t("pagesMisc.homePage.todo.stalled.text", { count: 2 }))).toBeNull();
    expect(todoCount()).toBe(0);
  });
});
