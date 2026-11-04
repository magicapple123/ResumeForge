// SPDX-License-Identifier: Apache-2.0
/**
 * 问题 13：「落点是插入排序」的下标换算与拒绝原因（纯函数）。
 *
 * 这里锁三件事：
 * 1. `resolveDropIndex` 是 **`toIndex` 的唯一实现**——dragover（判 no-op）与 drop（真换位）
 *    都读它，两份实现一定会漂移（"线画在右边、落点却在左边"）；
 * 2. `noop` 的判据是"插完还是原下标"，不是"落在左半边"——落在自己身上两侧都是 no-op；
 * 3. 拒绝原因分四种：`invalid`（位置不允许）/ `illegalTitle` / `illegalBody` / `samePosition`。
 */
import { describe, expect, it } from "vitest";
import type { Placement, ResumeItem } from "../../types/resumeDocument";
import { dropRejectReason, resolveDropIndex } from "./drag";

function field(id: string, placement: Placement): ResumeItem {
  return { id, kind: "field", key: "school", label: "", value: id, placement } as ResumeItem;
}

function listItem(id: string, placement: Placement): ResumeItem {
  return { id, kind: "list", key: "courses", label: "", values: [id], placement } as ResumeItem;
}

function textItem(id: string): ResumeItem {
  return { id, kind: "text", text: id, style: "bullet", hidden: false } as ResumeItem;
}

describe("resolveDropIndex", () => {
  const group = ["a", "b", "c"];

  it("同组、拖拽项排在目标之前：摘掉自己后目标前移一位，插到左半边 = no-op", () => {
    // 拖 a 到 b 的左半边 = 插到 b 前面 = a 的位置没变。
    expect(resolveDropIndex(group, "a", 1, "before")).toEqual({ toIndex: 0, noop: true });
  });

  it("同组、落在右半边 = 插到目标后面，真的要动", () => {
    expect(resolveDropIndex(group, "a", 1, "after")).toEqual({ toIndex: 1, noop: false });
  });

  it("同组、拖拽项排在目标之后：摘除不影响目标下标", () => {
    // 拖 c 到 a 的右半边 = 插到 a 之后 → 摘掉 c 后组是 [a,b]，插入点 1。
    expect(resolveDropIndex(group, "c", 0, "after")).toEqual({ toIndex: 1, noop: false });
    // 拖 c 到 a 的左半边 = 插到最前。
    expect(resolveDropIndex(group, "c", 0, "before")).toEqual({ toIndex: 0, noop: false });
  });

  it("落在自己身上：左半边与右半边都是 no-op（摘掉自己后「前/后」都不存在了）", () => {
    expect(resolveDropIndex(group, "b", 1, "before")).toEqual({ toIndex: 1, noop: true });
    expect(resolveDropIndex(group, "b", 1, "after")).toEqual({ toIndex: 1, noop: true });
  });

  it("拖拽项不在目标组里（跨位置组 / 跨条目）：按纯插入处理，永不 no-op", () => {
    expect(resolveDropIndex(group, "zzz", 0, "before")).toEqual({ toIndex: 0, noop: false });
    expect(resolveDropIndex(group, "zzz", 2, "after")).toEqual({ toIndex: 3, noop: false });
  });

  it("空组：插入点 0，不抛错", () => {
    expect(resolveDropIndex([], "a", 0, "before")).toEqual({ toIndex: 0, noop: false });
  });
});

describe("dropRejectReason", () => {
  it("位置本身不允许（列表字段进标题行）→ invalid", () => {
    expect(dropRejectReason(listItem("x", "lead"), "title")).toBe("invalid");
  });

  it("跨方框且目标是标题/元信息 → illegalTitle", () => {
    // 标题字段拖到 lead（正文前的灰字区）：位置允许，但跨方框。
    expect(dropRejectReason(field("x", "title"), "lead")).toBe("illegalTitle");
  });

  it("跨方框且目标是正文块区 → illegalBody", () => {
    expect(dropRejectReason(field("x", "title"), "body")).toBe("illegalBody");
  });

  it("同方框内一律合法（是否真的换位再看 resolveDropIndex.noop）", () => {
    expect(dropRejectReason(field("x", "title"), "meta")).toBeNull();
    expect(dropRejectReason(field("x", "lead"), "trail")).toBeNull();
  });

  it("隐藏与任何方框互通（隐藏/恢复是同一件事的两半）", () => {
    expect(dropRejectReason(field("x", "body"), "hidden")).toBeNull();
    expect(dropRejectReason(field("x", "hidden"), "title")).toBeNull();
  });

  it("TextItem 不参与换位置，但落在正文组是合法的（问题 12）", () => {
    // 正文块的显示/隐藏走右键菜单，没有"拖到隐藏组"这条路（draggable 也只挂在把手上）。
    expect(dropRejectReason(textItem("t"), "title")).toBe("invalid");
    expect(dropRejectReason(textItem("t"), "hidden")).toBe("invalid");
    // 落在正文组 = 组内换序（或从隐藏区恢复），不是"换位置"。
    expect(dropRejectReason(textItem("t"), "body")).toBeNull();
  });
});
