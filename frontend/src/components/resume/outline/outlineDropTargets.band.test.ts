// SPDX-License-Identifier: Apache-2.0
/**
 * **band 落点语义**的回归（2026-10-29 真机逐帧实测的 bug：条目高度不一致时换位连锁跳位）。
 *
 * 真机复现（项目经历 3 条全展开，treeitem 高 236 / 212 / 276）：
 *
 * | 帧 | 指针 y | 行矩形 |
 * |---|---|---|
 * | 初始 | 288 | w7kt20 250-278 / ore2aa 486-514 / ooa3n7 698-726 |
 * | 换位后 | 500 | ore2aa 250-278 / **缝隙 490~698（w7kt20 自己的要点区）** / ooa3n7 698-726 / 自己被拖行 462-490 |
 * | 松手 | — | ore2aa, ooa3n7, w7kt20（错，期望 ore2aa, w7kt20, ooa3n7） |
 *
 * 根因：旧实现用"中心距离最近"选目标，缝隙里必须硬猜一行（500 判给中心 712 的 ooa3n7）。
 * band 语义只认"指针真的压在某条同类行矩形里"，缝隙 = 什么都没压住 = 维持现状。
 *
 * 四条必须成立的性质：
 * 1. 行高不一致时**只移动一格且收敛**（不出现第二次切换）；
 * 2. 缝隙 keep；
 * 3. drop 与 hover 同一套 band（缝隙处提交"拖动中看到的那一版"）；
 * 4. 没有坐标（宿主降级成普通 Event）时什么都不猜。
 */
import { describe, expect, it } from "vitest";
import { buildOutline, entryKey } from "../../../features/resume-outline/model";
import type { OutlineModel } from "../../../features/resume-outline/model";
import type { OutlineSortSession } from "../../../features/resume-outline/types";
import {
  entryPayload,
  entryRows,
  entrySection,
  entrySession,
  expandedRows,
  keyOf,
  makeContent,
  makeContentWithPoints,
  previewOrder,
  ROW_HEIGHT,
  ROW_TOP,
} from "../../../test/outlineDragFixtures";
import {
  HOVER_HYSTERESIS_PX,
  bandHitRow,
  pointerOverForeignRow,
  resolveDropPoint,
  resolveHoverTarget,
  type DropRowBox,
} from "./outlineDropTargets";

/** 基准模型里第 index 个条目的 objectId（断言预览顺序用）。 */
function objectIdAt(model: OutlineModel, index: number): string {
  return entrySection(model).entries[index].objectId;
}

/** 等高质量版式里第 slot 个槽位的中心（个别用例直接按槽位摆指针）。 */
function slotCenter(slot: number): number {
  return ROW_TOP + slot * ROW_HEIGHT + ROW_HEIGHT / 2;
}

describe("band 语义：压住哪行就是哪行，不比较中心距离", () => {
  it("指针越过缓冲带进入相邻行矩形 → 立刻切换；同一位置再压一次 → keep", () => {
    const model = buildOutline(makeContent(4));
    const rows = entryRows(model, entrySession(model, 1));
    const payload = entryPayload(model, 1);

    // 越过被拖行的 ±8 缓冲带、刚进第 3 行的行矩形就切换：没有"要明显更近才换"的距离比较。
    const justInside = rows[2].top + HOVER_HYSTERESIS_PX + 1;
    expect(resolveHoverTarget(model, payload, rows, justInside, null)).toEqual({
      kind: "target",
      key: rows[2].key,
      index: 2,
    });
    // 同一位置、当前目标已经是它 → keep（目标没换就不产生状态变化）。
    expect(resolveHoverTarget(model, payload, rows, justInside, rows[2].key)).toEqual({
      kind: "keep",
    });
    // 再往下到第 4 行 → 换到下标 3。
    expect(resolveHoverTarget(model, payload, rows, rows[3].centerY, null)).toEqual({
      kind: "target",
      key: rows[3].key,
      index: 3,
    });
  });

  it("缓冲带宽度就是 +8px：边界上 keep，越过 1px 且压住下一行才切换", () => {
    const model = buildOutline(makeContent(4));
    const rows = entryRows(model, entrySession(model, 1));
    const payload = entryPayload(model, 1);
    const edge = rows[1].bottom + HOVER_HYSTERESIS_PX;
    expect(resolveHoverTarget(model, payload, rows, edge, rows[3].key)).toEqual({ kind: "keep" });
    expect(resolveHoverTarget(model, payload, rows, edge + 1, rows[3].key)).toEqual({
      kind: "target",
      key: rows[2].key,
      index: 2,
    });
  });

  it("缝隙 keep：指针落在两行之间的空白（250-278 / 486-514，指针 500）→ keep", () => {
    const model = buildOutline(makeContent(3));
    const payload = entryPayload(model, 2);
    // 真机第 2 帧的行矩形：别人 250-278、**自己被预览挪到 462-490**、最后一条 698-726。
    const rows: DropRowBox[] = [
      { key: keyOf(model, 0), top: 250, bottom: 278, centerY: 264 },
      { key: keyOf(model, 2), top: 462, bottom: 490, centerY: 476 },
      { key: keyOf(model, 1), top: 698, bottom: 726, centerY: 712 },
    ];
    // 几何自检：500 确实不在任何一条行矩形内。
    expect(rows.every((row) => 500 < row.top || 500 >= row.bottom)).toBe(true);
    // 旧实现按中心距离判给 698-726（距离 212）→ 又跳一格到末尾。现在：什么都没压住 = 不动。
    expect(resolveHoverTarget(model, payload, rows, 500, null)).toEqual({ kind: "keep" });
    expect(resolveHoverTarget(model, payload, rows, 500, keyOf(model, 0))).toEqual({
      kind: "keep",
    });
    expect(bandHitRow(model, payload, rows, 500)).toEqual({ kind: "gap" });
  });
});

