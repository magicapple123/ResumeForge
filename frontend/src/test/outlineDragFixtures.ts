// SPDX-License-Identifier: Apache-2.0
/**
 * 拖动落点判定的**测试夹具**：纯数据 + 纯几何，不碰 DOM、不碰 jest。
 *
 * 为什么单列文件：`outlineDropTargets` 的用例分两组（等高质量版 / 真机行高不一致版式），
 * 各自 200+ 行起，夹具再塞进去就顶到 500 行预算。而"真机实测数字"（236 / 212 / 276、
 * 条目行 28px、指针 500 落在缝隙里）必须只有**一处**定义，否则两组用例会各抄一份、
 * 迟早抄歪——真机版式就是这轮 bug 的复现依据。
 *
 * 放在 `src/test/` 下（与 `trackerPageHarness.tsx` / `resumeFixtures.ts` 同一口径）：
 * 它是**测试夹具**而非产品代码，不该进 i18n 棘轮与产品文案扫描的统计口径（夹具里的中文
 * 是"真机长什么样"的复现数据，不是界面文案），也不该被 vitest 当用例收集。
 */
import type { DropRowBox } from "../components/resume/outline/outlineDropTargets";
import { pointTreeKey, previewModel } from "../components/resume/outline/outlineTree";
import { ensureIds } from "../features/resume-document/identity";
import { entriesOf, entryIdOf, entryKey } from "../features/resume-outline/model";
import type { OutlineModel } from "../features/resume-outline/model";
import type { OutlineSortSession } from "../features/resume-outline/types";
import type { ResumeContent } from "../types/resume";

/** 条目行高（与 outline.css 一致）。 */
export const ROW_HEIGHT = 28;
/** 等高质量版式的第一行顶部。 */
export const ROW_TOP = 500;

/** 等高质量版式里第 slot 个槽位的行中心。 */
export function slotCenterY(slot: number): number {
  return ROW_TOP + slot * ROW_HEIGHT + ROW_HEIGHT / 2;
}

/** 等高质量版式里第 slot 个槽位的行矩形。 */
export function rowBox(slot: number): Omit<DropRowBox, "key"> {
  const top = ROW_TOP + slot * ROW_HEIGHT;
  return { top, bottom: top + ROW_HEIGHT, centerY: slotCenterY(slot) };
}

/** 每个条目固定 2 条要点（等高质量版式：行高无关的用例都用它）。 */
export function makeContent(projectCount: number): ResumeContent {
  return makeContentWithPoints(Array.from({ length: projectCount }, () => 2));
}

/** 条目内容：`points[i]` = 第 i 个项目有几条要点（要点越多，展开态那一整段越高）。 */
export function makeContentWithPoints(points: readonly number[]): ResumeContent {
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
    projects: points.map((count, index) => ({
      name: `项目${index + 1}`,
      role: "",
      start_date: "",
      end_date: "",
      tech_stack: [],
      description: Array.from(
        { length: count },
        (_, pointIndex) => `要点${index + 1}-${pointIndex + 1}`,
      ),
      highlights: [],
    })),
    skills: [],
    awards: [],
  });
}

export function entrySection(model: OutlineModel) {
  const section = model.sections.find((item) => item.field === "projects");
  if (!section) throw new Error("projects section missing");
  return section;
}

/** 第 startIndex 个条目刚被拿起时的排序会话（currentIndex = startIndex）。 */
export function entrySession(model: OutlineModel, startIndex: number): OutlineSortSession {
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

/** 拖拽载荷：第 index 个条目。 */
export function entryPayload(model: OutlineModel, index: number) {
  return {
    kind: "entry" as const,
    field: "projects" as const,
    objectId: entrySection(model).entries[index].objectId,
  };
}

/** 条目行在基准模型里的键。 */
export function keyOf(model: OutlineModel, index: number): string {
  return entryKey("projects", entrySection(model).entries[index].objectId);
}

/** 按排序会话的**预览顺序**量出各条目行的行矩形（模拟 CSS order 换位后的等高质量布局）。 */
export function entryRows(model: OutlineModel, session: OutlineSortSession): DropRowBox[] {
  const preview = previewModel(model, session);
  return entrySection(preview).entries.map((entry, slot) => ({
    key: entryKey("projects", entry.objectId),
    ...rowBox(slot),
  }));
}

// ── 真机版式：条目高度 = 条目行 + 它自己的要点子树（2026-10-29 实测） ──────────
/** 真机第一行的顶部（1680x1000，项目经历 3 条全展开）。 */
export const EXPANDED_TOP = 250;
/** 真机实测的条目总高（treeitem 高 = 条目行 + 展开的要点子树）。 */
export const REAL_ENTRY_TOTALS = [236, 212, 276];

/**
 * 把"预览顺序 + 每个条目的总高"铺成行矩形：条目行 28px，它自己的要点行按剩余高度均分。
 *
 * 由此得到的几何与真机一致：**条目行之间隔着它自己的要点行**（2 / 6 / 7 条要点 ⇒
 * 236 / 212 / 276），换位后整段移动的距离 ≠ 指针移动的距离，指针很容易停进两行之间的空白。
 */
export function expandedRows(
  model: OutlineModel,
  session: OutlineSortSession,
  content: ResumeContent,
): DropRowBox[] {
  const preview = previewModel(model, session);
  const section = entrySection(preview);
  const totals = new Map<string, number>();
  entriesOf(content, "projects").forEach((entry, index) => {
    totals.set(entryIdOf(entry), REAL_ENTRY_TOTALS[index] ?? REAL_ENTRY_TOTALS[0]);
  });
  const boxes: DropRowBox[] = [];
  let y = EXPANDED_TOP;
  for (const entry of section.entries) {
    boxes.push({
      key: entryKey("projects", entry.objectId),
      top: y,
      bottom: y + ROW_HEIGHT,
      centerY: y + ROW_HEIGHT / 2,
    });
    y += ROW_HEIGHT;
    const pointsHeight = Math.max(
      0,
      (totals.get(entry.objectId) ?? REAL_ENTRY_TOTALS[0]) - ROW_HEIGHT,
    );
    const count = entry.points.length;
    for (let index = 0; index < count; index += 1) {
      const point = entry.points[index];
      const height =
        Math.floor(pointsHeight / count) + (index === count - 1 ? pointsHeight % count : 0);
      boxes.push({
        key: pointTreeKey("projects", entry.objectId, point.pointField, point.pointId),
        top: y,
        bottom: y + height,
        centerY: y + height / 2,
      });
      y += height;
    }
  }
  return boxes;
}

/** 便捷出口：条目在预览顺序里的 objectId 序列（断言"只移动一格"用）。 */
export function previewOrder(model: OutlineModel, session: OutlineSortSession): string[] {
  return entrySection(previewModel(model, session)).entries.map((entry) => entry.objectId);
}
