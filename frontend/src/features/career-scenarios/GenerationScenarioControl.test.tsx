// SPDX-License-Identifier: Apache-2.0
/**
 * 生成弹窗内的「职业场景（用于本次生成）」区块（A2 / 契约 §2.5）。
 *
 * 核心性质：默认关闭 → 不产生上下文；打开后可选已保存/快捷场景并披露维度；
 * 就业状态是单独保险框（默认不发送）；目录失败只降级不阻断；
 * 表单打开后全站切换场景不改写这里已选的内容。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import type { CareerContextRequest, CareerScenario, CareerScenarioCatalog } from "./types";
import { saveScenarioSelection } from "./scenarioSelectionStorage";
import GenerationScenarioControl from "./GenerationScenarioControl";

const apiMocks = vi.hoisted(() => ({
  listCareerScenarios: vi.fn(),
  fetchCareerScenarioCatalog: vi.fn(),
}));

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  listCareerScenarios: apiMocks.listCareerScenarios,
  fetchCareerScenarioCatalog: apiMocks.fetchCareerScenarioCatalog,
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

function Harness({ initial = null }: { initial?: CareerContextRequest | null }) {
  const [value, setValue] = useState<CareerContextRequest | null>(initial);
  return (
    <AntdApp>
      <GenerationScenarioControl value={value} onChange={setValue} />
      <pre data-testid="context-value">{JSON.stringify(value)}</pre>
    </AntdApp>
  );
}

function contextValue(): CareerContextRequest | null {
  return JSON.parse(screen.getByTestId("context-value").textContent ?? "null");
}

function switchControl() {
  return screen.getByRole("switch", { name: t("careerScenarios.generate.switch") });
}

async function pick(labelKey: MessageKey, optionLabel: string) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: t(labelKey) }), { button: 0 });
  const option = await screen.findByText(
    (content, element) => content === optionLabel && !!element?.closest(".ant-select-item-option"),
  );
  fireEvent.click(option);
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  apiMocks.listCareerScenarios.mockReset();
  apiMocks.fetchCareerScenarioCatalog.mockReset();
  apiMocks.listCareerScenarios.mockResolvedValue({ items: [SCENARIO], total: 1 });
  apiMocks.fetchCareerScenarioCatalog.mockResolvedValue(CATALOG);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("GenerationScenarioControl", () => {
  it("默认关闭：不发 career_context，也不展示维度清单", async () => {
    render(<Harness />);
    await waitFor(() => expect(apiMocks.listCareerScenarios).toHaveBeenCalled());

    expect(switchControl()).not.toBeChecked();
    expect(contextValue()).toBeNull();
    expect(
      screen.queryByText(t("careerScenarios.generate.dimensionTitle")),
    ).not.toBeInTheDocument();
  });

  it("打开且选中已保存场景后：带上 id + 打开时的 revision，并列出本次发送的维度", async () => {
    saveScenarioSelection(SCENARIO.id);
    render(<Harness />);
    await waitFor(() => expect(apiMocks.listCareerScenarios).toHaveBeenCalled());

    fireEvent.click(switchControl());

    await waitFor(() =>
      expect(contextValue()).toEqual({
        scenario_id: 7,
        expected_revision: 3,
        include_employment_status: false,
      }),
    );
    expect(screen.getByText(t("careerScenarios.generate.dimensionTitle"))).toBeInTheDocument();
    expect(screen.getByText(/Data analysis/)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(t("careerScenarios.purpose.career_change"))),
    ).toBeInTheDocument();
  });

  it("就业状态是单独保险框：默认不勾，勾选后才进上下文与维度", async () => {
    saveScenarioSelection(SCENARIO.id);
    render(<Harness />);
    await waitFor(() => expect(apiMocks.listCareerScenarios).toHaveBeenCalled());
    fireEvent.click(switchControl());
    await waitFor(() => expect(contextValue()).not.toBeNull());

    const check = screen.getByRole("checkbox", {
      name: t("careerScenarios.generate.employmentStatusLabel"),
    });
    expect(check).not.toBeChecked();
    // 未勾选时就业状态不出现在披露清单里（"默认不发送"是硬合同）。
    expect(
      screen.queryByText(new RegExp(t("careerScenarios.status.unemployed"))),
    ).not.toBeInTheDocument();

    fireEvent.click(check);

    await waitFor(() => expect(contextValue()?.include_employment_status).toBe(true));
    expect(
      screen.getByText(new RegExp(t("careerScenarios.status.unemployed"))),
    ).toBeInTheDocument();
  });

  it("可选内置快捷场景：带上 preset_key + catalog_version", async () => {
    render(<Harness />);
    await waitFor(() => expect(apiMocks.fetchCareerScenarioCatalog).toHaveBeenCalled());

    fireEvent.click(switchControl());
    await pick("careerScenarios.generate.presetLabel", "Campus preset");

    await waitFor(() =>
      expect(contextValue()).toEqual({
        preset_key: "campus",
        catalog_version: "1",
        include_employment_status: false,
      }),
    );
    expect(screen.getByText(/Campus operations/)).toBeInTheDocument();
  });

  it("目录加载失败：给一条 Alert，但已保存场景仍可选、不阻断旧流程", async () => {
    apiMocks.fetchCareerScenarioCatalog.mockRejectedValue(new Error("catalog down"));
    render(<Harness />);
    await waitFor(() => expect(apiMocks.fetchCareerScenarioCatalog).toHaveBeenCalled());

    fireEvent.click(switchControl());
    expect(await screen.findByText(t("careerScenarios.generate.catalogError"))).toBeInTheDocument();

    await pick("careerScenarios.generate.savedLabel", SCENARIO.name);
    await waitFor(() => expect(contextValue()?.scenario_id).toBe(7));
  });

  it("表单打开后全站切换场景：不改写这里已选的内容", async () => {
    saveScenarioSelection(SCENARIO.id);
    render(<Harness />);
    await waitFor(() => expect(apiMocks.listCareerScenarios).toHaveBeenCalled());
    fireEvent.click(switchControl());
    await waitFor(() => expect(contextValue()?.scenario_id).toBe(7));

    // 模拟另一个选择器（页头）在别处切换：直接写它唯一会写的地方。
    saveScenarioSelection(999);
    await waitFor(() => expect(contextValue()?.scenario_id).toBe(7));
    expect(apiMocks.listCareerScenarios).toHaveBeenCalledTimes(1);
  });

  it("打开但还没选场景：只提示选择，不发送空上下文", async () => {
    render(<Harness />);
    await waitFor(() => expect(apiMocks.listCareerScenarios).toHaveBeenCalled());

    fireEvent.click(switchControl());

    await waitFor(() =>
      expect(screen.getByText(t("careerScenarios.generate.chooseOneHint"))).toBeInTheDocument(),
    );
    expect(contextValue()).toBeNull();
  });
});
