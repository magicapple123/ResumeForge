// SPDX-License-Identifier: Apache-2.0
/**
 * #27：moveItem 的 `toIndex` 语义 = **摘除后**的目标组内下标（键盘等价移动依赖它：
 * toIndex = 当前可见下标 ± 1 恰好换位）。鼠标拖放的"可见下标 → 摘除后下标"换算
 * 在调用方（EntryCard 落点计算）做，由拖拽交互测试覆盖——这里的断言钉两件事：
 * 同组换位语义 + 键盘连续下移 3 位不差一（#27 的验收口径）。
 */
import { describe, expect, it } from "vitest";
import type { ResumeDocument } from "../../types/resumeDocument";
import { moveItem, reorderItems } from "./placement";

function docWithTrail(keys: string[]): ResumeDocument {
  return {
    version: 2,
    language: "zh-CN",
    header: { items: [], contact_breaks: [] },
    sections: [
      {
        key: "experience",
        title: "",
        hidden: false,
        layout: {},
        entries: [
          {
            id: "ent1",
            hidden: false,
            layout: {},
            items: keys.map((key, index) => ({
              kind: "field" as const,
              id: `f_${key}`,
              key,
              label: "",
              value: key,
              format: "text" as const,
              placement: "trail" as const,
              sort_order: index,
            })),
          },
        ],
      },
    ],
  } as unknown as ResumeDocument;
}

function trailOrder(document: ResumeDocument): string[] {
  return (
    document.sections[0].entries[0].items.filter(
      (item) => item.kind !== "text" && item.placement === "trail",
    ) as { key: string }[]
  ).map((item) => item.key);
}

describe("moveItem #27 同组换位语义（摘除后下标）", () => {
  it("toIndex=当前下标+1：与后一项换位（键盘 ArrowDown 的等价物）", () => {
    const next = moveItem(docWithTrail(["a", "b", "c", "d"]), "experience.ent1.f_a", {
      toIndex: 1,
    });
    expect(trailOrder(next)).toEqual(["b", "a", "c", "d"]);
  });

  it("键盘连续下移 3 位不差一（#27 验收口径；1 → 2 → 3 各移一位）", () => {
    let current = docWithTrail(["a", "b", "c", "d"]);
    const path = "experience.ent1.f_a";
    // reorderItems 是键盘 ↑↓ 的入口；三次下移各前进一位
    current = reorderItems(current, path, 1);
    expect(trailOrder(current)).toEqual(["b", "a", "c", "d"]);
    current = reorderItems(current, path, 1);
    expect(trailOrder(current)).toEqual(["b", "c", "a", "d"]);
    current = reorderItems(current, path, 1);
    expect(trailOrder(current)).toEqual(["b", "c", "d", "a"]);
  });

  it("toIndex 越界 = 追加到组尾（不静默截断）", () => {
    const next = moveItem(docWithTrail(["a", "b", "c", "d"]), "experience.ent1.f_a", {
      toIndex: 99,
    });
    expect(trailOrder(next)).toEqual(["b", "c", "d", "a"]);
  });

  it("向前拖（toIndex=0）：落到组首", () => {
    const next = moveItem(docWithTrail(["a", "b", "c", "d"]), "experience.ent1.f_d", {
      toIndex: 0,
    });
    expect(trailOrder(next)).toEqual(["d", "a", "b", "c"]);
  });
});
