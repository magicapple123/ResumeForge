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

  it("切到「整个板块」后条目头布局不显示（head 是条目级属性）", () => {
    render(<Harness initial={makeDocument()} />);
    expect(screen.getByText(t("structure.layout.head"))).toBeInTheDocument();
    fireEvent.click(screen.getByText(t("structure.layout.scope.section")));
    expect(screen.queryByText(t("structure.layout.head"))).toBeNull();
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

describe("EntryLayoutPanel · 继承链可视化（P5-4）", () => {
  it("条目级的三项默认标「继承板块」，且没有逐项恢复按钮", () => {
    render(<Harness initial={makeDocument()} />);
    expect(screen.getAllByText(t("structure.layout.source.inherited"))).toHaveLength(3);
    expect(screen.queryByText(t("structure.layout.source.overridden"))).toBeNull();
    expect(
      screen.queryByRole("button", { name: t("structure.layout.restore.columns") }),
    ).toBeNull();
  });

  it("被覆盖的项标「本条覆盖」并出现逐项恢复按钮", () => {
    const initial = makeDocument();
    initial.sections[0].entries[0].layout = {
      head: "split",
      columns: 2,
      align: null,
      gap: null,
    };
    render(<Harness initial={initial} />);
    expect(screen.getByText(t("structure.layout.source.overridden"))).toBeInTheDocument();
    expect(screen.getAllByText(t("structure.layout.source.inherited"))).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: t("structure.layout.restore.columns") }),
    ).toBeInTheDocument();
    expect(screen.getByText(t("structure.layout.sourceHint"))).toBeInTheDocument();
  });

  it("逐项恢复继承只把那一项置 null，不写板块、不动其它覆盖", () => {
    const calls: unknown[][] = [];
    const initial = makeDocument();
    initial.sections[0].layout = { ...initial.sections[0].layout, columns: 3 };
    initial.sections[0].entries[0].layout = {
      head: "stacked",
      columns: 2,
      align: "flow",
      gap: 1,
    };
    render(<Harness initial={initial} onChange={(doc) => calls.push([doc])} />);
    fireEvent.click(screen.getByRole("button", { name: t("structure.layout.restore.columns") }));
    const next = latest(calls);
    const entryLayout = next.sections[0].entries[0].layout;
    expect(entryLayout.columns).toBeNull();
    expect(entryLayout.align).toBe("flow");
    expect(entryLayout.gap).toBe(1);
    expect(entryLayout.head).toBe("stacked");
    // 板块默认不受影响（逐项恢复继承 ≠ 改板块）
    expect(next.sections[0].layout.columns).toBe(3);
    expect(next.sections[0].layout).toEqual(initial.sections[0].layout);
  });

  it("板块级不显示继承来源标记与逐项恢复", () => {
    render(<Harness initial={makeDocument()} />);
    fireEvent.click(screen.getByText(t("structure.layout.scope.section")));
    expect(screen.queryByText(t("structure.layout.source.inherited"))).toBeNull();
    expect(screen.queryByText(t("structure.layout.sourceHint"))).toBeNull();
    expect(
      screen.queryByRole("button", { name: t("structure.layout.restore.columns") }),
    ).toBeNull();
  });
});
