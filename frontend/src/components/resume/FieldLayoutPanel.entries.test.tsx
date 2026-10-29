// SPDX-License-Identifier: Apache-2.0
/**
 * W4「条目字段排版」的**条目级**用例：单条条目（如"上海大学"这一条教育）可以有自己的
 * 列数 / 对齐 / 间距 / 顺序 / 独占行，没改的项继承分区默认。
 *
 * **为什么与 `FieldLayoutPanel.test.tsx` 分成两个文件**：那个文件加上分区级用例已过
 * 500 行测试预算（`backend/tests/test_file_size_budget.py` 同样守测试文件）。分区级行为
 * 留在原文件，条目级（数据层 + 下拉交互）在本文件。
 *
 * 断言一律走 `t()` / role / aria-label（禁中文 ByText，cjkRatchet 逐文件基线守着）；
 * 条目名是业务数据，用 ASCII 以免给本文件增加中文字面量。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ResumeLayout } from "../../types";
import {
  FIELD_LAYOUT_FIELDS,
  defaultSectionLayout,
  effectiveSectionLayout,
  entryPatchFromEffective,
  readEntryFieldLayout,
  withEntryFieldLayout,
} from "../../features/resume-layout/fieldLayout";
import type { FieldLayoutSection } from "../../features/resume-layout/fieldLayout";
import type { EntryFieldLayoutOption } from "../../features/resume-layout/entryOptions";
import { isReorderableSection, moveEntryCommand } from "../../features/resume-layout/entryReorder";
import type { OutlineCommand } from "../../features/resume-outline/types";
import FieldLayoutPanel from "./FieldLayoutPanel";

const BASE_LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  format_config: {},
};

/** 条目 id 用 W01 字符集的形状（真实值由后端生成，这里只要"像"）。 */
const ENTRY_ID_A = "eduAAAA1111";
const ENTRY_ID_B = "eduBBBB2222";
const ENTRY_ID_C = "eduCCCC3333";

/** 条目下拉选项（label 是主标题 = 纸面上的条目标题）。三条：上移 / 下移要能看出首末边界。 */
const ENTRY_OPTIONS: Partial<Record<FieldLayoutSection, EntryFieldLayoutOption[]>> = {
  education: [
    { id: ENTRY_ID_A, label: "Example University" },
    { id: ENTRY_ID_B, label: "Second University" },
    { id: ENTRY_ID_C, label: "Third University" },
  ],
};

function layoutDomain(layout: ResumeLayout): Record<string, unknown> {
  const config = layout.format_config as Record<string, unknown> | undefined;
  return (config?.["field_layout"] as Record<string, unknown> | undefined) ?? {};
}

/** 域里的**条目级**段：`{分区: {条目 id: 覆盖}}`（没有就是空对象）。 */
function entryDomain(
  layout: ResumeLayout,
): Record<string, Record<string, Record<string, unknown>>> {
  const entries = layoutDomain(layout)["entries"];
  return (entries ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
}

function lastLayout(mock: { mock: { calls: unknown[][] } }): ResumeLayout {
  const calls = mock.mock.calls;
  return calls[calls.length - 1][0] as ResumeLayout;
}

/** antd Select 的已验证交互模式：mouseDown(combobox) → 点 `.ant-select-item-option`。 */
async function pickOption(selectLabel: string, optionLabel: string) {
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: selectLabel }), { button: 0 });
  fireEvent.click(
    await screen.findByText(
      (content, element) =>
        content === optionLabel && !!element?.closest(".ant-select-item-option"),
    ),
  );
}

