// SPDX-License-Identifier: Apache-2.0
/**
 * **空要点字段的占位行**落点解析（F1：跨字段搬移的"单向门"）。
 *
 * 场景：`courses` 被搬空后（`courses: []`），大纲里没有课程行，`flatInsertionOf` 枚举所有
 * `(from, to)` 都推不出 `targetField = courses`——拖走就拖不回来。拖动中给这个空字段渲染一行
 * 占位行（键前缀 `point-empty:`），松在它上面 = 搬进该字段的第 0 位。
 *
 * 这个文件钉住四件事：
 * 1. 占位行只接受"同一条目的要点"，跨条目/跨板块/条目拖动一律拒绝；
 * 2. 悬停占位行**不产生位移**（`index` = 被拖要点自己的基准下标 ⇒ 预览复位）；
 * 3. drop 的几何解析与键解析给出一致的 `field` 落点；
 * 4. `dragFieldCommand` 产出恰好一条 `move-point`（`toIndex: 0`）。
 */
import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../../../types/resume";
import { ensureIds } from "../../../features/resume-document/identity";
import {
  buildOutline,
  entriesOf,
  entryIdOf,
  pointIdsOf,
  type OutlineEntry,
  type OutlineModel,
} from "../../../features/resume-outline/model";
import {
  classifyDropKey,
  parseTreeKey,
  resolveDropPoint,
  resolveHoverTarget,
  type DropRowBox,
} from "./outlineDropTargets";
import { dragFieldCommand } from "./outlineDropCommands";

const [AWARD_A, AWARD_B] = ["奖学金", "优秀学生"];

function education(school: string, courses: string[], achievements: string[]) {
  return {
    school,
    major: "市场营销",
    degree: "本科",
    gpa: "",
    start_date: "",
    end_date: "",
    courses,
    achievements,
  };
}

/** 第一条：课程被搬空（只有 2 条成果）；第二条：同板块的另一个条目（用于跨条目拒绝）。 */
function content(): ResumeContent {
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
    education: [
      education("上海大学", [], [AWARD_A, AWARD_B]),
      education("复旦大学", ["微观经济学"], [AWARD_A]),
    ],
    experience: [],
    campus_experience: [],
    projects: [],
    skills: [],
    awards: [],
  });
}

function firstEntry(model: OutlineModel): OutlineEntry {
  const section = model.sections.find((item) => item.field === "education");
  if (!section) throw new Error("education section missing");
  return section.entries[0];
}

function emptyKey(entry: OutlineEntry, pointField: string): string {
  return `point-empty:education:${entry.objectId}:${pointField}`;
}

/** 被拖要点：第一个条目的第一条成果（`courses` 为空，所以它的扁平下标 = 0）。 */
function dragPayload(entry: OutlineEntry) {
  return {
    kind: "point" as const,
    field: "education" as const,
    objectId: entry.objectId,
    pointField: "achievements",
    pointId: entry.points[0].pointId,
  };
}

describe("parseTreeKey：占位行是独立目标类型", () => {
  it("`point-empty:` 解析成 empty-point（不是 point：它没有 pointId）", () => {
    expect(parseTreeKey("point-empty:education:ob_edu:courses")).toEqual({
      kind: "empty-point",
      field: "education",
      objectId: "ob_edu",
      pointField: "courses",
    });
    expect(parseTreeKey("point-empty:education:ob_edu")).toBeNull();
  });
});

describe("classifyDropKey：只有同一条目的要点能落在占位行上", () => {
  it("同条目要点 → field 落点（带出目标字段）", () => {
    const base = content();
    const model = buildOutline(base);
    const entry = firstEntry(model);
    expect(classifyDropKey(model, dragPayload(entry), emptyKey(entry, "courses"))).toEqual({
      kind: "field",
      pointField: "courses",
    });
  });

  it("跨条目 / 跨板块 / 条目拖动 / 同字段 → 一律拒绝", () => {
    const base = content();
    const model = buildOutline(base);
    const section = model.sections.find((item) => item.field === "education");
    if (!section) throw new Error("education section missing");
    const [first, second] = section.entries;
    // 别的条目的占位行：改的是另一条经历的外形，不是"给这条排顺序"。
    expect(
      classifyDropKey(
        model,
        dragPayload(first),
        `point-empty:education:${second.objectId}:courses`,
      ),
    ).toEqual({ kind: "reject" });
    // 跨板块的占位行。
    expect(classifyDropKey(model, dragPayload(first), "point-empty:projects:ob_x:courses")).toEqual(
      { kind: "reject" },
    );
    // 条目拖动没有"搬进字段"这种语义。
    const entryPayload = {
      kind: "entry" as const,
      field: "education" as const,
      objectId: first.objectId,
    };
    expect(classifyDropKey(model, entryPayload, emptyKey(first, "courses"))).toEqual({
      kind: "reject",
    });
    // 来源字段与该占位字段相同（坏数据：该字段其实是空的）→ 拒绝。
    expect(classifyDropKey(model, dragPayload(first), emptyKey(first, "achievements"))).toEqual({
      kind: "reject",
    });
  });
});

