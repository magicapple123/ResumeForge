// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「助手记忆」卡（#31C/#18D/I-03）：列表与元信息、自动抽取开关、手填与编辑、
 * 删除/停用/历史的 `⋯` 菜单、清空全部的三段式确认，以及本次改版的四条版面判据。
 *
 * 断言文案一律 t(...)；后端接口整体 mock（组件只做展示与交互，校验在后端）。
 * 行内动作（停用 / 历史 / 删除 / 回到原对话）已收进 `⋯` 菜单，所以每个用例先开菜单
 * 再点条目——这不是测试技巧，而是这次改造的核心：「常驻可点元素」必须能被数出来。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { formatDateTime } from "../../utils/format";
import type { AssistantMemory } from "./assistantMemoryApi";
import AssistantMemoryCard from "./AssistantMemoryCard";

const apiMocks = vi.hoisted(() => ({
  listAssistantMemories: vi.fn(),
  listMemoryKinds: vi.fn(),
  createAssistantMemory: vi.fn(),
  updateAssistantMemory: vi.fn(),
  deleteAssistantMemory: vi.fn(),
  neverUseAssistantMemory: vi.fn(),
  restoreAssistantMemory: vi.fn(),
  getAssistantMemoryHistory: vi.fn(),
  getAssistantMemorySettings: vi.fn(),
  saveAssistantMemorySettings: vi.fn(),
}));

vi.mock("./assistantMemoryApi", async () => {
  const actual =
    await vi.importActual<typeof import("./assistantMemoryApi")>("./assistantMemoryApi");
  return { ...actual, ...apiMocks };
});

const MANUAL: AssistantMemory = {
  id: 1,
  kind: "target_role",
  kind_label: "Target role",
  key: "",
  value: "Backend engineer",
  confidence: 1,
  status: "active",
  source: "manual",
  source_conversation_id: null,
  source_message_id: null,
  created_at: "2026-11-10T02:00:00",
  updated_at: "2026-11-10T02:00:00",
};

const EXTRACTED: AssistantMemory = {
  id: 2,
  kind: "city",
  kind_label: "Cities",
  key: "",
  value: "Shanghai or Hangzhou",
  confidence: 0.8,
  status: "active",
  source: "extracted",
  source_conversation_id: 77,
  source_message_id: 9,
  created_at: "2026-11-11T02:00:00",
  updated_at: "2026-11-11T02:00:00",
};

const SUPERSEDED: AssistantMemory = {
  ...MANUAL,
  id: 3,
  kind: "salary_floor",
  value: "20k",
  confidence: 0.6,
  status: "superseded",
};

function renderCard() {
  render(
    <AntdApp>
      <MemoryRouter>
        <AssistantMemoryCard />
      </MemoryRouter>
    </AntdApp>,
  );
}

/** antd 会对两个汉字的按钮插入空格：按"逐字允许空白"匹配无障碍名。 */
function buttonName(key: Parameters<typeof t>[0]): RegExp {
  return new RegExp(
    t(key)
      .split("")
      .map((char) => `${char}\\s*`)
      .join(""),
  );
}

/** 按语言包 key 取按钮（图标/插空格都不影响无障碍名里的文字）。 */
function buttonByText(key: Parameters<typeof t>[0]): HTMLElement {
  return screen.getByRole("button", { name: buttonName(key) });
}

/** 打开某一行的 `⋯` 菜单（行内所有次级动作都从这里进）。 */
async function openRowMenu(id: number) {
  const row = await screen.findByTestId(`assistant-memory-${id}`);
  fireEvent.click(within(row).getByRole("button", { name: t("assistantMemory.list.menu") }));
  return row;
}

/** 点开 `⋯` 后按动作名点菜单项。 */
async function clickRowAction(id: number, key: Parameters<typeof t>[0]) {
  await openRowMenu(id);
  const item = await screen.findByText(t(key));
  fireEvent.click(item);
}

