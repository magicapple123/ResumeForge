// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目字段排版」面板主流程：板块/条目两级作用范围、列数/对齐/间距/head 布局写回、
 * 继承链可视化（P5-4）。拆文件后仍由本文件守「面板骨架」这一层。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { t } from "../../i18n";
import { latest, makeDocument } from "../../test/entryLayoutPanelFixtures";
import { Harness } from "../../test/entryLayoutPanelHarness";

describe("EntryLayoutPanel · 板块与条目", () => {
  it("板块选项来自文档（含自建板块）", () => {
    render(<Harness initial={makeDocument()} />);
    expect(screen.getByText(t("structure.section.education"))).toBeInTheDocument();
    // 自建板块用文档 title：antd Select 的未选中项要展开才进 DOM。
    fireEvent.mouseDown(screen.getByRole("combobox", { name: t("structure.layout.section") }));
    expect(screen.getByTitle("开源项目")).toBeInTheDocument();
  });

  it("selectedPath 预选板块与条目", () => {
    const calls: unknown[][] = [];
    render(
      <Harness
        initial={makeDocument()}
        selectedPath="custom:sec_0001.entry_proj_01.pname_001"
        onChange={(doc) => calls.push([doc])}
      />,
    );
    // 条目下拉显示的是被选中的条目（标题字段值）
    expect(screen.getByTitle("项目甲")).toBeInTheDocument();
  });
});

describe("EntryLayoutPanel · 布局写回", () => {
  it("条目级改列数写 entry.layout.columns", () => {
    const calls: unknown[][] = [];
    render(<Harness initial={makeDocument()} onChange={(doc) => calls.push([doc])} />);
    fireEvent.click(screen.getByRole("radio", { name: "2" }));
    const next = latest(calls);
    expect(next.sections[0].entries[0].layout.columns).toBe(2);
    // 条目级不动板块默认
    expect(next.sections[0].layout.columns).toBe(1);
  });

  it("切到「整个板块」再改列数写 section.layout.columns", () => {
    const calls: unknown[][] = [];
    render(<Harness initial={makeDocument()} onChange={(doc) => calls.push([doc])} />);
    fireEvent.click(screen.getByText(t("structure.layout.scope.section")));
    fireEvent.click(screen.getByRole("radio", { name: "3" }));
    const next = latest(calls);
    expect(next.sections[0].layout.columns).toBe(3);
  });

  it("切到「整个板块」后条目行与条目标题布局保留但禁用（R-11：高度不跳）", () => {
    render(<Harness initial={makeDocument()} />);
    expect(screen.getByText(t("structure.layout.head"))).toBeInTheDocument();
    fireEvent.click(screen.getByText(t("structure.layout.scope.section")));
    // 分组标题与三个选项都还在（面板高度不变），只是条目级属性禁用。
    expect(screen.getByText(t("structure.layout.head"))).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: t("structure.layout.head.stacked") })).toBeDisabled();
    // 条目选择器同样保留但禁用（不消失 → 不产生高度跳变）。
    expect(screen.getByRole("combobox", { name: t("structure.layout.entry") })).toBeDisabled();
  });

  it("head 布局三选一写 entry.layout.head", () => {
    const calls: unknown[][] = [];
    render(<Harness initial={makeDocument()} onChange={(doc) => calls.push([doc])} />);
    fireEvent.click(screen.getByText(t("structure.layout.head.stacked")));
    expect(latest(calls).sections[0].entries[0].layout.head).toBe("stacked");
  });

  it("恢复默认条目排版把 layout 还原成继承", () => {
    const calls: unknown[][] = [];
    const initial = makeDocument();
    initial.sections[0].entries[0].layout = { head: "stacked", columns: 3, align: "flow", gap: 1 };
    render(<Harness initial={initial} onChange={(doc) => calls.push([doc])} />);
    fireEvent.click(screen.getByRole("button", { name: t("structure.layout.reset") }));
    const layout = latest(calls).sections[0].entries[0].layout;
    expect(layout.head).toBe("split");
    expect(layout.columns).toBeNull();
    expect(layout.gap).toBeNull();
  });
});

describe("EntryLayoutPanel · 继承（P5-4 → R-11 重排）", () => {
  /** Segmented 的选中项文案（antd 用 class 表达选中，radio 的 checked 在 jsdom 里不可靠）。 */
  function selectedSegments(container: HTMLElement): string[] {
    return [...container.querySelectorAll(".ant-segmented-item-selected")].map(
      (node) => node.textContent ?? "",
    );
  }

  it("条目级的列数与对齐第一个选项都是「继承」，默认选中", () => {
    const { container } = render(<Harness initial={makeDocument()} />);
    // 列数 + 对齐各选中一枚「继承」（列间距是 InputNumber，空 = 继承，不是选项）。
    expect(
      selectedSegments(container).filter((text) => text === t("structure.layout.inherit")),
    ).toHaveLength(2);
  });

  it("被覆盖的项显示自己的值，不再出现「本条覆盖」标记与恢复按钮", () => {
    const initial = makeDocument();
    initial.sections[0].entries[0].layout = { head: "split", columns: 2, align: "flow", gap: null };
    const { container } = render(<Harness initial={initial} />);
    const selected = selectedSegments(container);
    expect(selected).toContain("2");
    expect(selected).toContain(t("structure.layout.align.flow"));
    // R-11-4：来源标记与逐项恢复按钮已删除。
    expect(screen.queryByText(t("structure.layout.source.overridden"))).toBeNull();
    expect(screen.queryByText(t("structure.layout.source.inherited"))).toBeNull();
    expect(
      screen.queryByRole("button", { name: t("structure.layout.restore.columns") }),
    ).toBeNull();
  });

  it("选「继承」把那一项置回 null，不写板块、不动其它覆盖", () => {
    const calls: unknown[][] = [];
    const initial = makeDocument();
    initial.sections[0].layout = { ...initial.sections[0].layout, columns: 3 };
    initial.sections[0].entries[0].layout = { head: "stacked", columns: 2, align: "flow", gap: 1 };
    render(<Harness initial={initial} onChange={(doc) => calls.push([doc])} />);
    // 第一个「继承」是列数（顺序：列数 → 对齐）。
    fireEvent.click(screen.getAllByText(t("structure.layout.inherit"))[0]);
    const next = latest(calls);
    const entryLayout = next.sections[0].entries[0].layout;
    expect(entryLayout.columns).toBeNull();
    expect(entryLayout.align).toBe("flow");
    expect(entryLayout.gap).toBe(1);
    expect(entryLayout.head).toBe("stacked");
    // 板块默认不受影响（恢复继承 ≠ 改板块）
    expect(next.sections[0].layout).toEqual(initial.sections[0].layout);
  });

  it("板块级的「继承」选项禁用（板块本身就是来源）", () => {
    render(<Harness initial={makeDocument()} />);
    fireEvent.click(screen.getByText(t("structure.layout.scope.section")));
    // 选项还在（保持高度不变），但不可选：板块层没有可继承的对象。
    const options = screen.getAllByRole("radio", { name: t("structure.layout.inherit") });
    expect(options).toHaveLength(2);
    options.forEach((node) => expect(node).toBeDisabled());
  });
});
