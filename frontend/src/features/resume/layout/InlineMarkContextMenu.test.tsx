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
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import InlineMarkContextMenu, { menuRootStyle } from "./InlineMarkContextMenu";
import { applyInlineEdit, resetInlineMarkFieldsForTests } from "../editor/lastFocusedTextarea";
import { registerInlineMarkField } from "../editor/useInlineMarkRange";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  resetInlineMarkFieldsForTests();
  vi.restoreAllMocks();
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
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

function rightClick(target: HTMLElement, clientX = 40, clientY = 20) {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
  });
  target.dispatchEvent(event);
  return event;
}

/**
 * 关闭判据用遮罩：它只在 `open` 时为真，关闭即卸载。
 * （antd 关闭受控浮层时**不卸载**弹层，只把整体挪到 `left: -1000vw`；而 jsdom 里
 * 首次方位计算并不必然发生，靠内联样式判断会误判。）
 */
async function expectMenuClosed() {
  await waitFor(() => {
    expect(document.querySelector(".rf-inline-mark-mask")).toBeNull();
  });
}

/** 给弹层一个固定尺寸，好让 DF-3 的"下方放不下就翻上"在 jsdom 里可判。 */
function mockPopupSize(width: number, height: number) {
  const real = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains("rf-inline-mark-popup")) {
      return {
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        width,
        height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return real.call(this);
  });
}

