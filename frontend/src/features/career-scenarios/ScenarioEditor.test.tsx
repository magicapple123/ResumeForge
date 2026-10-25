// SPDX-License-Identifier: Apache-2.0
/**
 * 场景编辑器（A2）：创建/编辑请求体、expected_revision、409 冲突刷新、快捷场景预填、
 * 脏值关闭出内联确认条（弹层关闭语义）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/apiError";
import { t } from "../../i18n";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import type { CareerScenario, CareerScenarioCatalog } from "./types";
import ScenarioEditor from "./ScenarioEditor";

const apiMocks = vi.hoisted(() => ({
  listCareerScenarios: vi.fn(),
  fetchCareerScenarioCatalog: vi.fn(),
  createCareerScenario: vi.fn(),
  updateCareerScenario: vi.fn(),
}));
const resumeApiMocks = vi.hoisted(() => ({ fetchResumeTemplates: vi.fn() }));

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  listCareerScenarios: apiMocks.listCareerScenarios,
  fetchCareerScenarioCatalog: apiMocks.fetchCareerScenarioCatalog,
  createCareerScenario: apiMocks.createCareerScenario,
  updateCareerScenario: apiMocks.updateCareerScenario,
}));
vi.mock("../../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/resumes")>()),
  fetchResumeTemplates: resumeApiMocks.fetchResumeTemplates,
}));

const CONFIG: CareerScenario["config"] = {
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

const PRESET_CONFIG: CareerScenario["config"] = {
  ...CONFIG,
  career_stage: "student",
  employment_status: "unset",
  purpose: "general",
  target_function: "Campus operations",
};

const CATALOG: CareerScenarioCatalog = {
  catalog_version: "1",
  schema_version: 1,
  limits: {
    max_name_chars: 40,
    max_scenarios: 50,
    max_config_bytes: 16384,
    max_expression_preferences: 800,
  },
  presets: [
    {
      key: "campus",
      name: "Campus preset",
      config: PRESET_CONFIG,
      suggested_sections: [],
      guidance: [],
    },
  ],
};

function renderEditor(props: Partial<React.ComponentProps<typeof ScenarioEditor>> = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <AntdApp>
      <ScenarioEditor open scenario={null} onClose={onClose} onSaved={onSaved} {...props} />
    </AntdApp>,
  );
  return { onSaved, onClose };
}

function nameInput() {
  return screen.getByLabelText(t("careerScenarios.editor.nameLabel"));
}

/**
 * 主按钮用正则按子串匹配：loading 图标离场动画还没结束时，按钮的可访问名会带
 * "loading " 前缀（图标 aria-label），精确字符串匹配会假红。
 */
