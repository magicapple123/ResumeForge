// SPDX-License-Identifier: Apache-2.0
/**
 * **原地确认 = 不动**（回归：键盘 Enter/Enter 会静默改字段）。
 *
 * 缺陷原形：焦点落在「市场营销学」（`courses`，扁平下标 0）的手柄上，Enter 开会话、**什么都不按**
 * 再 Enter 确认。旧的 `pointMoveOf` 把 `currentIndex === startIndex` 也算成一次扁平插入：
 * `remaining = [A0, A1]`、`anchor = A0` ⇒ `targetField = "achievements"`、`sameField = false`
 * ⇒ 派发 `move-point` ⇒ **这一条位置没变、字段却变成了 achievements**，纸面上「主修课程：…」
 * 整行消失，还记一步历史。更糟的是它与 `previewPoints` 的 `to === from` 短路**分叉**：
 * 预览说"什么都没改"，命令却改了字段。
 *
 * 修法在根因（`pointMoveOf`）：插入位置 == 原位置 ⇒ 同字段 + 本组内原下标 ⇒
 * `sortSessionCommand` 落回 `reorder-point` ⇒ 命令层 `to === from` ⇒ `changed: false`、无历史。
 */
import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../../../types/resume";
import { ensureIds } from "../../../features/resume-document/identity";
import { applyOutlineCommand } from "../../../features/resume-outline/commands";
import {
  buildOutline,
  entriesOf,
  entryIdOf,
  pointIdsOf,
  type OutlineEntry,
  type OutlineModel,
} from "../../../features/resume-outline/model";
import { pointMoveOf } from "../../../features/resume-outline/pointMove";
import type { OutlineSortSession } from "../../../features/resume-outline/types";
import { sortSessionCommand } from "./outlineTree";

const COURSE = "市场营销学";
const [AWARD_A, AWARD_B] = ["奖学金", "优秀学生"];

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
        courses: [COURSE],
        achievements: [AWARD_A, AWARD_B],
      },
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

/** 会话：`currentIndex` 由 case 指定（`=== startIndex` 就是"原地确认"）。 */
function sessionOf(
  entry: OutlineEntry,
  pointField: string,
  pointId: string,
  startIndex: number,
  currentIndex: number,
): OutlineSortSession {
  return {
    kind: "point",
    field: "education",
    objectId: entry.objectId,
    pointField,
    pointId,
    startIndex,
    currentIndex,
    total: entry.points.length,
  };
}

describe("pointMoveOf：插入位置 == 原位置 ⇒ 同字段 + 本组内原下标", () => {
  it("课程行（扁平 0）原地 → courses / toIndex 0 / sameField", () => {
    const base = content();
    const entry = firstEntry(buildOutline(base));
    expect(
      pointMoveOf(entry.points, {
        pointField: "courses",
        pointId: entry.points[0].pointId,
        startIndex: 0,
        currentIndex: 0,
      }),
    ).toEqual({
      fromPointField: "courses",
      toPointField: "courses",
      toIndex: 0,
      sameField: true,
    });
  });

  it("组内第二条（扁平 2）原地 → toIndex 是它在本组内的下标 1", () => {
    const base = content();
    const entry = firstEntry(buildOutline(base));
    expect(
      pointMoveOf(entry.points, {
        pointField: "achievements",
        pointId: entry.points[2].pointId,
        startIndex: 2,
        currentIndex: 2,
      }),
    ).toEqual({
      fromPointField: "achievements",
      toPointField: "achievements",
      toIndex: 1,
      sameField: true,
    });
  });

  it("最后一条被拖到越界下标（夹取回原位）也算不动", () => {
    const base = content();
    const entry = firstEntry(buildOutline(base));
    expect(
      pointMoveOf(entry.points, {
        pointField: "achievements",
        pointId: entry.points[2].pointId,
        startIndex: 2,
        currentIndex: 99,
      }),
    ).toEqual({
      fromPointField: "achievements",
      toPointField: "achievements",
      toIndex: 1,
      sameField: true,
    });
  });
});

describe("sortSessionCommand：原地确认落回 reorder-point（不是 move-point）", () => {
  it("currentIndex === startIndex → reorder-point，命令层 changed=false 且内容一字不差", () => {
    const base = content();
    const entry = firstEntry(buildOutline(base));
    const session = sessionOf(entry, "courses", entry.points[0].pointId, 0, 0);
    const command = sortSessionCommand(session, entry.points);
    expect(command).toEqual({
      type: "reorder-point",
      field: "education",
      objectId: entry.objectId,
      pointField: "courses",
      pointId: entry.points[0].pointId,
      toIndex: 0,
    });
    const applied = applyOutlineCommand(base, command);
    // 无位移 ⇒ 没有改动、不记历史；内容引用与逐字段都必须是原样。
    expect(applied).toEqual({ ok: true, content: base, changed: false });
    const raw = entriesOf(base, "education")[0];
    expect(pointIdsOf(raw, "courses")).toHaveLength(1);
    expect(pointIdsOf(raw, "achievements")).toHaveLength(2);
    expect(entryIdOf(raw)).toBe(entry.objectId);
  });

  it("中间那条原地确认同样 changed=false（不能因为「字段没变」就当成重排记一步）", () => {
    const base = content();
    const entry = firstEntry(buildOutline(base));
    const command = sortSessionCommand(
      sessionOf(entry, "achievements", entry.points[2].pointId, 2, 2),
      entry.points,
    );
    expect(command).toMatchObject({ type: "reorder-point", toIndex: 1 });
    expect(applyOutlineCommand(base, command)).toEqual({
      ok: true,
      content: base,
      changed: false,
    });
  });

  it("反向对照：currentIndex ≠ startIndex 仍然产生 move-point（短路没有杀掉正常跨字段搬移）", () => {
    const base = content();
    const entry = firstEntry(buildOutline(base));
    const command = sortSessionCommand(
      sessionOf(entry, "courses", entry.points[0].pointId, 0, 1),
      entry.points,
    );
    expect(command).toEqual({
      type: "move-point",
      field: "education",
      objectId: entry.objectId,
      fromPointField: "courses",
      toPointField: "achievements",
      pointId: entry.points[0].pointId,
      toIndex: 1,
    });
    const applied = applyOutlineCommand(base, command);
    if (!applied.ok) throw new Error(applied.reason);
    expect(applied.changed).toBe(true);
    const next = entriesOf(applied.content, "education")[0];
    expect(next.achievements).toEqual([AWARD_A, COURSE, AWARD_B]);
    expect(next.courses).toEqual([]);
  });
});
