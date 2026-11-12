// SPDX-License-Identifier: Apache-2.0
/**
 * 页眉（基本信息）chip 的位置与顺序（#10 纯函数部分）。
 *
 * 这里只测"槽位怎么算"和"移动怎么落"：组件行为（右键菜单 / 双击展开 / 拖拽）在
 * `DocumentEditor.header.test.tsx` 里走真实渲染，不在这份文件里重复。
 */
import { describe, expect, it } from "vitest";
import type { HeaderItem, ResumeDocument } from "../../../types/resumeDocument";
import { emptyDocument } from "./defaults";
import {
  headerGroupOf,
  headerPhotoItem,
  headerSlotOf,
  isCustomHeaderItem,
  isPhotoDataUrl,
  keyboardHeaderMoveTarget,
  moveHeaderItem,
} from "./headerOrder";

const PHOTO = "data:image/png;base64,iVBORw0KGgo=";

function headerItem(init: {
  id: string;
  key: string;
  placement: HeaderItem["placement"];
  value?: string;
}): HeaderItem {
  return {
    kind: "field",
    id: init.id,
    key: init.key,
    label: "",
    value: init.value ?? "",
    placement: init.placement,
    format: "text",
  };
}

/** name(name) / gender(name_meta) / phone(contact) / email(contact) / photo(photo)。 */
function makeDocument(): ResumeDocument {
  const base = emptyDocument("zh-CN");
  return {
    ...base,
    header: {
      contact_breaks: [],
      items: [
        headerItem({ id: "h1", key: "name", placement: "name", value: "Li Si" }),
        headerItem({ id: "h2", key: "gender", placement: "name_meta" }),
        headerItem({ id: "h3", key: "phone", placement: "contact", value: "138" }),
        headerItem({ id: "h4", key: "email", placement: "contact", value: "a@b.c" }),
        headerItem({ id: "h5", key: "photo", placement: "photo", value: PHOTO }),
      ],
    },
  };
}

describe("页眉位置组与槽位", () => {
  it("headerGroupOf 只留同位置组，顺序与文档一致", () => {
    const items = makeDocument().header.items;
    expect(headerGroupOf(items, "contact").map((item) => item.id)).toEqual(["h3", "h4"]);
    expect(headerGroupOf(items, "subtitle")).toEqual([]);
  });

  it("headerSlotOf 返回组内下标（不是数组总下标）", () => {
    const items = makeDocument().header.items;
    expect(headerSlotOf(items, items[3])).toEqual({ placement: "contact", index: 1 });
    expect(
      headerSlotOf(items, headerItem({ id: "missing", key: "x", placement: "contact" })),
    ).toBeNull();
  });

  it("↑ / ↓ 在同组内移动，到边界返回 null", () => {
    const items = makeDocument().header.items;
    const email = items[3];
    const slot = headerSlotOf(items, email)!;
    expect(keyboardHeaderMoveTarget(items, slot, "up")).toEqual({ placement: "contact", index: 0 });
    // 手机上移一位即到边界。
    const phoneSlot = { placement: "contact" as const, index: 0 };
    expect(keyboardHeaderMoveTarget(items, phoneSlot, "up")).toBeNull();
    const lastSlot = { placement: "contact" as const, index: 1 };
    expect(keyboardHeaderMoveTarget(items, lastSlot, "down")).toBeNull();
  });

  it("← / → 在位置组之间循环切换", () => {
    const items = makeDocument().header.items;
    const name = items[0];
    const slot = headerSlotOf(items, name)!;
    expect(keyboardHeaderMoveTarget(items, slot, "right")).toEqual({
      placement: "name_meta",
      index: 0,
    });
    // 最左再往左 = 循环到最后一个位置组（hidden）。
    expect(keyboardHeaderMoveTarget(items, slot, "left")).toEqual({
      placement: "hidden",
      index: 0,
    });
  });
});

describe("moveHeaderItem", () => {
  it("同组内换序：把 email 插到 phone 之前", () => {
    const document = makeDocument();
    const next = moveHeaderItem(document, "h4", { placement: "contact", index: 0 });
    expect(next.header.items.map((item) => item.id)).toEqual(["h1", "h2", "h4", "h3", "h5"]);
    expect(next.header.items[2].placement).toBe("contact");
  });

  it("换位置组：把 phone 移到 name_meta 组末尾", () => {
    const document = makeDocument();
    const next = moveHeaderItem(document, "h3", { placement: "name_meta", index: 9 });
    const moved = next.header.items.find((item) => item.id === "h3")!;
    expect(moved.placement).toBe("name_meta");
    // 组内顺序：gender 后紧跟 phone（数组里 h3 落在 h2 之后）。
    expect(next.header.items.map((item) => item.id)).toEqual(["h1", "h2", "h3", "h4", "h5"]);
  });

  it("组为空时追加到数组末尾", () => {
    const document = makeDocument();
    const next = moveHeaderItem(document, "h1", { placement: "subtitle", index: 0 });
    expect(next.header.items[next.header.items.length - 1].id).toBe("h1");
    expect(next.header.items[next.header.items.length - 1].placement).toBe("subtitle");
  });

  it("位置与顺序都没变时返回原引用（宿主不会多记一条历史）", () => {
    const document = makeDocument();
    expect(moveHeaderItem(document, "h3", { placement: "contact", index: 0 })).toBe(document);
    expect(moveHeaderItem(document, "nope", { placement: "contact", index: 0 })).toBe(document);
  });
});

describe("页眉字段的判定", () => {
  it("照片字段按 key 找，且只有 data URL 才算有图", () => {
    const document = makeDocument();
    expect(headerPhotoItem(document)?.id).toBe("h5");
    expect(isPhotoDataUrl(PHOTO)).toBe(true);
    expect(isPhotoDataUrl("")).toBe(false);
    expect(isPhotoDataUrl("https://example.com/a.png")).toBe(false);
  });

  it("自定义字段靠 key 前缀区分（目录里没有它）", () => {
    expect(
      isCustomHeaderItem(headerItem({ id: "h9", key: "custom_abc", placement: "contact" })),
    ).toBe(true);
    expect(isCustomHeaderItem(headerItem({ id: "h1", key: "name", placement: "name" }))).toBe(
      false,
    );
  });
});
