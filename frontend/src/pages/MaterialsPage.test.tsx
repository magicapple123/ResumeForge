/**
 * 资料箱：卡片点击查看详情。
 *
 * 卡片里只有正文摘要与附件数量，真正的内容（正文全文、备注、附件清单）在详情里，
 * 所以"点得开"这件事必须有测试守着——它是这一页唯一的阅读入口。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Material } from "../types";
import MaterialsPage from "./MaterialsPage";

const apiMocks = vi.hoisted(() => ({
  listMaterialsPage: vi.fn(),
  getMaterial: vi.fn(),
  listMaterialCategories: vi.fn(),
  createMaterial: vi.fn(),
  updateMaterial: vi.fn(),
  deleteMaterial: vi.fn(),
  batchDeleteMaterials: vi.fn(),
}));

vi.mock("../api/material", () => apiMocks);

const userFileMocks = vi.hoisted(() => ({
  listUserFiles: vi.fn(),
  openUserFile: vi.fn(),
  lookupUserFiles: vi.fn(),
  userFileRawUrl: vi.fn((id: number) => `/api/user-files/${id}/raw`),
}));

vi.mock("../api/userFiles", () => userFileMocks);

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

/** 分页端点响应（{items, total}）；total 缺省时按 items.length。 */
function makePage(items: Material[], total = items.length) {
  return { items, total };
}

function renderPage() {
  return render(
    <AntdApp>
      <MaterialsPage />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.listMaterialsPage.mockReset().mockResolvedValue(makePage(ITEMS));
  // 详情与编辑按需取全量（RF-25：列表只带附件元信息）。
  apiMocks.getMaterial.mockReset().mockResolvedValue(ITEMS[0]);
  apiMocks.listMaterialCategories.mockReset().mockResolvedValue(["证书"]);
  userFileMocks.listUserFiles.mockReset().mockResolvedValue({ items: [], total: 0 });
  userFileMocks.openUserFile.mockReset().mockResolvedValue({ ok: true });
  userFileMocks.lookupUserFiles.mockReset().mockResolvedValue({ items: [] });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("MaterialsPage", () => {
  it("keeps a failed load distinct from empty data and recovers on retry", async () => {
    apiMocks.listMaterialsPage.mockRejectedValueOnce(new Error("服务暂不可用"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("服务暂不可用");
    expect(screen.queryByText(/资料箱还是空的/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
    expect(await screen.findByText("护士执业资格证")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(apiMocks.listMaterialsPage).toHaveBeenCalledTimes(2);
  });

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

  it("切到「我的文件」页签后渲染副本清单（空态）", async () => {
    renderPage();
    await screen.findByText("护士执业资格证");

    fireEvent.click(screen.getByText("我的文件"));

    // 副本清单走独立的数据源：切页签后按列表参数拉取，空数据给中文空态。
    expect(await screen.findByText("还没有保存过文件")).toBeInTheDocument();
    expect(userFileMocks.listUserFiles).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, page_size: 20 }),
    );
  });

  it("切回「资料」页签后恢复资料卡片", async () => {
    renderPage();
    await screen.findByText("护士执业资格证");

    fireEvent.click(screen.getByText("我的文件"));
    await screen.findByText("还没有保存过文件");
    fireEvent.click(screen.getByText("资料"));

    expect(await screen.findByText("护士执业资格证")).toBeInTheDocument();
  });

  it("翻到第 2 页按 page=2 重新请求服务端，取到旧全量之外的第 19 条", async () => {
    // 服务端分页（RF-08 续）：一页 18 张，翻页时把页码下发 /materials/page。
    const pageOne: Material[] = Array.from({ length: 18 }, (_, index) => ({
      id: index + 1,
      title: `资料-${index + 1}`,
      category: "证书",
      content: "",
      url: "",
      files: [],
      note: "",
      created_at: "2026-09-01T08:00:00",
      updated_at: "2026-09-10T09:30:00",
    }));
    apiMocks.listMaterialsPage
      .mockResolvedValueOnce(makePage(pageOne, 19))
      .mockResolvedValueOnce(makePage([ITEMS[0]], 19));
    renderPage();

    expect(await screen.findByText("资料-1")).toBeInTheDocument();
    expect(screen.queryByText("护士执业资格证")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle("2")[0]);

    await waitFor(() => {
      expect(apiMocks.listMaterialsPage).toHaveBeenLastCalledWith(
        { keyword: "", category: "" },
        2,
        18,
      );
    });
    expect(await screen.findByText("护士执业资格证")).toBeInTheDocument();
  });

  it("搜索关键词后回第 1 页并把 keyword 下发服务端", async () => {
    // 筛选变化必须重置页码：停在第 2 页时搜索，若仍请求 page=2 会漏掉第 1 页的命中。
    const pageOne: Material[] = Array.from({ length: 18 }, (_, index) => ({
      id: index + 1,
      title: `资料-${index + 1}`,
      category: "证书",
      content: "",
      url: "",
      files: [],
      note: "",
      created_at: "2026-09-01T08:00:00",
      updated_at: "2026-09-10T09:30:00",
    }));
    apiMocks.listMaterialsPage
      .mockResolvedValueOnce(makePage(pageOne, 19))
      .mockResolvedValueOnce(makePage([ITEMS[0]], 19))
      .mockResolvedValueOnce(makePage(ITEMS, 1));
    renderPage();

    expect(await screen.findByText("资料-1")).toBeInTheDocument();
    fireEvent.click(screen.getAllByTitle("2")[0]);
    await screen.findByText("护士执业资格证");

    const searchInput = screen.getByPlaceholderText("搜索标题、正文或备注");
    fireEvent.change(searchInput, { target: { value: "证书" } });
    fireEvent.keyDown(searchInput, { key: "Enter", code: "Enter", keyCode: 13 });

    await waitFor(() => {
      expect(apiMocks.listMaterialsPage).toHaveBeenLastCalledWith(
        { keyword: "证书", category: "" },
        1,
        18,
      );
    });
  });

  it("批量选择：右键进多选 → 勾 2 条 → 删除所选（确认文案带数量）→ 一次批量删除请求带全部 id 并重拉", async () => {
    const two: Material[] = [ITEMS[0], { ...ITEMS[0], id: 2, title: "英语六级证书" }];
    apiMocks.listMaterialsPage.mockResolvedValue(makePage(two));
    apiMocks.batchDeleteMaterials.mockResolvedValue({ deleted: 2 });
    renderPage();

    await screen.findByText("护士执业资格证");
    fireEvent.contextMenu(screen.getByText("护士执业资格证"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /批量选择/ }));

    fireEvent.click(screen.getByRole("checkbox", { name: "选择资料 护士执业资格证" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择资料 英语六级证书" }));
    expect(screen.getByText("已选 2 项")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "删除所选" }));
    // Popconfirm 确认（文案带数量）；确认前绝不发请求。
    const popover = await waitFor(() => {
      const root = document.querySelector(".ant-popover");
      expect(root).not.toBeNull();
      return root as HTMLElement;
    });
    expect(popover.textContent).toContain("删除选中的 2 份资料");
    expect(apiMocks.batchDeleteMaterials).not.toHaveBeenCalled();
    fireEvent.click(within(popover).getByRole("button", { name: /删\s*除/ }));

    await waitFor(() => {
      expect(apiMocks.batchDeleteMaterials).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.batchDeleteMaterials).toHaveBeenCalledWith([1, 2]);
    // 成功后清空选择并重拉当前页。
    expect(await screen.findByText(/已删除 2 份资料/)).toBeInTheDocument();
    expect(screen.queryByText(/已选/)).not.toBeInTheDocument();
  });
});
