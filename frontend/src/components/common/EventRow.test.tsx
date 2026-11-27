// SPDX-License-Identifier: Apache-2.0
/**
 * 事件行（整改 #13）：结构、键盘可达、以及"不许再长出左缘色条"的反回潮守卫。
 *
 * 为什么有一部分断言是**读源码**：jsdom 不加载组件旁的 CSS（`vitest.config.ts` 的
 * `test.css.include` 只放行 base / accessibility / design-tokens 几张表），所以
 * `getComputedStyle` 拿不到 `.rf-event-title` 的字重，也看不见有没有 `::before`。
 * 这里改成"类名真的挂上去了 + 样式表里确实写着那条规则"，两件事一起成立才等于
 * "未读与已读字重不同"。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import EventRow from "./EventRow";

afterEach(cleanup);

// 与 src/styles/*.test.ts 同一读法：以 src 为根拼绝对路径（vitest 的 import.meta.url
// 不是 file:// 协议，用它喂 readFileSync 会直接抛 "The URL must be of scheme file"）。
declare const process: { cwd(): string };
const RAW_CSS = readFileSync(`${process.cwd()}/src/components/common/event-row.css`, "utf8");

/** 去掉注释再断言：注释里写着"这里没有 border-left"本身不算实现（同 styles 下几份守卫）。 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const CSS = stripCssComments(RAW_CSS);

describe("EventRow 的行结构", () => {
  it("未读：标题前有圆点且带 is-unread；已读：两个都没有", () => {
    const { container: unreadRow } = render(<EventRow title="提醒已过期：投递 A 司" unread />);
    const unread = unreadRow.querySelector(".rf-event-row");
    expect(unread?.classList.contains("is-unread")).toBe(true);
    expect(unread?.querySelector(".rf-event-dot")).not.toBeNull();

    cleanup();
    const { container: readRow } = render(<EventRow title="提醒已过期：投递 A 司" />);
    const read = readRow.querySelector(".rf-event-row");
    expect(read?.classList.contains("is-unread")).toBe(false);
    expect(read?.querySelector(".rf-event-dot")).toBeNull();
  });

  it("逾期天数 >0 才在副行写红字；0 / 负数都不渲染", () => {
    render(<EventRow title="测评截止" meta="今天 14:12" overdueDays={3} />);
    expect(screen.getByText(t("trackerUi.card.overdueDays", { days: 3 }))).toBeInTheDocument();

    cleanup();
    render(<EventRow title="测评截止" meta="今天 14:12" overdueDays={0} />);
    expect(document.querySelector(".rf-event-overdue")).toBeNull();
  });

  it("动作落在副行右端（与相对时间同一行），不占标题宽度", () => {
    const { container } = render(
      <EventRow
        title="投递 A 司"
        meta="今天 14:12"
        actions={<button type="button">完成</button>}
      />,
    );

    const subline = container.querySelector(".rf-event-subline");
    expect(subline?.querySelector(".rf-event-actions button")).not.toBeNull();
    expect(subline?.textContent).toContain("今天 14:12");
  });
});

describe("EventRow 的可点语义", () => {
  it("箭头在标题行内（T25）：可点时才有，且是标题行的最后一个兄弟", () => {
    const { container } = render(
      <EventRow title="投递 A 司" meta="今天 14:12" onOpen={() => undefined} />,
    );
    const title = container.querySelector(".rf-event-title") as HTMLElement;
    const arrow = container.querySelector(".rf-event-arrow") as HTMLElement;

    // 挪进标题行是三条右缘能重合的前提：箭头若还是「行的兄弟」，动作组就得让出
    // 箭头宽度 + gap（弹窗实测 13px），副行动作右缘永远贴不到分隔线。
    expect(title).not.toBeNull();
    expect(title.contains(arrow)).toBe(true);
    expect(title.lastElementChild).toBe(arrow);
    // 标题文字吃掉剩余宽度，箭头才会被顶到最右（样式表里的 flex:1 1 auto）。
    expect(CSS).toMatch(/\.rf-event-title-text\s*\{[^}]*flex:\s*1\s+1\s+auto/);
  });

  it("整行可点：点击、Enter、空格都触发 onOpen（不嵌套 <button>）", () => {
    const onOpen = vi.fn();
    const { container } = render(<EventRow title="投递 A 司" onOpen={onOpen} />);
    const row = container.querySelector(".rf-event-row") as HTMLElement;

    // 行容器是 div role=button（行内可能还有真按钮，嵌套 button 是非法 HTML）。
    expect(row.tagName).toBe("DIV");
    expect(row).toHaveAttribute("role", "button");
    expect(row).toHaveAttribute("tabindex", "0");

    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it("焦点在行内按钮上按回车，不会顺手把整行也打开", () => {
    const onOpen = vi.fn();
    const { container } = render(
      <EventRow title="投递 A 司" onOpen={onOpen} actions={<button type="button">完成</button>} />,
    );
    const action = screen.getByRole("button", { name: "完成" });

    fireEvent.keyDown(action, { key: "Enter" });
    expect(onOpen).not.toHaveBeenCalled();
    expect(container.querySelector(".rf-event-row")).not.toBeNull();
  });

  it("没有 onOpen 时不承诺可点：不挂 role/tabIndex，也不画箭头", () => {
    const { container } = render(<EventRow title="投递 A 司" />);
    const row = container.querySelector(".rf-event-row") as HTMLElement;

    expect(row).not.toHaveAttribute("role");
    expect(row).not.toHaveAttribute("tabindex");
    expect(container.querySelector(".rf-event-arrow")).toBeNull();
  });
});

/**
 * 反回潮守卫（2026-11-26 用户第二次拍板）：**任何状态下都不许出现左缘色条**。
 * 左侧装饰只有三种写法能做到，这里逐个钉死；同时钉住"未读 600 / 已读 400"
 * ——那是色条被删掉之后唯一还承载状态的手段，掉了就等于未读与已读无法区分。
 */
describe("EventRow 样式守卫", () => {
  it("样式表里没有任何左缘色条的写法（border-left / inset 阴影 / ::before）", () => {
    expect(CSS).not.toMatch(/border-left/);
    expect(CSS).not.toMatch(/inset/);
    expect(CSS).not.toMatch(/::before/);
  });

  it("未读 600、已读 400：状态只由字重与圆点表达", () => {
    expect(CSS).toMatch(/\.rf-event-title\s*\{[^}]*font-weight:\s*400/);
    expect(CSS).toMatch(/\.rf-event-row\.is-unread\s+\.rf-event-title\s*\{[^}]*font-weight:\s*600/);
  });

  it("箭头是低对比常驻色，hover 才变深（这是「能点」的唯一视觉承诺）", () => {
    expect(CSS).toMatch(/\.rf-event-arrow\s*\{[^}]*color:\s*#ccd4df/i);
    expect(CSS).toMatch(/\.rf-event-arrow[^{]*\{[^}]*color:\s*#8a94a6/i);
  });
});
