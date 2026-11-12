// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台选中态的唯一出口（R-14 / 任务 8）。
 *
 * 判定表（清单 §2 任务 8「行为规则」）：
 * | 来源 | 纸面是否滚 |
 * | 结构树 / 条目排版面板 / 中栏编辑器 | 是 |
 * | 直接在纸面上点 | 否 |
 *
 * `canvasReveal` 是右栏定位的**唯一**计数器：结构树以前自己在 `useStructurePanel` 里另存了一份
 * reveal，两路 smooth 滚动会互相覆盖（先发起的那一路被后一帧顶掉），表现得像"没定位"。
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useWorkbenchSelectionSync } from "./useWorkbenchSelectionSync";

describe("useWorkbenchSelectionSync · 纸面定位来源", () => {
  it("结构树 / 编辑器选中递增 canvasReveal，纸面点击不递增", () => {
    const { result } = renderHook(() => useWorkbenchSelectionSync("7|open"));
    expect(result.current.canvasReveal).toBeNull();

    act(() => result.current.selectPath("education.e1.school", "structure"));
    expect(result.current.canvasReveal).toEqual({ path: "education.e1.school", nonce: 1 });

    act(() => result.current.selectPath("education.e1.major", "editor"));
    expect(result.current.canvasReveal).toEqual({ path: "education.e1.major", nonce: 2 });

    // 纸面点击：高亮要换，但纸面不许再滚一次（用户点的东西本来就在眼前）。
    act(() => result.current.pickFromPaper("education.e1.year"));
    expect(result.current.selectedPath).toBe("education.e1.year");
    // 令牌作废（不是"换成新路径、nonce 不变"）——后者会让消费方 effect 因为
    // `revealPath` 变了而重跑，把纸面滚到刚点的字段上（第二轮返工缺陷 D1）。
    expect(result.current.canvasReveal).toBeNull();
  });

  it("令牌只在指向当前选中时有效；纸面点击后重新由结构树选中才续生", () => {
    const { result } = renderHook(() => useWorkbenchSelectionSync("7|open"));

    act(() => result.current.selectPath("education.e1.school", "structure"));
    expect(result.current.canvasReveal).toEqual({ path: "education.e1.school", nonce: 1 });

    act(() => result.current.pickFromPaper("education.e1.year"));
    expect(result.current.canvasReveal).toBeNull();

    // 纸面点在"上一次 reveal 的同一路径"上：令牌原样保留。这不是缺陷来源——
    // 令牌的 `path`/`nonce` 一个都没变，消费方 effect 的 deps 不变、不会重跑；
    // 而选中仍然是 A，`iframe` 重载重放定位指回 A 也依然正确。
    act(() => result.current.pickFromPaper("education.e1.school"));
    expect(result.current.canvasReveal).toEqual({ path: "education.e1.school", nonce: 1 });

    // 结构树再选中：令牌续生且 nonce 只增不减（同路径再点也要重新定位）。
    act(() => result.current.selectPath("education.e1.school", "structure"));
    expect(result.current.canvasReveal).toEqual({ path: "education.e1.school", nonce: 2 });

    // 显式传 "paper" 的选中同样不写令牌。
    act(() => result.current.selectPath("education.e1.major", "paper"));
    expect(result.current.selectedPath).toBe("education.e1.major");
    expect(result.current.canvasReveal).toBeNull();
  });

  it("中栏定位序号对任何来源都递增（同路径连点也要重新定位）", () => {
    const { result } = renderHook(() => useWorkbenchSelectionSync("7|open"));

    act(() => result.current.selectPath("education.e1.school", "structure"));
    const first = result.current.editorReveal?.nonce;
    act(() => result.current.pickFromPaper("education.e1.school"));
    const second = result.current.editorReveal?.nonce;

    expect(first).toBe(1);
    expect(second).toBe(2);
  });
});
