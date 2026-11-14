// SPDX-License-Identifier: Apache-2.0
/**
 * 行内格式的右键菜单（F22）。
 *
 * 守四件事：①选中文字右键 → 菜单接管（原生菜单被 preventDefault）；
 * ②**空选区右键原样放行**（不 preventDefault、不弹菜单）；
 * ③菜单项走同一批纯函数并真的写回受控输入框；
 * ④「清除行内格式」把样式标记与加粗一起去掉，可见文字不变。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import InlineMarkContextMenu from "./InlineMarkContextMenu";
import { applyInlineEdit, resetInlineMarkFieldsForTests } from "../editor/lastFocusedTextarea";
import { registerInlineMarkField } from "../editor/useInlineMarkRange";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  resetInlineMarkFieldsForTests();
});

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <AntdApp>
      <InlineMarkContextMenu
        onCommit={(next) =>
          applyInlineEdit({ text: next.text, start: next.selection.start, end: next.selection.end })
        }
      >
        <div>
          <input
            aria-label="字段值"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onFocus={registerInlineMarkField}
          />
        </div>
      </InlineMarkContextMenu>
      <output data-testid="value">{value}</output>
    </AntdApp>
  );
}

function rightClick(target: HTMLElement) {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 20,
  });
  target.dispatchEvent(event);
  return event;
}

describe("InlineMarkContextMenu", () => {
  it("选中文字右键：接管菜单，点「加粗」写回受控值", async () => {
    render(<Harness initial="abcdef" />);
    const input = screen.getByRole("textbox", { name: "字段值" }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 4);

    const event = rightClick(input);
    expect(event.defaultPrevented).toBe(true);

    fireEvent.click(await screen.findByRole("menuitem", { name: t("typography.inline.bold") }));
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("ab**cd**ef"));
    expect(input.value).toBe("ab**cd**ef");
  });

  it("空选区右键：放行原生菜单（不 preventDefault、不弹菜单）", async () => {
    render(<Harness initial="abcdef" />);
    const input = screen.getByRole("textbox", { name: "字段值" }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(3, 3);

    const event = rightClick(input);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("「清除行内格式」去掉样式标记与加粗，可见文字不变", async () => {
    render(<Harness initial="{@size=1.1}**重点**{@}" />);
    const input = screen.getByRole("textbox", { name: "字段值" }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(0, input.value.length);

    rightClick(input);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: t("typography.inline.clearMarks") }),
    );
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("重点"));
  });

  it("没有选区时也放行；菜单关闭后不再残留", async () => {
    render(<Harness initial="abc" />);
    const input = screen.getByRole("textbox", { name: "字段值" }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(0, 2);
    rightClick(input);
    await screen.findByRole("menuitem", { name: t("typography.inline.bold") });

    input.setSelectionRange(2, 2);
    const event = rightClick(input);
    expect(event.defaultPrevented).toBe(false);
  });
});
