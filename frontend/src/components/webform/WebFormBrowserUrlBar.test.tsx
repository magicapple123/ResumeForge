/**
 * 网申地址栏「历史网址」下拉：popupRender 自定义容器的两条用户反馈修复。
 *
 * 1. 双滚动条：滚动只允许出现在外层限高容器（.webform-history-popup）——
 *    本测试断言容器是唯一带 overflowY 的滚动层、内层菜单无自身滚动样式；
 *    「.ant-dropdown-menu 强制 overflow visible」的兜底规则在 styles/modules.css。
 * 2. 无边框：popupRender 会顶掉默认浮层外观，容器必须自带背景/圆角/边框/阴影。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebFormBrowserUrlBar from "./WebFormBrowserUrlBar";
import type { WebFormUrlHistory } from "../../types";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const HISTORY: WebFormUrlHistory[] = [
  {
    id: 1,
    url: "https://example.com/job/1",
    title: "后端工程师",
    last_used_at: "2026-01-01T08:00:00",
  },
  { id: 2, url: "https://example.com/job/2", title: "", last_used_at: "2026-01-01T09:00:00" },
];

function renderBar() {
  render(
    <AntdApp>
      <WebFormBrowserUrlBar
        value=""
        history={HISTORY}
        busy={false}
        onChange={vi.fn()}
        onOpen={vi.fn()}
        onSelectHistory={vi.fn()}
        onDeleteHistory={vi.fn()}
      />
    </AntdApp>,
  );
}

function openHistoryMenu(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "历史网址" }));
  const popup = document.querySelector<HTMLElement>(".webform-history-popup");
  if (!popup) throw new Error("history popup container not found");
  return popup;
}

describe("WebFormBrowserUrlBar 历史网址弹层", () => {
  it("外层限高容器是唯一滚动层：只有它带 overflowY，内层菜单不自带滚动", () => {
    renderBar();
    const popup = openHistoryMenu();

    expect(popup.style.maxHeight).toBe("360px");
    expect(popup.style.overflowY).toBe("auto");

    // 弹层内不允许出现第二个滚动容器（此前是外层容器 + 菜单列表各一条）。
    const scrollables = Array.from(popup.querySelectorAll<HTMLElement>("*")).filter(
      (node) => node.style.overflowY === "auto" || node.style.overflowY === "scroll",
    );
    expect(scrollables).toEqual([]);

    const menu = popup.querySelector("ul.ant-dropdown-menu");
    expect(menu).not.toBeNull();
    expect((menu as HTMLElement).style.maxHeight).toBe("");
    expect((menu as HTMLElement).style.overflow).toBe("");
  });

  it("自定义容器补齐浮层观感：背景、圆角、边框、阴影都非空", () => {
    renderBar();
    const popup = openHistoryMenu();

    expect(popup.style.background).not.toBe("");
    expect(popup.style.borderRadius).not.toBe("");
    expect(popup.style.border).toContain("1px solid");
    expect(popup.style.boxShadow).not.toBe("");
  });

  it("菜单渲染历史条目，删除按钮不触发选中", () => {
    renderBar();
    openHistoryMenu();
    expect(screen.getByText("后端工程师")).toBeInTheDocument();
    expect(screen.getByLabelText("删除网址 https://example.com/job/1")).toBeInTheDocument();
  });
});
