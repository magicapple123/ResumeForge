// SPDX-License-Identifier: Apache-2.0
/**
 * I-28：`HintDetail` 参与提示模式（Alt+H）与"本页 N 条说明"计数。
 *
 * 三条必须成立、且都只能在这一层验证：
 * 1. **挂载即登记**（与模式开关无关）——徽标要在进入模式之前就数得对；
 * 2. **StrictMode 双挂载不重复计数**——`+1/-1` 写法会漂，这里按身份登记；
 * 3. `variant="block"` 只换排版，不换交互（默认仍是可点开的按钮）。
 */
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../i18n";
import HelpModeBadge from "../../features/help-mode/HelpModeBadge";
import {
  enterHelpMode,
  exitHelpMode,
  getHelpModeSnapshot,
} from "../../features/help-mode/helpModeStore";
import { HintDetail } from "./HintDetail";

const DETAIL = t("shortcutSettings.hint.toggleTheme");
const LABEL = t("shortcutSettings.actionHelp", { label: t("shortcutSettings.action.toggleTheme") });

afterEach(() => {
  // 模块级单例：模式与计数都要回到"关闭 / 0 条"，否则用例互相污染。
  exitHelpMode();
});

describe("HintDetail 与提示模式（I-28）", () => {
  it("挂载即登记、卸载即注销：计数与模式开关无关", () => {
    const view = render(
      <>
        <HintDetail detail={DETAIL} label={LABEL} />
        <HintDetail detail={DETAIL} label={LABEL} />
      </>,
    );
    expect(getHelpModeSnapshot().hintCount).toBe(2);
    // 只是登记，不代表进入了模式。
    expect(getHelpModeSnapshot().active).toBe(false);

    view.rerender(<HintDetail detail={DETAIL} label={LABEL} />);
    expect(getHelpModeSnapshot().hintCount).toBe(1);

    view.unmount();
    expect(getHelpModeSnapshot().hintCount).toBe(0);
  });

  it("StrictMode 双挂载不重复计数", () => {
    render(
      <StrictMode>
        <HintDetail detail={DETAIL} label={LABEL} />
      </StrictMode>,
    );
    expect(getHelpModeSnapshot().hintCount).toBe(1);
  });

  it("提示模式下原地展开成 role=note，退出后恢复成按钮", () => {
    render(<HintDetail detail={DETAIL} label={LABEL} />);
    expect(screen.getByRole("button", { name: LABEL })).toBeInTheDocument();

    act(() => enterHelpMode());
    const note = screen.getByRole("note", { name: LABEL });
    expect(note).toHaveAttribute("data-help-mode", "active");
    expect(note.textContent).toContain(DETAIL);
    expect(screen.queryByRole("button", { name: LABEL })).toBeNull();

    act(() => exitHelpMode());
    expect(screen.getByRole("button", { name: LABEL })).toBeInTheDocument();
  });

  it("block 变体改成竖排，但仍是可点开的按钮", () => {
    render(<HintDetail detail={DETAIL} label={LABEL} summary="Toggle theme" variant="block" />);
    const trigger = screen.getByRole("button", { name: LABEL });
    const wrap = trigger.parentElement as HTMLElement;
    expect(wrap.style.display).toBe("block");
    expect(wrap.style.width).toBe("100%");
    expect(wrap.textContent).toContain("Toggle theme");
  });

  it("空说明不渲染、也不计数", () => {
    render(<HintDetail detail="   " label={LABEL} />);
    expect(screen.queryByRole("button", { name: LABEL })).toBeNull();
    expect(getHelpModeSnapshot().hintCount).toBe(0);
  });

  it("徽标显示本页条数；没有说明时说清「没有」", () => {
    const view = render(
      <MemoryRouter initialEntries={["/settings"]}>
        <HintDetail detail={DETAIL} label={LABEL} />
        <HelpModeBadge />
      </MemoryRouter>,
    );
    act(() => enterHelpMode());
    expect(screen.getByRole("status")).toHaveTextContent(t("helpMode.badgeCount", { count: 1 }));

    view.rerender(
      <MemoryRouter initialEntries={["/settings"]}>
        <HelpModeBadge />
      </MemoryRouter>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(t("helpMode.badgeEmpty"));
  });
});
