// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心「外部简历」区块：空态 / 列表 / 删除撤销 / 用于面试的两种结局。
 *
 * 断言一律走 role 或 `t()`（不用中文 `*ByText`）：测试里的中文断言也计入 i18n 棘轮。
 * 删除是**软删 + Toast 撤销**（不弹二次确认），这里连点撤销一起钉住。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import ExternalResumePanel from "./ExternalResumePanel";

const navigateMock = vi.hoisted(() => vi.fn());
const apiMocks = vi.hoisted(() => ({
  listExternalResumes: vi.fn(),
  uploadExternalResume: vi.fn(),
  deleteExternalResume: vi.fn(),
  getExternalResume: vi.fn(),
  getExternalResumeAnalysis: vi.fn(),
  externalResumeFileUrl: (id: number) => `/api/external-resumes/${id}/file`,
}));
const trashMocks = vi.hoisted(() => ({ restoreTrashItem: vi.fn(), restoreTrashItems: vi.fn() }));
const jobMocks = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn() }));

vi.mock("../../api/externalResumes", () => apiMocks);
vi.mock("../../api/trash", () => trashMocks);
vi.mock("../../api/jobs", () => jobMocks);
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

function externalResume(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    file_id: 11,
    name: "external-a.txt",
    mime: "text/plain",
    text_chars: 120,
    has_text: true,
    job_id: null,
    job_title: "",
    created_at: "2026-11-10T10:00:00",
    updated_at: "2026-11-10T10:00:00",
    warnings: [],
    ...overrides,
  };
}

function renderPanel(variant: "card" | "bare" = "card") {
  return render(
    <MemoryRouter>
      <AntdApp>
        <ExternalResumePanel variant={variant} />
      </AntdApp>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  navigateMock.mockReset();
  apiMocks.listExternalResumes
    .mockReset()
    .mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
  apiMocks.deleteExternalResume.mockReset().mockResolvedValue(undefined);
  apiMocks.uploadExternalResume.mockReset();
  jobMocks.listJobs.mockReset().mockResolvedValue({ items: [], total: 0 });
  jobMocks.getJob.mockReset().mockResolvedValue(null);
  trashMocks.restoreTrashItem.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ExternalResumePanel", () => {
  it("没有外部简历时给空态，空态里自带上传主按钮", async () => {
    renderPanel();

    expect(await screen.findByText(t("resumesPage.external.empty"))).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("resumesPage.external.upload") }),
    ).toBeInTheDocument();
  });

  it("文件行显示名称与提取状态；「外部」标签只留在区块标题上", async () => {
    apiMocks.listExternalResumes.mockResolvedValue({
      items: [
        externalResume(),
        externalResume({ id: 2, name: "scan-file.pdf", has_text: false, text_chars: 0 }),
      ],
      total: 2,
      page: 1,
      page_size: 100,
    });
    renderPanel();

    expect(await screen.findByText("external-a.txt")).toBeInTheDocument();
    // 副行的状态排第一：正常件写实际字数，扫描件写「未提取到文字 · 扫描件或图片型 PDF」。
    expect(
      screen.getByText(t("resumesPage.external.extractedChars", { count: 120 })),
    ).toBeInTheDocument();
    expect(screen.getByText("scan-file.pdf")).toBeInTheDocument();
    expect(screen.getByText(t("resumesPage.external.scanStatus"))).toBeInTheDocument();
    // 每一行都有一个类型徽标（这两份都是 .pdf / .txt）。
    expect(screen.getByText("TXT")).toBeInTheDocument();
    expect(screen.getByText("PDF")).toBeInTheDocument();
    // 「外部」标签不再逐行重复：整页都是外部简历，只在标题上出现一次。
    expect(screen.getAllByText(t("resumesPage.external.tag"))).toHaveLength(1);
    // 只读快照的说明必须在区块上写清（否则用户会点进去找编辑）。
    expect(screen.getByText(t("resumesPage.external.subtitle"))).toBeInTheDocument();
  });

  it("删除直接执行（不弹确认），Toast 里的撤销会调回收站恢复并刷新列表", async () => {
    apiMocks.listExternalResumes
      .mockResolvedValueOnce({ items: [externalResume()], total: 1, page: 1, page_size: 100 })
      .mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
    renderPanel();

    await screen.findByText("external-a.txt");
    fireEvent.click(screen.getByRole("button", { name: t("common.rowActions.more") }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: t("resumesPage.external.delete") }),
    );

    await waitFor(() => expect(apiMocks.deleteExternalResume).toHaveBeenCalledWith(1));
    fireEvent.click(await screen.findByRole("button", { name: t("toast.undo.label") }));

    await waitFor(() =>
      expect(trashMocks.restoreTrashItem).toHaveBeenCalledWith("external_resume", 1),
    );
    // 撤销 + 删除各触发一次刷新（列表至少被重取两次）。
    await waitFor(() => expect(apiMocks.listExternalResumes.mock.calls.length).toBeGreaterThan(1));
  });

  it("「用于面试」跳到带 externalResumeId 的面试图（预填由设定卡负责）", async () => {
    apiMocks.listExternalResumes.mockResolvedValue({
      items: [externalResume()],
      total: 1,
      page: 1,
      page_size: 100,
    });
    renderPanel();

    fireEvent.click(
      await screen.findByRole("button", { name: t("resumesPage.external.useForInterview") }),
    );

    expect(navigateMock).toHaveBeenCalledWith("/interview?externalResumeId=1");
  });

  it("没有文字层的简历：「用于面试」置灰，并说明要先在面试页上传原件", async () => {
    apiMocks.listExternalResumes.mockResolvedValue({
      items: [externalResume({ has_text: false, text_chars: 0 })],
      total: 1,
      page: 1,
      page_size: 100,
    });
    renderPanel();

    const button = await screen.findByRole("button", {
      name: t("resumesPage.external.useForInterview"),
    });
    // 置灰是"不许点"，说明是"为什么"——两者必须同时存在，只灰不说等于没提示。
    expect(button).toBeDisabled();
    fireEvent.mouseEnter(button.parentElement as HTMLElement);
    expect(
      await screen.findByText(t("resumesPage.external.noTextForInterview")),
    ).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe("ExternalResumePanel · bare 变体（07-1 空白行）", () => {
  const uploadName = () => new RegExp(t("resumesPage.external.upload"));

  it("标题行由面板渲染在卡片之外，上传按钮与标题同一行", async () => {
    apiMocks.listExternalResumes.mockResolvedValue({
      items: [externalResume()],
      total: 1,
      page: 1,
      page_size: 100,
    });
    const { container } = renderPanel("bare");

    await screen.findByText("external-a.txt");
    const header = container.querySelector(".external-resume-header");
    expect(header).not.toBeNull();
    // 标题与按钮同属标题行；卡片头不存在（§1.9），按钮也不再占卡片里的一整行。
    expect(header?.querySelector("h4")?.textContent).toBe(t("resumesPage.external.title"));
    expect(header?.querySelector("button")).not.toBeNull();
    expect(container.querySelectorAll(".ant-card-head")).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: uploadName() })).toHaveLength(1);
  });

  it("空列表时标题行不放按钮：只留空态那一颗", async () => {
    const { container } = renderPanel("bare");

    await screen.findByText(t("resumesPage.external.empty"));
    const header = container.querySelector(".external-resume-header");
    expect(header).not.toBeNull();
    expect(header?.querySelector("button")).toBeNull();
    expect(screen.getAllByRole("button", { name: uploadName() })).toHaveLength(1);
  });
});

