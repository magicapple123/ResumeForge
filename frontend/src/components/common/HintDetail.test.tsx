// SPDX-License-Identifier: Apache-2.0
/**
 * I-28：`HintDetail` 参与提示模式（Alt+H）与"本页 N 条说明"计数。
 *
 * 三条必须成立、且都只能在这一层验证：
 * 1. **挂载即登记**（与模式开关无关）——徽标要在进入模式之前就数得对；
 * 2. **StrictMode 双挂载不重复计数**——`+1/-1` 写法会漂，这里按身份登记；
 * 3. `variant="block"` 只换排版，不换交互（默认仍是可点开的按钮）。
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
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

/**
 * #10：120 字符无空格串（URL / 路径 / 长参数名）不许撑破卡片。
 *
 * jsdom 没有布局，量不到"溢出"，但**折行规则本身**是可判定的：`overflowWrap: anywhere`
 * 参与 min-content 计算，`maxWidth` 才压得住；只写 `break-word` 时最小宽度仍是整串长度，
 * 容器该被撑破还是会被撑破。所以这里钉的是这两条声明，而不是像素。
 */
describe("HintDetail 长串换行（#10）", () => {
  // 一整条没有空格的地址：浏览器默认只在空格处折行，所以它是最容易撑破卡片的那种文案。
  const LONG = `https://example.internal/research/brief?${"a".repeat(120)}`;

  /** 找出正文那一层（带 `pre-line` 的那个 span / 容器）。 */
  function detailLayer(scope: HTMLElement): HTMLElement {
    // 用**全等**而不是 `includes(URL 前缀)`：后者是 CodeQL
    // `js/incomplete-url-substring-sanitization` 的告警点（把 URL 当字符串检查子串），
    // 而且这里本来就该找"正文恰好是这条长串"的那个节点——子串匹配还可能误命中父节点。
    const node = Array.from(scope.querySelectorAll<HTMLElement>("span")).find(
      (span) => span.textContent === LONG,
    );
    if (!node) throw new Error("找不到正文节点");
    return node;
  }

  it("气泡（默认分支）里的正文带 anywhere + break-word，且没改 maxWidth", async () => {
    render(<HintDetail detail={LONG} label={LABEL} />);
    fireEvent.click(screen.getByRole("button", { name: LABEL }));

    const layer = await screen.findByText(LONG);
    expect(layer.style.overflowWrap).toBe("anywhere");
    expect(layer.style.wordBreak).toBe("break-word");
    // maxWidth 是阅读行宽，不是这个 bug 的原因；不许为了"不撑破"把它改小或去掉。
    expect(layer.style.maxWidth).toBe("320px");
  });

  it("提示模式（原地展开分支）同样带折行规则", () => {
    render(<HintDetail detail={LONG} label={LABEL} />);
    act(() => enterHelpMode());

    const note = screen.getByRole("note", { name: LABEL });
    const layer = detailLayer(note);
    expect(layer.style.overflowWrap).toBe("anywhere");
    expect(layer.style.wordBreak).toBe("break-word");
  });
});