describe("悬停占位行：不产生位移（预览复位）", () => {
  it("resolveHoverTarget 返回的 index = 被拖要点自己的基准下标", () => {
    const base = content();
    const model = buildOutline(base);
    const entry = firstEntry(model);
    const rows: DropRowBox[] = [
      // 被拖行自己和别的行都量不到（jsdom 无布局）→ 只有占位行命中。
      { key: emptyKey(entry, "courses"), top: 490, bottom: 518, centerY: 504 },
    ];
    const startIndex = entry.points.findIndex((point) => point.pointId === entry.points[0].pointId);
    expect(resolveHoverTarget(model, dragPayload(entry), rows, 500, null)).toEqual({
      kind: "target",
      key: emptyKey(entry, "courses"),
      index: startIndex,
    });
    // 已经是当前目标 → keep（不重复 setState）。
    expect(
      resolveHoverTarget(model, dragPayload(entry), rows, 500, emptyKey(entry, "courses")),
    ).toEqual({ kind: "keep" });
  });

  it("同一版式下，普通要点行给出的是该行的基准下标（两种落点不混淆）", () => {
    const base = content();
    const model = buildOutline(base);
    const entry = firstEntry(model);
    const rows: DropRowBox[] = [
      {
        key: `point:education:${entry.objectId}:achievements:${entry.points[1].pointId}`,
        top: 490,
        bottom: 518,
        centerY: 504,
      },
    ];
    expect(resolveHoverTarget(model, dragPayload(entry), rows, 500, null)).toEqual({
      kind: "target",
      key: rows[0].key,
      index: 1,
    });
  });
});

describe("resolveDropPoint：与悬停共用 band（占位行同样成立）", () => {
  it("压在占位行上 → field 落点；压在别处 → commit", () => {
    const base = content();
    const model = buildOutline(base);
    const entry = firstEntry(model);
    const rows: DropRowBox[] = [
      { key: emptyKey(entry, "courses"), top: 490, bottom: 518, centerY: 504 },
    ];
    expect(resolveDropPoint(model, dragPayload(entry), rows, 500)).toEqual({
      kind: "field",
      pointField: "courses",
    });
    expect(resolveDropPoint(model, dragPayload(entry), rows, 900)).toEqual({ kind: "commit" });
  });
});

describe("dragFieldCommand：一条 move-point，toIndex 恒为 0", () => {
  it("要点 → move-point（fromPointField 是来源字段，toPointField 是占位字段）", () => {
    const base = content();
    const model = buildOutline(base);
    const entry = firstEntry(model);
    const payload = dragPayload(entry);
    expect(dragFieldCommand(payload, "courses")).toEqual({
      type: "move-point",
      field: "education",
      objectId: entry.objectId,
      fromPointField: "achievements",
      toPointField: "courses",
      pointId: payload.pointId,
      toIndex: 0,
    });
  });

  it("条目拖动没有这种落点 → null", () => {
    const base = content();
    const model = buildOutline(base);
    const entry = firstEntry(model);
    expect(
      dragFieldCommand({ kind: "entry", field: "education", objectId: entry.objectId }, "courses"),
    ).toBeNull();
    // 引用一下，确认 fixture 的 id/要点都是真实物化的（空字段也能被占位行补上）。
    const raw = entriesOf(base, "education")[0];
    expect(pointIdsOf(raw, "courses")).toEqual([]);
    expect(entryIdOf(raw)).toBe(entry.objectId);
  });
});
