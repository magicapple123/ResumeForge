// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑器浮层组（I-01 / I-04）。
 *
 * - I-01：照片字段的右键菜单只有「照片框…」、没有「调整排版」；浮层里不出现 data URI；
 *   电话这类普通页眉字段仍是「调整排版」（守卫成对，防止"顺手把入口删了"）。
 * - I-04：三条互斥边——开菜单收编辑器 / 开编辑器关菜单与浮层 / 编辑器内右键放行原生菜单。
 *
 * 断言文案一律走 `t()`（中文 ByText 会撞 cjkRatchet 的 tests 口径）。
 */
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import {
  headerChip,
  mainButton,
  renderEditor,
  renderWithLayout,
  withPhoto,
} from "../../../test/documentEditorHeaderHarness";

describe("I-01 · 照片字段的右键入口", () => {
  it("照片：菜单里是「照片框」，没有「调整排版」", async () => {
    renderWithLayout(withPhoto());
    fireEvent.contextMenu(headerChip("document.headerField.photo"));
    expect(await screen.findByText(t("resume.photo.frame.menu"))).toBeInTheDocument();
    expect(screen.queryByText(t("document.editor.styleEntry"))).toBeNull();
  });

  it("电话：仍是「调整排版」，没有「照片框」", async () => {
    renderWithLayout(withPhoto());
    fireEvent.contextMenu(headerChip("document.headerField.phone"));
    expect(await screen.findByText(t("document.editor.styleEntry"))).toBeInTheDocument();
    expect(screen.queryByText(t("resume.photo.frame.menu"))).toBeNull();
  });

  it("点「照片框」→ 打开的是照片框浮层，DOM 里 data:image 出现 0 次", async () => {
    renderWithLayout(withPhoto());
    fireEvent.contextMenu(headerChip("document.headerField.photo"));
    fireEvent.click(await screen.findByText(t("resume.photo.frame.menu")));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-label") ?? "").toContain(t("resume.photo.frame.label"));
    // 五行的标签在，且整张浮层的文本里没有 base64。
    expect(dialog).toHaveTextContent(t("resume.photo.frame.radius"));
    expect(dialog.innerHTML).not.toContain("data:image");
  });
});

describe("I-04 · 字段浮层互斥", () => {
  it("展开编辑器后右键该 chip → 编辑器收起，菜单可见", async () => {
    renderEditor();
    const chip = headerChip("document.headerField.phone");
    fireEvent.click(mainButton(chip), { detail: 1 });
    fireEvent.click(mainButton(chip), { detail: 2 });
    expect(globalThis.document.querySelector(".document-header-editor")).not.toBeNull();

    fireEvent.contextMenu(chip);
    expect(await screen.findByText(t("document.item.hide"))).toBeInTheDocument();
    // 第 1 条边：菜单一开，编辑器必须收起（否则两张卡叠在同一块像素上）。
    expect(globalThis.document.querySelector(".document-header-editor")).toBeNull();
  });

  it("编辑器内右键 → 放行原生菜单（不 preventDefault），字段菜单不出现", () => {
    renderEditor();
    const chip = headerChip("document.headerField.phone");
    fireEvent.click(mainButton(chip), { detail: 1 });
    fireEvent.click(mainButton(chip), { detail: 2 });
    const input = screen.getByLabelText(t("document.headerField.phone"));
    // fireEvent 返回 false = 事件被 preventDefault 了（原生菜单不会出来）。
    expect(fireEvent.contextMenu(input)).toBe(true);
    expect(screen.queryByText(t("document.item.hide"))).toBeNull();
  });

  it("排版浮层开着 → 双击字段 → 浮层关闭、编辑器打开（第 2 条边）", async () => {
    renderWithLayout(withPhoto());
    fireEvent.contextMenu(headerChip("document.headerField.phone"));
    fireEvent.click(await screen.findByText(t("document.editor.styleEntry")));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    const chip = headerChip("document.headerField.phone");
    fireEvent.click(mainButton(chip), { detail: 1 });
    fireEvent.click(mainButton(chip), { detail: 2 });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(globalThis.document.querySelector(".document-header-editor")).not.toBeNull();
  });

  it("单击只选中：不关浮层（既有工作流：浮层开着点纸面预览）", async () => {
    renderWithLayout(withPhoto());
    fireEvent.contextMenu(headerChip("document.headerField.phone"));
    fireEvent.click(await screen.findByText(t("document.editor.styleEntry")));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    fireEvent.click(mainButton(headerChip("document.headerField.name")));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
