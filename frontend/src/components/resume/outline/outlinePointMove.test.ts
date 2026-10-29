// SPDX-License-Identifier: Apache-2.0
/**
 * 跨字段搬移的**面板侧**链路：落点解析、拖动预览、键盘会话门槛、会话 → 命令。
 *
 * 最贵的两条断言：
 * 1. 「同一条目、不同要点字段」的要点行是**合法落点**（第一条要点拖不动就是这个判定写死了）；
 * 2. 「拖动中看到的顺序」与「松手提交后的顺序」逐条相同（预览与命令同一份推导）。
 */
import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../../../types/resume";
import { ensureIds } from "../../../features/resume-document/identity";
import { applyOutlineCommand } from "../../../features/resume-outline/commands";
import {
  buildOutline,
  entriesOf,
  pointIdsOf,
  type OutlineEntry,
  type OutlineModel,
} from "../../../features/resume-outline/model";
import type { OutlineSortSession } from "../../../features/resume-outline/types";
import { classifyDropKey, dragDropCommand } from "./outlineDropTargets";
import { pointSortSession, previewModel, sortSessionCommand } from "./outlineTree";

const COURSE = "市场营销学";
const [AWARD_A, AWARD_B, AWARD_C] = ["奖学金", "竞赛一等奖", "优秀学生"];

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
    // 第一条：1 条课程 + 3 条在校成果（用户截图里的形态）。
    education: [
      education("上海大学", [COURSE], [AWARD_A, AWARD_B, AWARD_C]),
      education("复旦大学", [], [AWARD_A]),
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

function pointKey(entry: OutlineEntry, pointField: string, pointId: string): string {
  return `point:education:${entry.objectId}:${pointField}:${pointId}`;
}

function textsOf(entry: { points: readonly { text: string }[] }): string[] {
  return entry.points.map((point) => point.text);
}

describe("落点解析：同一条目可以跨要点字段，跨条目仍然拒绝", () => {
  it("课程行拖到第三条成果行 → row（扁平下标 3 由 id 现算）", () => {
    const base = content();
    const model = buildOutline(base);
    const entry = firstEntry(model);
    const courseId = pointIdsOf(entriesOf(base, "education")[0], "courses")[0];
    const awardIds = pointIdsOf(entriesOf(base, "education")[0], "achievements");
    const payload = {
      kind: "point" as const,
      field: "education" as const,
      objectId: entry.objectId,
      pointField: "courses",
      pointId: courseId,
    };
    // 扁平列表 = 课程 1 条 + 成果 3 条：第三行是扁平下标 3。
    expect(classifyDropKey(model, payload, pointKey(entry, "achievements", awardIds[2]))).toEqual({
      kind: "row",
      index: 3,
    });
    expect(classifyDropKey(model, payload, pointKey(entry, "achievements", awardIds[0]))).toEqual({
      kind: "row",
      index: 1,
    });
    // 压在自己身上 = 维持现状。
    expect(classifyDropKey(model, payload, pointKey(entry, "courses", courseId))).toEqual({
      kind: "self",
    });
  });

  it("跨条目 / 跨板块 / 个人信息一律拒绝（既有语义不放宽）", () => {
    const base = content();
    const model = buildOutline(base);
    const section = model.sections.find((item) => item.field === "education");
    if (!section) throw new Error("education section missing");
    const [first, second] = section.entries;
    const payload = {
      kind: "point" as const,
      field: "education" as const,
      objectId: first.objectId,
      pointField: "courses",
      pointId: first.points[0].pointId,
    };
    const otherId = pointIdsOf(entriesOf(base, "education")[1], "achievements")[0];
    expect(classifyDropKey(model, payload, pointKey(second, "achievements", otherId))).toEqual({
      kind: "reject",
    });
    expect(classifyDropKey(model, payload, "section:experience")).toEqual({ kind: "reject" });
    expect(classifyDropKey(model, payload, "personal")).toEqual({ kind: "reject" });
    // 同板块的其它条目行也不是要点的落点。
    expect(classifyDropKey(model, payload, `entry:education:${second.objectId}`)).toEqual({
      kind: "reject",
    });
  });
});

describe("拖动预览：跨字段搬移后仍按字段声明顺序拼回", () => {
  it("课程行移到扁平第 3 位 → 预览里它变成一条成果，课程字段变空", () => {
    const base = content();
    const model = buildOutline(base);
    const entry = firstEntry(model);
    const courseId = pointIdsOf(entriesOf(base, "education")[0], "courses")[0];
    const session: OutlineSortSession = {
      kind: "point",
      field: "education",
      objectId: entry.objectId,
      pointField: "courses",
      pointId: courseId,
      startIndex: 0,
      currentIndex: 2,
      total: entry.points.length,
    };
    const preview = previewModel(model, session);
    const previewed = firstEntry(preview);
    expect(textsOf(previewed)).toEqual([AWARD_A, AWARD_B, COURSE, AWARD_C]);
    // 搬进去的那条已经属于目标字段（纸面上就是"课程行变成项目符号"）。
    expect(previewed.points.map((point) => point.pointField)).toEqual([
      "achievements",
      "achievements",
      "achievements",
      "achievements",
    ]);
    // 组内下标重新编号（只用于展示行号）。
    expect(previewed.points.map((point) => point.index)).toEqual([0, 1, 2, 3]);
    // 预览不改真实模型。
    expect(textsOf(entry)).toEqual([COURSE, AWARD_A, AWARD_B, AWARD_C]);
  });

  it("原地（currentIndex = startIndex）预览不搬家", () => {
    const base = content();
    const model = buildOutline(base);
    const entry = firstEntry(model);
    const session: OutlineSortSession = {
      kind: "point",
      field: "education",
      objectId: entry.objectId,
      pointField: "courses",
      pointId: entry.points[0].pointId,
      startIndex: 0,
      currentIndex: 0,
      total: entry.points.length,
    };
    expect(textsOf(firstEntry(previewModel(model, session)))).toEqual([
      COURSE,
      AWARD_A,
      AWARD_B,
      AWARD_C,
    ]);
  });
});

describe("会话 → 命令：松手提交的位置 == 拖动中看到的位置", () => {
  it("跨字段 → 一条 move-point；应用到内容后的顺序与预览逐条相同", () => {
    const base = content();
    const model = buildOutline(base);
    const entry = firstEntry(model);
    const courseId = pointIdsOf(entriesOf(base, "education")[0], "courses")[0];
    const session: OutlineSortSession = {
      kind: "point",
      field: "education",
      objectId: entry.objectId,
      pointField: "courses",
      pointId: courseId,
      startIndex: 0,
      currentIndex: 2,
      total: entry.points.length,
    };
    const command = sortSessionCommand(session, entry.points);
    expect(command).toEqual({
      type: "move-point",
      field: "education",
      objectId: entry.objectId,
      fromPointField: "courses",
      toPointField: "achievements",
      pointId: courseId,
      toIndex: 2,
    });
    const applied = applyOutlineCommand(base, command);
    if (!applied.ok) throw new Error(applied.reason);
    const committed = firstEntry(buildOutline(applied.content));
    const previewed = firstEntry(previewModel(model, session));
    expect(textsOf(committed)).toEqual(textsOf(previewed));
    expect(pointIdsOf(entriesOf(applied.content, "education")[0], "courses")).toEqual([]);
  });

  it("同字段 → 仍是 reorder-point（历史与既测试口径不变）", () => {
    const base = content();
    const model = buildOutline(base);
    const entry = firstEntry(model);
    const session: OutlineSortSession = {
      kind: "point",
      field: "education",
      objectId: entry.objectId,
      pointField: "achievements",
      pointId: entry.points[3].pointId,
      startIndex: 3,
      currentIndex: 1,
      total: entry.points.length,
    };
    expect(sortSessionCommand(session, entry.points)).toEqual({
      type: "reorder-point",
      field: "education",
      objectId: entry.objectId,
      pointField: "achievements",
      pointId: entry.points[3].pointId,
      toIndex: 0,
    });
  });

  it("拖拽提交（dragDropCommand）与键盘会话走同一套判定", () => {
    const base = content();
    const model = buildOutline(base);
    const entry = firstEntry(model);
    const courseId = pointIdsOf(entriesOf(base, "education")[0], "courses")[0];
    const payload = {
      kind: "point" as const,
      field: "education" as const,
      objectId: entry.objectId,
      pointField: "courses",
      pointId: courseId,
    };
    expect(dragDropCommand(model, payload, 3)).toEqual({
      type: "move-point",
      field: "education",
      objectId: entry.objectId,
      fromPointField: "courses",
      toPointField: "achievements",
      pointId: courseId,
      toIndex: 3,
    });
    // 同字段落点仍是 reorder-point，且下标换算成组内下标。
    const awardPayload = {
      kind: "point" as const,
      field: "education" as const,
      objectId: entry.objectId,
      pointField: "achievements",
      pointId: entry.points[3].pointId,
    };
    expect(dragDropCommand(model, awardPayload, 1)).toEqual({
      type: "reorder-point",
      field: "education",
      objectId: entry.objectId,
      pointField: "achievements",
      pointId: entry.points[3].pointId,
      toIndex: 0,
    });
  });
});

describe("键盘排序门槛：条目要点总数 ≥2 就能进会话", () => {
  it("两个字段各 1 条（总数 2）→ 有会话；只有 1 条要点 → 没有会话", () => {
    const base = content();
    const model = buildOutline(base);
    const entry = firstEntry(model);
    // 上海大学：1 条课程 + 3 条成果 → 总数 4，课程行也能进会话（这就是本轮修的点）。
    expect(
      pointSortSession(model, {
        kind: "point",
        field: "education",
        objectId: entry.objectId,
        pointField: "courses",
        pointId: entry.points[0].pointId,
      }),
    ).toMatchObject({ kind: "point", startIndex: 0, total: 4 });
    // 复旦大学：只有 1 条成果 → 移动它什么都变不了，不进会话。
    const second = model.sections.find((item) => item.field === "education")?.entries[1];
    if (!second) throw new Error("second education entry missing");
    expect(second.points).toHaveLength(1);
    expect(
      pointSortSession(model, {
        kind: "point",
        field: "education",
        objectId: second.objectId,
        pointField: "achievements",
        pointId: second.points[0].pointId,
      }),
    ).toBeNull();
  });
});
