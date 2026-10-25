// SPDX-License-Identifier: Apache-2.0
/**
 * A2：「本次生成的职业场景」与长 CV 文档模式在生成弹窗里的整合（从
 * GenerateResumeModal.test.tsx 拆出，行数预算 500）。
 *
 * 守两条硬合同：
 * 1. 未启用场景 + 普通简历时，请求里**不出现** career_context / document_mode；
 * 2. 场景上下文在打开弹窗时冻结：之后全站切换场景不改写它，提交时也不重读全局选择。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import type { CareerScenario, CareerScenarioCatalog } from "../../features/career-scenarios/types";
import { saveScenarioSelection } from "../../features/career-scenarios/scenarioSelectionStorage";
import type { ResumeGenerateTask } from "../../types";
import { resetBackgroundTasks } from "../../utils/backgroundTasks";
import { registerNotifyHost } from "../../utils/taskNotify";
import GenerateResumeModal from "../GenerateResumeModal";

/** 记录"完成提醒"的假宿主：本文件只关心请求参数，但组件需要通知宿主。 */
const fakeNotifyHost = {
  notification: {
    success: () => undefined,
    warning: () => undefined,
    error: () => undefined,
    info: () => undefined,
  },
  modal: {
    info: () => undefined,
  },
};

const apiMocks = vi.hoisted(() => ({
  startResumeGeneration: vi.fn(),
  getResumeGenerateTask: vi.fn(),
  cancelResumeGenerateTask: vi.fn(),
  getResume: vi.fn(),
  renderResume: vi.fn(),
  updateResume: vi.fn(),
  updateResumeLayout: vi.fn(),
  fetchResumeTemplates: vi.fn(),
  getLLMConfig: vi.fn(),
}));

vi.mock("../../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/resumes")>()),
  startResumeGeneration: apiMocks.startResumeGeneration,
  getResumeGenerateTask: apiMocks.getResumeGenerateTask,
  cancelResumeGenerateTask: apiMocks.cancelResumeGenerateTask,
  getResume: apiMocks.getResume,
  renderResume: apiMocks.renderResume,
  updateResume: apiMocks.updateResume,
  updateResumeLayout: apiMocks.updateResumeLayout,
  fetchResumeTemplates: apiMocks.fetchResumeTemplates,
}));
vi.mock("../../api/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/settings")>()),
  getLLMConfig: apiMocks.getLLMConfig,
  listResumeFonts: vi.fn().mockResolvedValue({ items: [], active: null, max_bytes: 1 }),
}));

// 场景区块自己加载目录/列表：桩到 features 的 api 层，避免测试去敲真实后端。
const careerMocks = vi.hoisted(() => ({
  listCareerScenarios: vi.fn(),
  fetchCareerScenarioCatalog: vi.fn(),
}));
vi.mock("../../features/career-scenarios/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../features/career-scenarios/api")>()),
  listCareerScenarios: careerMocks.listCareerScenarios,
  fetchCareerScenarioCatalog: careerMocks.fetchCareerScenarioCatalog,
}));

