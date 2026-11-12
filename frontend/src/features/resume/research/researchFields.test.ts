// SPDX-License-Identifier: Apache-2.0
/**
 * 科研字段数据层（W14）：空条目形状、状态映射、防御性归一化、数组移动。
 *
 * 重点在**宽容读取**：旧记录没有三类栏目、被外部工具改坏过、状态是未知字符串，
 * 这些都不能让编辑器崩掉，也不能把脏值原样写回去（未知状态落 other）。
 */
import { describe, expect, it } from "vitest";
import {
  PATENT_STATUSES,
  PUBLICATION_STATUSES,
  emptyAuthor,
  emptyPatent,
  emptyPublication,
  emptyResearchProject,
  hasResearchContent,
  moveListItem,
  normalizeAuthors,
  normalizePatent,
  normalizePublication,
  normalizeResearchProject,
  patentStatusKey,
  publicationStatusKey,
} from "./researchFields";

describe("空条目工厂", () => {
  it("论文空值：作者为空数组、状态为 other（不预设已发表）", () => {
    const item = emptyPublication();
    expect(item.authors).toEqual([]);
    expect(item.status).toBe("other");
    expect(item.title).toBe("");
    expect(item.doi).toBe("");
  });

  it("专利空值：发明人为空数组、状态为 other", () => {
    const item = emptyPatent();
    expect(item.inventors).toEqual([]);
    expect(item.status).toBe("other");
  });

  it("科研项目空值：两个要点数组为空", () => {
    const item = emptyResearchProject();
    expect(item.description).toEqual([]);
    expect(item.outcomes).toEqual([]);
  });

  it("作者空值：本人与通讯都未勾选", () => {
    expect(emptyAuthor()).toEqual({ name: "", is_self: false, corresponding: false });
  });
});

describe("状态枚举与文案 key", () => {
  it("论文状态覆盖六个值且不包含未知值", () => {
    expect([...PUBLICATION_STATUSES]).toEqual([
      "published",
      "accepted",
      "in_press",
      "under_review",
      "preprint",
      "other",
    ]);
  });

  it("在投与已发表是两个不同的 key（不得混用）", () => {
    expect(publicationStatusKey("under_review")).toBe("research.status.under_review");
    expect(publicationStatusKey("published")).toBe("research.status.published");
    expect(publicationStatusKey("under_review")).not.toBe(publicationStatusKey("published"));
  });

  it("专利四个已完成/进行中状态各有 key，未知值落 other", () => {
    expect([...PATENT_STATUSES]).toEqual(["granted", "pending", "filed", "expired", "other"]);
    for (const status of PATENT_STATUSES) {
      expect(patentStatusKey(status)).toContain("research.patentStatus.");
    }
    expect(patentStatusKey("other")).toBe("research.patentStatus.other");
  });
});

describe("归一化（旧记录 / 脏数据）", () => {
  it("缺字段的论文补默认值，未知状态落 other", () => {
    const item = normalizePublication({ title: "T", status: "published_v2" });
    expect(item.title).toBe("T");
    expect(item.status).toBe("other");
    expect(item.authors).toEqual([]);
    expect(item.venue).toBe("");
  });

  it("非对象输入返回空值而不是抛异常", () => {
    expect(normalizePublication(null).title).toBe("");
    expect(normalizePatent("oops").inventors).toEqual([]);
    expect(normalizeResearchProject(42).description).toEqual([]);
  });

  it("作者数组丢弃非对象元素，布尔字段缺省 false", () => {
    expect(normalizeAuthors([{ name: "A" }, null, "x", { name: "B", is_self: true }])).toEqual([
      { name: "A", is_self: false, corresponding: false },
      { name: "B", is_self: true, corresponding: false },
    ]);
    expect(normalizeAuthors(undefined)).toEqual([]);
  });

  it("科研项目的要点数组只保留字符串", () => {
    const item = normalizeResearchProject({ description: ["a", 1, null, "b"] });
    expect(item.description).toEqual(["a", "b"]);
  });
});

describe("moveListItem", () => {
  it("上移/下移交换相邻两项", () => {
    expect(moveListItem(["a", "b", "c"], 1, 0)).toEqual(["b", "a", "c"]);
    expect(moveListItem(["a", "b", "c"], 1, 2)).toEqual(["a", "c", "b"]);
  });

  it("越界或原地返回原顺序的新数组（不修改入参）", () => {
    const source = ["a", "b"];
    expect(moveListItem(source, 0, 0)).toEqual(source);
    expect(moveListItem(source, -1, 0)).toEqual(source);
    expect(moveListItem(source, 2, 0)).toEqual(source);
    expect(source).toEqual(["a", "b"]);
  });
});

describe("hasResearchContent", () => {
  it("任一栏目有内容即为真", () => {
    expect(hasResearchContent(null)).toBe(false);
    expect(hasResearchContent({})).toBe(false);
    expect(hasResearchContent({ publications: [] })).toBe(false);
    expect(hasResearchContent({ patents: [{}] })).toBe(true);
  });
});