/**
 * 文件行与批量选择（整改 #3）。
 *
 * 断言的落点：
 * - 勾选列默认**在 DOM 里但被折叠**（`is-selecting` 类不出现），这样切多选态时列宽不跳；
 * - 「批量选择」两个入口（整行右键 / 行尾 ⋯）效果一致；
 * - 批量删除**逐条**调接口（后端没有批量端点），且只刷新一次列表。
 */
describe("ExternalResumePanel · 文件行与批量选择（#3）", () => {
  /** 右键打开行菜单并返回最近弹出的菜单容器（与简历中心折叠表同一套做法）。 */
  async function openRowMenu(target: HTMLElement): Promise<HTMLElement> {
    fireEvent.contextMenu(target);
    return waitFor(() => {
      const menus = document.querySelectorAll<HTMLElement>(".ant-dropdown");
      const menu = menus[menus.length - 1];
      if (!menu) throw new Error("context menu did not open");
      return menu;
    });
  }

  const rowOf = (name: string): HTMLElement => {
    const row = screen.getByText(name).closest("tr");
    if (!row) throw new Error("row not found");
    return row;
  };

  /** 点行尾「⋯」打开下拉，返回最近弹出的菜单容器。 */
  async function openMoreMenu(index = 0): Promise<HTMLElement> {
    fireEvent.click(screen.getAllByRole("button", { name: t("common.rowActions.more") })[index]);
    return waitFor(() => {
      const menus = document.querySelectorAll<HTMLElement>(".ant-dropdown");
      const menu = menus[menus.length - 1];
      if (!menu) throw new Error("more menu did not open");
      return menu;
    });
  }

  function twoItems() {
    apiMocks.listExternalResumes.mockResolvedValue({
      items: [
        externalResume(),
        externalResume({ id: 2, name: "second-a.txt", mime: "text/plain" }),
      ],
      total: 2,
      page: 1,
      page_size: 100,
    });
  }

  it("默认不进多选态：勾选列在 DOM 里但折叠，也没有批量条", async () => {
    twoItems();
    const { container } = renderPanel();

    await screen.findByText("external-a.txt");
    const table = container.querySelector(".external-resume-files");
    expect(table).not.toBeNull();
    // 列始终挂载（默认折叠），不是靠卸载列来隐藏——否则切多选态时列宽会跳。
    expect(container.querySelectorAll(".ant-table-selection-column").length).toBeGreaterThan(0);
    expect(table?.classList.contains("is-selecting")).toBe(false);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("整行右键有「批量选择」，点了才出现批量条与勾选框", async () => {
    twoItems();
    const { container } = renderPanel();

    await screen.findByText("external-a.txt");
    const menu = await openRowMenu(rowOf("external-a.txt"));
    fireEvent.click(within(menu).getByText(t("common.action.batchSelect")));

    await waitFor(() =>
      expect(
        container.querySelector(".external-resume-files")?.classList.contains("is-selecting"),
      ).toBe(true),
    );
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    // 表头全选 + 两行各一个勾选框 + 批量条上的「全选本页」。
    expect(screen.getAllByRole("checkbox").length).toBe(4);
  });

  it("行尾「⋯」里也有「批量选择」：入口两处，效果一致", async () => {
    twoItems();
    renderPanel();

    await screen.findByText("external-a.txt");
    const menu = await openMoreMenu();
    fireEvent.click(within(menu).getByText(t("common.action.batchSelect")));

    expect(await screen.findByRole("toolbar")).toBeInTheDocument();
  });

  it("批量删除：确认后逐条删（没有批量端点）并只刷新一次列表", async () => {
    apiMocks.listExternalResumes
      .mockResolvedValueOnce({
        items: [
          externalResume(),
          externalResume({ id: 2, name: "second-a.txt", mime: "text/plain" }),
        ],
        total: 2,
        page: 1,
        page_size: 100,
      })
      .mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
    renderPanel();

    await screen.findByText("external-a.txt");
    const menu = await openMoreMenu();
    fireEvent.click(within(menu).getByText(t("common.action.batchSelect")));
    const checkboxes = await screen.findAllByRole("checkbox");
    // 第一个是表头全选，后两个是数据行。
    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[2]);

    fireEvent.click(
      await screen.findByRole("button", { name: t("common.batchBar.deleteSelected") }),
    );
    // 先确认一次（文案里带份数）——确认按钮是弹窗里最后那颗按钮（antd 会在两个汉字
    // 之间插一个空格，所以按 role+name 匹配不可靠，直接取确认区最后一颗）。
    expect(
      (await screen.findAllByText(t("resumesPage.external.batchDelete.title", { count: 2 })))
        .length,
    ).toBeGreaterThan(0);
    const confirmButtons = await waitFor(() => {
      const buttons = document.querySelectorAll<HTMLButtonElement>(
        ".ant-modal-confirm-btns button",
      );
      if (buttons.length === 0) throw new Error("confirm buttons not found");
      return buttons;
    });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(apiMocks.deleteExternalResume).toHaveBeenCalledTimes(2));
    expect(apiMocks.deleteExternalResume).toHaveBeenCalledWith(1);
    expect(apiMocks.deleteExternalResume).toHaveBeenCalledWith(2);
    // 逐条删完只重取一次列表（每条都刷会把 100 条翻十遍）。
    await waitFor(() => expect(apiMocks.listExternalResumes).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText(t("resumesPage.external.batchDelete.done", { count: 2 })),
    ).toBeInTheDocument();
  });
});