async function clickSave(text: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(text) }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  apiMocks.listCareerScenarios.mockReset();
  apiMocks.fetchCareerScenarioCatalog.mockReset();
  apiMocks.createCareerScenario.mockReset();
  apiMocks.updateCareerScenario.mockReset();
  resumeApiMocks.fetchResumeTemplates.mockReset();
  apiMocks.listCareerScenarios.mockResolvedValue({ items: [SCENARIO], total: 1 });
  apiMocks.fetchCareerScenarioCatalog.mockResolvedValue(CATALOG);
  apiMocks.createCareerScenario.mockResolvedValue({ ...SCENARIO, id: 11, name: "Scaled role" });
  apiMocks.updateCareerScenario.mockResolvedValue(SCENARIO);
  resumeApiMocks.fetchResumeTemplates.mockResolvedValue(TEMPLATE_CATALOG);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ScenarioEditor", () => {
  it("新建：POST name + config（新建请求不带 expected_revision）", async () => {
    const { onSaved, onClose } = renderEditor();
    await waitFor(() => expect(apiMocks.fetchCareerScenarioCatalog).toHaveBeenCalled());

    fireEvent.change(nameInput(), { target: { value: "Scaled role" } });
    await clickSave(t("careerScenarios.editor.saveCreate"));

    await waitFor(() => expect(apiMocks.createCareerScenario).toHaveBeenCalledOnce());
    const payload = apiMocks.createCareerScenario.mock.calls[0][0];
    expect(payload.name).toBe("Scaled role");
    expect(payload.config).toMatchObject({ career_stage: "unset", purpose: "general" });
    expect(payload).not.toHaveProperty("expected_revision");
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("编辑：PATCH 带打开时拿到的 expected_revision", async () => {
    renderEditor({ scenario: SCENARIO });
    await waitFor(() => expect(apiMocks.fetchCareerScenarioCatalog).toHaveBeenCalled());

    fireEvent.change(nameInput(), { target: { value: "Career A v2" } });
    await clickSave(t("careerScenarios.editor.saveEdit"));

    await waitFor(() => expect(apiMocks.updateCareerScenario).toHaveBeenCalledOnce());
    expect(apiMocks.updateCareerScenario.mock.calls[0][0]).toBe(7);
    expect(apiMocks.updateCareerScenario.mock.calls[0][1]).toMatchObject({
      name: "Career A v2",
      expected_revision: 3,
    });
  });

  it("409 冲突：不静默覆盖，提示刷新；刷新后按最新 revision 重新保存", async () => {
    apiMocks.updateCareerScenario
      .mockRejectedValueOnce(
        new ApiError("场景已被其他窗口修改", 409, {
          businessCode: "career_scenario_revision_conflict",
        }),
      )
      .mockResolvedValue({ ...SCENARIO, revision: 6 });
    apiMocks.listCareerScenarios.mockResolvedValue({
      items: [{ ...SCENARIO, revision: 6, name: "Career A latest" }],
      total: 1,
    });
    renderEditor({ scenario: SCENARIO });
    await waitFor(() => expect(apiMocks.fetchCareerScenarioCatalog).toHaveBeenCalled());

    fireEvent.change(nameInput(), { target: { value: "Career A v2" } });
    await clickSave(t("careerScenarios.editor.saveEdit"));

    expect(await screen.findByText(t("careerScenarios.editor.conflictTitle"))).toBeInTheDocument();
    expect(apiMocks.updateCareerScenario).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole("button", { name: t("careerScenarios.editor.conflictRefresh") }),
    );
    await waitFor(() => expect(apiMocks.listCareerScenarios).toHaveBeenCalled());
    await waitFor(() => expect(nameInput()).toHaveValue("Career A latest"));

    await clickSave(t("careerScenarios.editor.saveEdit"));
    await waitFor(() => expect(apiMocks.updateCareerScenario).toHaveBeenCalledTimes(2));
    expect(apiMocks.updateCareerScenario.mock.calls[1][1]).toMatchObject({
      expected_revision: 6,
    });
  });

  it("快捷场景是起点：套用后按它预填表单，保存成自定义场景", async () => {
    renderEditor();
    await waitFor(() => expect(apiMocks.fetchCareerScenarioCatalog).toHaveBeenCalled());

    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: t("careerScenarios.editor.presetLabel") }),
      { button: 0 },
    );
    const option = await screen.findByText(
      (content, element) =>
        content === "Campus preset" && !!element?.closest(".ant-select-item-option"),
    );
    fireEvent.click(option);
    fireEvent.click(screen.getByRole("button", { name: t("careerScenarios.editor.presetApply") }));

    await waitFor(() => expect(nameInput()).toHaveValue("Campus preset"));
    fireEvent.change(nameInput(), { target: { value: "Campus custom" } });
    await clickSave(t("careerScenarios.editor.saveCreate"));

    await waitFor(() => expect(apiMocks.createCareerScenario).toHaveBeenCalledOnce());
    const payload = apiMocks.createCareerScenario.mock.calls[0][0];
    expect(payload.name).toBe("Campus custom");
    expect(payload.config).toMatchObject({
      career_stage: "student",
      target_function: "Campus operations",
    });
  });

  it("有未保存内容时关闭：先在 footer 里就地确认，不静默丢掉", async () => {
    const { onClose } = renderEditor();
    await waitFor(() => expect(apiMocks.fetchCareerScenarioCatalog).toHaveBeenCalled());

    fireEvent.change(nameInput(), { target: { value: "Draft name" } });
    fireEvent.click(screen.getByRole("button", { name: /取\s*消/ }));

    expect(await screen.findByText(t("common.discard.title"))).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: t("common.action.discard") }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
