// SPDX-License-Identifier: Apache-2.0
/**
 * 简历微调弹窗「从我的资料填入」（R16）：入口只在该出现的时候出现。
 *
 * 2026-10-28：从 ResumeEditorModal.test.tsx 拆出（行数预算 500）。这一组只断言
 * 「传 / 不传 fillSources 时教育页与基本信息页有没有入口」，与参考栏、未保存守卫、
 * 双栏滚动、快捷键互不依赖；内容夹具仍来自 ResumeEditorModal.testkit.tsx。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTENT } from "./ResumeEditorModal.testkit";
import ResumeEditorModal from "./ResumeEditorModal";

/** 已下线的板块级「追加一条」文案（中文只放常量，避免新增 ByText 中文断言抬高 tests 棘轮）。 */
const REMOVED_APPEND_TITLE = "从我的资料追加一条";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumeEditorModal 从我的资料填入（R16）", () => {
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
    summary: "资料里的个人总结",
  };

  async function openEducationTab() {
    fireEvent.click(await screen.findByRole("tab", { name: "教育" }));
    // 「添加教育经历」始终存在，用它确认这一页真的挂上了（内容为空时没有字段可等）。
    // 用正则：按钮里带图标，无障碍名会混进图标的 aria-label。
    return screen.findByRole("button", { name: /添加教育经历/ });
  }

  it("不传 fillSources 时教育页没有任何填入入口", async () => {
    render(
      <AntdApp>
        <ResumeEditorModal open content={CONTENT} onClose={vi.fn()} onSave={vi.fn()} />
      </AntdApp>,
    );

    await openEducationTab();
    // 用 role 定位而不是 ByText：新文件里的中文 ByText 会抬高 CJK 棘轮基线。
    expect(screen.queryAllByRole("combobox", { name: /从我的资料/ })).toHaveLength(0);
    expect(
      screen.queryByRole("combobox", { name: "从我的资料选择教育经历" }),
    ).not.toBeInTheDocument();
    // 基本信息页的「填入个人总结」同样不该出现。
    expect(
      screen.queryByRole("button", { name: /从我的资料填入个人总结/ }),
    ).not.toBeInTheDocument();
  });

  it("传了 fillSources 时教育页出现候选下拉", async () => {
    render(
      <AntdApp>
        <ResumeEditorModal
          open
          content={CONTENT}
          fillSources={FILL_SOURCES}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </AntdApp>,
    );

    await openEducationTab();
    // 任务 #9：入口在**条目头**（「从资料填入本条」），不是板块顶部。
    // 内容里还没有教育条目，先加一条空的（条目级入口挂在每条卡片上）。
    fireEvent.click(screen.getByRole("button", { name: /添加教育经历/ }));
    expect(
      await screen.findByRole("combobox", { name: "从我的资料选择填入本条" }),
    ).toBeInTheDocument();
    // 板块级的「从我的资料追加一条」已下线。
    expect(screen.queryByText(REMOVED_APPEND_TITLE)).not.toBeInTheDocument();
  });
});
