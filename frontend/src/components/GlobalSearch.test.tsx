/**
 * 全站搜索（R6）：页头放大镜 + ⌘/Ctrl+K，任何页面都能用。
 *
 * 钉住三件容易坏的事：打开时**不发空查询**、输入有防抖（连打不连发）、点结果会跳转。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GlobalSearch from "./GlobalSearch";

const apiMocks = vi.hoisted(() => ({ searchAll: vi.fn() }));

vi.mock("../api/search", () => apiMocks);

/**
 * Modal 只做「开/关」的替身：jsdom 不会跑完 antd 的离场动画，真实弹窗关闭后内容
 * 仍留在 DOM 里，无法断言「Esc 关闭」。其它 antd 组件保持真实实现，交互不变。
 */
vi.mock("antd", async (importOriginal) => {
  const actual = await importOriginal<typeof import("antd")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    Modal: (props: { open?: boolean; title?: ReactNode; children?: ReactNode }) =>
      props.open ? createElement("div", { role: "dialog" }, props.title, props.children) : null,
  };
});

const RESULT = {
  jobs: [
    {
      id: 3,
      title: "护士",
      company: "示例医院",
    },
  ],
  resumes: [{ id: 7, title: "张三-护士", company: "", job_title: "护士" }],
  more: [],
};

function renderSearch() {
  return render(
    <MemoryRouter initialEntries={["/settings"]}>
      <AntdApp>
        <GlobalSearch />
        <Routes>
          <Route path="*" element={<div>当前页面</div>} />
          <Route path="/jobs" element={<div>岗位页已打开</div>} />
        </Routes>
      </AntdApp>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMocks.searchAll.mockReset().mockResolvedValue(RESULT);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("GlobalSearch", () => {
  it("打开时不发空查询，输入后按关键词搜索", async () => {
    renderSearch();

    fireEvent.click(screen.getByRole("button", { name: "全站搜索" }));
    expect(screen.getByLabelText("搜索关键词")).toBeInTheDocument();
    expect(apiMocks.searchAll).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("搜索关键词"), { target: { value: "护士" } });

    await waitFor(() => expect(apiMocks.searchAll).toHaveBeenCalledWith("护士"));
    // 「护士」同时出现在岗位标题与简历的目标岗位里：用出现次数断言，避免多元素报错。
    expect((await screen.findAllByText("护士")).length).toBeGreaterThan(0);
    expect(screen.getByText("示例医院")).toBeInTheDocument();
    expect(screen.getByText("张三-护士")).toBeInTheDocument();
  });

  it("连续输入只发一次请求（250ms 防抖）", async () => {
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "全站搜索" }));
    const input = screen.getByLabelText("搜索关键词");

    fireEvent.change(input, { target: { value: "护" } });
    fireEvent.change(input, { target: { value: "护士" } });
    fireEvent.change(input, { target: { value: "护士岗" } });

    await waitFor(() => expect(apiMocks.searchAll).toHaveBeenCalledTimes(1));
    expect(apiMocks.searchAll).toHaveBeenCalledWith("护士岗");
  });

  it("点岗位结果跳到岗位深链", async () => {
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "全站搜索" }));
    fireEvent.change(screen.getByLabelText("搜索关键词"), { target: { value: "护士" } });

    fireEvent.click(await screen.findByText("示例医院"));

    expect(await screen.findByText("岗位页已打开")).toBeInTheDocument();
  });

  it("没有匹配时给出空态，而不是一片空白", async () => {
    apiMocks.searchAll.mockResolvedValue({ jobs: [], resumes: [], more: [] });
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "全站搜索" }));
    fireEvent.change(screen.getByLabelText("搜索关键词"), { target: { value: "不存在" } });

    expect(await screen.findByText("没有匹配的内容")).toBeInTheDocument();
  });

  /** 结果项：`data-hit-index` 是跨分组扁平化后的下标，`aria-selected` 标记当前高亮。 */
  const items = () => Array.from(document.querySelectorAll<HTMLElement>("[data-hit-index]"));
  const selected = () => items().findIndex((el) => el.getAttribute("aria-selected") === "true");

  /** 打开搜索并等到两条结果（岗位 + 简历）。 */
  async function searchTwoHits() {
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "全站搜索" }));
    const input = screen.getByLabelText("搜索关键词");
    fireEvent.change(input, { target: { value: "护士" } });
    await waitFor(() => expect(items()).toHaveLength(2));
    return input;
  }

  it("↑↓ 在跨分组结果里移动高亮，末尾与开头互相循环（R6）", async () => {
    const input = await searchTwoHits();
    expect(selected()).toBe(-1);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(selected()).toBe(0);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(selected()).toBe(1);

    // 最后一条再往下：回到第一条。
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(selected()).toBe(0);

    // 第一条再往上：回到最后一条。
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(selected()).toBe(1);

    // 鼠标 hover 与键盘共用同一个高亮状态。
    fireEvent.mouseEnter(items()[0]);
    expect(selected()).toBe(0);
  });

  it("还没选中时 ↑ 直接落到最后一条", async () => {
    const input = await searchTwoHits();
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(selected()).toBe(1);
  });

  it("Enter 跳转到当前高亮项（与鼠标点击同一路径）", async () => {
    const input = await searchTwoHits();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("岗位页已打开")).toBeInTheDocument();
  });

  it("Esc 关闭搜索弹层", async () => {
    const input = await searchTwoHits();
    fireEvent.keyDown(input, { key: "Escape" });

    // Modal 替身只在 open 为 true 时渲染内容，弹层关闭即整个消失。
    await waitFor(() => expect(screen.queryByLabelText("搜索关键词")).not.toBeInTheDocument());
  });

  it("没有结果时按方向键或回车不崩、不误跳转", async () => {
    apiMocks.searchAll.mockResolvedValue({ jobs: [], resumes: [], more: [] });
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "全站搜索" }));
    const input = screen.getByLabelText("搜索关键词");
    fireEvent.change(input, { target: { value: "不存在" } });
    await screen.findByText("没有匹配的内容");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("没有匹配的内容")).toBeInTheDocument();
    expect(screen.queryByText("岗位页已打开")).not.toBeInTheDocument();
  });
});
