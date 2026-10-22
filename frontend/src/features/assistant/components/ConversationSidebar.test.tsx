// SPDX-License-Identifier: Apache-2.0
/** ConversationSidebar 批量选择：勾选若干段对话 → 确认 → 把 id 列表交给父级。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantConversationBrief } from "../../../types";
import ConversationSidebar from "./ConversationSidebar";

function conversation(overrides: Partial<AssistantConversationBrief>): AssistantConversationBrief {
  return {
    id: 1,
    title: "对话",
    surface: "page",
    pinned: false,
    favorite: false,
    archived: false,
    group_name: "",
    message_count: 2,
    created_at: "2026-10-01T10:00:00",
    updated_at: "2026-10-01T10:00:00",
    ...overrides,
  };
}

const CONVERSATIONS = [
  conversation({ id: 1, title: "简历修改讨论" }),
  conversation({ id: 2, title: "面试复盘" }),
];

function sidebarProps(
  onBatchDelete: (ids: number[]) => void,
  conversations: AssistantConversationBrief[] = CONVERSATIONS,
  loading = false,
) {
  return {
    conversations,
    loading,
    activeId: null,
    onCreate: vi.fn(),
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onToggleFlag: vi.fn(),
    onArchive: vi.fn(),
    onFork: vi.fn(),
    onMoveToGroup: vi.fn(),
    onBatchDelete,
  };
}

function renderSidebar(
  onBatchDelete: (ids: number[]) => void,
  conversations: AssistantConversationBrief[] = CONVERSATIONS,
  loading = false,
) {
  return render(
    <AntdApp>
      <ConversationSidebar {...sidebarProps(onBatchDelete, conversations, loading)} />
    </AntdApp>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ConversationSidebar 批量选择", () => {
  /** 加载态不是空态：加载中不出现「暂无对话」（用户截图里空态文案 + 转圈图标同屏）；
      加载完成且确实没有会话时才显示空态。 */
  it("加载中显示加载提示，加载完成且无会话才显示「暂无对话」", () => {
    const onBatchDelete = vi.fn();
    const view = renderSidebar(onBatchDelete, [], true);

    expect(screen.queryByText("暂无对话")).not.toBeInTheDocument();
    expect(screen.getByText("正在加载对话…")).toBeInTheDocument();

    view.rerender(
      <AntdApp>
        <ConversationSidebar {...sidebarProps(onBatchDelete, [], false)} />
      </AntdApp>,
    );
    expect(screen.getByText("暂无对话")).toBeInTheDocument();
    expect(screen.queryByText("正在加载对话…")).not.toBeInTheDocument();
  });

  /** 右键会话条目，从菜单点「批量选择」（入口已从侧栏按钮收进右键菜单，R8）。 */
  async function enterSelectingViaContextMenu(title: string) {
    fireEvent.contextMenu(screen.getByText(title));
    fireEvent.click(await screen.findByRole("menuitem", { name: /批量选择/ }));
  }

  it("右键菜单进入多选 → 勾 2 项 → 删除所选 → 确认 → 把 id 列表交给父级", async () => {
    const onBatchDelete = vi.fn();
    renderSidebar(onBatchDelete);

    await screen.findByText("简历修改讨论");
    // R8：侧栏不再有直接的「批量选择」按钮。
    expect(screen.queryByRole("button", { name: /批量选择/ })).not.toBeInTheDocument();
    await enterSelectingViaContextMenu("简历修改讨论");

    fireEvent.click(await screen.findByRole("checkbox", { name: "选择对话 简历修改讨论" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "选择对话 面试复盘" }));
    expect(screen.getByText("已选 2 项")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "删除所选" }));
    const confirmRoot = await waitFor(() => {
      const root = document.querySelector(".ant-modal-confirm");
      expect(root).not.toBeNull();
      return root as HTMLElement;
    });
    expect(confirmRoot.textContent).toContain("删除选中的对话");
    expect(confirmRoot.textContent).toContain("这 2 段对话");
    fireEvent.click(within(confirmRoot).getByRole("button", { name: /删\s*除/ }));

    await waitFor(() => expect(onBatchDelete).toHaveBeenCalledWith([1, 2]));
  });

  it("退出多选清空选区", async () => {
    const onBatchDelete = vi.fn();
    renderSidebar(onBatchDelete);

    await enterSelectingViaContextMenu("简历修改讨论");
    fireEvent.click(await screen.findByRole("checkbox", { name: "选择对话 简历修改讨论" }));
    expect(screen.getByText("已选 1 项")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "退出多选" }));

    expect(screen.queryByText(/已选/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除所选" })).not.toBeInTheDocument();
    expect(onBatchDelete).not.toHaveBeenCalled();
  });

  it("全选覆盖全部可见会话（去分页后 12 条也不只选本页 10 条）", async () => {
    const onBatchDelete = vi.fn();
    const many = Array.from({ length: 12 }, (_, index) =>
      conversation({ id: index + 1, title: `对话 ${index + 1}` }),
    );
    renderSidebar(onBatchDelete, many);

    await screen.findByText("对话 1");
    fireEvent.contextMenu(screen.getByText("对话 1"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /批量选择/ }));

    fireEvent.click(await screen.findByRole("checkbox", { name: /全选本页/ }));
    expect(screen.getByText("已选 12 项")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "删除所选" }));
    const confirmRoot = await waitFor(() => {
      const root = document.querySelector(".ant-modal-confirm");
      expect(root).not.toBeNull();
      return root as HTMLElement;
    });
    expect(confirmRoot.textContent).toContain("删除选中的对话");
    expect(confirmRoot.textContent).toContain("这 12 段对话");
    fireEvent.click(within(confirmRoot).getByRole("button", { name: /删\s*除/ }));

    await waitFor(() => expect(onBatchDelete).toHaveBeenCalledTimes(1));
    expect(onBatchDelete.mock.calls[0][0]).toHaveLength(12);
  });
});
