// SPDX-License-Identifier: Apache-2.0
/**
 * 条目卡「选中整卡」的入口（I-22）。
 *
 * 状态（`is-selected` / 结构树联动）本来就实现了，缺的只是**入口**：`#N` 以前是纯文本，
 * 卡片头也没有点击处理。这里钉住四件事：
 *
 * 1. `#N` 是按钮、`aria-pressed` 跟随"正好选中这一条"（子字段选中不算）；
 * 2. 再点一次取消（与字段 chip 同一手势）；
 * 3. 头部空白**只选中、不取消**，且点 `⋯` / 交互控件不会误触整卡选中；
 * 4. 只读宿主（生成预览、分享页）保持纯文本 `#N`。
 *
 * 文案一律走 `t()`（cjkRatchet 口径）；几何量不到（jsdom 无布局），选中态强度读 CSS 原文。
 */
import { fireEvent, render, screen } from "@testing-library/react";
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { entryDisplayLabel } from "../document/summarize";
import { makeDocument } from "../document/documentFixtures";
import { entryPath } from "../document/paths";
import type { ResumeDocument } from "../../../types/resumeDocument";
import DocumentEditor from "./DocumentEditor";

declare const process: { cwd(): string };

const DOC: ResumeDocument = makeDocument();
const FIRST = DOC.sections[0].entries[0];
const ENTRY_PATH = entryPath(DOC.sections[0].key, FIRST.id ?? "");
const ENTRY_LABEL = entryDisplayLabel(FIRST);

function renderEditor(
  props: { selectedPath?: string | null; readOnly?: boolean; document?: ResumeDocument } = {},
) {
  const onChange = vi.fn();
  const onSelectPath = vi.fn();
  const view = render(
    <DocumentEditor
      document={props.document ?? DOC}
      onChange={onChange}
      onSelectPath={onSelectPath}
      selectedPath={props.selectedPath ?? null}
      readOnly={props.readOnly}
    />,
  );
  fireEvent.click(screen.getByRole("tab", { name: t("editor.section.education") }));
  return { onChange, onSelectPath, view };
}

/** 编号按钮（`#N`）是 `document-entry-index`；只读态它不是按钮。 */
function indexButton(): HTMLElement {
  const node = document.querySelector<HTMLElement>("button.document-entry-index");
  if (!node) throw new Error("找不到 #N 按钮");
  return node;
}

describe("EntryCard · 选中整卡（I-22）", () => {
  it("#N 是按钮：可访问名带序号与条目标题，未选中时 aria-pressed=false", () => {
    renderEditor();

    const button = indexButton();
    expect(button).toHaveTextContent(`#1`);
    expect(button).toHaveAccessibleName(
      t("document.entry.selectAria", { index: 1, title: ENTRY_LABEL }),
    );
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("点 #N：把条目路径交给宿主（选中整卡，不是某个字段）", () => {
    const { onSelectPath } = renderEditor();

    fireEvent.click(indexButton());

    expect(onSelectPath).toHaveBeenCalledWith(ENTRY_PATH);
  });

  it("正好选中这一条时再点 #N：取消选中（null）", () => {
    const { onSelectPath } = renderEditor({ selectedPath: ENTRY_PATH });

    const button = indexButton();
    expect(button).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(button);

    expect(onSelectPath).toHaveBeenCalledWith(null);
  });

  it("选中的是这条里的某个字段时：卡片高亮，但 #N 不算“已按下”", () => {
    renderEditor({ selectedPath: `${ENTRY_PATH}.ob_field001` });

    expect(document.querySelector(".document-entry")).toHaveClass("is-selected");
    expect(indexButton()).toHaveAttribute("aria-pressed", "false");
  });

  it("头部空白：选中（不取消），点 ⋯ 不会误触", () => {
    const { onSelectPath } = renderEditor();

    const head = document.querySelector<HTMLElement>(".document-entry-head");
    if (!head) throw new Error("找不到条目头");
    fireEvent.click(head);
    expect(onSelectPath).toHaveBeenCalledWith(ENTRY_PATH);

    onSelectPath.mockClear();
    fireEvent.click(screen.getAllByRole("button", { name: t("document.entry.more") })[0]);
    expect(onSelectPath).not.toHaveBeenCalled();
  });

  it("只读宿主：#N 是纯文本，没有选中按钮、没有手型", () => {
    renderEditor({ readOnly: true });

    const node = document.querySelector<HTMLElement>(".document-entry-index");
    expect(node?.tagName).toBe("SPAN");
    expect(document.querySelector("button.document-entry-index")).toBeNull();
  });

  it("点 #N 不做 scrollIntoView（滚动一律交给宿主）", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderEditor();

    fireEvent.click(indexButton());

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

/**
 * 选中态强度：只换 1px 边框在深色主题下几乎看不出（基础边框本来就很浅），
 * 所以必须同时有底色或 inset 描边。jsdom 量不到颜色，只能钉声明。
 */
describe("EntryCard · 选中态样式（I-22）", () => {
  function entryCss(): string {
    return readFileSync(
      [process.cwd(), "src", "styles", "document-editor-entry.css"].join("/"),
      "utf8",
    );
  }

  function ruleBlock(css: string, selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    expect(match, `CSS 里找不到规则：${selector}`).not.toBeNull();
    return (match as RegExpExecArray)[1];
  }

  it("整卡选中：边框 + 极浅品牌底 + inset 描边（不占布局）", () => {
    const selected = ruleBlock(entryCss(), ".document-entry.is-selected");
    expect(selected).toMatch(/border-color:\s*var\(--rf-brand\)/);
    expect(selected).toMatch(/background:\s*var\(--rf-brand-wash\)/);
    expect(selected).toMatch(/box-shadow:\s*inset/);
  });

  it("#N 按钮 reset 掉原生样式（与原来的 12px 灰字同样观感）", () => {
    const button = ruleBlock(entryCss(), "button.document-entry-index");
    expect(button).toMatch(/padding:\s*0/);
    expect(button).toMatch(/border:\s*0/);
    expect(button).toMatch(/background:\s*none/);
    expect(button).toMatch(/font-size:\s*12px/);
  });
});
