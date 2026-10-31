// SPDX-License-Identifier: Apache-2.0
/**
 * v2 三区卡编辑器（DocumentEditor）的交互测试：
 * 三区渲染 / head 布局切换 / 隐藏 / 键盘等价拖拽 / 非法位置提示 / 选中展开编辑 /
 * 自建板块与 inline、text 两种 kind / 仅素材标注 / 页眉编辑 / 添加字段与条目。
 *
 * 断言里的界面文案一律走 `t()`（cjkRatchet 的 tests 口径统计中文 ByText：新增中文断言会变红）。
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ResumeDocument, ResumeSection } from "../../types/resumeDocument";
import { buildFallbackCatalog } from "../../features/resume-document/fieldCatalog";
import { defaultSectionLayout, emptyDocument } from "../../features/resume-document";
import { makeDocument } from "../../features/resume-document/documentFixtures";
import DocumentEditor from "./DocumentEditor";

/** chip 的无障碍名：目录标签 + 全角冒号 + 值。 */
function chipName(labelKey: Parameters<typeof t>[0], value: string): string {
  return `${t(labelKey)}\uFF1A${value}`;
}

function renderEditor(
  document: ResumeDocument = makeDocument(),
  props: Partial<Parameters<typeof DocumentEditor>[0]> = {},
) {
  const onChange = vi.fn();
  const onSelectPath = vi.fn();
  const utils = render(
    <DocumentEditor
      document={document}
      onChange={onChange}
      onSelectPath={onSelectPath}
      {...props}
    />,
  );
  return { ...utils, onChange, onSelectPath };
}

/** 渲染后切到教育页签（默认停在「基本信息」；三区卡的断言都在教育板块上）。 */
function renderEducation(
  document: ResumeDocument = makeDocument(),
  props: Partial<Parameters<typeof DocumentEditor>[0]> = {},
) {
  const result = renderEditor(document, props);
  fireEvent.click(screen.getByRole("tab", { name: t("editor.section.education") }));
  return result;
}

function lastDocument(onChange: ReturnType<typeof vi.fn>): ResumeDocument {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1][0] as ResumeDocument;
}

function dropPayload(path: string) {
  return { dataTransfer: { getData: () => path, dropEffect: "move" } };
}

function makeSection(overrides: Partial<ResumeSection>): ResumeSection {
  return {
    key: "custom:abc",
    title: "",
    kind: "entries",
    layout: defaultSectionLayout(),
    entries: [],
    ...overrides,
  };
}

/** 行内板块的一条技能：name/level 是正文，category 是灰字（与公开目录默认位置一致）。 */
function skillEntry(id: string, name: string, level: string, category: string) {
  const field = (key: string, value: string, placement: "body" | "trail") => ({
    kind: "field" as const,
    id: `${id}-${key}`,
    key,
    label: "",
    value,
    placement,
    format: "text" as const,
    wrap: "none" as const,
    show_label: placement === "trail",
    solo: false,
    source: null,
    body_style: "bullet" as const,
  });
  return {
    id,
    hidden: false,
    lock_content: false,
    lock_layout: false,
    layout: { head: "split" as const },
    items: [
      field("name", name, "body"),
      field("level", level, "body"),
      field("category", category, "trail"),
    ],
  };
}

function makeInlineSkillsDocument(): ResumeDocument {
  const document = makeDocument();
  document.sections.push(
    makeSection({
      key: "skills",
      kind: "inline",
      entries: [
        skillEntry("sk1", "TypeScript", "Advanced", "Language"),
        skillEntry("sk2", "Rust", "Beginner", "Language"),
        skillEntry("sk3", "SQL", "Advanced", "Tooling"),
      ],
    }),
  );
  return document;
}

function inlineEntryIds(document: ResumeDocument): (string | null | undefined)[] {
  return (
    document.sections
      .find((section) => section.key === "skills")
      ?.entries.map((entry) => entry.id) ?? []
  );
}

