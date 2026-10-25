// SPDX-License-Identifier: Apache-2.0
/**
 * 字符级标记按钮（W07）：加粗 / 斜体 / 链接。
 *
 * 守四件事：①按 textarea 选区插入成对标记并回传新选区；②空选区/无目标/非法 URL
 * 都给出 t() 提示且**不写回**（不制造空改动）；③已有成对加粗时斜体不拆标记、不产生空提交；
 * ④按钮是受控禁用（宿主保存中/只读时一致置灰）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import InlineMarkButtons, { type InlineMarkCommit } from "./InlineMarkButtons";

interface HarnessProps {
  initial?: string;
  noTarget?: boolean;
  disabled?: boolean;
  onCommit?: (next: InlineMarkCommit) => void;
}

/** 最小宿主：真实 textarea + "最近聚焦的文本框"读取器（与 shell 的接法同型）。 */
function Harness({
  initial = "abcdef",
  noTarget = false,
  disabled,
  onCommit = vi.fn(),
}: HarnessProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <AntdApp>
      <textarea ref={ref} defaultValue={initial} aria-label="draft" />
      <InlineMarkButtons
        getTarget={() => (noTarget ? null : ref.current)}
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

  it("选中文字点斜体：成对插入 *", () => {
    const { container, onCommit } = renderHarness();
    select(container, 2, 4);
    fireEvent.click(screen.getByRole("button", { name: t("typography.inline.italicAria") }));
    expect(onCommit).toHaveBeenCalledWith({ text: "ab*cd*ef", selection: { start: 3, end: 5 } });
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

  it("选区贴着成对加粗标记时点斜体：不拆标记、不产生空提交", () => {
    const { container, onCommit } = renderHarness({ initial: "**ab**" });
    select(container, 2, 4);
    fireEvent.click(screen.getByRole("button", { name: t("typography.inline.italicAria") }));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("disabled 时三颗按钮都不可点", () => {
    renderHarness({ disabled: true });
    for (const key of ["boldAria", "italicAria", "linkAria"] as const) {
      expect(screen.getByRole("button", { name: t(`typography.inline.${key}`) })).toBeDisabled();
    }
  });
});