describe("行高不一致：连锁跳位（真机 bug 的复现版式）", () => {
  it("从 A 行中心拖到 B 行中心：只移动一格，第 2 帧就收敛", () => {
    // 真机数据集：2 / 6 / 7 条要点 ⇒ treeitem 高 236 / 212 / 276，每条高度都不一样。
    const content = makeContentWithPoints([2, 6, 7]);
    const model = buildOutline(content);
    const section = entrySection(model);
    const [a, b, c] = section.entries;
    const payload = { kind: "entry" as const, field: "projects" as const, objectId: a.objectId };
    let session: OutlineSortSession = {
      kind: "entry",
      field: "projects",
      objectId: a.objectId,
      startIndex: 0,
      currentIndex: 0,
      total: section.entries.length,
    };

    const bRow = expandedRows(model, session, content).find(
      (row) => row.key === entryKey("projects", b.objectId),
    );
    if (!bRow) throw new Error("找不到 B 的行矩形");
    // 真机：B 的行在 486-514，指针停在中心 500。
    const pointerY = bRow.centerY;

    let activeKey: string | null = null;
    const switches: number[] = [];
    for (let frame = 0; frame < 8; frame += 1) {
      const rows = expandedRows(model, session, content);
      const resolution = resolveHoverTarget(model, payload, rows, pointerY, activeKey);
      if (resolution.kind === "keep") break;
      switches.push(resolution.index);
      session = { ...session, currentIndex: resolution.index };
      activeKey = resolution.key;
    }

    // 只允许换一次位置：换位后 A 落到 462-490，指针 500 在 A 自己的要点区（band 什么都没
    // 压住）→ keep。旧实现按中心距离判给最后一条 → 又跳一格到末尾。
    expect(switches).toEqual([1]);
    expect(previewOrder(model, session)).toEqual([b.objectId, a.objectId, c.objectId]);
  });

  it("同版式下把指针压到 C 的行上：只移动两格并收敛（不会滑到末尾之外）", () => {
    const content = makeContentWithPoints([2, 6, 7]);
    const model = buildOutline(content);
    const section = entrySection(model);
    const [a, , c] = section.entries;
    const payload = { kind: "entry" as const, field: "projects" as const, objectId: a.objectId };
    let session: OutlineSortSession = {
      kind: "entry",
      field: "projects",
      objectId: a.objectId,
      startIndex: 0,
      currentIndex: 0,
      total: section.entries.length,
    };
    const cRow = expandedRows(model, session, content).find(
      (row) => row.key === entryKey("projects", c.objectId),
    );
    if (!cRow) throw new Error("找不到 C 的行矩形");
    const pointerY = cRow.centerY;

    let activeKey: string | null = null;
    const switches: number[] = [];
    for (let frame = 0; frame < 8; frame += 1) {
      const rows = expandedRows(model, session, content);
      const resolution = resolveHoverTarget(model, payload, rows, pointerY, activeKey);
      if (resolution.kind === "keep") break;
      switches.push(resolution.index);
      session = { ...session, currentIndex: resolution.index };
      activeKey = resolution.key;
    }
    expect(switches).toEqual([2]);
    expect(previewOrder(model, session)).toEqual([objectIdAt(model, 1), c.objectId, a.objectId]);
  });

  it("指针停在自己的要点区（换位后的缝隙）时：12 帧都不再改顺序", () => {
    const content = makeContentWithPoints([2, 6, 7]);
    const model = buildOutline(content);
    const section = entrySection(model);
    const [a, b] = section.entries;
    const payload = { kind: "entry" as const, field: "projects" as const, objectId: a.objectId };
    // 已经换过一格（真机指针 288 那一帧）：预览顺序 = B, A, C。
    let session: OutlineSortSession = {
      kind: "entry",
      field: "projects",
      objectId: a.objectId,
      startIndex: 0,
      currentIndex: 1,
      total: section.entries.length,
    };
    const aRow = expandedRows(model, session, content).find(
      (row) => row.key === entryKey("projects", a.objectId),
    );
    if (!aRow) throw new Error("找不到 A 的行矩形");
    // 指针停在 A 自己的要点区中部（真机 500 = aRow.bottom + 10）。
    const pointerY = aRow.bottom + 10;

    let activeKey: string | null = keyOf(model, 1);
    for (let frame = 0; frame < 12; frame += 1) {
      const rows = expandedRows(model, session, content);
      const resolution = resolveHoverTarget(model, payload, rows, pointerY, activeKey);
      // 12 帧都必须 keep：缝隙里既不换目标，也不"顺手"滑到下一个条目。
      expect(resolution, `frame=${frame}`).toEqual({ kind: "keep" });
      if (resolution.kind !== "target") continue;
      session = { ...session, currentIndex: resolution.index };
      activeKey = resolution.key;
    }
    expect(session.currentIndex).toBe(1);
    expect(previewOrder(model, session)).toEqual([b.objectId, a.objectId, objectIdAt(model, 2)]);
  });
});

