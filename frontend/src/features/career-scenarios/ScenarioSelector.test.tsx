// SPDX-License-Identifier: Apache-2.0
/**
 * 全局场景选择器（A2）：加载/空态/错误态、切换零业务写入、管理入口。
 *
 * 「零业务写入」用 mock fetch 在**协议层**断言：切换只允许出现 GET catalog/list，
 * 一旦出现 POST/PATCH/PUT/DELETE 就会失败（这是 A2 验收的核心性质）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import type { CareerScenario, CareerScenarioConfig } from "./types";
import ScenarioSelector from "./ScenarioSelector";

const resumeApiMocks = vi.hoisted(() => ({ fetchResumeTemplates: vi.fn() }));

vi.mock("../../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/resumes")>()),
  fetchResumeTemplates: resumeApiMocks.fetchResumeTemplates,
}));

const CONFIG: CareerScenarioConfig = {
  career_stage: "experienced",
  employment_status: "unemployed",
  purpose: "career_change",
  target_industries: ["Manufacturing"],
  target_function: "Data analysis",
  cooperation_form: "full_time",
  content_language: "zh-CN",
  work_region: "China",
  preferred_sections: [],
  expression_preferences: "",
  include_employment_status: false,
};

const SCENARIO: CareerScenario = {
  id: 7,
  name: "Career A",
  schema_version: 1,
  revision: 3,
  config: CONFIG,
  archived: false,
  created_at: "2026-10-01T00:00:00",
  updated_at: null,
};

const CATALOG = {
  catalog_version: "1",
  schema_version: 1,
  limits: {
    max_name_chars: 40,
    max_scenarios: 50,
    max_config_bytes: 16384,
    max_expression_preferences: 800,
  },
  presets: [],
};

interface FetchCall {
  url: string;
  method: string;
}

let calls: FetchCall[] = [];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 按 URL 分派：只有 career-scenarios 端点会命中（其余视为未预期的写请求，同样被记录）。 */
/** 默认分派：catalog 返回目录，其余（list）返回一条场景。 */
function defaultHandler(url: string): Response {
  if (url.includes("/career-scenarios/catalog")) return jsonResponse(CATALOG);
  return jsonResponse({ items: [SCENARIO], total: 1 });
}

function stubFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response> = defaultHandler,
) {
  calls = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: (init?.method ?? "GET").toUpperCase() });
    return Promise.resolve(handler(url, init));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderSelector() {
  return render(
    <AntdApp>
      <ScenarioSelector showLabel />
    </AntdApp>,
  );
}

function combobox() {
  return screen.getByRole("combobox", { name: t("careerScenarios.selector.aria") });
}

async function pickOption(label: string) {
  fireEvent.mouseDown(combobox(), { button: 0 });
  const option = await screen.findByText(
    (content, element) => content === label && !!element?.closest(".ant-select-item-option"),
  );
  fireEvent.click(option);
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  resumeApiMocks.fetchResumeTemplates.mockReset();
  resumeApiMocks.fetchResumeTemplates.mockResolvedValue(TEMPLATE_CATALOG);
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  document.body.innerHTML = "";
});

describe("ScenarioSelector", () => {
  it("挂载时用 GET 拉一次场景列表，默认选中「不指定场景」", async () => {
    stubFetch();
    renderSelector();

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0]).toEqual({ url: "/api/career-scenarios", method: "GET" });
    expect(screen.getByText(t("careerScenarios.selector.unset"))).toBeInTheDocument();
    expect(window.sessionStorage.getItem("resumeforge:career-scenario:v1:main")).toBeNull();
  });

  it("切换场景只写本窗口 sessionStorage：不产生任何写方法请求", async () => {
    stubFetch();
    renderSelector();
    await waitFor(() => expect(calls.length).toBe(1));

    await pickOption(SCENARIO.name);

    await waitFor(() =>
      expect(window.sessionStorage.getItem("resumeforge:career-scenario:v1:main")).toBe("7"),
    );
    const writes = calls.filter((call) => call.method !== "GET");
    expect(writes).toEqual([]);
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(1);
  });

  it("列表加载失败：选择器标成警告态，下拉里给错误态与重试", async () => {
    let fail = true;
    const fetchMock = stubFetch(() => {
      if (fail) return Promise.reject(new TypeError("Failed to fetch"));
      return jsonResponse({ items: [], total: 0 });
    });
    renderSelector();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(combobox().closest(".ant-select")).toHaveClass("ant-select-status-warning");

    fireEvent.mouseDown(combobox(), { button: 0 });
    expect(await screen.findByText(t("careerScenarios.selector.error"))).toBeInTheDocument();

    fail = false;
    // antd 会在两个汉字的按钮文案里插空格（可访问名变成「重 试」），用字符间距正则匹配。
    const retryName = new RegExp(t("careerScenarios.selector.retry").split("").join("\\s*"));
    fireEvent.click(screen.getByRole("button", { name: retryName }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("管理入口打开场景编辑器（新建）", async () => {
    stubFetch();
    renderSelector();
    await waitFor(() => expect(calls.length).toBe(1));

    fireEvent.click(screen.getByRole("button", { name: t("careerScenarios.selector.manageAria") }));

    expect(await screen.findByText(t("careerScenarios.editor.createTitle"))).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("careerScenarios.editor.saveCreate") }),
    ).toBeInTheDocument();
  });

  it("选择后回到「不指定场景」同样只读不写", async () => {
    stubFetch();
    renderSelector();
    await waitFor(() => expect(calls.length).toBe(1));

    await pickOption(SCENARIO.name);
    await pickOption(t("careerScenarios.selector.unset"));

    await waitFor(() =>
      expect(window.sessionStorage.getItem("resumeforge:career-scenario:v1:main")).toBe("unset"),
    );
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
  });
});