beforeEach(() => {
  apiMocks.listAssistantMemories.mockReset().mockResolvedValue([MANUAL, EXTRACTED, SUPERSEDED]);
  apiMocks.listMemoryKinds.mockReset().mockResolvedValue([
    { kind: "target_role", label: "Target role" },
    { kind: "city", label: "Cities" },
    { kind: "salary_floor", label: "Salary floor" },
  ]);
  apiMocks.getAssistantMemorySettings
    .mockReset()
    .mockResolvedValue({ auto_extract: false, inject: true });
  apiMocks.saveAssistantMemorySettings
    .mockReset()
    .mockImplementation(async (patch: { auto_extract?: boolean; inject?: boolean }) => ({
      auto_extract: patch.auto_extract ?? false,
      inject: patch.inject ?? true,
    }));
  apiMocks.createAssistantMemory.mockReset().mockImplementation(async (input: unknown) => ({
    ...MANUAL,
    id: 9,
    ...(input as object),
  }));
  apiMocks.updateAssistantMemory
    .mockReset()
    .mockImplementation(async (id: number, input: unknown) => ({
      ...MANUAL,
      id,
      ...(input as object),
    }));
  apiMocks.deleteAssistantMemory.mockReset().mockResolvedValue(undefined);
  apiMocks.neverUseAssistantMemory
    .mockReset()
    .mockResolvedValue({ ...MANUAL, status: "suppressed" });
  apiMocks.restoreAssistantMemory.mockReset().mockResolvedValue({ ...MANUAL, status: "active" });
  apiMocks.getAssistantMemoryHistory.mockReset().mockResolvedValue([]);
});

afterEach(() => cleanup());

describe("AssistantMemoryCard 列表", () => {
  it("展示内容/类型；来源与更新时间进 `⋯` 菜单，列表头数的是列表长度", async () => {
    renderCard();

    expect(await screen.findByText("Backend engineer")).toBeInTheDocument();
    expect(screen.getByText(t("assistantMemory.kind.target_role"))).toBeInTheDocument();
    expect(screen.getByText(t("assistantMemory.status.superseded"))).toBeInTheDocument();
    // T23：N = 列表长度（3），不再只数 active。
    expect(screen.getByText(t("assistantMemory.list.count", { count: 3 }))).toBeInTheDocument();

    // 元信息不再占正文行：读屏文本（sr-only）与 `⋯` 菜单里各有一份。
    const metaLine = t("assistantMemory.meta.line", {
      source: t("assistantMemory.source.manual"),
      updated: t("assistantMemory.updatedAt", {
        time: formatDateTime(MANUAL.updated_at),
      }),
    });
    expect(
      within(screen.getByTestId("assistant-memory-1")).getByText(metaLine),
    ).toBeInTheDocument();
    await openRowMenu(1);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText(metaLine)).toBeInTheDocument();
  });

  it("自动抽取的记忆从 `⋯` 菜单回原对话；手填的没有这一项", async () => {
    renderCard();

    await openRowMenu(2);
    expect(await screen.findByText(t("assistantMemory.openConversation"))).toBeInTheDocument();
    cleanup();

    renderCard();
    await openRowMenu(1);
    // 手填的记忆没有来源对话，不能凭空给一个深链。
    await waitFor(() =>
      expect(screen.queryByText(t("assistantMemory.openConversation"))).toBeNull(),
    );
  });

  it("每条常驻只有「编辑」+「⋯」两个可点元素", async () => {
    renderCard();
    const row = await screen.findByTestId("assistant-memory-1");
    expect(within(row).getAllByRole("button")).toHaveLength(2);
  });

  it("空态给出手填入口，点击后打开新建弹层", async () => {
    apiMocks.listAssistantMemories.mockResolvedValue([]);
    renderCard();

    expect(await screen.findByText(t("assistantMemory.empty"))).toBeInTheDocument();
    fireEvent.click(
      screen.getAllByRole("button", { name: buttonName("assistantMemory.action.add") })[0],
    );
    expect(await screen.findByText(t("assistantMemory.form.createTitle"))).toBeInTheDocument();
  });

  it("列表加载失败显示错误态，重试后恢复", async () => {
    apiMocks.listAssistantMemories
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue([MANUAL]);
    renderCard();

    expect(await screen.findByText(t("assistantMemory.loadFailed"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: buttonName("common.retry") }));
    expect(await screen.findByText("Backend engineer")).toBeInTheDocument();
  });
});

