// SPDX-License-Identifier: Apache-2.0
/**
 * 拖动**悬停身份判定**的不变量（用户反馈：拖动中被拖条目反复跳动、松手落错位置）。
 *
 * 这里不渲染组件，只钉住 `resolveHoverTarget` 与行几何相关的三条性质：
 * 1. 被拖行自己不产生目标；压的还是当前目标也不产生目标（调用方不会重复 setState）；
 * 2. 任意起始下标 × 任意指针位置的迭代都**收敛**——不会出现"改目标 → 布局变 → 又改回去"的环；
 * 3. 跨板块/跨条目的落点按几何拒绝（`pointerOverForeignRow`）。
 *
 * band 语义本身的用例（缝隙 keep、行高不一致的连锁跳位、drop 与 hover 同源）在
 * `outlineDropTargets.band.test.ts`；两边共用 `outlineDragFixtures`。
 */
import { describe, expect, it } from "vitest";
import { buildOutline } from "../../../features/resume-outline/model";
import type { OutlineSortSession } from "../../../features/resume-outline/types";
import {
  entrySection,
  entryPayload,
  entryRows,
  entrySession,
  keyOf,
  makeContent,
  previewOrder,
  rowBox,
  ROW_HEIGHT,
  ROW_TOP,
  slotCenterY,
} from "../../../test/outlineDragFixtures";
import { pointerOverForeignRow, resolveHoverTarget, type DropRowBox } from "./outlineDropTargets";
import { previewModel } from "./outlineTree";

describe("resolveHoverTarget：被拖行自己不产生目标", () => {
  it("指针压在被拖行当前预览位置上 → keep（旧实现会弹回起始下标）", () => {
    const model = buildOutline(makeContent(3));
    const session = { ...entrySession(model, 1), currentIndex: 2 };
    const rows = entryRows(model, session);
    const dragged = rows[2];
    expect(
      resolveHoverTarget(model, entryPayload(model, 1), rows, dragged.centerY, rows[1].key),
    ).toEqual({
      kind: "keep",
    });
  });

  it("指针压在目标行上 → target 是该行在基准模型里的下标", () => {
    const model = buildOutline(makeContent(3));
    const rows = entryRows(model, entrySession(model, 1));
    expect(resolveHoverTarget(model, entryPayload(model, 1), rows, rows[2].centerY, null)).toEqual({
      kind: "target",
      key: rows[2].key,
      index: 2,
    });
  });

  it("指针压的还是当前目标行 → keep（拖动中的高频 dragover 不重复 setState）", () => {
    const model = buildOutline(makeContent(4));
    const rows = entryRows(model, entrySession(model, 1));
    expect(
      resolveHoverTarget(model, entryPayload(model, 1), rows, rows[2].centerY, rows[2].key),
    ).toEqual({
      kind: "keep",
    });
  });
});

describe("resolveHoverTarget：离开被拖行后（别的行 / 空白处 / 跨板块）", () => {
  it("被拖行是最后一条时，指针压到上面的行上 → 能切换（不会被自己挡住）", () => {
    const model = buildOutline(makeContent(3));
    const rows = entryRows(model, entrySession(model, 2));
    const payload = entryPayload(model, 2);

    // 旧实现按"自己的中心离指针更近"判：拖最后一条时自己永远最近 → 拖到哪儿都不动。
    expect(resolveHoverTarget(model, payload, rows, rows[1].centerY, null)).toEqual({
      kind: "target",
      key: rows[1].key,
      index: 1,
    });
  });

  it("指针落在所有行下方的空白处 → keep（不猜落点）", () => {
    const model = buildOutline(makeContent(3));
    const rows = entryRows(model, entrySession(model, 2));
    expect(resolveHoverTarget(model, entryPayload(model, 2), rows, 900, null)).toEqual({
      kind: "keep",
    });
  });

  it("指针压在别的板块的条目行上 → keep（跨对象不猜，顺序一动不动）", () => {
    const model = buildOutline(makeContent(3));
    const payload = entryPayload(model, 1);
    const rows: DropRowBox[] = [
      { key: keyOf(model, 0), ...rowBox(0) },
      // 别的板块的条目行（真机拖动中只能靠几何识别）。
      {
        key: "entry:education:ob_edu",
        top: ROW_TOP + 200,
        bottom: ROW_TOP + 228,
        centerY: ROW_TOP + 214,
      },
    ];
    expect(resolveHoverTarget(model, payload, rows, ROW_TOP + 214, null)).toEqual({ kind: "keep" });
    expect(pointerOverForeignRow(payload, rows, ROW_TOP + 214)).toBe(true);
  });
});

