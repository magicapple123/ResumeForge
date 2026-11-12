// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { makeDocument } from "./documentFixtures";
import {
  entryPath,
  findEntry,
  findHeaderItem,
  findItem,
  findSection,
  headerPath,
  itemPath,
  locatePath,
  parseDocumentPath,
  sectionKeyOfPath,
  sectionPath,
} from "./paths";

describe("路径构造函数", () => {
  it("四种路径格式与计划 §5.2 一致", () => {
    expect(sectionPath("education")).toBe("education");
    expect(entryPath("education", "ob_entry001")).toBe("education.ob_entry001");
    expect(itemPath("education", "ob_entry001", "ob_item0001")).toBe(
      "education.ob_entry001.ob_item0001",
    );
    expect(headerPath("ob_head0001")).toBe("header.ob_head0001");
  });
});

describe("parseDocumentPath", () => {
  it("识别四种路径", () => {
    expect(parseDocumentPath("header.ob_head0001")).toEqual({
      kind: "header",
      itemId: "ob_head0001",
    });
    expect(parseDocumentPath("education")).toEqual({ kind: "section", sectionKey: "education" });
    expect(parseDocumentPath("education.ob_entry001")).toEqual({
      kind: "entry",
      sectionKey: "education",
      entryId: "ob_entry001",
    });
    expect(parseDocumentPath("custom:abc.ob_entry001.ob_item0001")).toEqual({
      kind: "item",
      sectionKey: "custom:abc",
      entryId: "ob_entry001",
      itemId: "ob_item0001",
    });
  });

  it("空路径 / 段数不对 / 含空段返回 null（纸面 DOM 来的值一律当外部输入）", () => {
    expect(parseDocumentPath(null)).toBeNull();
    expect(parseDocumentPath("")).toBeNull();
    expect(parseDocumentPath("a.b.c.d")).toBeNull();
    expect(parseDocumentPath("header.a.b")).toBeNull();
    expect(parseDocumentPath("a..b")).toBeNull();
  });

  it("sectionKeyOfPath：header / 空路径返回 null", () => {
    expect(sectionKeyOfPath("education.ob_entry001")).toBe("education");
    expect(sectionKeyOfPath("header.ob_head0001")).toBeNull();
    expect(sectionKeyOfPath(null)).toBeNull();
  });
});

describe("locatePath / find*", () => {
  const document = makeDocument();

  it("定位 header / section / entry / item 四层并带上下文", () => {
    const header = locatePath(document, "header.ob_head0001");
    expect(header?.kind).toBe("header");
    const sec = locatePath(document, "education");
    expect(sec?.kind).toBe("section");
    const en = locatePath(document, "education.ob_entry001");
    expect(en?.kind).toBe("entry");
    const item = locatePath(document, "education.ob_entry001.ob_item0001");
    expect(item?.kind).toBe("item");
    if (item?.kind === "item") {
      expect((item.item as { key?: string }).key).toBe("school");
      expect(item.itemIndex).toBe(0);
      expect(item.entry.id).toBe("ob_entry001");
      expect(item.section.key).toBe("education");
    }
  });

  it("路径不存在返回 null，不抛错", () => {
    expect(locatePath(document, "nope")).toBeNull();
    expect(locatePath(document, "education.nope")).toBeNull();
    expect(locatePath(document, "education.ob_entry001.nope")).toBeNull();
    expect(locatePath(document, "header.nope")).toBeNull();
    expect(locatePath(document, "bogus.path.x.y")).toBeNull();
  });

  it("findSection / findEntry / findItem / findHeaderItem 各自的收窄", () => {
    expect(findSection(document, "education")?.key).toBe("education");
    expect(findSection(document, "education.ob_entry001")?.key).toBe("education");
    expect(findSection(document, "header.ob_head0001")).toBeNull();
    expect(findEntry(document, "education.ob_entry001")?.entryIndex).toBe(0);
    expect(findEntry(document, "education")).toBeNull();
    expect(
      (
        findItem(document, "education.ob_entry001.ob_item0002")?.item as
          { key?: string } | undefined
      )?.key,
    ).toBe("major");
    expect(findItem(document, "education.ob_entry001")?.item).toBeUndefined();
    expect(findHeaderItem(document, "header.ob_head0002")?.item.key).toBe("phone");
    expect(findHeaderItem(document, "education")).toBeNull();
  });
});
