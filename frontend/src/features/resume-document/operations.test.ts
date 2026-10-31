// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  createIdFactory,
  entry,
  fieldItem,
  listItem,
  makeDocument,
  textItem,
} from "./documentFixtures";
import {
  addEntry,
  copyEntry,
  moveEntry,
  removeEntry,
  toggleEntryHidden,
  toggleLock,
} from "./entries";
import {
  allowedPlacementsForItem,
  canPlaceItem,
  getItemPlacement,
  moveItem,
  reorderItems,
  setPlacement,
  withItemPlacement,
} from "./placement";
import {
  addHeaderItem,
  addItem,
  addSection,
  moveSection,
  removeHeaderItem,
  removeItem,
  removeSection,
  replaceItem,
  setEntryHeadLayout,
  toggleItemHidden,
  updateAuthorsItem,
  updateEntry,
  updateFieldItem,
  updateHeaderItem,
  updateListItem,
  updateSection,
  updateTextItem,
} from "./mutations";
import type { HeaderItem, ResumeSection } from "../../types/resumeDocument";

describe("位置规则", () => {
  it("getItemPlacement：text 由 hidden 布尔推导，其余读 placement", () => {
    expect(getItemPlacement(fieldItem({ placement: "lead" }))).toBe("lead");
    expect(getItemPlacement(textItem({ hidden: false }))).toBe("body");
    expect(getItemPlacement(textItem({ hidden: true }))).toBe("hidden");
  });

  it("允许的位置：field 六个抽屉；list/authors 只能灰色/隐藏；text 不参与拖拽", () => {
    expect(allowedPlacementsForItem(fieldItem())).toEqual([
      "title",
      "meta",
      "lead",
      "body",
      "trail",
      "hidden",
    ]);
    expect(allowedPlacementsForItem(listItem())).toEqual(["lead", "trail", "hidden"]);
    expect(allowedPlacementsForItem(textItem())).toEqual([]);
    expect(canPlaceItem(listItem(), "title")).toBe(false);
    expect(canPlaceItem(textItem(), "body")).toBe(false);
  });

  it("withItemPlacement：text 只处理 hidden，不同值返回新对象", () => {
    const text = textItem({ hidden: false });
    expect(withItemPlacement(text, "hidden")).toMatchObject({ hidden: true });
    expect(withItemPlacement(text, "lead")).toBe(text);
    const field = fieldItem({ placement: "title" });
    expect(withItemPlacement(field, "body")).toMatchObject({ placement: "body" });
    expect(withItemPlacement(field, "title")).toBe(field);
  });
});

describe("moveItem / setPlacement / reorderItems", () => {
  it("同组内换顺序（toIndex 从 0 起）", () => {
    const document = makeDocument();
    // title 组：[school, major] → 把 school 移到 major 之后。
    const moved = moveItem(document, "education.ob_entry001.ob_item0001", { toIndex: 1 });
    const titles = moved.sections[0].entries[0].items.filter(
      (item) => (item as { placement?: string }).placement === "title",
    );
    expect(titles.map((item) => item.kind === "field" && item.key)).toEqual(["major", "school"]);
    expect(document.sections[0].entries[0].items[0].id).toBe("ob_item0001");
  });

  it("跨位置：title → body，顺序落组内末尾", () => {
    const document = makeDocument();
    const moved = setPlacement(document, "education.ob_entry001.ob_item0002", "body");
    const item = moved.sections[0].entries[0].items.find(
      (candidate) => candidate.id === "ob_item0002",
    );
    expect((item as { placement?: string } | undefined)?.placement).toBe("body");
  });

  it("非法位置 / TextItem / 路径不存在都返回原引用（===）", () => {
    const document = makeDocument();
    expect(moveItem(document, "education.ob_entry001.ob_item0004", { placement: "title" })).toBe(
      document,
    );
    expect(moveItem(document, "education.ob_entry001.ob_item0006", { placement: "lead" })).toBe(
      document,
    );
    expect(moveItem(document, "education.ob_entry001.nope", { placement: "body" })).toBe(document);
  });

  it("reorderItems：同组上下移，边界返回原引用、不跨位置", () => {
    const document = makeDocument();
    const down = reorderItems(document, "education.ob_entry001.ob_item0001", 1);
    const titles = down.sections[0].entries[0].items.filter(
      (item) => (item as { placement?: string }).placement === "title",
    );
    expect(titles.map((item) => item.id)).toEqual(["ob_item0002", "ob_item0001"]);
    const up = reorderItems(down, "education.ob_entry001.ob_item0001", -1);
    expect(
      up.sections[0].entries[0].items
        .filter((item) => (item as { placement?: string }).placement === "title")
        .map((item) => item.id),
    ).toEqual(["ob_item0001", "ob_item0002"]);
    expect(reorderItems(document, "education.ob_entry001.ob_item0001", -1)).toBe(document);
    expect(reorderItems(document, "education.ob_entry001.ob_item0003", 1)).toBe(document);
  });
});

