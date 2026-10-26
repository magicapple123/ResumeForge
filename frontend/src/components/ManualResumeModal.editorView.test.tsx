// SPDX-License-Identifier: Apache-2.0
/**
 * F10：新建简历（ManualResumeModal）的板块/字段来自**当前方案投影的编辑器视图**。
 *
 * 用户口径（2026-10-26）：资料里那个自建板块叫 22333，制作台就不该只写「自定义板块」；
 * 资料里已隐藏的教育字段，新建简历也不该再摆一个空输入框。视图在创建时冻结进快照，
 * 已保存简历之后再改方案不受影响（见 useResumeEditorFillSources 的用例）。
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editorSchema, editorSection } from "../test/editorSchemaFixture";
import { projectionOf } from "../test/profileProjectionFixture";
import { t } from "../i18n";
import ManualResumeModal from "./ManualResumeModal";

const apiMocks = vi.hoisted(() => ({
  createManualResume: vi.fn(),
  projection: null as unknown,
  navigate: vi.fn(),
}));

vi.mock("../api/resumes", () => ({ createManualResume: apiMocks.createManualResume }));
vi.mock("../features/profile-library/useCurrentProjection", () => ({
  useCurrentProjection: () => ({
    data: apiMocks.projection,
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => apiMocks.navigate }));

/** 方案：基本信息 + 教育（隐藏 research_direction/courses/achievements）+ 自建板块 22333。 */
function projectionWithEditorView() {
  const data = projectionOf({
    keys: ["basic_info", "educations", "custom:22333"],
    content: {
      name: "A",
      education: [
        {
          school: "Example University",
          major: "CS",
          degree: "Bachelor",
          start_date: "2023.09",
          end_date: "2027.06",
          gpa: "3.8",
          courses: [],
          achievements: [],
        },
      ],
    },
  });
  return {
    ...data,
    editor_schema: editorSchema(
      editorSection("basic_info", "basic", ["name"], {
        form: "singleton",
        resume_field: null,
      }),
      editorSection(
        "educations",
        "edu",
        ["school", "major", "degree", "start_date", "end_date", "gpa", "study_form"],
        { resume_field: "education" },
      ),
      editorSection("custom:22333", "22333", [], { resume_field: "custom_sections" }),
    ),
  };
}

async function openEditorNav() {
  // 不用中文 ByText 等编辑器出现（cjkRatchet 的 tests 口径）：等栏目条容器即可。
  await waitFor(() => {
    expect(document.querySelector(".ant-tabs-nav")).not.toBeNull();
  });
  return document.querySelector<HTMLElement>(".ant-tabs-nav");
}

/** 往上找 display:none 的祖先（Form.Item 自身也是 .ant-col，closest 只命中内层）。 */
function isHidden(id: string): boolean {
  for (let node = document.getElementById(id); node; node = node.parentElement) {
    if ((node as HTMLElement).style?.display === "none") return true;
  }
  return false;
}

beforeEach(() => {
  apiMocks.createManualResume.mockReset();
  apiMocks.projection = projectionWithEditorView();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("新建简历 · 当前方案的编辑器视图（F10）", () => {
  it("页签来自方案：自建板块页签显示 22333，而不是泛称", async () => {
    render(
      <AntdApp>
        <ManualResumeModal job={null} open onClose={vi.fn()} />
      </AntdApp>,
    );
    const nav = await openEditorNav();
    expect(nav).not.toBeNull();
    expect(within(nav as HTMLElement).getByText("22333")).toBeInTheDocument();
  });

  it("教育页签只显示方案可见字段：隐藏字段留在表单里但不可见", async () => {
    render(
      <AntdApp>
        <ManualResumeModal job={null} open onClose={vi.fn()} />
      </AntdApp>,
    );
    const nav = await openEditorNav();
    fireEvent.click(
      within(nav as HTMLElement).getByRole("tab", { name: t("editor.tab.education") }),
    );
    await waitFor(() => {
      expect(document.getElementById("education_0_research_direction")).not.toBeNull();
    });
    expect(isHidden("education_0_research_direction")).toBe(true);
    expect(isHidden("education_0_study_form")).toBe(false);
  });
});
