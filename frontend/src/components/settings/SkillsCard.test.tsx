// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页的技能摘要卡：**只读**。
 *
 * 这张卡的契约在本轮变了：技能的新建 / 导入 / 启用停用 / 删除全部收归工作台
 * （`/skills`），设置页只剩「看一眼现状 + 去工作台管理」。所以这里检查的重点
 * 不是"能不能点"，而是"写入口真的不在了"——一个看不见的写入口比显式的更危险，
 * 而"删掉一条用例"并不能防止它被加回来，断言"不存在"可以。
 */

import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import SkillsCard from "./SkillsCard";
import type { AssistantSkill } from "../../types";

const skill = (overrides: Partial<AssistantSkill> = {}): AssistantSkill => ({
  id: 1,
  name: "面试模拟官",
  description: "练面试时使用",
  files: ["题库.md"],
  prompt_chars: 120,
  enabled: true,
  updated_at: "2026-10-01T00:00:00Z",
  source_name: "面试模拟官.md",
  ...overrides,
});

function renderCard(overrides: Partial<Parameters<typeof SkillsCard>[0]> = {}) {
  const props = {
    skills: [] as AssistantSkill[],
    loading: false,
    onOpen: vi.fn(),
    ...overrides,
  };
  render(
    <MemoryRouter initialEntries={["/settings"]}>
      <AntdApp>
        <Routes>
          <Route path="/settings" element={<SkillsCard {...props} />} />
          <Route path="/skills" element={<div>workbench-route-probe</div>} />
        </Routes>
      </AntdApp>
    </MemoryRouter>,
  );
  return props;
}

afterEach(cleanup);

describe("SkillsCard", () => {
  it("不再提供任何导入入口（导入只在工作台）", () => {
    renderCard({ skills: [skill()] });

    expect(screen.queryByRole("button", { name: /导入技能/ })).toBeNull();
    // 文件选择框（antd Upload / FileDropZone 都会渲染它）也不该存在。
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("不再提供启用开关，状态只用 Tag 展示", () => {
    renderCard({
      skills: [skill({ enabled: true }), skill({ id: 2, name: "简历诊断", enabled: false })],
    });

    expect(screen.queryByRole("switch")).toBeNull();
    // 只读摘要仍然要说清现在开着还是关着（用文本内容断言，而不是 ByText 查询：
    // 这是状态说明，不是一个可按文案定位的控件）。
    expect(document.body).toHaveTextContent("启用中");
    expect(document.body).toHaveTextContent("已停用");
  });

  it("不再提供删除入口（行菜单与删除按钮都已移除）", () => {
    renderCard({ skills: [skill()] });

    expect(screen.queryByRole("button", { name: "更多操作" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /删除技能/ })).toBeNull();
    expect(document.body).not.toHaveTextContent("删除技能");
  });

  it("说明段不描述本页已经没有的动作，并链接到工作台", () => {
    renderCard({ skills: [skill()] });

    // 「导入同名技能会覆盖更新」描述的是导入能力，本页已不再提供。
    expect(document.body).not.toHaveTextContent("导入同名技能会覆盖更新");
    // 术语正名：页面叫「工作台」，不叫「技能工作台」。
    expect(document.body).not.toHaveTextContent("技能工作台");
    const link = screen.getByRole("link", { name: "去工作台管理" });
    expect(link).toHaveAttribute("href", "/skills");
  });

  it("点「去工作台管理」跳到 /skills", () => {
    renderCard({ skills: [skill()] });

    fireEvent.click(screen.getByRole("link", { name: "去工作台管理" }));

    expect(screen.getByText("workbench-route-probe")).toBeInTheDocument();
  });

  it("点技能名查看详情（只读入口保留）", () => {
    const props = renderCard({ skills: [skill()] });

    fireEvent.click(screen.getByRole("button", { name: "面试模拟官" }));

    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("技能超过 5 项：默认只展示 5 项，点「显示全部」展开其余", () => {
    const skills = Array.from({ length: 7 }, (_, index) =>
      skill({ id: index + 1, name: `技能${index + 1}` }),
    );
    renderCard({ skills });

    expect(screen.getByText("技能1")).toBeTruthy();
    // 第 6、7 项默认折叠；展开后可见。
    expect(screen.queryByText("技能6")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "显示全部 7 条" }));
    expect(screen.getByText("技能6")).toBeTruthy();
    expect(screen.getByText("技能7")).toBeTruthy();
  });

  it("技能不超过 5 项：不出现折叠按钮", () => {
    renderCard();
    expect(screen.queryByText(/显示全部/)).toBeNull();
  });
});