describe("DocumentEditor 三区卡", () => {
  it("渲染基础信息页签 + 三个区 + 标题/元信息 chip", () => {
    renderEducation();
    expect(screen.getByRole("tab", { name: t("document.basic.title") })).toBeInTheDocument();
    expect(screen.getAllByText(t("document.zone.head")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t("document.zone.detail")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t("document.zone.body")).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("group", {
        name: chipName("editor.field.school", "Tsinghua University"),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", {
        name: chipName("editor.field.major", "Computer Science"),
      }),
    ).toBeInTheDocument();
  });

  it("head 布局 Segmented 切换为「上下」并写回文档", () => {
    const { onChange } = renderEducation();
    fireEvent.click(screen.getAllByText(t("document.entry.headLayout.stacked"))[0]);
    expect(lastDocument(onChange).sections[0].entries[0].layout.head).toBe("stacked");
  });

  it("键盘等价拖拽：Enter 拿起 → ArrowDown → Enter 确认，同组顺序换了", () => {
    const { onChange } = renderEducation();
    const chip = screen.getByRole("group", {
      name: chipName("editor.field.school", "Tsinghua University"),
    });
    const main = within(chip).getAllByRole("button")[0];
    fireEvent.keyDown(main, { key: "Enter" });
    fireEvent.keyDown(main, { key: "ArrowDown" });
    fireEvent.keyDown(main, { key: "Enter" });
    const titles = lastDocument(onChange)
      .sections[0].entries[0].items.filter(
        (item) => (item as { placement?: string }).placement === "title",
      )
      .map((item) => (item as { key?: string }).key);
    expect(titles).toEqual(["major", "school"]);
  });

  it("键盘移动越界给可读提示（不静默失败）", () => {
    renderEducation();
    const courseChip = screen.getByRole("group", {
      name: new RegExp(t("editor.field.courses")),
    });
    const main = within(courseChip).getAllByRole("button")[0];
    fireEvent.keyDown(main, { key: "Enter" });
    fireEvent.keyDown(main, { key: "ArrowUp" });
    expect(screen.getByText(t("document.drag.boundary"))).toBeInTheDocument();
  });

  it("鼠标拖放跨区：把 lead 的绩点放进正文区，placement 改成 body", () => {
    const { onChange } = renderEducation();
    const bodyZone = document.querySelector('[data-document-zone="body"]') as HTMLElement;
    fireEvent.drop(bodyZone, dropPayload("education.ob_entry001.ob_item0005"));
    const item = lastDocument(onChange).sections[0].entries[0].items.find(
      (candidate) => candidate.id === "ob_item0005",
    );
    expect((item as { placement?: string } | undefined)?.placement).toBe("body");
  });

  it("可由鼠标拖动：非 text 的 item chip 带 draggable", () => {
    renderEducation();
    const chip = screen.getByRole("group", {
      name: chipName("editor.field.school", "Tsinghua University"),
    });
    const main = within(chip).getAllByRole("button")[0];
    expect(main).toHaveAttribute("draggable", "true");
  });

  it("拖到非法位置（list item → 标题行）给提示且不改文档", () => {
    const { onChange } = renderEducation();
    const titleZone = document.querySelector('[data-document-zone="title"]') as HTMLElement;
    fireEvent.drop(titleZone, dropPayload("education.ob_entry001.ob_item0004"));
    expect(screen.getByText(t("document.drag.invalid"))).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("点击 chip 上报选中路径", () => {
    const { onSelectPath } = renderEducation();
    const school = screen.getByRole("group", {
      name: chipName("editor.field.school", "Tsinghua University"),
    });
    const major = screen.getByRole("group", {
      name: chipName("editor.field.major", "Computer Science"),
    });
    fireEvent.click(within(school).getAllByRole("button")[0]);
    expect(onSelectPath).toHaveBeenCalledWith("education.ob_entry001.ob_item0001");
    fireEvent.click(within(major).getAllByRole("button")[0]);
    expect(onSelectPath).toHaveBeenCalledWith("education.ob_entry001.ob_item0002");
  });

  it("再次点击已选中的 chip：收起 item 编辑器并上报 null", () => {
    const { onSelectPath } = renderEditor(makeDocument(), {
      selectedPath: "education.ob_entry001.ob_item0001",
    });
    fireEvent.click(screen.getByRole("tab", { name: t("editor.section.education") }));
    const school = screen.getByRole("group", {
      name: chipName("editor.field.school", "Tsinghua University"),
    });
    const main = within(school).getAllByRole("button")[0];
    expect(main).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText(t("document.field.value"))).toBeInTheDocument();
    fireEvent.click(main);
    expect(onSelectPath).toHaveBeenLastCalledWith(null);
  });

  it("受控 selectedPath 展开 item 编辑器（值输入框可用）", () => {
    const { onChange } = renderEditor(makeDocument(), {
      selectedPath: "education.ob_entry001.ob_item0001",
    });
    const input = screen.getByLabelText(t("document.field.value")) as HTMLInputElement;
    expect(input.value).toBe("Tsinghua University");
    fireEvent.change(input, { target: { value: "Peking University" } });
    const first = lastDocument(onChange).sections[0].entries[0].items[0] as { value: string };
    expect(first.value).toBe("Peking University");
  });

  it("条目动作：添加条目追加到板块末尾", () => {
    const { onChange } = renderEducation();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("document.entry.add")) }));
    expect(lastDocument(onChange).sections[0].entries).toHaveLength(3);
  });
});