function Harness({
  initial,
  onChange,
  entryOptions,
}: {
  initial: ResumeLayout;
  onChange?: (next: ResumeLayout) => void;
  entryOptions?: typeof ENTRY_OPTIONS;
}) {
  const [layout, setLayout] = useState(initial);
  return (
    <AntdApp>
      <FieldLayoutPanel
        layout={layout}
        entryOptions={entryOptions}
        onChange={(next) => {
          setLayout(next);
          onChange?.(next);
        }}
      />
    </AntdApp>
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("FieldLayoutPanel · 条目级", () => {
  it("没有条目选项时条目下拉禁用并说明原因", async () => {
    render(<Harness initial={BASE_LAYOUT} />);
    const select = await screen.findByRole("combobox", {
      name: t("typography.fieldLayout.entryLabel"),
    });
    expect(select).toBeDisabled();
    expect(screen.getByText(t("typography.fieldLayout.entryNone"))).toBeInTheDocument();
  });

  it("选中条目后控件显示这条的生效值（未改的项继承分区默认）", async () => {
    const configured: ResumeLayout = {
      ...BASE_LAYOUT,
      format_config: {
        field_layout: {
          version: 1,
          education: { columns: 2, gap: 2.4 },
          entries: { education: { [ENTRY_ID_A]: { columns: 3 } } },
        },
      } as unknown as ResumeLayout["format_config"],
    };
    render(<Harness initial={configured} entryOptions={ENTRY_OPTIONS} />);
    await pickOption(t("typography.fieldLayout.entryLabel"), "Example University");
    // 列数来自条目覆盖（3），间距来自分区级（2.4）。
    expect(
      await screen.findByRole("radio", { name: t("typography.fieldLayout.columns.3") }),
    ).toBeChecked();
    expect(
      screen.getByRole("slider", { name: t("typography.fieldLayout.gapLabel") }),
    ).toHaveAttribute("aria-valuenow", "2.4");
    expect(
      screen.getByText(t("typography.fieldLayout.entryEditing", { label: "Example University" })),
    ).toBeInTheDocument();
  });

  it("条目模式下改列数只写 entries.<分区>.<id>，分区级一个键都不写", async () => {
    const onChange = vi.fn();
    render(<Harness initial={BASE_LAYOUT} onChange={onChange} entryOptions={ENTRY_OPTIONS} />);
    await pickOption(t("typography.fieldLayout.entryLabel"), "Example University");
    fireEvent.click(
      await screen.findByRole("radio", { name: t("typography.fieldLayout.columns.3") }),
    );
    const next = lastLayout(onChange);
    expect(entryDomain(next)["education"][ENTRY_ID_A]).toEqual({ columns: 3 });
    expect(layoutDomain(next)["education"]).toBeUndefined();
    // 另一条不受影响（覆盖只写在被选中的那个 id 上）。
    expect(entryDomain(next)["education"][ENTRY_ID_B]).toBeUndefined();
  });

  it("条目模式下改回与分区默认一致时覆盖被整条删掉", async () => {
    const configured: ResumeLayout = {
      ...BASE_LAYOUT,
      format_config: {
        field_layout: { version: 1, entries: { education: { [ENTRY_ID_A]: { columns: 3 } } } },
      } as unknown as ResumeLayout["format_config"],
    };
    const onChange = vi.fn();
    render(<Harness initial={configured} onChange={onChange} entryOptions={ENTRY_OPTIONS} />);
    await pickOption(t("typography.fieldLayout.entryLabel"), "Example University");
    // 3 列 → 1 列（= 分区默认）→ 不给库里留一条"什么都没改"的记录。
    fireEvent.click(
      await screen.findByRole("radio", { name: t("typography.fieldLayout.columns.1") }),
    );
    expect(layoutDomain(lastLayout(onChange))).toEqual({});
  });

  it("「恢复继承」删掉该条覆盖；该条没有覆盖时按钮禁用", async () => {
    const configured: ResumeLayout = {
      ...BASE_LAYOUT,
      format_config: {
        field_layout: { version: 1, entries: { education: { [ENTRY_ID_A]: { columns: 3 } } } },
      } as unknown as ResumeLayout["format_config"],
    };
    const onChange = vi.fn();
    render(<Harness initial={configured} onChange={onChange} entryOptions={ENTRY_OPTIONS} />);
    // 先看没有覆盖的那一条：按钮禁用。
    await pickOption(t("typography.fieldLayout.entryLabel"), "Second University");
    expect(
      screen.getByRole("button", { name: t("typography.fieldLayout.entryRestore") }),
    ).toBeDisabled();
    // 有覆盖的那一条：可点，点完整域回到"从未设置"。
    await pickOption(t("typography.fieldLayout.entryLabel"), "Example University");
    const restore = screen.getByRole("button", {
      name: t("typography.fieldLayout.entryRestore"),
    });
    expect(restore).toBeEnabled();
    fireEvent.click(restore);
    expect(layoutDomain(lastLayout(onChange))).toEqual({});
  });

  it("分区「恢复默认」保留条目级覆盖（两条语义不互相清空）", async () => {
    const configured: ResumeLayout = {
      ...BASE_LAYOUT,
      format_config: {
        field_layout: {
          version: 1,
          education: { columns: 2 },
          entries: { education: { [ENTRY_ID_A]: { columns: 3 } } },
        },
      } as unknown as ResumeLayout["format_config"],
    };
    const onChange = vi.fn();
    render(<Harness initial={configured} onChange={onChange} entryOptions={ENTRY_OPTIONS} />);
    fireEvent.click(await screen.findByRole("button", { name: t("typography.fieldLayout.reset") }));
    const next = lastLayout(onChange);
    expect(layoutDomain(next)["education"]).toBeUndefined();
    expect(entryDomain(next)["education"][ENTRY_ID_A]).toEqual({ columns: 3 });
  });
});

describe("FieldLayoutPanel · 条目级纯函数", () => {
  it("effectiveSectionLayout：patch 只含 columns 时 align / gap / order 继承分区默认", () => {
    const base = {
      ...defaultSectionLayout("education"),
      columns: 2 as const,
      gap: 2.4,
      solo: ["advisor"],
    };
    const effective = effectiveSectionLayout("education", base, { columns: 3 });
    expect(effective.columns).toBe(3);
    expect(effective.align).toBe(base.align);
    expect(effective.gap).toBe(2.4);
    expect(effective.order).toEqual(base.order);
    expect(effective.solo).toEqual(["advisor"]);
    // 没有 patch（= 全部条目）时原样返回，一眼看得出"没在单独设置"。
    expect(effectiveSectionLayout("education", base, null)).toBe(base);
  });

  it("entryPatchFromEffective：只保留与分区默认不同的键，全一致时返回 null", () => {
    const base = { ...defaultSectionLayout("education"), columns: 2 as const };
    // 只有列数变了 → 只写 columns。
    expect(entryPatchFromEffective(base, { ...base, columns: 3 })).toEqual({ columns: 3 });
    // 间距"恰好等于该对齐模式的兜底值"不算改过（与后端等价继承同口径）。
    expect(entryPatchFromEffective(base, { ...base, gap: 1.6 })).toBeNull();
    // 真的改了间距才写，且干净到 1 位小数。
    expect(entryPatchFromEffective(base, { ...base, gap: 4.04 })).toEqual({ gap: 4 });
    expect(entryPatchFromEffective(base, { ...base })).toBeNull();
  });

  it("readEntryFieldLayout / withEntryFieldLayout：两层存储、空段不落库", () => {
    const stored: ResumeLayout = {
      ...BASE_LAYOUT,
      format_config: {
        field_layout: {
          version: 1,
          entries: { education: { [ENTRY_ID_A]: { columns: 3, order: ["rank"] } } },
        },
      } as unknown as ResumeLayout["format_config"],
    };
    const read = readEntryFieldLayout(stored);
    expect(read.education?.[ENTRY_ID_A].columns).toBe(3);
    // order 读侧补全量（与分区级同一套归一化）。
    expect(read.education?.[ENTRY_ID_A].order).toHaveLength(FIELD_LAYOUT_FIELDS.education.length);
    expect(read.education?.[ENTRY_ID_A].order?.[0]).toBe("rank");
    // 写：只动 entries，分区级不变；删空后整个域消失。
    const withEntry = withEntryFieldLayout(BASE_LAYOUT, "education", ENTRY_ID_A, { columns: 2 });
    expect(entryDomain(withEntry)["education"][ENTRY_ID_A]).toEqual({ columns: 2 });
    expect(readEntryFieldLayout(withEntry).education?.[ENTRY_ID_A].columns).toBe(2);
    const removed = withEntryFieldLayout(withEntry, "education", ENTRY_ID_A, null);
    expect(layoutDomain(removed)).toEqual({});
  });
});

/**
 * 上移 / 下移的宿主接线样板：**与 `WorkbenchParamsColumn` 里那段一模一样**——面板只报
 * "哪一条往哪边一格"，宿主用 `moveEntryCommand` 翻译成大纲命令再交给 `onOutlineCommand`。
 * 这样断言的就是真实链路（面板点击 → 命令 → 宿主出口），不是面板自己的中间态。
 */
function ReorderHarness({
  onOutlineCommand,
}: {
  onOutlineCommand: (command: OutlineCommand) => void;
}) {
  const [layout, setLayout] = useState(BASE_LAYOUT);
  return (
    <AntdApp>
      <FieldLayoutPanel
        layout={layout}
        entryOptions={ENTRY_OPTIONS}
        onChange={setLayout}
        onReorderEntry={(section, entryId, direction) => {
          const command = moveEntryCommand(section, ENTRY_OPTIONS[section], entryId, direction);
          if (command) onOutlineCommand(command);
        }}
      />
    </AntdApp>
  );
}

function moveButton(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

describe("FieldLayoutPanel · 条目上移 / 下移", () => {
  it("选中第 2 条点下移 → 宿主收到 reorder-entry，toIndex = 该条下标 + 1", async () => {
    const commands: OutlineCommand[] = [];
    render(<ReorderHarness onOutlineCommand={(command) => commands.push(command)} />);
    await pickOption(t("typography.fieldLayout.entryLabel"), "Second University");
    fireEvent.click(
      moveButton(t("typography.fieldLayout.entryMoveDown", { label: "Second University" })),
    );
    expect(commands).toEqual([
      { type: "reorder-entry", field: "education", objectId: ENTRY_ID_B, toIndex: 2 },
    ]);
    // 一次点击只下发一条命令（不会连带把列表顺序也写进排版域）。
    expect(commands).toHaveLength(1);
  });

  it("选中第 2 条点上移 → toIndex = 该条下标 - 1", async () => {
    const commands: OutlineCommand[] = [];
    render(<ReorderHarness onOutlineCommand={(command) => commands.push(command)} />);
    await pickOption(t("typography.fieldLayout.entryLabel"), "Second University");
    fireEvent.click(
      moveButton(t("typography.fieldLayout.entryMoveUp", { label: "Second University" })),
    );
    expect(commands).toEqual([
      { type: "reorder-entry", field: "education", objectId: ENTRY_ID_B, toIndex: 0 },
    ]);
  });

  it("首项上移、末项下移分别禁用（越界不发命令）", async () => {
    const commands: OutlineCommand[] = [];
    render(<ReorderHarness onOutlineCommand={(command) => commands.push(command)} />);
    await pickOption(t("typography.fieldLayout.entryLabel"), "Example University");
    expect(
      moveButton(t("typography.fieldLayout.entryMoveUp", { label: "Example University" })),
    ).toBeDisabled();
    expect(
      moveButton(t("typography.fieldLayout.entryMoveDown", { label: "Example University" })),
    ).toBeEnabled();
    await pickOption(t("typography.fieldLayout.entryLabel"), "Third University");
    expect(
      moveButton(t("typography.fieldLayout.entryMoveDown", { label: "Third University" })),
    ).toBeDisabled();
    expect(
      moveButton(t("typography.fieldLayout.entryMoveUp", { label: "Third University" })),
    ).toBeEnabled();
    expect(commands).toEqual([]);
  });

  it("只选「全部条目」时两个按钮都禁用；只读态不传 onReorderEntry 时也不渲染命令", async () => {
    const commands: OutlineCommand[] = [];
    render(<ReorderHarness onOutlineCommand={(command) => commands.push(command)} />);
    // 「全部条目」= 分区级设置，没有"这一条"可以挪。
    expect(moveButton(t("typography.fieldLayout.entryMoveUp", { label: "" }))).toBeDisabled();
    expect(moveButton(t("typography.fieldLayout.entryMoveDown", { label: "" }))).toBeDisabled();
    // 没选条目时点也不该有命令（按钮已禁用，这里是第二道防线）。
    fireEvent.click(moveButton(t("typography.fieldLayout.entryMoveDown", { label: "" })));
    expect(commands).toEqual([]);
  });

  it("论文 / 科研项目没有大纲分组 → 不渲染这两个按钮", async () => {
    render(<ReorderHarness onOutlineCommand={() => undefined} />);
    // 教育分区有按钮。
    expect(
      screen.queryByRole("button", {
        name: t("typography.fieldLayout.entryMoveUp", { label: "" }),
      }),
    ).not.toBeNull();
    await pickOption(t("typography.fieldLayout.sectionLabel"), t("research.tab.projects"));
    expect(
      screen.queryByRole("button", {
        name: t("typography.fieldLayout.entryMoveUp", { label: "" }),
      }),
    ).toBeNull();
  });

  it("moveEntryCommand：边界与不可排序分区分明（纯函数，第二道防线）", () => {
    const options = ENTRY_OPTIONS.education;
    expect(moveEntryCommand("education", options, ENTRY_ID_B, 1)).toEqual({
      type: "reorder-entry",
      field: "education",
      objectId: ENTRY_ID_B,
      toIndex: 2,
    });
    // 首项上移 / 末项下移 / id 不在清单里 → null（不编一个越界下标出来）。
    expect(moveEntryCommand("education", options, ENTRY_ID_A, -1)).toBeNull();
    expect(moveEntryCommand("education", options, ENTRY_ID_C, 1)).toBeNull();
    expect(moveEntryCommand("education", options, "eduZZZZ9999", 1)).toBeNull();
    expect(moveEntryCommand("education", undefined, ENTRY_ID_A, 1)).toBeNull();
    // 论文 / 科研项目没有 `reorder-entry` 的落点。
    expect(isReorderableSection("publications")).toBe(false);
    expect(isReorderableSection("research_projects")).toBe(false);
    expect(moveEntryCommand("publications", options, ENTRY_ID_A, 1)).toBeNull();
    expect(isReorderableSection("education")).toBe(true);
  });
});