describe("resolveHoverTarget：任意指针位置都不会形成来回循环", () => {
  it("从任意起始下标/指针位置出发，最多 4 步就收敛", () => {
    const model = buildOutline(makeContent(4));
    const rowsCount = entrySection(model).entries.length;
    // 覆盖"行带之外"（上方 200px / 下方 400px）：跨板块、空白处的指针位置也必须收敛，
    // 否则用户把指针移到别的板块上时预览会无限跳动。
    const lowestCenter = slotCenterY(rowsCount - 1);
    for (let startIndex = 0; startIndex < rowsCount; startIndex += 1) {
      const payload = entryPayload(model, startIndex);
      for (
        let pointerY = ROW_TOP - 200;
        pointerY <= lowestCenter + ROW_HEIGHT + 400;
        pointerY += 2
      ) {
        let session = entrySession(model, startIndex);
        let activeKey: string | null = null;
        let steps = 0;
        let converged = false;
        while (steps < 4) {
          const rows = entryRows(model, session);
          const resolution = resolveHoverTarget(model, payload, rows, pointerY, activeKey);
          if (resolution.kind === "keep") {
            converged = true;
            break;
          }
          // 幂等目标（下标就是当前下标）：调用方不 setState，等价于收敛（不会来回跳）。
          if (resolution.index === session.currentIndex) {
            converged = true;
            break;
          }
          session = { ...session, currentIndex: resolution.index };
          activeKey = resolution.key;
          steps += 1;
        }
        expect(converged, `start=${startIndex} pointerY=${pointerY}`).toBe(true);
      }
    }
  });

  it("收敛后落点是「一格」级别的：连拖 4 帧后预览顺序只变一次", () => {
    const model = buildOutline(makeContent(4));
    const payload = entryPayload(model, 0);
    let session: OutlineSortSession = entrySession(model, 0);
    let activeKey: string | null = null;
    const orders: string[] = [previewOrder(model, session).join(",")];
    for (let frame = 0; frame < 4; frame += 1) {
      const rows = entryRows(model, session);
      const resolution = resolveHoverTarget(model, payload, rows, slotCenterY(2), activeKey);
      if (resolution.kind === "keep") break;
      session = { ...session, currentIndex: resolution.index };
      activeKey = resolution.key;
      orders.push(previewOrder(model, session).join(","));
    }
    expect(orders).toHaveLength(2);
  });
});

describe("resolveHoverTarget：要点拖动同一套判定", () => {
  it("自己被拖要点不产生目标；指向同组另一条要点 → target 是它在基准分组里的下标", () => {
    const model = buildOutline(makeContent(3));
    const section = entrySection(model);
    const entry = section.entries[1];
    const [first, second] = entry.points;
    const pointKey = (pointId: string): string =>
      `point:projects:${entry.objectId}:description:${pointId}`;
    const session: OutlineSortSession = {
      kind: "point",
      field: "projects",
      objectId: entry.objectId,
      pointField: "description",
      pointId: first.pointId,
      startIndex: 0,
      currentIndex: 1,
      total: entry.points.length,
    };
    const preview = previewModel(model, session);
    const points = entrySection(preview).entries[1].points;
    const rows: DropRowBox[] = points.map((point, slot) => ({
      key: pointKey(point.pointId),
      ...rowBox(slot),
    }));
    const payload = {
      kind: "point" as const,
      field: "projects" as const,
      objectId: entry.objectId,
      pointField: "description",
      pointId: first.pointId,
    };

    // 预览把被拖要点换到第 2 个槽位：指针压在自己身上 → keep（旧实现会弹回起始下标）。
    expect(resolveHoverTarget(model, payload, rows, rows[1].centerY, null)).toEqual({
      kind: "keep",
    });
    // 指向同组另一条要点（预览里占第 1 个槽位）→ 目标是它的基准下标 1。
    expect(resolveHoverTarget(model, payload, rows, rows[0].centerY, null)).toEqual({
      kind: "target",
      key: pointKey(second.pointId),
      index: 1,
    });
  });
});

describe("pointerOverForeignRow：跨板块/跨条目的落点按几何拒绝", () => {
  it("压在别的板块的条目行上 → 拒绝；压在自己板块的行/别的板块标题/空白处 → 不算跨对象", () => {
    const model = buildOutline(makeContent(3));
    const payload = entryPayload(model, 1);
    const rows: DropRowBox[] = [
      { key: keyOf(model, 0), ...rowBox(0) },
      // 别的板块的条目行：真机上 drop 的目标永远是树容器，拿不到这个键，只能按几何判断。
      {
        key: "entry:education:ob_edu",
        top: ROW_TOP + 200,
        bottom: ROW_TOP + 228,
        centerY: ROW_TOP + 214,
      },
      // 别的板块的**标题**：不是"别人的一行"，按缝隙处理（维持现状），不拒绝。
      {
        key: "section:education",
        top: ROW_TOP + 300,
        bottom: ROW_TOP + 328,
        centerY: ROW_TOP + 314,
      },
    ];

    expect(pointerOverForeignRow(payload, rows, ROW_TOP + 214)).toBe(true);
    expect(pointerOverForeignRow(payload, rows, ROW_TOP + 14)).toBe(false);
    expect(pointerOverForeignRow(payload, rows, ROW_TOP + 314)).toBe(false);
    // 行与行之间的空白（离所有行都很远）：不算压在别人的行上。
    expect(pointerOverForeignRow(payload, rows, ROW_TOP + 120)).toBe(false);
  });

  it("要点拖动：同一条目的要点行（含另一个要点字段）不算跨对象，别的条目的要点行算", () => {
    const model = buildOutline(makeContent(3));
    const section = entrySection(model);
    const entry = section.entries[1];
    const payload = {
      kind: "point" as const,
      field: "projects" as const,
      objectId: entry.objectId,
      pointField: "description",
      pointId: entry.points[0].pointId,
    };
    const rows: DropRowBox[] = [
      {
        key: `point:projects:${entry.objectId}:description:${entry.points[1].pointId}`,
        ...rowBox(0),
      },
      { key: `point:projects:${entry.objectId}:highlights:ob_h`, ...rowBox(1) },
      { key: `point:projects:${section.entries[0].objectId}:description:ob_x`, ...rowBox(2) },
    ];
    expect(pointerOverForeignRow(payload, rows, rowBox(0).centerY)).toBe(false);
    // 同一条目的另一个要点字段（highlights）是合法落点：跨字段搬移就靠它（pointMove.ts）。
    expect(pointerOverForeignRow(payload, rows, rowBox(1).centerY)).toBe(false);
    expect(pointerOverForeignRow(payload, rows, rowBox(2).centerY)).toBe(true);
  });
});
