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

function renderSidebar(onBatchDelete: (ids: number[]) => void) {
  return render(
    <AntdApp>
      <ConversationSidebar
        conversations={CONVERSATIONS}
        loading={false}
        activeId={null}
        onCreate={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onToggleFlag={vi.fn()}
        onArchive={vi.fn()}
        onFork={vi.fn()}
        onMoveToGroup={vi.fn()}
        onBatchDelete={onBatchDelete}
      />
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
    expect(confirmRoot.textContent).toContain("删除选中的 2 段对话");
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
});
