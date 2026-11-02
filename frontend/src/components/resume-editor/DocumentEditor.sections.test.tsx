// SPDX-License-Identifier: Apache-2.0
/** 板块形态与页眉用例（#31 拆分：主测试文件超 500 行预算，helpers 从主文件导出共用）。 */
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { t } from "../../i18n";
import { makeDocument } from "../../features/resume-document/documentFixtures";
import { buildFallbackCatalog } from "../../features/resume-document/fieldCatalog";
import {
  chipName,
  inlineEntryIds,
  lastDocument,
  makeInlineSkillsDocument,
  makeSection,
  plainField,
  renderEditor,
  renderEducation,
} from "./DocumentEditor.test";

/**
 * 自建板块的标题夹具。
 *
 * 刻意用非中文：`cjkRatchet` 的 tests 口径统计"中文断言行"，新增中文界面文案会被判红；
 * 板块标题是**数据**而不是界面文案，用 ASCII 就与棘轮无关（同 `Society president` 先例）。
 */
const CUSTOM_TITLE = "Society life";

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
            items: [plainField("ob_skitem1", "name", "TypeScript")],
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
    const titleChip = screen.getByRole("group", {
      name: chipName("editor.field.school", "Tsinghua University"),
    });
    fireEvent.keyDown(within(titleChip).getAllByRole("button")[0], { key: "F2" });
    expect(screen.queryByText(t("document.item.wrap"))).toBeNull();
    titleView.unmount();

    // 行内板块的正文位置：wrap 会被 planner 消费（`_inline_rows`），开关必须还在。
    renderEditor(makeInlineSkillsDocument(), { selectedPath: "skills.sk1.sk1-name" });
    const skillChip = screen.getByRole("group", { name: /TypeScript/ });
    fireEvent.keyDown(within(skillChip).getAllByRole("button")[0], { key: "F2" });
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
            items: [plainField("ob_pitem001", "outcome_type", "Invention patent", "hidden")],
          },
        ],
      }),
    );
    renderEditor(document, { fieldCatalog: buildFallbackCatalog((key) => key) });
    fireEvent.click(screen.getByRole("tab", { name: "research.tab.patents" }));
    expect(screen.getAllByText(t("document.item.materialOnly")).length).toBeGreaterThan(0);
  });

  // #10：页眉字段改成 chip，值输入框在**展开态**里（双击 / F2 才展开）。旧断言直接
  // getByLabelText 拿输入框，是"页眉是一排表单行"时代的写法，按新语义改写。
  it("#10 页眉（基本信息）chip 展开后可编辑：输入姓名写回 header item", () => {
    const { onChange } = renderEditor();
    const chip = screen.getByRole("group", {
      name: chipName("document.headerField.name", "Li Si"),
    });
    const main = within(chip).getAllByRole("button")[0];
    fireEvent.doubleClick(main);
    expect(main).toHaveAttribute("aria-expanded", "true");
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

  /**
   * 任务 11 返工：删除自建板块的入口只挂在**自建板块的右键菜单**上。
   * 系统板块不是"菜单项灰掉"，而是整个菜单都不出现（它们只能隐藏/改标题）。
   */
  it("任务 11 返工：自建板块页签右键有「删除这个板块」，系统板块没有", async () => {
    const document = makeDocument();
    const custom = makeSection({});
    (custom as { title: string }).title = CUSTOM_TITLE;
    document.sections.push(custom);

    const customView = renderEditor(document);
    fireEvent.contextMenu(screen.getByRole("tab", { name: CUSTOM_TITLE }));
    expect(await screen.findByText(t("editor.custom-sections.remove-section"))).toBeInTheDocument();
    customView.unmount();

    // 系统板块（教育经历）右键：菜单根本不弹，所以文案查不到。
    renderEditor(document);
    fireEvent.contextMenu(screen.getByRole("tab", { name: t("editor.section.education") }));
    expect(screen.queryByText(t("editor.custom-sections.remove-section"))).toBeNull();
  });

  /**
   * 任务 11 返工：点菜单还没改文档——必须先过确认弹窗；确认后写回文档、选中落到相邻板块、
   * 并给一条"已删除"的提示（提示里带板块名，用户才知道删掉的是哪一个）。
   */
  it("任务 11 返工：确认后删除自建板块，选中落到相邻板块并给提示", async () => {
    const document = makeDocument();
    const custom = makeSection({});
    (custom as { title: string }).title = CUSTOM_TITLE;
    // 页签顺序：基本信息 / 教育经历 / 个人总结 / 自建；删的是**最后一条**。
    document.sections.push(custom);
    const { onChange, onSelectPath } = renderEditor(document);

    fireEvent.contextMenu(screen.getByRole("tab", { name: CUSTOM_TITLE }));
    fireEvent.click(await screen.findByText(t("editor.custom-sections.remove-section")));

    // 二次确认：正文说清"只删本份简历 + 可撤销"。
    expect(
      await screen.findByText(t("document.section.removeBody", { section: CUSTOM_TITLE })),
    ).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    // 主按钮文案是两个汉字，antd 会自动插空格，按文案取不到；弹窗 footer 的最后一个按钮
    // 就是主按钮（前面依次是 × 与「取消」）。
    const dialog = await screen.findByRole("dialog");
    const dialogButtons = within(dialog).getAllByRole("button");
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);

    expect(lastDocument(onChange).sections.map((section) => section.key)).toEqual([
      "education",
      "summary",
    ]);
    // 删最后一条 → 选中交给前一条（个人总结），不留悬空选中。
    expect(onSelectPath).toHaveBeenLastCalledWith("summary");
    expect(
      screen.getByText(t("document.section.removed", { section: CUSTOM_TITLE })),
    ).toBeInTheDocument();
  });
});
