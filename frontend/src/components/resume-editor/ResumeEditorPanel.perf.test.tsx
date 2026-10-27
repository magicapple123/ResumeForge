// SPDX-License-Identifier: Apache-2.0
/**
 * 输入路径的渲染成本（需求 #12）：制作台/新建简历共用的编辑面板打字时的重复渲染。
 *
 * 口径与 `useProfileSectionReorder.perf.test.tsx` 一致：jsdom 的耗时不可信，只数
 * **组件渲染次数**（行为计数），不碰墙钟。
 *
 * 两个宿主都覆盖：
 * - 弹窗宿主（`ResumeEditorModal`）：新建简历/手动调整；
 * - 制作台中栏（`ResumeWorkbenchEditorColumn`）：带草稿通道（onDraftContent）。
 *
 * ## 修复前的实测（2026-10-27，夹具 = 2 条项目经历）
 *
 * 连续输入 10 个字符：
 * - 条目字段区（`EditorFieldCol`）渲染 **180 次**（18 个字段 × 10 键）——Form.List
 *   在数组引用变化时重跑渲染函数，把该分区所有条目的所有 Form.Item 逐键重渲染；
 * - 整个表单值被 `JSON.stringify` **161 次**（rc-form 的全量 useWatch + rc-tabs 指示条）。
 *
 * 修复后这两项分别降到 **0 次** / **111 次**（详情见各断言注释）。
 */
import { App as AntdApp } from "antd";
import { Profiler } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createResumeDraftStore } from "../../features/resume/resumeDraftContent";
import { t } from "../../i18n";
import type { ResumeContent } from "../../types";
import ResumeEditorModal from "../ResumeEditorModal";
import ResumeWorkbenchEditorColumn from "../resume/ResumeWorkbenchEditorColumn";
import { makeResumeContent } from "../ResumeEditorModal.testkit";

/** 各层的渲染次数：字段区是"打字是否陪跑"的核心指标，面板壳只用来确认没退化成整棵重渲染。 */
const counters = vi.hoisted(() => ({
  fieldColRenders: 0,
  listSectionRenders: 0,
  panelRenders: 0,
  projectRenders: 0,
  commits: 0,
}));

vi.mock("./EditorFieldCol", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./EditorFieldCol")>();
  const React = await import("react");
  const Col = actual.default;
  return {
    ...actual,
    default: function CountedFieldCol(props: Parameters<typeof Col>[0]) {
      counters.fieldColRenders += 1;
      return React.createElement(Col, props);
    },
  };
});

vi.mock("./ResumeListSection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ResumeListSection")>();
  const React = await import("react");
  const ListSection = actual.default;
  return {
    ...actual,
    default: function CountedListSection(props: Parameters<typeof ListSection>[0]) {
      counters.listSectionRenders += 1;
      return React.createElement(ListSection, props);
    },
  };
});

vi.mock("./ResumeEditorPanel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ResumeEditorPanel")>();
  const React = await import("react");
  const Panel = actual.default;
  return {
    ...actual,
    default: function CountedPanel(props: Parameters<typeof Panel>[0]) {
      counters.panelRenders += 1;
      return React.createElement(Panel, props);
    },
  };
});

vi.mock("./ResumeSectionEditors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ResumeSectionEditors")>();
  const React = await import("react");
  const ProjectEditor = actual.ProjectEditor;
  return {
    ...actual,
    ProjectEditor: function CountedProjectEditor() {
      counters.projectRenders += 1;
      return React.createElement(ProjectEditor);
    },
  };
});

function filledContent(): ResumeContent {
  return makeResumeContent({
    projects: [
      {
        name: "P1",
        role: "R",
        start_date: "2023.01",
        end_date: "2023.12",
        tech_stack: ["React"],
        description: ["body"],
        highlights: ["h"],
      },
      {
        name: "P2",
        role: "R",
        start_date: "2022.01",
        end_date: "2022.12",
        tech_stack: [],
        description: [],
        highlights: [],
      },
    ],
  });
}

function resetCounters() {
  counters.fieldColRenders = 0;
  counters.listSectionRenders = 0;
  counters.panelRenders = 0;
  counters.projectRenders = 0;
  counters.commits = 0;
}

/** 逐键输入：真机上每敲一个键是独立任务，useWatch 的批处理用宏任务合并，这里要对齐节奏。 */
async function typeTenCharacters(input: HTMLInputElement) {
  for (let index = 1; index <= 10; index += 1) {
    fireEvent.change(input, { target: { value: "P".repeat(index) } });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function projectNameInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[id^="projects_"]');
  if (!input) throw new Error("project name input not found");
  return input;
}

beforeEach(resetCounters);

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("编辑器输入路径的渲染次数（需求 #12）", () => {
  it("弹窗宿主：连续输入 10 个字符，条目字段区不再逐键重渲染", async () => {
    render(
      <AntdApp>
        <Profiler id="editor" onRender={() => (counters.commits += 1)}>
          <ResumeEditorModal
            open
            content={filledContent()}
            onClose={vi.fn()}
            onSave={vi.fn(async () => undefined)}
          />
        </Profiler>
      </AntdApp>,
    );
    fireEvent.click(await screen.findByRole("tab", { name: t("editor.tab.projects") }));
    await screen.findByRole("tabpanel");
    const input = projectNameInput();
    resetCounters();

    await typeTenCharacters(input);

    // 修复前 = 180（18 个字段 × 10 键）。首键可能带来一次"置脏/局部补渲染"，给 2 次余量。
    expect(counters.fieldColRenders).toBeLessThanOrEqual(2);
    expect(counters.projectRenders).toBe(0);
    // 面板壳本身可以随脏值/草稿快照重渲染一次（很便宜），但绝不该是"整棵表单+页签重建"。
    expect(counters.panelRenders).toBeLessThanOrEqual(15);
  });

  it("制作台中栏（带草稿通道）：连续输入 10 个字符，条目字段区同样不陪跑", async () => {
    const draftStore = createResumeDraftStore(0);
    render(
      <AntdApp>
        <ResumeWorkbenchEditorColumn
          active
          content={filledContent()}
          draftStore={draftStore}
          onSave={async () => undefined}
        />
      </AntdApp>,
    );
    // 中栏有自绘栏目条 + antd 隐藏的 nav，两套 role=tab 都指向同一个栏目。
    const tabs = await screen.findAllByRole("tab", { name: t("editor.tab.projects") });
    fireEvent.click(tabs[0]);
    await screen.findByRole("tabpanel");
    const input = projectNameInput();
    resetCounters();

    await typeTenCharacters(input);

    expect(counters.fieldColRenders).toBeLessThanOrEqual(2);
    expect(counters.projectRenders).toBe(0);
  });
});