describe("条目操作", () => {
  it("addEntry：追加到末尾并返回新 id；板块不存在返回原文档", () => {
    const document = makeDocument();
    const created = addEntry(
      document,
      "education",
      { ...entry(), id: null },
      createIdFactory("ob_"),
    );
    expect(created.entryId).toBe("ob_00000001");
    const createdEntries = created.document.sections[0].entries;
    expect(createdEntries[createdEntries.length - 1].id).toBe("ob_00000001");
    expect(addEntry(document, "nope").document).toBe(document);
  });

  it("removeEntry：删掉指定条目；item 路径定点到所属条目", () => {
    const document = makeDocument();
    const removed = removeEntry(document, "education.ob_entry001.ob_item0001");
    expect(removed.sections[0].entries.map((item) => item.id)).toEqual(["ob_entry002"]);
    expect(removeEntry(document, "education.nope")).toBe(document);
  });

  it("moveEntry：up/down/数字目标；越界与原地不动返回原引用", () => {
    const document = makeDocument();
    const down = moveEntry(document, "education.ob_entry001", "down");
    expect(down.sections[0].entries.map((item) => item.id)).toEqual(["ob_entry002", "ob_entry001"]);
    const back = moveEntry(down, "education.ob_entry001", 0);
    expect(back.sections[0].entries.map((item) => item.id)).toEqual(["ob_entry001", "ob_entry002"]);
    expect(moveEntry(document, "education.ob_entry001", "up")).toBe(document);
    expect(moveEntry(document, "education.ob_entry002", 5)).toBe(document);
  });

  it("copyEntry：插在原条目后面，条目与全部 item 换新 id", () => {
    const document = makeDocument();
    const copied = copyEntry(document, "education.ob_entry001", createIdFactory("cp_"));
    expect(copied.entryId).toBe("cp_00000001");
    const entries = copied.document.sections[0].entries;
    expect(entries).toHaveLength(3);
    expect(entries[1].id).toBe("cp_00000001");
    expect(entries[1].items.map((item) => item.id)).not.toContain("ob_item0001");
    // 入参不变
    expect(document.sections[0].entries).toHaveLength(2);
  });

  it("toggleEntryHidden / toggleLock", () => {
    const document = makeDocument();
    const hidden = toggleEntryHidden(document, "education.ob_entry001");
    expect(hidden.sections[0].entries[0].hidden).toBe(true);
    const locked = toggleLock(document, "education.ob_entry001", "content");
    expect(locked.sections[0].entries[0].lock_content).toBe(true);
    expect(locked.sections[0].entries[0].lock_layout).toBe(false);
  });
});

