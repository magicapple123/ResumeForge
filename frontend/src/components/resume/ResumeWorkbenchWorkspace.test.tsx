// SPDX-License-Identifier: Apache-2.0
/**
 * W15 工作区预设（D14）：预设只切**面板可见性**，画布恒开、文档状态共用。
 *
 * 单独成文件：`ResumeZoomModal.test.tsx` 已贴 500 行测试预算，而这一组钉的是 fe-delivery
 * 注入的 proview 外壳接线（`useWorkspacePreset` → 三栏显隐），与三栏结构是两件事。
 */
import { App as AntdApp } from "antd";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import { WORKSPACE_PRESET_KEY } from "../../features/resume-proview/workspacePresets";
import ResumeZoomModal from "./ResumeZoomModal";
import { CONTENT, LAYOUT } from "./ResumeZoomModal.testkit";

vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
vi.mock("../ResumePreview", () => ({
  default: () => <div data-testid="workbench-preview" />,
}));

function renderWorkbench() {
  render(
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
      />
    </AntdApp>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("制作台 · 工作区预设（W15）", () => {
  it("默认预设：三栏都在（与没有 proview 时逐字相同）", () => {
    renderWorkbench();
    expect(document.querySelector(".resume-wb-col-params")).not.toBeNull();
    expect(document.querySelector(".resume-wb-col-editor")).not.toBeNull();
    expect(document.querySelector(".resume-wb-col-canvas")).not.toBeNull();
  });

  it("「内容撰写」预设：参数栏隐藏，内容栏与画布仍在", () => {
    localStorage.setItem(WORKSPACE_PRESET_KEY, "writing");
    renderWorkbench();
    expect(document.querySelector(".resume-wb-col-params")).toBeNull();
    expect(document.querySelector(".resume-wb-col-editor")).not.toBeNull();
    // 预设只切可见性：画布在任何预设下都不能消失（否则用户看不到改动）。
    expect(document.querySelector(".resume-wb-col-canvas")).not.toBeNull();
  });

  it("「精细排版」预设：内容栏隐藏，参数栏与画布仍在", () => {
    localStorage.setItem(WORKSPACE_PRESET_KEY, "typography");
    renderWorkbench();
    expect(document.querySelector(".resume-wb-col-params")).not.toBeNull();
    expect(document.querySelector(".resume-wb-col-editor")).toBeNull();
    expect(document.querySelector(".resume-wb-col-canvas")).not.toBeNull();
  });
});
