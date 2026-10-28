// SPDX-License-Identifier: Apache-2.0
/**
 * 拖动悬停判定的**不变量**（用户反馈：拖动中被拖条目反复跳动、松手落错位置）。
 *
 * 这里不渲染组件，只钉住 `resolveHoverTarget` 的三条性质：
 * 1. 被拖行自己不产生目标（旧实现把它映射回起始下标，构成 2 次循环）；
 * 2. 目标没换 / 只近了一点点（滞回带内）时不返回 target，调用方不会重复 setState；
 * 3. 任意起始下标 × 任意指针位置的迭代都**收敛**——不会出现"改目标 → 布局变 → 又改回去"的环。
 */
import { describe, expect, it } from "vitest";
import { ensureIds } from "../../../features/resume-document/identity";
import { buildOutline, entryKey } from "../../../features/resume-outline/model";
import type { OutlineSortSession } from "../../../features/resume-outline/types";
import type { ResumeContent } from "../../../types/resume";
import { HOVER_HYSTERESIS_PX, resolveHoverTarget, type DropRowBox } from "./outlineDropTargets";
import { previewModel } from "./outlineTree";

const ROW_HEIGHT = 28;
const ROW_TOP = 500;

function slotCenterY(slot: number): number {
  return ROW_TOP + slot * ROW_HEIGHT + ROW_HEIGHT / 2;
}

function makeContent(projectCount: number): ResumeContent {
  return ensureIds({
    photo: "",
    name: "张三",
    gender: "",
    birth_year: "",
    phone: "",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "",
    summary: "",
    education: [],
    experience: [],
    campus_experience: [],
    projects: Array.from({ length: projectCount }, (_, index) => ({
      name: `项目${index + 1}`,
      role: "",
      start_date: "",
      end_date: "",
      tech_stack: [],
      description: [`要点${index + 1}-1`, `要点${index + 1}-2`],
      highlights: [],
    })),
    skills: [],
    awards: [],
  });
}

function entrySection(model: ReturnType<typeof buildOutline>) {
  const section = model.sections.find((item) => item.field === "projects");
  if (!section) throw new Error("projects section missing");
  return section;
}

function entrySession(
  model: ReturnType<typeof buildOutline>,
  startIndex: number,
): OutlineSortSession {
  const section = entrySection(model);
  return {
    kind: "entry",
    field: "projects",
    objectId: section.entries[startIndex].objectId,
    startIndex,
    currentIndex: startIndex,
    total: section.entries.length,
  };
}

function entryPayload(model: ReturnType<typeof buildOutline>, index: number) {
  return {
    kind: "entry" as const,
    field: "projects" as const,
    objectId: entrySection(model).entries[index].objectId,
  };
}

/** 按排序会话的预览顺序量出各行在视口里的中心（模拟 CSS order 换位后的布局）。 */
function entryRows(
  model: ReturnType<typeof buildOutline>,
  session: OutlineSortSession,
): DropRowBox[] {
  const preview = previewModel(model, session);
  return entrySection(preview).entries.map((entry, slot) => ({
    key: entryKey("projects", entry.objectId),
    centerY: slotCenterY(slot),
  }));
}

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

  it("最近行仍是当前目标 → keep（拖动中的高频 dragover 不重复 setState）", () => {
    const model = buildOutline(makeContent(4));
    const rows = entryRows(model, entrySession(model, 1));
    expect(
      resolveHoverTarget(model, entryPayload(model, 1), rows, rows[2].centerY, rows[2].key),
    ).toEqual({
      kind: "keep",
    });
  });
});

describe("resolveHoverTarget：切换目标要越过滞回带", () => {
  it("新行只近了几像素 → keep；明显更近 → target", () => {
    const model = buildOutline(makeContent(4));
    const rows = entryRows(model, entrySession(model, 1));
    const payload = entryPayload(model, 1);
    const activeKey = rows[2].key; // 当前目标：第 3 条（下标 2），槽位中心 = rows[2]
    const target = rows[3]; // 第 4 条（下标 3）

    // 指针在两条行之间、靠近当前目标：新行只近 4px < 滞回带 → 不换目标。
    const nearCurrentY = target.centerY - (ROW_HEIGHT / 2 - 2);
    expect(resolveHoverTarget(model, payload, rows, nearCurrentY, activeKey).kind).toBe("keep");
    // 继续朝新行移动，超过滞回带（新行近 8px 以上）→ 换目标。
    const clearlyCloserY = target.centerY - 2;
    expect(resolveHoverTarget(model, payload, rows, clearlyCloserY, activeKey)).toEqual({
      kind: "target",
      key: target.key,
      index: 3,
    });
    expect(HOVER_HYSTERESIS_PX).toBeGreaterThanOrEqual(4);
  });
});

describe("resolveHoverTarget：任意指针位置都不会形成来回循环", () => {
  it("从任意起始下标/指针位置出发，最多 4 步就收敛到 keep", () => {
    const model = buildOutline(makeContent(4));
    const rowsCount = entrySection(model).entries.length;
    for (let startIndex = 0; startIndex < rowsCount; startIndex += 1) {
      const payload = entryPayload(model, startIndex);
      for (let pointerY = ROW_TOP; pointerY <= ROW_TOP + rowsCount * ROW_HEIGHT; pointerY += 2) {
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
          // target 必须代表"换一个位置"，否则调用方会在原地打转。
          expect(resolution.index).not.toBe(session.currentIndex);
          session = { ...session, currentIndex: resolution.index };
          activeKey = resolution.key;
          steps += 1;
        }
        expect(converged, `start=${startIndex} pointerY=${pointerY}`).toBe(true);
      }
    }
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
      centerY: slotCenterY(slot),
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
