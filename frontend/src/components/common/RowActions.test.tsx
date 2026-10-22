// SPDX-License-Identifier: Apache-2.0
/**
 * 行操作区 / 批量删除按钮的禁用语义（审计 §8.1 规则 5）。
 *
 * 规矩只有一条：**禁用语义只传 `true` 或 `undefined`**（`disabled={flag || undefined}`）。
 * 因为 antd 的合并规则是 `自定义 disabled ?? 上下文 disabled`——恒传布尔 `false`
 * 会把 `<Form disabled>` / `<ConfigProvider componentDisabled>` 的上下文禁用短路掉，
 * 「只读页里按钮居然还能点」这类故障就是这么来的。
 *
 * 为什么 `BatchDeleteButton` 的用例也放在本文件：它是同一条契约的第二个出口
 * （批量选择工具栏），共用同一套断言形态；为了不再多一个几乎重复的夹具文件，
 * 两个 describe 放在一起。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App as AntdApp, Form } from "antd";
import { afterEach, describe, expect, it, vi } from "vitest";
import BatchDeleteButton from "./BatchDeleteButton";
import { RowActions } from "./RowActions";
import { TRASH_RECOVERY_NOTE, useRowActionMenu, type RowMenuItem } from "./rowActionMenu";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const ACTIONS = [{ key: "edit", label: "编辑", onClick: () => undefined }];

describe("RowActions 的禁用语义", () => {
  it("未传 disabled 时跟随 Form 级禁用（DisabledContext=true）", () => {
    render(
      <Form disabled>
        <RowActions primary={ACTIONS} more={ACTIONS} />
      </Form>,
    );

    expect(screen.getByRole("button", { name: "编辑" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "更多操作" })).toBeDisabled();
  });

  it("显式 disabled={false} 在没有禁用上下文时照常可用", () => {
    render(<RowActions primary={ACTIONS} more={ACTIONS} disabled={false} />);

    expect(screen.getByRole("button", { name: "编辑" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "更多操作" })).toBeEnabled();
  });

  it("单条动作自己标了 disabled 时只禁用那一条", () => {
    render(
      <RowActions
        primary={[ACTIONS[0], { key: "archive", label: "归档", disabled: true }]}
        disabled={false}
      />,
    );

    expect(screen.getByRole("button", { name: "编辑" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "归档" })).toBeDisabled();
  });
});

/** 把菜单项 onClick 暴露成一个真按钮：只为一件事存在，验证确认弹窗带正文。 */
function ConfirmHarness({ items }: { items: RowMenuItem[] }) {
  const buildMenu = useRowActionMenu();
  const menuItems = buildMenu(items);
  const open = () => {
    const first = menuItems?.[0] as { onClick?: () => void } | undefined;
    first?.onClick?.();
  };
  return <button onClick={open}>打开确认</button>;
}

describe("二次确认的正文", () => {
  it("confirmBody 出现在弹窗正文里（不只有一个标题）", async () => {
    const onClick = vi.fn();
    render(
      <AntdApp>
        <ConfirmHarness
          items={[
            {
              key: "delete",
              label: "删除",
              danger: true,
              confirm: "删除这条记录？",
              confirmBody: TRASH_RECOVERY_NOTE,
              onClick,
            },
          ]}
        />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开确认" }));

    const dialog = await screen.findByRole("dialog");
    // 标题说动作与对象，正文说后果与可逆性——两段都在，才算 §4.4 的三段式。
    expect(dialog.textContent).toContain("删除这条记录？");
    expect(dialog.textContent).toContain(TRASH_RECOVERY_NOTE);
  });
});

describe("BatchDeleteButton 的禁用语义", () => {
  it("未传 disabled 时跟随 Form 级禁用（DisabledContext=true）", () => {
    render(
      <Form disabled>
        <BatchDeleteButton count={2} noun="条记录" onDelete={vi.fn()} />
      </Form>,
    );

    expect(screen.getByRole("button", { name: "删除所选" })).toBeDisabled();
  });

  it("有选中项且无禁用上下文时可用（显式 false 不短路上下文，也不误伤自己）", () => {
    render(<BatchDeleteButton count={2} noun="条记录" disabled={false} onDelete={vi.fn()} />);

    expect(screen.getByRole("button", { name: "删除所选" })).toBeEnabled();
  });

  it("没选中任何项时禁用（数量为 0 本身就是禁用理由）", () => {
    render(<BatchDeleteButton count={0} noun="条记录" onDelete={vi.fn()} />);

    expect(screen.getByRole("button", { name: "删除所选" })).toBeDisabled();
  });
});