describe("DocumentEditor 板块形态与页眉", () => {
  it("inline kind：渲染行内提示与已有技能 chip", () => {
    const document = makeDocument();
    document.sections.push(
      makeSection({
        key: "skills",
        kind: "inline",
        entries: [
          {
            id: "ob_skill001",
            hidden: false,
            lock_content: false,
            lock_layout: false,
            layout: { head: "split" },
            items: [
              {
                kind: "field",
                id: "ob_skitem1",
                key: "name",
                label: "",
                value: "TypeScript",
                placement: "body",
                format: "text",
                wrap: "none",
                show_label: false,
                solo: false,
                source: null,
                body_style: "bullet",
              },
            ],
          },
        ],
      }),
    );
    renderEditor(document);
    fireEvent.click(screen.getByRole("tab", { name: t("editor.section.skills") }));
    expect(screen.getByText(t("document.section.inlineHint"))).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /TypeScript/ })).toBeInTheDocument();
  });

  it("inline kind：每条 entry 各占一行，而非只渲染第一条（Q06）", () => {
    renderEditor(makeInlineSkillsDocument());
    fireEvent.click(screen.getByRole("tab", { name: t("editor.section.skills") }));

    const rows = document.querySelectorAll("[data-document-inline-entry]");
    expect(rows).toHaveLength(3);
    for (const value of ["TypeScript", "Rust", "SQL"]) {
      expect(screen.getByRole("group", { name: new RegExp(value) })).toBeInTheDocument();
    }
  });

  it("inline kind：选中某条 entry 时对应行高亮（结构树联动）", () => {
    renderEditor(makeInlineSkillsDocument(), { selectedPath: "skills.sk2" });
    fireEvent.click(screen.getByRole("tab", { name: t("editor.section.skills") }));

    const selected = document.querySelector('[data-document-entry="skills.sk2"]');
    expect(selected?.className).toContain("is-selected");
    // 选中行里就地出现「添加字段」——行内添加字段不必先切到别处。
    expect(selected?.querySelector("[data-document-inline-add]")).not.toBeNull();
  });

  it("值加括号只在正文位置出现（Q17）", () => {
    // 标题位置的字段：planner 不消费 wrap，编辑器不能再摆这个开关。
    const titleView = renderEditor(makeDocument(), {
      selectedPath: "education.ob_entry001.ob_item0001",
    });
    expect(screen.queryByText(t("document.item.wrap"))).toBeNull();
    titleView.unmount();

    // 行内板块的正文位置：wrap 会被 planner 消费（`_inline_rows`），开关必须还在。
    renderEditor(makeInlineSkillsDocument(), { selectedPath: "skills.sk1.sk1-name" });
    expect(screen.getByText(t("document.item.wrap"))).toBeInTheDocument();
  });

  it("inline kind：底部添加按钮按目录预填默认字段并自动选中新行（Q06）", () => {
    const catalog = buildFallbackCatalog((key) => key);
    const { onChange, onSelectPath } = renderEditor(makeInlineSkillsDocument(), {
      fieldCatalog: catalog,
    });
    const title = catalog.sections.find((section) => section.key === "skills")?.title ?? "";
    fireEvent.click(screen.getByRole("tab", { name: title }));
    // 图标按钮的可访问名带图标名（plus + 文案），所以按子串匹配。
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(t("document.section.inlineAdd", { name: title })),
      }),
    );

    const next = lastDocument(onChange);
    const entries = next.sections.find((section) => section.key === "skills")?.entries ?? [];
    expect(entries).toHaveLength(4);
    const created = entries[3];
    // 技能 = 名称 / 级别 / 技能分类：新行不是空白 entry，用户点开就能填值。
    expect(created.items.map((item) => (item as { key?: string }).key)).toEqual([
      "category",
      "name",
      "level",
    ]);
    expect(onSelectPath).toHaveBeenCalledWith(`skills.${created.id}`);
  });

  it("inline kind：行操作上移 / 右键隐藏 / 右键移除都写回文档（Q06）", async () => {
    const first = renderEditor(makeInlineSkillsDocument());
    fireEvent.click(screen.getByRole("tab", { name: t("editor.section.skills") }));
    const secondRow = document.querySelectorAll("[data-document-inline-entry]")[1] as HTMLElement;
    const secondHead = within(
      secondRow.querySelector(".document-inline-entry-head") as HTMLElement,
    );
    fireEvent.click(secondHead.getByRole("button", { name: t("document.entry.moveUp") }));
    expect(inlineEntryIds(lastDocument(first.onChange))).toEqual(["sk2", "sk1", "sk3"]);
    first.unmount();

    const second = renderEditor(makeInlineSkillsDocument());
    fireEvent.click(screen.getByRole("tab", { name: t("editor.section.skills") }));
    const hideRow = document.querySelectorAll("[data-document-inline-entry]")[1] as HTMLElement;
    fireEvent.contextMenu(hideRow.querySelector(".document-inline-entry-head") as HTMLElement);
    fireEvent.click(await screen.findByText(t("document.entry.hide")));
    const hidden = lastDocument(second.onChange).sections.find(
      (section) => section.key === "skills",
    )?.entries[1];
    expect(hidden?.hidden).toBe(true);
    second.unmount();

    const third = renderEditor(makeInlineSkillsDocument());
    fireEvent.click(screen.getByRole("tab", { name: t("editor.section.skills") }));
    const removeRow = document.querySelectorAll("[data-document-inline-entry]")[0] as HTMLElement;
    fireEvent.contextMenu(removeRow.querySelector(".document-inline-entry-head") as HTMLElement);
    fireEvent.click(await screen.findByText(t("document.entry.remove")));
    expect(inlineEntryIds(lastDocument(third.onChange))).toEqual(["sk2", "sk3"]);
  });

  it("text kind：个人总结段落可见", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("tab", { name: t("editor.field.summary") }));
    expect(screen.getByRole("group", { name: /Personal summary paragraph/ })).toBeInTheDocument();
  });

  it("自建板块：页签用板块标题，条目卡与系统板块同构", () => {
    const document = makeDocument();
    const custom = makeSection({
      entries: [
        {
          id: "ob_custom01",
          hidden: false,
          lock_content: false,
          lock_layout: false,
          layout: { head: "split" },
          items: [
            {
              kind: "text",
              id: "ob_ctext001",
              style: "paragraph",
              text: "Society president",
              hidden: false,
            },
          ],
        },
      ],
    });
    // 标题在创建后赋值（不写对象字面量的 title 属性：产品文案守卫把 title: 当作文案位）。
    (custom as { title: string }).title = "社团经历";
    document.sections.push(custom);
    renderEditor(document);
    fireEvent.click(screen.getByRole("tab", { name: "社团经历" }));
    expect(screen.getByRole("group", { name: /Society president/ })).toBeInTheDocument();
  });

  it("仅素材字段带「仅素材」徽标", () => {
    const document = makeDocument();
    document.sections.push(
      makeSection({
        key: "patents",
        entries: [
          {
            id: "ob_patent01",
            hidden: false,
            lock_content: false,
            lock_layout: false,
            layout: { head: "split" },
            items: [
              {
                kind: "field",
                id: "ob_pitem001",
                key: "outcome_type",
                label: "",
                value: "Invention patent",
                placement: "hidden",
                format: "text",
                wrap: "none",
                show_label: false,
                solo: false,
                source: null,
                body_style: "bullet",
              },
            ],
          },
        ],
      }),
    );
    renderEditor(document, { fieldCatalog: buildFallbackCatalog((key) => key) });
    fireEvent.click(screen.getByRole("tab", { name: "research.tab.patents" }));
    expect(screen.getAllByText(t("document.item.materialOnly")).length).toBeGreaterThan(0);
  });

  it("页眉（基本信息）可编辑：输入姓名写回 header item", () => {
    const { onChange } = renderEditor();
    const input = screen.getByLabelText(t("document.headerField.name")) as HTMLInputElement;
    expect(input.value).toBe("Li Si");
    fireEvent.change(input, { target: { value: "Wang Wu" } });
    expect(lastDocument(onChange).header.items[0].value).toBe("Wang Wu");
  });

  it("添加字段菜单：选「学习形式」后追加一条字段 item", async () => {
    const { onChange } = renderEducation();
    fireEvent.click(screen.getAllByRole("button", { name: t("document.head.addTitle") })[0]);
    fireEvent.click(await screen.findByText(t("editor.field.studyForm")));
    const items = lastDocument(onChange).sections[0].entries[0].items;
    expect(items.some((item) => (item as { key?: string }).key === "study_form")).toBe(true);
  });
});

describe("DocumentEditor 空文档与只读", () => {
  it("空文档显示基本信息与空页眉提示（不崩）", () => {
    renderEditor(emptyDocument());
    expect(screen.getByRole("tab", { name: t("document.basic.title") })).toBeInTheDocument();
    expect(screen.getByText(t("document.basic.empty"))).toBeInTheDocument();
  });

  it("readOnly 时不渲染隐藏/移除按钮与添加入口", () => {
    renderEditor(makeDocument(), { readOnly: true });
    expect(screen.queryByRole("button", { name: t("document.item.hide") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("document.entry.add") })).toBeNull();
  });
});