describe("内容写入", () => {
  it("replaceItem / 四类 update 只在 kind 匹配时生效", () => {
    const document = makeDocument();
    expect(
      (
        replaceItem(
          document,
          "education.ob_entry001.ob_item0001",
          fieldItem({ id: "ob_item0001", value: "北大" }),
        ).sections[0].entries[0].items[0] as { value: string }
      ).value,
    ).toBe("北大");
    const field = updateFieldItem(document, "education.ob_entry001.ob_item0001", { value: "复旦" });
    expect((field.sections[0].entries[0].items[0] as { value: string }).value).toBe("复旦");
    // kind 不匹配 → 原引用
    expect(updateListItem(document, "education.ob_entry001.ob_item0001", { label: "x" })).toBe(
      document,
    );
    expect(updateAuthorsItem(document, "education.ob_entry001.ob_item0001", { label: "x" })).toBe(
      document,
    );
    expect(updateTextItem(document, "education.ob_entry001.ob_item0001", { text: "x" })).toBe(
      document,
    );
    const text = updateTextItem(document, "education.ob_entry001.ob_item0006", { text: "改了" });
    expect((text.sections[0].entries[0].items[5] as { text: string }).text).toBe("改了");
  });

  it("toggleItemHidden：field 隐藏 / 从隐藏恢复隐藏前位置；text 切 hidden 布尔", () => {
    const document = makeDocument();
    const before = (document.sections[0].entries[0].items[0] as { placement?: string }).placement;
    const hidden = toggleItemHidden(document, "education.ob_entry001.ob_item0001");
    const hiddenItem = hidden.sections[0].entries[0].items[0] as {
      placement?: string;
      hidden_from?: string | null;
    };
    expect(hiddenItem.placement).toBe("hidden");
    expect(hiddenItem.hidden_from).toBe(before);
    const shown = toggleItemHidden(hidden, "education.ob_entry001.ob_item0001");
    const shownItem = shown.sections[0].entries[0].items[0] as {
      placement?: string;
      hidden_from?: string | null;
    };
    expect(shownItem.placement).toBe(before);
    expect(shownItem.hidden_from).toBeNull();
    // 拖进隐藏分组也记住来源位置，点“显示”时恢复。
    const draggedHidden = moveItem(document, "education.ob_entry001.ob_item0001", {
      placement: "hidden",
    });
    const draggedItem = draggedHidden.sections[0].entries[0].items.find(
      (item) => item.id === "ob_item0001",
    ) as { hidden_from?: string };
    expect(draggedItem.hidden_from).toBe(before);
    const draggedBack = toggleItemHidden(draggedHidden, "education.ob_entry001.ob_item0001");
    const restoredItem = draggedBack.sections[0].entries[0].items.find(
      (item) => item.id === "ob_item0001",
    ) as { placement?: string };
    expect(restoredItem.placement).toBe(before);
    const textHidden = toggleItemHidden(document, "education.ob_entry001.ob_item0006");
    expect((textHidden.sections[0].entries[0].items[5] as { hidden: boolean }).hidden).toBe(true);
  });

  it("addItem / removeItem", () => {
    const document = makeDocument();
    const added = addItem(
      document,
      "education",
      "ob_entry001",
      fieldItem({ id: "ob_new00001", key: "note" }),
    );
    expect(added.sections[0].entries[0].items).toHaveLength(7);
    expect(addItem(document, "nope", "ob_entry001", fieldItem())).toBe(document);
    expect(addItem(document, "education", "nope", fieldItem())).toBe(document);
    const removed = removeItem(added, "education.ob_entry001.ob_new00001");
    expect(removed.sections[0].entries[0].items).toHaveLength(6);
    expect(removeItem(document, "education.ob_entry001.nope")).toBe(document);
  });

  it("updateEntry：layout 浅合并；setEntryHeadLayout 三选一", () => {
    const document = makeDocument();
    const updated = updateEntry(document, "education.ob_entry001", { layout: { head: "stacked" } });
    expect(updated.sections[0].entries[0].layout.head).toBe("stacked");
    expect(updated.sections[0].entries[0].layout.columns).toBeNull();
    expect(
      setEntryHeadLayout(document, "education.ob_entry001", "meta_first").sections[0].entries[0]
        .layout.head,
    ).toBe("meta_first");
  });

  it("updateSection：title/kind/layout 合并；addSection 重复 key 不生效；removeSection", () => {
    const document = makeDocument();
    const updated = updateSection(document, "education", { layout: { columns: 2 } });
    expect(updated.sections[0].layout.columns).toBe(2);
    const custom: ResumeSection = {
      key: "custom:abc",
      title: "社团",
      kind: "entries",
      layout: document.sections[0].layout,
      entries: [],
    };
    const added = addSection(document, custom);
    expect(added.sections).toHaveLength(3);
    expect(addSection(added, custom)).toBe(added);
    expect(removeSection(added, "custom:abc").sections).toHaveLength(2);
    expect(removeSection(document, "nope")).toBe(document);
  });

  it("moveSection：上移 / 下移板块，越界返回原文档", () => {
    const document = makeDocument();
    const keys = document.sections.map((section) => section.key);
    const down = moveSection(document, keys[0], "down");
    expect(down.sections.map((section) => section.key)).toEqual([keys[1], keys[0]]);
    const up = moveSection(down, keys[0], "up");
    expect(up.sections.map((section) => section.key)).toEqual(keys);
    expect(moveSection(document, keys[0], "up")).toBe(document);
    expect(moveSection(document, keys[keys.length - 1], "down")).toBe(document);
  });

  it("页眉：addHeaderItem / updateHeaderItem / removeHeaderItem", () => {
    const document = makeDocument();
    const item: HeaderItem = {
      kind: "field",
      id: "ob_head0003",
      key: "email",
      label: "",
      value: "a@b.c",
      placement: "contact",
      format: "text",
    };
    const added = addHeaderItem(document, item);
    expect(added.header.items).toHaveLength(3);
    const updated = updateHeaderItem(added, "header.ob_head0003", { value: "c@d.e" });
    expect(updated.header.items[2].value).toBe("c@d.e");
    expect(removeHeaderItem(updated, "header.ob_head0003").header.items).toHaveLength(2);
    expect(removeHeaderItem(document, "header.nope")).toBe(document);
  });
});
