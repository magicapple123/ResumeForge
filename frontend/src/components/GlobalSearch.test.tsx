/**
 * 全站搜索（R6）：页头放大镜 + ⌘/Ctrl+K，任何页面都能用。
 *
 * 钉住三件容易坏的事：打开时**不发空查询**、输入有防抖（连打不连发）、点结果会跳转。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GlobalSearch from "./GlobalSearch";

const apiMocks = vi.hoisted(() => ({ searchAll: vi.fn() }));

vi.mock("../api/search", () => apiMocks);

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
});