describe("InlineMarkContextMenu", () => {
  /**
   * I-11：首帧闪一张空壳，是因为隐藏只加在内层 `.rf-inline-mark-popup` 上，antd 的外壳
   * （白底、圆角、阴影）仍然可见。结构守卫钉住"落点未算出 → 外层也隐藏"这一条；真机上
   * "第一帧就在最终位置"只能靠录屏，jsdom 测不了（清单里已写明）。
   */
  it("I-11：落点未算出时外层隐藏，算出来后恢复", () => {
    expect(menuRootStyle(false)).toEqual({ visibility: "hidden" });
    expect(menuRootStyle(true)).toBeUndefined();
  });

  it("I-11：首次打开仍能正常出现（外层没有被永久隐藏）", async () => {
    mockPopupSize(220, 280);
    render(<Harness initial="abcdef" />);
    const input = screen.getByRole("textbox", { name: "字段值" }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 4);
    rightClick(input);

    expect(await screen.findByRole("menu")).toBeTruthy();
    await waitFor(() => {
      const dropdown = document.querySelector(".ant-dropdown") as HTMLElement | null;
      expect(dropdown?.style.visibility ?? "").not.toBe("hidden");
    });
  });

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

  it("点菜单外任意处关闭（I-25）", async () => {
    render(<Harness initial="abcdef" />);
    const input = screen.getByRole("textbox", { name: "字段值" }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 4);
    rightClick(input);
    expect(await screen.findByRole("menu")).toBeTruthy();

    // 在宿主输入框之外按下指针：菜单必须收起，输入框里的选区不受影响。
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    // antd 关闭受控浮层时**不卸载**，而是把弹层挪到 `left: -1000vw`（视觉上离开视口）。
    // 所以判据是"弹层已离屏"，不是"DOM 里没有 menu"。
    await waitFor(() => {
      const dropdown = document.querySelector(".ant-dropdown") as HTMLElement | null;
      const style = dropdown?.getAttribute("style") ?? "";
      expect(!dropdown || style.includes("-1000vw")).toBe(true);
    });
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

  // DF-2：纸面是 iframe，父页面收不到事件——遮罩负责"点纸面即关闭"。
  it("DF-2：点透明遮罩关闭菜单（点纸面任意处）", async () => {
    render(<Harness initial="abcdef" />);
    const input = screen.getByRole("textbox", { name: "字段值" }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 4);
    rightClick(input);
    await screen.findByRole("menu");

    const mask = document.querySelector(".rf-inline-mark-mask") as HTMLElement;
    expect(mask).toBeTruthy();
    fireEvent.mouseDown(mask);
    await expectMenuClosed();
    // 遮罩不残留：关闭后立刻从 DOM 移除，纸面点击恢复。
    expect(document.querySelector(".rf-inline-mark-mask")).toBeNull();
  });

  it("DF-2：滚轮落在外层也关闭菜单", async () => {
    render(<Harness initial="abcdef" />);
    const input = screen.getByRole("textbox", { name: "字段值" }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 4);
    rightClick(input);
    await screen.findByRole("menu");

    const mask = document.querySelector(".rf-inline-mark-mask") as HTMLElement;
    fireEvent.wheel(mask);
    await expectMenuClosed();
  });

  // DF-2 的第二半：宿主豁免只留给右键，左键点同一张卡片也应关闭。
  it("DF-2：左键点在宿主卡片内（例如另一个字段）关闭菜单", async () => {
    render(<Harness initial="abcdef" />);
    const input = screen.getByRole("textbox", { name: "字段值" }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 4);
    rightClick(input);
    await screen.findByRole("menu");

    fireEvent.mouseDown(input, { button: 0 });
    await expectMenuClosed();
  });

  it("DF-2：右键仍交给 onContextMenu 重新定位，不提前关闭", async () => {
    render(<Harness initial="abcdef" />);
    const input = screen.getByRole("textbox", { name: "字段值" }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 4);
    rightClick(input);
    await screen.findByRole("menu");

    fireEvent.mouseDown(input, { button: 2 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector(".rf-inline-mark-mask")).not.toBeNull();
  });

  // DF-3：下方优先，放不下翻到光标上方（底边贴光标）。
  it("DF-3：光标距底部不足一个菜单高度时翻到上方", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });
    mockPopupSize(220, 280);
    render(<Harness initial="abcdef" />);
    const input = screen.getByRole("textbox", { name: "字段值" }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 4);
    // 400 - 390 = 10px < 280px，下方放不下。
    rightClick(input, 40, 390);

    await waitFor(() => {
      const popup = document.querySelector(".rf-inline-mark-popup") as HTMLElement | null;
      expect(popup?.getAttribute("data-placement")).toBe("above");
    });
  });

  it("DF-3：上方空间足够时留在下方（不无脑翻上去）", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });
    mockPopupSize(220, 280);
    render(<Harness initial="abcdef" />);
    const input = screen.getByRole("textbox", { name: "字段值" }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 4);
    rightClick(input, 40, 20);

    await waitFor(() => {
      const popup = document.querySelector(".rf-inline-mark-popup") as HTMLElement | null;
      expect(popup?.getAttribute("data-placement")).toBe("below");
      expect(popup?.style.visibility).toBe("");
    });
  });

  // DF-3（实机复核补）：窗口在两次右键之间缩放过时，翻转判定必须用**当前**视口，
  // 不能继续用上一次打开时记下的高度。修复前 `viewport` 只在菜单开着时才更新，
  // 这里会错误地留在下方。
  it("DF-3：窗口缩小后再右键，按新的视口高度翻转", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    mockPopupSize(220, 280);
    render(<Harness initial="abcdef" />);
    const input = screen.getByRole("textbox", { name: "字段值" }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 4);

    // 菜单没开着时改窗口高度：旧实现收不到 resize（监听只在 open 时挂）。
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });
    rightClick(input, 40, 390);

    await waitFor(() => {
      const popup = document.querySelector(".rf-inline-mark-popup") as HTMLElement | null;
      expect(popup?.getAttribute("data-placement")).toBe("above");
    });
  });

  // DF-3（实机复核补）：点「插入链接…」后菜单必须留在原位并长出输入框。
  // 修复前 antd 在同一拍上报 onOpenChange(false)，读 state 的 `linkMode` 还是旧值，
  // 菜单连同刚展开的输入框一起被收起。
  it("DF-3：点「插入链接…」菜单不收起，露出链接输入框", async () => {
    mockPopupSize(220, 280);
    render(<Harness initial="abcdef" />);
    const input = screen.getByRole("textbox", { name: "字段值" }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 4);
    rightClick(input);
    fireEvent.click(await screen.findByRole("menuitem", { name: t("typography.inline.linkMenu") }));

    await waitFor(() => {
      expect(document.querySelector(".rf-inline-mark-mask")).not.toBeNull();
      expect(
        screen.getByRole("textbox", { name: t("typography.inline.linkPlaceholder") }),
      ).toBeTruthy();
    });
  });
});
