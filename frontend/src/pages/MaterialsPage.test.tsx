/**
 * 资料箱：卡片点击查看详情。
 *
 * 卡片里只有正文摘要与附件数量，真正的内容（正文全文、备注、附件清单）在详情里，
 * 所以"点得开"这件事必须有测试守着——它是这一页唯一的阅读入口。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Material } from "../types";
import MaterialsPage from "./MaterialsPage";

const apiMocks = vi.hoisted(() => ({
  listMaterials: vi.fn(),
  listMaterialCategories: vi.fn(),
  createMaterial: vi.fn(),
  updateMaterial: vi.fn(),
  deleteMaterial: vi.fn(),
}));

vi.mock("../api/material", () => apiMocks);

const ITEMS: Material[] = [
  {
    id: 1,
    title: "护士执业资格证",
    category: "证书",
    content: "2024 年通过考试，证书编号示例。",
    url: "",
    files: [],
    note: "入职时要带原件",
    created_at: "2026-09-01T08:00:00",
    updated_at: "2026-09-10T09:30:00",
  },
];

function renderPage() {
  return render(
    <AntdApp>
      <MaterialsPage />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.listMaterials.mockReset().mockResolvedValue(ITEMS);
  apiMocks.listMaterialCategories.mockReset().mockResolvedValue(["证书"]);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("MaterialsPage", () => {
  it("渲染资料卡片", async () => {
    renderPage();

    expect(await screen.findByText("护士执业资格证")).toBeInTheDocument();
    expect(screen.getByText("证书")).toBeInTheDocument();
  });

  it("点卡片打开详情，看得到正文与备注", async () => {
    renderPage();
    await screen.findByText("护士执业资格证");

    fireEvent.click(screen.getByRole("button", { name: /打开资料「护士执业资格证」的详情/ }));

    expect(await screen.findByText("正文")).toBeInTheDocument();
    expect(screen.getByText("备注")).toBeInTheDocument();
    expect(screen.getByText("入职时要带原件")).toBeInTheDocument();
    expect(screen.getAllByText(/2024 年通过考试/).length).toBeGreaterThan(0);
  });

  it("点「编辑」菜单项只打开编辑弹窗，不再连带打开详情", async () => {
    renderPage();
    await screen.findByText("护士执业资格证");

    // 行操作菜单渲染在 portal 里，点击沿 React 树冒泡回卡片的 DetailTrigger——
    // 「编辑」曾因此把编辑弹窗和详情抽屉一起弹出来。菜单项本身应被识别为内层
    // 交互元素，点击后只有编辑弹窗。
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(await screen.findByText("编辑"));

    expect(
      await screen.findByPlaceholderText("如：CET-6 成绩单 / 个人作品集链接"),
    ).toBeInTheDocument();
    // 详情抽屉没有被打开（详情里会有独立的「正文」区块，编辑表单里只有「正文内容」）。
    expect(screen.queryByText("正文")).toBeNull();
  });
});
