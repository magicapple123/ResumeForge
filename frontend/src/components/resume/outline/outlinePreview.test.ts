// SPDX-License-Identifier: Apache-2.0
/**
 * 排序结构预览（`structurePreviewContent`）的纯函数测试。
 *
 * 预览与提交必须是**同一条命令算出来的**（见 `outlinePreview.ts` 头注释），所以这里钉的
 * 是"预览内容 == applyOutlineCommand(baseContent, sortSessionCommand(session))"：顺序、
 * 身份（id / point_ids）与入参不可变三条。
 */
import { describe, expect, it } from "vitest";
import { ensureIds } from "../../../features/resume-document/identity";
import { entriesOf, entryIdOf, pointIdsOf } from "../../../features/resume-outline/model";
import type { OutlineSortSession } from "../../../features/resume-outline/types";
import type { ResumeContent } from "../../../types/resume";
import { structurePreviewContent } from "./outlinePreview";

const PROJECT_A = "项目甲";
const PROJECT_B = "项目乙";
const PROJECT_C = "项目丙";

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
    education: [],
    experience: [],
    campus_experience: [],
    projects: [
      {
        name: PROJECT_A,
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: ["甲一", "甲二"],
        highlights: [],
      },
      {
        name: PROJECT_B,
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: ["乙一"],
        highlights: [],
      },
      {
        name: PROJECT_C,
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: ["丙一"],
        highlights: [],
      },
    ],
    skills: [],
    awards: [],
  });
}

function projectIds(source: ResumeContent): string[] {
  return entriesOf(source, "projects").map((entry) => entryIdOf(entry));
}

function entrySession(
  objectId: string,
  startIndex: number,
  currentIndex: number,
): OutlineSortSession {
  return {
    kind: "entry",
    field: "projects",
    objectId,
    startIndex,
    currentIndex,
    total: 3,
  };
}

describe("structurePreviewContent", () => {
  it("没有位移（currentIndex === startIndex）时返回 null（不是空内容）", () => {
    const base = content();
    const [idB] = projectIds(base).slice(1);
    expect(structurePreviewContent(base, entrySession(idB, 1, 1))).toBeNull();
  });

  it("条目移到最后一位：顺序变化、身份跟着走，入参不可变", () => {
    const base = content();
    const ids = projectIds(base);
    const snapshot = JSON.stringify(base);
    const next = structurePreviewContent(base, entrySession(ids[1], 1, 2));
    expect(next).not.toBeNull();
    expect(entriesOf(next, "projects").map((entry) => entry.name)).toEqual([
      PROJECT_A,
      PROJECT_C,
      PROJECT_B,
    ]);
    expect(next && projectIds(next)).toEqual([ids[0], ids[2], ids[1]]);
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it("要点移动只在同一 pointField 分组内生效：文本与 point_ids 同步重排", () => {
    const base = content();
    const entry = entriesOf(base, "projects")[0];
    const pointIds = pointIdsOf(entry, "description");
    const session: OutlineSortSession = {
      kind: "point",
      field: "projects",
      objectId: entryIdOf(entry),
      pointField: "description",
      pointId: pointIds[1],
      startIndex: 1,
      currentIndex: 0,
      total: 2,
    };
    const next = structurePreviewContent(base, session);
    const nextEntry = next ? entriesOf(next, "projects")[0] : null;
    expect(nextEntry?.description).toEqual(["甲二", "甲一"]);
    expect(pointIdsOf(nextEntry, "description")).toEqual([pointIds[1], pointIds[0]]);
  });

  it("内容里找不到对象（命令会拒绝）时返回 null，不抛错", () => {
    const base = content();
    expect(structurePreviewContent(base, entrySession("ob_not_existing", 0, 1))).toBeNull();
  });

  it("没有基准内容时返回 null", () => {
    expect(structurePreviewContent(null, entrySession("ob_not_existing", 0, 1))).toBeNull();
    expect(structurePreviewContent(content(), null)).toBeNull();
  });
});