describe("AssistantMemoryCard 版面判据（I-03）", () => {
  it("1 条数据不出现搜索与排序；超过 3 条才出现", async () => {
    apiMocks.listAssistantMemories.mockResolvedValue([MANUAL]);
    renderCard();
    await screen.findByText("Backend engineer");
    expect(screen.queryByLabelText(t("assistantMemory.search.placeholder"))).toBeNull();
    expect(screen.queryByLabelText(t("assistantMemory.sort.label"))).toBeNull();
    cleanup();

    apiMocks.listAssistantMemories.mockResolvedValue([
      MANUAL,
      EXTRACTED,
      SUPERSEDED,
      { ...MANUAL, id: 4, value: "Remote" } as AssistantMemory,
    ]);
    renderCard();
    expect(
      await screen.findByLabelText(t("assistantMemory.search.placeholder")),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(t("assistantMemory.sort.label"))).toBeInTheDocument();
  });

  it("「清空全部」下沉到列表底部，且 0 条时不渲染", async () => {
    renderCard();
    await screen.findByText("Backend engineer");
    const clearButton = screen.getByRole("button", {
      name: buttonName("assistantMemory.action.clearAll"),
    });
    // T23：危险动作在列表区内、列表末尾，不再占 Card extra。
    expect(clearButton.closest('[data-testid="assistant-memory-list"]')).not.toBeNull();
    cleanup();

    apiMocks.listAssistantMemories.mockResolvedValue([]);
    renderCard();
    await screen.findByText(t("assistantMemory.empty"));
    expect(
      screen.queryByRole("button", { name: buttonName("assistantMemory.action.clearAll") }),
    ).toBeNull();
  });

  it("敏感信息提示不再常驻卡片（已移进新增/编辑弹窗）", async () => {
    renderCard();
    await screen.findByText("Backend engineer");
    expect(screen.queryByText(t("assistantMemory.form.sensitiveHint"))).toBeNull();
    // 底注改说隐私；机制说明收进 ⓘ（不常驻一整句）。
    expect(screen.getByText(t("assistantMemory.footnote.privacy"))).toBeInTheDocument();
    expect(screen.queryByText(t("assistantMemory.injection.info"))).toBeNull();
    expect(
      screen.getByRole("button", { name: t("assistantMemory.injection.infoLabel") }),
    ).toBeInTheDocument();
  });
});

describe("AssistantMemoryCard 自动抽取与注入开关（T23）", () => {
  it("自动整理默认关闭；开启时只送自己这一项并给成功提示", async () => {
    renderCard();

    const toggle = await screen.findByRole("switch", {
      name: t("assistantMemory.autoExtract.label"),
    });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(apiMocks.saveAssistantMemorySettings).toHaveBeenCalledWith({ auto_extract: true }),
    );
    expect(
      await screen.findByText(t("assistantMemory.autoExtract.enableToast")),
    ).toBeInTheDocument();
  });

  it("记忆注入默认开启；关闭时只送 inject，不连带改写自动整理", async () => {
    renderCard();

    const toggle = await screen.findByRole("switch", {
      name: t("assistantMemory.inject.label"),
    });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(apiMocks.saveAssistantMemorySettings).toHaveBeenCalledWith({ inject: false }),
    );
    expect(await screen.findByText(t("assistantMemory.inject.disableToast"))).toBeInTheDocument();
  });
});

describe("AssistantMemoryCard 手填与编辑", () => {
  it("添加记忆：填写内容后以 manual 新建并刷新列表", async () => {
    renderCard();
    await screen.findByText("Backend engineer");

    fireEvent.click(buttonByText("assistantMemory.action.add"));
    expect(await screen.findByText(t("assistantMemory.form.createTitle"))).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: t("assistantMemory.form.value") }), {
      target: { value: "Remote friendly only" },
    });
    fireEvent.click(buttonByText("assistantMemory.action.create"));

    await waitFor(() =>
      expect(apiMocks.createAssistantMemory).toHaveBeenCalledWith({
        kind: "target_role",
        value: "Remote friendly only",
        key: "",
      }),
    );
    expect(apiMocks.listAssistantMemories).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(t("assistantMemory.toast.saved"))).toBeInTheDocument();
  });

  it("编辑：预填原内容，保存后调 PATCH 并刷新", async () => {
    renderCard();
    await screen.findByText("Backend engineer");

    const row = screen.getByTestId("assistant-memory-1");
    fireEvent.click(
      within(row).getByRole("button", { name: buttonName("assistantMemory.action.edit") }),
    );
    expect(await screen.findByText(t("assistantMemory.form.editTitle"))).toBeInTheDocument();

    const textarea = screen.getByRole("textbox", { name: t("assistantMemory.form.value") });
    expect(textarea).toHaveValue("Backend engineer");
    fireEvent.change(textarea, { target: { value: "Backend / platform engineer" } });
    fireEvent.click(buttonByText("assistantMemory.action.save"));

    await waitFor(() =>
      expect(apiMocks.updateAssistantMemory).toHaveBeenCalledWith(1, {
        value: "Backend / platform engineer",
        key: "",
      }),
    );
    expect(apiMocks.listAssistantMemories).toHaveBeenCalledTimes(2);
  });

  it("内容为空时不发请求，在弹层内提示必填", async () => {
    renderCard();
    await screen.findByText("Backend engineer");

    fireEvent.click(buttonByText("assistantMemory.action.add"));
    fireEvent.click(
      await screen.findByRole("button", { name: buttonName("assistantMemory.action.create") }),
    );
    expect(await screen.findByText(t("assistantMemory.error.valueRequired"))).toBeInTheDocument();
    expect(apiMocks.createAssistantMemory).not.toHaveBeenCalled();
  });
});