/**
 * 关联岗位可点（整改 #4）。
 *
 * 三条分支：有关联 → 链到 `/jobs?job_id=N`；岗位被删（外键 `SET NULL`，`job_id` 为空）
 * → 不渲染链接（否则是死链）；岗位名为空但 id 有值 → 文案回落 `#id`，链接照旧。
 */
describe("ExternalResumePanel · 关联岗位可点（#4）", () => {
  function oneItem(overrides: Record<string, unknown>) {
    apiMocks.listExternalResumes.mockResolvedValue({
      items: [externalResume(overrides)],
      total: 1,
      page: 1,
      page_size: 100,
    });
  }

  it("有关联岗位时点岗位名跳到岗位详情", async () => {
    oneItem({ job_id: 7, job_title: "Backend Engineer" });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Backend Engineer" }));

    expect(navigateMock).toHaveBeenCalledWith("/jobs?job_id=7");
  });

  it("岗位已删（job_id 为空）不给链接，只显示破折号", async () => {
    oneItem({ job_id: null, job_title: "" });
    renderPanel();

    await screen.findByText("external-a.txt");
    // 岗位列不出现任何可点的东西——死链比"没有链接"更糟。
    expect(screen.queryByRole("button", { name: "#7" })).toBeNull();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("岗位名为空但 id 有值：文案回落 #id，仍可点", async () => {
    oneItem({ job_id: 9, job_title: "" });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "#9" }));

    expect(navigateMock).toHaveBeenCalledWith("/jobs?job_id=9");
  });
});