describe("resolveDropPoint：与 hover 共用 band（缝隙提交预览）", () => {
  it("压在行上 → 同一个 index；缝隙 → commit；别人的行 → reject", () => {
    const model = buildOutline(makeContent(3));
    const rows = entryRows(model, entrySession(model, 1));
    const payload = entryPayload(model, 1);

    // 压在行上：hover 与 drop 的答案必须一字不差。
    expect(resolveHoverTarget(model, payload, rows, rows[2].centerY, null)).toEqual({
      kind: "target",
      key: rows[2].key,
      index: 2,
    });
    expect(resolveDropPoint(model, payload, rows, rows[2].centerY)).toEqual({
      kind: "row",
      index: 2,
    });
    expect(bandHitRow(model, payload, rows, rows[2].centerY)).toEqual({
      kind: "row",
      key: rows[2].key,
      index: 2,
    });

    // 缝隙（所有行下方 300px）：hover = keep，drop = 提交预览（不是"最近行"）。
    const gapY = rows[2].bottom + 300;
    expect(resolveHoverTarget(model, payload, rows, gapY, null)).toEqual({ kind: "keep" });
    expect(resolveDropPoint(model, payload, rows, gapY)).toEqual({ kind: "commit" });

    // 压在别的板块的行上：drop 拒绝，hover 保持现状。
    const foreign: DropRowBox[] = [
      ...rows,
      {
        key: "entry:education:ob_edu",
        top: gapY,
        bottom: gapY + ROW_HEIGHT,
        centerY: gapY + ROW_HEIGHT / 2,
      },
    ];
    expect(resolveDropPoint(model, payload, foreign, gapY + 1)).toEqual({ kind: "reject" });
    expect(resolveHoverTarget(model, payload, foreign, gapY + 1, null)).toEqual({ kind: "keep" });
  });

  it("真机版式的缝隙里松手：hover 没换过目标，drop 提交的也是原位（commit）", () => {
    const content = makeContentWithPoints([2, 6, 7]);
    const model = buildOutline(content);
    const section = entrySection(model);
    const [a] = section.entries;
    const payload = { kind: "entry" as const, field: "projects" as const, objectId: a.objectId };
    const session: OutlineSortSession = {
      kind: "entry",
      field: "projects",
      objectId: a.objectId,
      startIndex: 0,
      currentIndex: 0,
      total: section.entries.length,
    };
    const rows = expandedRows(model, session, content);
    const pointerY = rows[1].bottom + 10; // B 的行下方 = B 自己的要点区（缝隙）
    expect(resolveHoverTarget(model, payload, rows, pointerY, null)).toEqual({ kind: "keep" });
    expect(resolveDropPoint(model, payload, rows, pointerY)).toEqual({ kind: "commit" });
  });
});

describe("没有指针坐标（宿主降级成普通 Event）时不猜落点", () => {
  it("bandHitRow → gap；pointerOverForeignRow → false；hover → keep；drop → commit", () => {
    const model = buildOutline(makeContent(3));
    const payload = entryPayload(model, 1);
    const rows = entryRows(model, entrySession(model, 1));

    // 隐患：`undefined < row.top` 恒为 false → 每一行都会"命中" → 落点被判给第一行。
    expect(bandHitRow(model, payload, rows, Number.NaN)).toEqual({ kind: "gap" });
    expect(pointerOverForeignRow(payload, rows, Number.NaN)).toBe(false);
    expect(resolveHoverTarget(model, payload, rows, Number.NaN, null)).toEqual({ kind: "keep" });
    expect(resolveDropPoint(model, payload, rows, Number.NaN)).toEqual({ kind: "commit" });
  });
});

describe("等高质量版式下逐帧拖动（回归：不许连跳）", () => {
  it("从第 1 行拖到第 3 行：逐帧只切换一次，稳定后不再变化", () => {
    const model = buildOutline(makeContent(4));
    const payload = entryPayload(model, 0);
    let session: OutlineSortSession = entrySession(model, 0);
    let activeKey: string | null = null;
    const switches: number[] = [];
    for (let frame = 0; frame < 10; frame += 1) {
      const rows = entryRows(model, session);
      const resolution = resolveHoverTarget(model, payload, rows, slotCenter(2), activeKey);
      if (resolution.kind === "keep") break;
      switches.push(resolution.index);
      session = { ...session, currentIndex: resolution.index };
      activeKey = resolution.key;
    }
    expect(switches).toEqual([2]);
    expect(previewOrder(model, session)[2]).toBe(objectIdAt(model, 0));
  });
});
