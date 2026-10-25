// SPDX-License-Identifier: Apache-2.0
/**
 * A6 制作台只读场景上下文条：未记录显示「未使用」、有快照显示 display_name，
 * 且挂进制作台后三栏容器照常存在（不重构布局、不改变保存/草稿行为）。
 */
import { App as AntdApp } from "antd";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import type { GenerationContextSnapshot } from "../../types";
import { CONTENT, LAYOUT } from "./ResumeZoomModal.testkit";
import ResumeZoomModal from "./ResumeZoomModal";
import ScenarioContextBar from "./ScenarioContextBar";

vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
vi.mock("../ResumePreview", () => ({
  default: () => <div data-testid="workbench-preview" />,
}));

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

  it("挂进制作台后三栏容器仍在：上下文条只占一行，不改动原布局", () => {
    const { container } = render(
      <AntdApp>
        <ResumeZoomModal
          open
          html="<html></html>"
          warnings={[]}
          pages={1}
          onClose={vi.fn()}
          layout={LAYOUT}
          resumeId={42}
          content={CONTENT}
          onApplyLayout={vi.fn()}
          onSaveContent={vi.fn(async () => undefined)}
          contextSnapshot={SNAPSHOT}
        />
      </AntdApp>,
    );

    expect(container.ownerDocument.querySelector(".resume-wb-scenario-bar")?.textContent).toContain(
      usedText(SNAPSHOT.display_name),
    );
    expect(container.ownerDocument.querySelector(".resume-wb-body")).not.toBeNull();
    expect(container.ownerDocument.querySelector(".resume-wb-col-canvas")).not.toBeNull();
  });
});
