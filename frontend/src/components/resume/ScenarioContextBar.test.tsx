// SPDX-License-Identifier: Apache-2.0
/**
 * A6 制作台只读场景上下文条：未记录显示「未使用」、有快照显示 display_name。
 *
 * v1 链路已删：原「挂进旧 ResumeZoomModal 壳」的三栏容器用例随旧壳删除；V2 壳
 * （ResumeWorkbenchV2）里该条的挂载由 workbench 的 V2 集成测试覆盖。
 */
import { App as AntdApp } from "antd";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { t } from "../../i18n";
import type { GenerationContextSnapshot } from "../../types";
import ScenarioContextBar from "./ScenarioContextBar";

const SNAPSHOT: GenerationContextSnapshot = {
  schema_version: 1,
  scenario_origin: "saved",
  scenario_id: 7,
  preset_key: null,
  scenario_revision: 3,
  catalog_version: null,
  display_name: "Career A",
  resolved_dimensions: { purpose: "career_change" },
  approved_guidance: [],
  disclosure: { include_employment_status: false },
};

function unusedText(): string {
  return t("careerScenarios.context.text", { name: t("careerScenarios.context.unused") });
}

function usedText(name: string): string {
  return t("careerScenarios.context.text", { name });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("制作台 · 本次场景上下文条（A6）", () => {
  it("没有快照（旧简历 / 未启用）显示「未使用」，且只读（没有按钮）", () => {
    const { container } = render(
      <AntdApp>
        <ScenarioContextBar snapshot={null} />
      </AntdApp>,
    );

    expect(container.querySelector(".resume-wb-scenario-bar")?.textContent).toContain(unusedText());
    const bar = container.querySelector(".resume-wb-scenario-bar");
    expect(bar?.getAttribute("role")).toBe("status");
    expect(bar?.getAttribute("aria-label")).toBe(t("careerScenarios.context.aria"));
    expect(bar?.querySelectorAll("button").length).toBe(0);
  });

  it("有冻结快照时显示生成时记下的场景名，不回填当前场景", () => {
    const { container } = render(
      <AntdApp>
        <ScenarioContextBar snapshot={SNAPSHOT} />
      </AntdApp>,
    );

    expect(container.querySelector(".resume-wb-scenario-bar")?.textContent).toContain(
      usedText(SNAPSHOT.display_name),
    );
  });
});
