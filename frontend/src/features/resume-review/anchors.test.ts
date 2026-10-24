// SPDX-License-Identifier: Apache-2.0
/**
 * 批注定位测试（契约 §4.4 第 7 步：object_id 优先，path 只是兼容锚点，**绝不按下标回退**）。
 *
 * 断言方式刻意选"排序后再解析"：id 锚定的批注必须指向**原对象**的新下标；如果实现里
 * 偷用了下标，这里会指到隔壁条目。
 */
import { describe, expect, it } from "vitest";
import { ensureIds } from "../resume-document/identity";
import { applyOutlineCommand } from "../resume-outline/commands";
import { entriesOf, entryIdOf, pointIdsOf } from "../resume-outline/model";
import type { ResumeContent } from "../../types/resume";
import { resolveAnnotationAnchor } from "./anchors";
import type { ReviewPackAnnotation } from "./types";

const PROJECT_A = "项目甲";
const PROJECT_B = "项目乙";

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
        description: ["甲一"],
        highlights: [],
      },
      {
        name: PROJECT_B,
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: ["乙一", "乙二"],
        highlights: [],
      },
    ],
    skills: [],
    awards: [],
  });
}

const ready = content();
const projectB = entriesOf(ready, "projects")[1];
const projectBId = entryIdOf(projectB);
const pointB1 = pointIdsOf(projectB, "description")[0];
const pointB2 = pointIdsOf(projectB, "description")[1];

function anchor(partial: Partial<ReviewPackAnnotation>): ReviewPackAnnotation {
  return { external_id: "ext-1", text: "批注", ...partial };
}

describe("resolveAnnotationAnchor", () => {
  it("条目级 object_id → 条目路径与主体名", () => {
    expect(resolveAnnotationAnchor(ready, anchor({ object_id: projectBId }))).toEqual({
      path: "projects.1",
      objectLabel: PROJECT_B,
      pointText: null,
      via: "object-id",
    });
  });

  it("要点级 object_id + point_id → 精确要点路径与原文", () => {
    expect(
      resolveAnnotationAnchor(ready, anchor({ object_id: projectBId, point_id: pointB2 })),
    ).toEqual({
      path: "projects.1.description.1",
      objectLabel: PROJECT_B,
      pointText: "乙二",
      via: "object-id",
    });
  });

  it("排序后仍指向原对象：路径现算成新下标，而不是旧下标", () => {
    const result = applyOutlineCommand(ready, {
      type: "reorder-entry",
      field: "projects",
      objectId: projectBId,
      toIndex: 0,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(
      resolveAnnotationAnchor(result.content, anchor({ object_id: projectBId, point_id: pointB1 })),
    ).toMatchObject({
      path: "projects.0.description.0",
      objectLabel: PROJECT_B,
      pointText: "乙一",
    });
  });

  it("object_id 落空时回退兼容锚点 path（旧包/无 id）", () => {
    expect(
      resolveAnnotationAnchor(
        ready,
        anchor({ object_id: "ob_000000000000", path: "projects.0.name" }),
      ),
    ).toEqual({
      path: "projects.0.name",
      objectLabel: PROJECT_A,
      pointText: null,
      via: "path",
    });
  });

  it("object_id 与 path 都不命中 → 不定位（不给同下标对象背书）", () => {
    expect(
      resolveAnnotationAnchor(
        ready,
        anchor({ object_id: "ob_000000000000", path: "projects.9.name" }),
      ),
    ).toEqual({ path: null, objectLabel: null, pointText: null, via: "none" });
    expect(resolveAnnotationAnchor(ready, anchor({ path: "nowhere" }))).toEqual({
      path: null,
      objectLabel: null,
      pointText: null,
      via: "none",
    });
  });

  it("对象在但要点已不在 → 不给要点定位（不退回同位置的另一条要点）", () => {
    expect(
      resolveAnnotationAnchor(
        ready,
        anchor({ object_id: projectBId, point_id: "ob_000000000000" }),
      ),
    ).toEqual({
      path: null,
      objectLabel: PROJECT_B,
      pointText: null,
      via: "object-id",
    });
  });

  it("内容还没加载时返回空定位", () => {
    expect(resolveAnnotationAnchor(null, anchor({ object_id: projectBId }))).toEqual({
      path: null,
      objectLabel: null,
      pointText: null,
      via: "none",
    });
  });
});
