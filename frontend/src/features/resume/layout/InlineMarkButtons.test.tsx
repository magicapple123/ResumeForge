// SPDX-License-Identifier: Apache-2.0
/**
 * 字符级格式工具条（W07 / R-11 / F22）：加粗 / 字号菜单 / 颜色 / 链接。
 *
 * 守六件事：①按输入框选区插入成对标记并回传新选区；②空选区/无目标/非法 URL
 * 都给出 t() 提示且**不写回**（不制造空改动）；③字号走菜单（F22：不再固定 0.9），
 * 100% 档是"清除"；④按钮是受控禁用（宿主保存中/只读时一致置灰）；
 * ⑤**选区降级**：实时选区为空时用宿主记住的最近一次非空选区，链接在没有选区时
 * 按"光标处插入、URL 当链接文字"处理；⑥强调色控件存在且可禁用（取色面板本身由
 * `inlineMarks` 的纯规则测试覆盖：rgba → hex）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { InlineRange } from "./inlineMarks";
import InlineMarkButtons, { type InlineMarkCommit } from "./InlineMarkButtons";

interface HarnessProps {
  initial?: string;
  noTarget?: boolean;
  disabled?: boolean;
  /** 宿主"记住的最近一次非空选区"（模拟 `useInlineMarkRange` 的 getRange）。 */
  remembered?: InlineRange | null;
  onCommit?: (next: InlineMarkCommit) => void;
}

/** 最小宿主：真实 textarea + "最近聚焦的输入框"读取器（与 shell 的接法同型）。 */
function Harness({
  initial = "abcdef",
  noTarget = false,
  disabled,
  remembered = null,
  onCommit = vi.fn(),
}: HarnessProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <AntdApp>
      <textarea ref={ref} defaultValue={initial} aria-label="draft" />
      <InlineMarkButtons
        getTarget={() => (noTarget ? null : ref.current)}
        getRememberedRange={() => remembered}
        onCommit={onCommit}
        disabled={disabled}
      />
    </AntdApp>
  );
}

function select(container: HTMLElement, start: number, end: number) {
  const textarea = container.querySelector("textarea");
  if (!textarea) throw new Error("textarea missing");
  textarea.focus();
  textarea.setSelectionRange(start, end);
  return textarea;
}

function renderHarness(props: HarnessProps = {}) {
  const onCommit = vi.fn();
  const view = render(<Harness {...props} onCommit={onCommit} />);
  return { ...view, onCommit };
}

