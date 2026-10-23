// SPDX-License-Identifier: Apache-2.0
/**
 * 栏目条溢出计算（`computeTabOverflow`）的纯函数用例。
 *
 * 为什么是纯函数而不是渲染用例：jsdom 没有布局引擎，`clientWidth` / `offsetLeft` 恒为 0，
 * 组件里那条"量一遍"的路径在测试里永远走"没有溢出"分支。而这一轮真正容易退化的点恰好在
 * 数学上——**滚动之后渐隐起点要跟着变**（遮罩贴在轨道盒子上、不跟内容滚）。把几何算成纯
 * 函数，就能用一组确定的输入把结论钉住，不必伪造整个布局。
 *
 * 口径（`R` = 视口内右边界 = `offsetLeft + offsetWidth - scrollLeft`）：
 * - `R > clientWidth - reserve` → 右侧没显示完，从它开始连同后面全部算"没显示出来"；
 * - `R <= 0` → 已被滚出左边，同样算"没显示出来"；
 * - 渐隐起点 = 最后一个满足 `0 < R <= limit` 的栏目的 `R`。
 */
import { describe, expect, it } from "vitest";
import { computeTabOverflow, type TabBox } from "./tabOverflow";

/** 8 个栏目，每个 60px 紧挨着排（与 `EditorTabStrip` 的布局形态一致，只是去掉了间距）。 */
const BOXES: TabBox[] = Array.from({ length: 8 }, (_unused, index) => ({
  offsetLeft: index * 60,
  offsetWidth: 60,
}));

/** 轨道 200px、按钮预留 28px → 可用 172px：前两栏（右边界 60 / 120）完整放得下。 */
const TRACK = { clientWidth: 200, scrollLeft: 0, reserve: 28 };

describe("栏目溢出计算", () => {
  it("全部放得下时不溢出、不渐隐", () => {
    const result = computeTabOverflow(BOXES, { ...TRACK, clientWidth: 600 });

    expect(result.hiddenIndexes).toEqual([]);
    // null = 不渐隐：没有溢出时加遮罩只会把最后几栏白白淡掉。
    expect(result.fadeFrom).toBeNull();
  });

  it("部分溢出时只把尾部没显示完的栏目算进下拉", () => {
    const result = computeTabOverflow(BOXES, TRACK);

    // 第 3 个（下标 2，右边界 180 > 172）开始放不下，它和它后面全部进下拉。
    expect(result.hiddenIndexes).toEqual([2, 3, 4, 5, 6, 7]);
    // 渐隐从"最后一个完整可见栏目的右边界"开始（下标 1 的右边界 = 120）。
    expect(result.fadeFrom).toBe(120);
  });

  it("横向滚动后渐隐起点按视口坐标跟随，滚出左边的栏目算进下拉", () => {
    // 往右滚 100px：下标 0（0–60）已完全滚出左边；下标 1 的视口右边界变成 20，
    // 下标 3 变成 140（仍 <= 172 可用宽度），下标 4 变成 200 开始放不下。
    const result = computeTabOverflow(BOXES, { ...TRACK, scrollLeft: 100 });

    // 视口坐标下渐隐起点从 120 变成 140（内容整体左移 100px 之后，最后一个完整可见栏目的
    // 位置变了）——这就是"滚动后必须重算"的证据。
    expect(result.fadeFrom).toBe(140);
    // 滚出左边的下标 0 也属于"没显示出来"，否则滚到最右端时下拉按钮会消失，
    // 而被滚出去的那几栏就再也没有入口。
    expect(result.hiddenIndexes).toContain(0);

    // 继续滚到最右端：右边界最靠后的几栏都露出来了，但左边一定还有栏目被切掉 →
    // 溢出依然存在（下拉按钮不许消失）。
    const atEnd = computeTabOverflow(BOXES, { ...TRACK, scrollLeft: 400 });
    expect(atEnd.hiddenIndexes.length).toBeGreaterThan(0);
    expect(atEnd.hiddenIndexes).not.toContain(7);
  });

  it("宽度量不到（首帧 / 无布局引擎）时退化成「没有溢出」", () => {
    expect(computeTabOverflow(BOXES, { ...TRACK, clientWidth: 0 })).toEqual({
      hiddenIndexes: [],
      fadeFrom: null,
    });
    expect(computeTabOverflow([], TRACK)).toEqual({ hiddenIndexes: [], fadeFrom: null });
  });

  it("一个栏目都放不下时溢出不渐隐（遮罩从 0 开始会把整条擦掉）", () => {
    const tiny = computeTabOverflow(BOXES, { ...TRACK, clientWidth: 40 });

    expect(tiny.hiddenIndexes).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(tiny.fadeFrom).toBeNull();
  });
});