const CAREER_CONFIG: CareerScenario["config"] = {
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

const CAREER_SCENARIO: CareerScenario = {
  id: 7,
  name: "Career A",
  schema_version: 1,
  revision: 3,
  config: CAREER_CONFIG,
  archived: false,
  created_at: "2026-10-01T00:00:00",
  updated_at: null,
};

const CAREER_CATALOG: CareerScenarioCatalog = {
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

function makeTask(overrides: Partial<ResumeGenerateTask> = {}): ResumeGenerateTask {
  return {
    id: 1,
    status: "running",
    resume_id: null,
    error: "",
    message: "",
    received_chars: 0,
    job_id: null,
    title: "",
    created_at: "2025-01-01T00:00:00",
    started_at: "2025-01-01T00:00:00",
    finished_at: null,
    ...overrides,
  };
}

function renderModal() {
  return render(
    <MemoryRouter>
      <AntdApp>
        <GenerateResumeModal job={null} open onClose={vi.fn()} />
      </AntdApp>
    </MemoryRouter>,
  );
}

/** 当前被选中的分段控件标签（antd 把选中态放在 .ant-segmented-item-selected 上）。 */
function selectedSegments(): string[] {
  return Array.from(
    document.querySelectorAll(".ant-segmented-item-selected .ant-segmented-item-label"),
  ).map((node) => node.textContent ?? "");
}

function switchScenario() {
  return screen.getByRole("switch", { name: t("careerScenarios.generate.switch") });
}

async function pickScenario(name: string) {
  fireEvent.mouseDown(
    screen.getByRole("combobox", { name: t("careerScenarios.generate.savedLabel") }),
    { button: 0 },
  );
  const option = await screen.findByText(
    (content, element) => content === name && !!element?.closest(".ant-select-item-option"),
  );
  fireEvent.click(option);
}

/** 等生成配置阶段挂载完成（场景区块的列表请求已发出）。 */
async function waitForConfigStage() {
  expect(await screen.findByRole("button", { name: /开始生成/ })).toBeInTheDocument();
  await waitFor(() => expect(careerMocks.listCareerScenarios).toHaveBeenCalled());
}

function sentOptions() {
  return apiMocks.startResumeGeneration.mock.calls[0][0].options as Record<string, unknown>;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetBackgroundTasks();
  registerNotifyHost(fakeNotifyHost as never);
  apiMocks.startResumeGeneration.mockReset();
  apiMocks.getResumeGenerateTask.mockReset();
  apiMocks.cancelResumeGenerateTask.mockReset();
  apiMocks.getResume.mockReset();
  apiMocks.renderResume.mockReset();
  apiMocks.updateResume.mockReset();
  apiMocks.updateResumeLayout.mockReset();
  apiMocks.fetchResumeTemplates.mockReset();
  apiMocks.getLLMConfig.mockReset();
  apiMocks.getLLMConfig.mockResolvedValue({ base_url: "https://api.example.com/v1", model: "m" });
  apiMocks.startResumeGeneration.mockResolvedValue(makeTask());
  apiMocks.getResumeGenerateTask.mockResolvedValue(makeTask());
  apiMocks.fetchResumeTemplates.mockResolvedValue(TEMPLATE_CATALOG);
  careerMocks.listCareerScenarios.mockReset();
  careerMocks.fetchCareerScenarioCatalog.mockReset();
  careerMocks.listCareerScenarios.mockResolvedValue({ items: [], total: 0 });
  careerMocks.fetchCareerScenarioCatalog.mockResolvedValue(CAREER_CATALOG);
});

afterEach(() => {
  resetBackgroundTasks();
  cleanup();
  document.body.innerHTML = "";
});

describe("GenerateResumeModal 本次生成的职业场景", () => {
  it("默认不发送 career_context 与 document_mode（旧请求逐字节兼容）", async () => {
    renderModal();
    await waitForConfigStage();

    fireEvent.click(screen.getByRole("button", { name: /开始生成/ }));

    await waitFor(() => expect(apiMocks.startResumeGeneration).toHaveBeenCalledOnce());
    expect(sentOptions()).not.toHaveProperty("career_context");
    expect(sentOptions()).not.toHaveProperty("document_mode");
  });

  it("打开开关并选中已保存场景后，才把 career_context 放进 options", async () => {
    careerMocks.listCareerScenarios.mockResolvedValue({ items: [CAREER_SCENARIO], total: 1 });
    renderModal();
    await waitForConfigStage();

    fireEvent.click(switchScenario());
    await pickScenario(CAREER_SCENARIO.name);
    fireEvent.click(screen.getByRole("button", { name: /开始生成/ }));

    await waitFor(() => expect(apiMocks.startResumeGeneration).toHaveBeenCalledOnce());
    expect(sentOptions().career_context).toEqual({
      scenario_id: 7,
      expected_revision: 3,
      include_employment_status: false,
    });
  });

  it("目录加载失败：只提示降级，开始生成照常可达且不带 career_context", async () => {
    careerMocks.fetchCareerScenarioCatalog.mockRejectedValue(new Error("catalog down"));
    renderModal();
    await waitForConfigStage();

    fireEvent.click(switchScenario());
    expect(await screen.findByText(t("careerScenarios.generate.catalogError"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /开始生成/ }));
    await waitFor(() => expect(apiMocks.startResumeGeneration).toHaveBeenCalledOnce());
    expect(sentOptions()).not.toHaveProperty("career_context");
  });

  it("表单打开后全站切换场景：本次生成仍用表单里已选的场景", async () => {
    careerMocks.listCareerScenarios.mockResolvedValue({ items: [CAREER_SCENARIO], total: 1 });
    renderModal();
    await waitForConfigStage();

    fireEvent.click(switchScenario());
    await pickScenario(CAREER_SCENARIO.name);
    // 模拟页头选择器在另一个地方切换场景：它只写 sessionStorage。
    saveScenarioSelection(999);

    fireEvent.click(screen.getByRole("button", { name: /开始生成/ }));
    await waitFor(() => expect(apiMocks.startResumeGeneration).toHaveBeenCalledOnce());
    expect((sentOptions().career_context as Record<string, unknown>).scenario_id).toBe(7);
  });

  it("长 CV：页数上限放宽到 10，并在请求里带 document_mode=long_cv", async () => {
    renderModal();
    await waitForConfigStage();

    fireEvent.click(screen.getByText(t("research.mode.longCv")));
    // 普通简历只有 1–3 页；切到长 CV 后 4–10 页才出现。
    fireEvent.click(await screen.findByText(t("research.mode.limitOption", { count: 10 })));

    fireEvent.click(screen.getByRole("button", { name: /开始生成/ }));
    await waitFor(() => expect(apiMocks.startResumeGeneration).toHaveBeenCalledOnce());
    expect(sentOptions().document_mode).toBe("long_cv");
    expect(sentOptions().page_limit).toBe(10);
  });

  it("切回普通简历时把页数夹到 3 页，并恢复默认（不发 document_mode）", async () => {
    renderModal();
    await waitForConfigStage();

    fireEvent.click(screen.getByText(t("research.mode.longCv")));
    fireEvent.click(await screen.findByText(t("research.mode.limitOption", { count: 10 })));
    fireEvent.click(screen.getByText(t("research.mode.resume")));

    await waitFor(() => expect(selectedSegments()).toContain("3 页"));
    expect(selectedSegments()).not.toContain("10 页");

    fireEvent.click(screen.getByRole("button", { name: /开始生成/ }));
    await waitFor(() => expect(apiMocks.startResumeGeneration).toHaveBeenCalledOnce());
    expect(sentOptions()).not.toHaveProperty("document_mode");
    expect(sentOptions().page_limit).toBe(3);
  });
});
