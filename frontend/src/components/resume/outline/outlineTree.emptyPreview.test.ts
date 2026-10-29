// SPDX-License-Identifier: Apache-2.0
/**
 * 预览的**无位移**性质（F1 的复位依赖它）。
 *
 * 拖动中悬停到"空要点字段的占位行"时，`useOutlineSort` 通过把 `currentIndex` 设回
 * `startIndex` 来**复位**预览。因此 `previewModel(currentIndex === startIndex)` 必须返回
 * **原顺序、原字段**——而 `flatInsertionOf(points, from, from)` 会把被搬项改成"剩余列表第
 * from 条"所属的字段（通常是另一个字段），于是不短路就会得到"位置没变、字段标签却变了"的
 * 假预览：用户看到"课程行变成了成果行"，松手才变回去。
 */
import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../../../types/resume";
import { ensureIds } from "../../../features/resume-document/identity";
import {
  buildOutline,
  entryIdOf,
  entriesOf,
  pointIdsOf,
  type OutlineEntry,
  type OutlineModel,
} from "../../../features/resume-outline/model";
import type { OutlineSortSession } from "../../../features/resume-outline/types";
import { pointTreeKey, previewModel } from "./outlineTree";

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
      {
        school: "上海大学",
        major: "市场营销",
        degree: "本科",
        gpa: "",
        start_date: "",
        end_date: "",
        // 课程在前、成果在后：位移 0 时 anchor 就是成果那一条，最容易暴露"假换字段"。
        courses: ["市场营销学"],
        achievements: ["奖学金", "优秀学生"],
      },
    ],
    experience: [],
    campus_experience: [],
    projects: [],
    skills: [],
    awards: [],
  });
}

function educationEntry(model: OutlineModel): OutlineEntry {
  const section = model.sections.find((item) => item.field === "education");
  if (!section) throw new Error("education section missing");
  return section.entries[0];
}

function previewPointsOf(base: ResumeContent, session: OutlineSortSession) {
  const model = buildOutline(base);
  return educationEntry(previewModel(model, session)).points;
}

describe("previewModel：currentIndex === startIndex 时原样返回（复位用）", () => {
  it("课程行不换字段、顺序与 index 全不变（长路短路，不经过 flatInsertionOf）", () => {
    const base = content();
    const raw = entriesOf(base, "education")[0];
    const courseId = pointIdsOf(raw, "courses")[0];
    const session: OutlineSortSession = {
      kind: "point",
      field: "education",
      objectId: entryIdOf(raw),
      pointField: "courses",
      pointId: courseId,
      startIndex: 0,
      currentIndex: 0,
      total: 3,
    };
    const points = previewPointsOf(base, session);
    expect(points.map((point) => point.text)).toEqual(["市场营销学", "奖学金", "优秀学生"]);
    // 关键断言：位移为 0 时**不能**把课程行改写成一个"成果行"。
    expect(points.map((point) => point.pointField)).toEqual([
      "courses",
      "achievements",
      "achievements",
    ]);
    expect(points.map((point) => point.index)).toEqual([0, 0, 1]);
    expect(points.map((point) => point.pointId)).toEqual([
      courseId,
      ...pointIdsOf(raw, "achievements"),
    ]);
  });

  it("位移不为 0 时仍然按扁平搬移生效（短路只作用在 to === from 上）", () => {
    const base = content();
    const raw = entriesOf(base, "education")[0];
    const session: OutlineSortSession = {
      kind: "point",
      field: "education",
      objectId: entryIdOf(raw),
      pointField: "courses",
      pointId: pointIdsOf(raw, "courses")[0],
      startIndex: 0,
      currentIndex: 2,
      total: 3,
    };
    const points = previewPointsOf(base, session);
    // 移到扁平第 2 位 = 移到剩余列表的末尾（课程行变成最后一条成果）。
    expect(points.map((point) => point.text)).toEqual(["奖学金", "优秀学生", "市场营销学"]);
    expect(points.map((point) => point.pointField)).toEqual([
      "achievements",
      "achievements",
      "achievements",
    ]);
    // 树键仍按 point id（拖动中行不会错位）。
    expect(pointTreeKey("education", entryIdOf(raw), "courses", points[2].pointId)).toContain(
      "point:education:",
    );
  });
});