/** 打开字号菜单并点某一档（菜单渲染在 body 的弹层里）。 */
function pickSize(step: string) {
  fireEvent.click(screen.getByRole("button", { name: t("typography.inline.sizeAria") }));
  fireEvent.click(screen.getByText(step));
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("InlineMarkButtons", () => {
  it("选中文字点加粗：成对插入 ** 并回传新选区", () => {
    const { container, onCommit } = renderHarness();
    select(container, 2, 4);
    fireEvent.click(screen.getByRole("button", { name: t("typography.inline.boldAria") }));
    expect(onCommit).toHaveBeenCalledWith({ text: "ab**cd**ef", selection: { start: 4, end: 6 } });
  });

  it("F22：字号从菜单选档，写进对应系数（不再是固定 0.9）", () => {
    const { container, onCommit } = renderHarness();
    select(container, 2, 4);
    pickSize("110%");
    expect(onCommit).toHaveBeenCalledWith({
      text: "ab{@size=1.1}cd{@}ef",
      selection: { start: 13, end: 15 },
    });

    onCommit.mockClear();
    select(container, 0, 2);
    pickSize("125%");
    expect(onCommit).toHaveBeenCalledWith({
      text: "{@size=1.25}ab{@}cdef",
      selection: { start: 12, end: 14 },
    });
  });

  it("F22：100% 档是「清除字号」，把选区上的字号去掉", () => {
    const { container, onCommit } = renderHarness({ initial: "ab{@size=1.1}cd{@}ef" });
    select(container, 13, 15);
    pickSize(t("typography.inline.sizeClear"));
    expect(onCommit).toHaveBeenCalledWith({
      text: "abcdef",
      selection: { start: 2, end: 4 },
    });
  });

  // #5d：斜体按钮已整体移除（工具区只有加粗 / 字号 / 颜色 / 链接）。

  it("颜色控件存在（取色面板的值由纯规则测试覆盖）", () => {
    renderHarness();
    expect(screen.getByLabelText(t("typography.inline.color"))).toBeInTheDocument();
  });

  it("链接：输入合法地址后插入 [label](url)", () => {
    const { container, onCommit } = renderHarness();
    select(container, 2, 4);
    fireEvent.click(screen.getByRole("button", { name: t("typography.inline.linkAria") }));
    const input = screen.getByRole("textbox", { name: t("typography.inline.linkPlaceholder") });
    fireEvent.change(input, { target: { value: "https://x.dev/a" } });
    fireEvent.click(screen.getByRole("button", { name: t("typography.inline.linkApply") }));
    expect(onCommit).toHaveBeenCalledWith({
      text: "ab[cd](https://x.dev/a)ef",
      selection: { start: 2, end: 23 },
    });
  });

  it("非法链接不写回，只提示要用 http(s)", async () => {
    const { container, onCommit } = renderHarness();
    select(container, 2, 4);
    fireEvent.click(screen.getByRole("button", { name: t("typography.inline.linkAria") }));
    fireEvent.change(
      screen.getByRole("textbox", { name: t("typography.inline.linkPlaceholder") }),
      {
        target: { value: "javascript:alert(1)" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: t("typography.inline.linkApply") }));
    expect(await screen.findByText(t("typography.inline.invalidUrl"))).toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("空选区给提示、不写回", async () => {
    const { container, onCommit } = renderHarness();
    select(container, 3, 3);
    fireEvent.click(screen.getByRole("button", { name: t("typography.inline.boldAria") }));
    expect(await screen.findByText(t("typography.inline.selectFirst"))).toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("没有可编辑目标时给提示、不写回", async () => {
    const { onCommit } = renderHarness({ noTarget: true });
    fireEvent.click(screen.getByRole("button", { name: t("typography.inline.boldAria") }));
    expect(await screen.findByText(t("typography.inline.noTarget"))).toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("实时选区已被折叠时，用宿主记住的选区插入链接", () => {
    // 用户确实选过 2–4，但点图标那一拍选区被折叠成 5/5（浏览器把选区收掉了）。
    const { container, onCommit } = renderHarness({ remembered: { start: 2, end: 4 } });
    select(container, 5, 5);
    fireEvent.click(screen.getByRole("button", { name: t("typography.inline.linkAria") }));
    fireEvent.change(
      screen.getByRole("textbox", { name: t("typography.inline.linkPlaceholder") }),
      {
        target: { value: "https://x.dev/a" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: t("typography.inline.linkApply") }));
    expect(onCommit).toHaveBeenCalledWith({
      text: "ab[cd](https://x.dev/a)ef",
      selection: { start: 2, end: 23 },
    });
  });

  it("实时选区为空时，加粗也能用记住的选区", () => {
    const { container, onCommit } = renderHarness({ remembered: { start: 2, end: 4 } });
    select(container, 0, 0);
    fireEvent.click(screen.getByRole("button", { name: t("typography.inline.boldAria") }));
    expect(onCommit).toHaveBeenCalledWith({ text: "ab**cd**ef", selection: { start: 4, end: 6 } });
  });

  it("完全没有选区时点链接：在光标处插入，用 URL 当链接文字", () => {
    const { container, onCommit } = renderHarness({ remembered: null });
    select(container, 6, 6);
    fireEvent.click(screen.getByRole("button", { name: t("typography.inline.linkAria") }));
    fireEvent.change(
      screen.getByRole("textbox", { name: t("typography.inline.linkPlaceholder") }),
      {
        target: { value: "https://x.dev/a" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: t("typography.inline.linkApply") }));
    const inserted = "[https://x.dev/a](https://x.dev/a)";
    expect(onCommit).toHaveBeenCalledWith({
      text: `abcdef${inserted}`,
      selection: { start: 6, end: 6 + inserted.length },
    });
  });

  it("disabled 时加粗 / 字号 / 链接都不可点", () => {
    renderHarness({ disabled: true });
    for (const key of ["boldAria", "sizeAria", "linkAria"] as const) {
      expect(screen.getByRole("button", { name: t(`typography.inline.${key}`) })).toBeDisabled();
    }
  });
});