describe("AssistantMemoryCard 删除、停用与清空", () => {
  it("删除单条：`⋯` → 删除，弹窗写明后果，确认后调 DELETE", async () => {
    renderCard();
    await screen.findByText("Backend engineer");

    await clickRowAction(1, "assistantMemory.action.delete");
    expect(await screen.findByText(t("assistantMemory.deleteConfirm.body"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("assistantMemory.deleteConfirm.ok") }));

    await waitFor(() => expect(apiMocks.deleteAssistantMemory).toHaveBeenCalledWith(1));
    expect(await screen.findByText(t("assistantMemory.toast.deleted"))).toBeInTheDocument();
  });

  it("停用：`⋯` → 永不使用，走单独端点，不调用普通删除", async () => {
    renderCard();
    await screen.findByText("Backend engineer");

    await clickRowAction(1, "assistantMemory.action.neverUse");
    expect(await screen.findByText(t("assistantMemory.neverUseConfirm.body"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("assistantMemory.neverUseConfirm.ok") }));

    await waitFor(() => expect(apiMocks.neverUseAssistantMemory).toHaveBeenCalledWith(1));
    expect(apiMocks.deleteAssistantMemory).not.toHaveBeenCalled();
  });

  it("清空全部：确认文案写明条数与后果，逐条删除并提示总数", async () => {
    renderCard();
    await screen.findByText("Backend engineer");

    fireEvent.click(
      screen.getByRole("button", { name: buttonName("assistantMemory.action.clearAll") }),
    );
    expect(
      await screen.findByText(t("assistantMemory.clearConfirm.body", { count: 3 })),
    ).toBeInTheDocument();
    expect(apiMocks.deleteAssistantMemory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: t("assistantMemory.clearConfirm.ok") }));

    await waitFor(() => expect(apiMocks.deleteAssistantMemory).toHaveBeenCalledTimes(3));
    expect(
      await screen.findByText(t("assistantMemory.toast.cleared", { count: 3 })),
    ).toBeInTheDocument();
  });
});

describe("AssistantMemoryCard 停用语义（F33）", () => {
  it("停用的条目仍留在列表：置灰、标「已停用」、`⋯` 里给「恢复使用」", async () => {
    apiMocks.listAssistantMemories.mockResolvedValue([
      MANUAL,
      { ...EXTRACTED, status: "suppressed" } as AssistantMemory,
    ]);
    renderCard();

    const row = await screen.findByTestId("assistant-memory-2");
    expect(within(row).getByText(t("assistantMemory.status.suppressed"))).toBeInTheDocument();
    expect(within(row).getByText("Shanghai or Hangzhou")).toBeInTheDocument();
    expect(row.className).toContain("is-suppressed");
    // 停用的条目没有「编辑」，只剩 `⋯` 一个可点元素。
    expect(within(row).getAllByRole("button")).toHaveLength(1);

    await clickRowAction(2, "assistantMemory.action.restore");
    await waitFor(() => expect(apiMocks.restoreAssistantMemory).toHaveBeenCalledWith(2));
  });

  it("被替换的条目只读：没有「编辑」，也没有「永不使用」", async () => {
    renderCard();
    const row = await screen.findByTestId("assistant-memory-3");
    expect(
      within(row).queryByRole("button", { name: buttonName("assistantMemory.action.edit") }),
    ).toBeNull();
    await openRowMenu(3);
    await waitFor(() =>
      expect(screen.queryByText(t("assistantMemory.action.neverUse"))).toBeNull(),
    );
  });

  it("「历史」按时间倒序展示动作与前后值", async () => {
    apiMocks.getAssistantMemoryHistory.mockResolvedValue([
      { id: 3, action: "suppress", before: "Shanghai", after: "", at: "2026-11-12T03:00:00" },
      { id: 2, action: "update", before: "Beijing", after: "Shanghai", at: "2026-11-11T03:00:00" },
      { id: 1, action: "create", before: "", after: "Beijing", at: "2026-11-10T03:00:00" },
    ]);
    renderCard();

    await clickRowAction(2, "assistantMemory.action.history");
    await waitFor(() => expect(apiMocks.getAssistantMemoryHistory).toHaveBeenCalledWith(2));
    expect(await screen.findByText(t("assistantMemory.history.title"))).toBeInTheDocument();
    expect(screen.getByText(t("assistantMemory.history.action.suppress"))).toBeInTheDocument();
    expect(
      screen.getByText(
        t("assistantMemory.history.changed", { before: "Beijing", after: "Shanghai" }),
      ),
    ).toBeInTheDocument();
  });
});
