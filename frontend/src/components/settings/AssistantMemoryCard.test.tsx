// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「助手记忆」卡（#31C/#18D）：列表/来源/深链、自动抽取开关、手填与编辑、
 * 删除/永不使用/清空的三段式确认。
 *
 * 断言文案一律 t(...)；后端接口整体 mock（组件只做展示与交互，校验在后端）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { AssistantMemory } from "./assistantMemoryApi";
import AssistantMemoryCard from "./AssistantMemoryCard";

const apiMocks = vi.hoisted(() => ({
  listAssistantMemories: vi.fn(),
  listMemoryKinds: vi.fn(),
  createAssistantMemory: vi.fn(),
  updateAssistantMemory: vi.fn(),
  deleteAssistantMemory: vi.fn(),
  neverUseAssistantMemory: vi.fn(),
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

beforeEach(() => {
  apiMocks.listAssistantMemories.mockReset().mockResolvedValue([MANUAL, EXTRACTED, SUPERSEDED]);
  apiMocks.listMemoryKinds.mockReset().mockResolvedValue([
    { kind: "target_role", label: "Target role" },
    { kind: "city", label: "Cities" },
    { kind: "salary_floor", label: "Salary floor" },
  ]);
  apiMocks.getAssistantMemorySettings.mockReset().mockResolvedValue({ auto_extract: false });
  apiMocks.saveAssistantMemorySettings
    .mockReset()
    .mockImplementation(async (enabled: boolean) => ({ auto_extract: enabled }));
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
  apiMocks.neverUseAssistantMemory.mockReset().mockResolvedValue({ ...MANUAL, status: "deleted" });
});

afterEach(() => cleanup());

describe("AssistantMemoryCard 列表", () => {
  it("展示内容/类型/来源/置信度，并为自动抽取的记忆提供回原对话深链", async () => {
    renderCard();

    expect(await screen.findByText("Backend engineer")).toBeInTheDocument();
    expect(screen.getByText(t("assistantMemory.kind.target_role"))).toBeInTheDocument();
    expect(screen.getAllByText(t("assistantMemory.source.manual"))).toHaveLength(2);
    expect(screen.getAllByText(t("assistantMemory.source.extracted"))).toHaveLength(1);
    expect(screen.getByText(t("assistantMemory.status.superseded"))).toBeInTheDocument();
    expect(screen.getByText(t("assistantMemory.count", { count: 3 }))).toBeInTheDocument();

    const extractedRow = screen.getByTestId("assistant-memory-2");
    expect(
      within(extractedRow).getByRole("button", { name: t("assistantMemory.openConversation") }),
    ).toBeInTheDocument();
    // 手填的记忆没有来源对话，不能凭空给一个深链。
    expect(
      within(screen.getByTestId("assistant-memory-1")).queryByRole("button", {
        name: t("assistantMemory.openConversation"),
      }),
    ).toBeNull();
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

describe("AssistantMemoryCard 自动抽取", () => {
  it("默认关闭；开启时调用设置接口并给成功提示", async () => {
    renderCard();

    const toggle = await screen.findByRole("switch", {
      name: t("assistantMemory.autoExtract.label"),
    });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);
    await waitFor(() => expect(apiMocks.saveAssistantMemorySettings).toHaveBeenCalledWith(true));
    expect(
      await screen.findByText(t("assistantMemory.autoExtract.enableToast")),
    ).toBeInTheDocument();
  });
});

describe("AssistantMemoryCard 手填与编辑", () => {
  it("补充画像：填写内容后以 manual 新建并刷新列表", async () => {
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

describe("AssistantMemoryCard 删除、永不使用与清空", () => {
  it("删除单条：弹窗写明后果，确认后调 DELETE", async () => {
    renderCard();
    await screen.findByText("Backend engineer");

    const row = screen.getByTestId("assistant-memory-1");
    fireEvent.click(
      within(row).getByRole("button", { name: buttonName("assistantMemory.action.delete") }),
    );
    expect(await screen.findByText(t("assistantMemory.deleteConfirm.body"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("assistantMemory.deleteConfirm.ok") }));

    await waitFor(() => expect(apiMocks.deleteAssistantMemory).toHaveBeenCalledWith(1));
    expect(await screen.findByText(t("assistantMemory.toast.deleted"))).toBeInTheDocument();
  });

  it("永不使用：走单独端点，不调用普通删除", async () => {
    renderCard();
    await screen.findByText("Backend engineer");

    const row = screen.getByTestId("assistant-memory-1");
    fireEvent.click(
      within(row).getByRole("button", { name: buttonName("assistantMemory.action.neverUse") }),
    );
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
