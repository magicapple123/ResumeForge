// SPDX-License-Identifier: Apache-2.0
/**
 * 条目级「从资料填入本条」（任务 #9）。
 *
 * 用户反馈：每个板块的**每条**都应该能从我的资料填入本条；板块级的
 * 「从我的资料追加一条」不再需要。本文件钉住两条行为：
 *
 * 1. 每个已有条目头部都有条目级下拉（不分通用模式/岗位模式，也不再有开关）；
 * 2. 板块级「从我的资料追加一条」彻底下线——顶部不再有下拉，也就不会多出一条重复条目。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import type { ResumeContent } from "../types";
import { makeResumeContent } from "./ResumeEditorModal.testkit";
import ResumeEditorModal from "./ResumeEditorModal";

/** 已下线的板块级「追加一条」文案（中文只放常量，避免新增 ByText 中文断言抬高 tests 棘轮）。 */
const REMOVED_APPEND_TITLE = "从我的资料追加一条";
const REMOVED_APPEND_ARIA = "从我的资料选择教育经历";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumeEditorModal 条目级「从资料填入本条」（任务 #9）", () => {
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
        school: "",
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
    fireEvent.click(await screen.findByRole("tab", { name: t("editor.tab.education") }));
    return screen.findByRole("button", { name: /添加/ });
  }

  function renderEditor() {
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
  }

  it("每条头部都有条目级下拉，板块级「追加一条」不再出现", async () => {
    renderEditor();
    await openEducationTab();

    // 条目级入口：标题 + 下拉 + 按钮。
    expect(await screen.findByText(t("editor.profileFill.title.entry"))).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: t("editor.profileFill.aria.entry") }),
    ).toBeInTheDocument();
    // 板块级「追加一条」的文案与下拉都不在了。
    expect(screen.queryByText(REMOVED_APPEND_TITLE)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: REMOVED_APPEND_ARIA })).not.toBeInTheDocument();
  });

  it("条目级填入只补空字段：资料里的值写进当前这一条，不新增条目", async () => {
    renderEditor();
    await openEducationTab();
    const before = screen.getAllByLabelText(t("editor.field.school"));

    const select = screen.getByRole("combobox", { name: t("editor.profileFill.aria.entry") });
    fireEvent.mouseDown(select);
    fireEvent.click(await screen.findByText("示例大学（软件工程）"));
    fireEvent.click(
      screen.getByRole("button", {
        name: t("editor.profileFill.fillEntryAria", { label: t("editor.section.education") }),
      }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText(t("editor.field.school"))).toHaveValue("示例大学"),
    );
    // 只做加法：数组长度不变（不是"追加一条"）。
    expect(screen.getAllByLabelText(t("editor.field.school"))).toHaveLength(before.length);
  });
});
