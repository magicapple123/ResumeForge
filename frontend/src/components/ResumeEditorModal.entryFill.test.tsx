// SPDX-License-Identifier: Apache-2.0
/**
 * `entryFill`：条目级「从资料填入本条」的开关。
 *
 * 从 `ResumeEditorModal.test.tsx` 拆出（行数预算 500）：用例、断言与文案原样搬迁，
 * 内容夹具改从 `ResumeEditorModal.testkit.tsx` 取。本文件不注册任何 `vi.mock`
 * ——这一组用例断言的是渲染结果，不涉及 api mock（与 R16 那组不同）。
 *
 * 岗位详情里的「自行编写简历」传 `entryFill={false}`——那份表单的经历/项目是空的，
 * 用户照着岗位从头写，条目级填入没有可对应的目标；关掉它，模块顶部的
 * 「从我的资料追加一条」必须**照旧可用**（那才是这个场景下唯一需要的入口）。
 * 不传时保持旧行为（条目级入口在），否则通用手写简历与资料页编辑都会悄悄退化。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResumeContent } from "../types";
import { makeResumeContent } from "./ResumeEditorModal.testkit";
import ResumeEditorModal from "./ResumeEditorModal";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumeEditorModal 条目级填入开关（entryFill）", () => {
  const FILL_SOURCES = {
    education: [
      {
        key: "示例大学|软件工程|2023.09|2027.06",
        label: "示例大学",
        hint: "软件工程",
        value: { school: "示例大学", major: "软件工程" },
      },
    ],
    experience: [],
    campusExperience: [],
    projects: [],
    skills: [],
    awards: [],
    summary: "",
  };

  /** 带一条教育经历的内容：「条目头部的下拉」得有条目才谈得上。 */
  const CONTENT_WITH_EDUCATION: ResumeContent = makeResumeContent({
    education: [
      {
        school: "我的大学",
        major: "机械设计",
        degree: "本科",
        start_date: "2022.09",
        end_date: "2026.06",
        gpa: "",
        courses: [],
        achievements: [],
      },
    ],
  });

  async function openEducationTab() {
    fireEvent.click(await screen.findByRole("tab", { name: "教育" }));
    return screen.findByRole("button", { name: /添加教育经历/ });
  }

  it("默认（不传 entryFill）时条目级下拉与顶部追加入口同时存在", async () => {
    render(
      <AntdApp>
        <ResumeEditorModal
          open
          content={CONTENT_WITH_EDUCATION}
          fillSources={FILL_SOURCES}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </AntdApp>,
    );

    await openEducationTab();
    expect(await screen.findByText("从资料填入本条")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "从我的资料选择填入本条" })).toBeInTheDocument();
    // 顶部追加不受影响。
    expect(screen.getByText("从我的资料追加一条")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "从我的资料选择教育经历" })).toBeInTheDocument();
  });

  it("传 entryFill={false} 时只剩顶部追加入口", async () => {
    render(
      <AntdApp>
        <ResumeEditorModal
          open
          content={CONTENT_WITH_EDUCATION}
          fillSources={FILL_SOURCES}
          entryFill={false}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </AntdApp>,
    );

    await openEducationTab();
    // 条目还在（这一条是内容里带进来的），只是头上没有下拉了。
    expect(screen.getByLabelText("学校")).toHaveValue("我的大学");
    expect(screen.queryByText("从资料填入本条")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "从我的资料选择填入本条" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "填入本条的教育经历" })).not.toBeInTheDocument();

    // 顶部追加仍然在，且能真的加一条。
    expect(screen.getByText("从我的资料追加一条")).toBeInTheDocument();
    const topSelect = screen.getByRole("combobox", { name: "从我的资料选择教育经历" });
    fireEvent.mouseDown(topSelect);
    fireEvent.click(topSelect);
    fireEvent.click(await screen.findByText("示例大学（软件工程）"));
    fireEvent.click(screen.getByRole("button", { name: "填入选中的教育经历" }));
    await waitFor(() => expect(screen.getAllByLabelText("学校")).toHaveLength(2));
    // 新加的那条同样没有条目级下拉（开关是整份表单级别的）。
    expect(
      screen.queryByRole("combobox", { name: "从我的资料选择填入本条" }),
    ).not.toBeInTheDocument();
  });
});
