// SPDX-License-Identifier: Apache-2.0
/**
 * 路径重映射测试 —— W06 验收里最容易漏、后果最重的一条：
 * **把第二个项目移到第一位后，加粗 / 来源 / 局部排版 / 批注都随原对象移动**。
 *
 * 这里用"路径键控的 overlay"当一个与真实加粗完全同型的测试桩（真实实现是
 * `features/resume/useRichTextOverrides.ts` 的 `path → {raw, base}`），再用
 * `FactAnnotation` 同型的 `{path, object_id, point_id}` 验证来源标注。断言方式刻意选
 * **"用映射后的键去新内容里取值，得到的必须是原对象的内容"**，而不是只比较映射表本身——
 * 后者写错了也能自洽。
 */
import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../../types/resume";
import { ensureIds } from "../resume-document/identity";
import { applyOutlineCommand } from "./commands";
import { entriesOf, entryIdOf, pointIdsOf } from "./model";
import { buildPathRemap, remapAnnotationPaths, remapPathMap, type PathRemap } from "./paths";

function content(): ResumeContent {
  return {
    photo: "",
    name: "张三",
    gender: "",
    birth_year: "",
    phone: "13800000000",
    email: "zhang@example.com",
    city: "上海",
    personal_website: "",
    github: "",
    job_intent: "后端开发",
    summary: "一段总结",
    education: [],
    experience: [
      {
        company: "甲公司",
        role: "工程师",
        start_date: "",
        end_date: "",
        description: ["做了甲一", "做了甲二"],
      },
      {
        company: "乙公司",
        role: "高级工程师",
        start_date: "",
        end_date: "",
        description: ["做了乙一"],
      },
    ],
    campus_experience: [],
    projects: [
      {
        name: "项目甲",
        role: "负责人",
        start_date: "",
        end_date: "",
        tech_stack: ["Python"],
        description: ["做了甲"],
        highlights: ["上线了"],
      },
      {
        name: "项目乙",
        role: "开发",
        start_date: "",
        end_date: "",
        tech_stack: ["TypeScript"],
        description: ["做了乙一", "做了乙二"],
        highlights: ["获奖了"],
      },
    ],
    skills: [{ name: "Python", level: "熟练" }],
    awards: [{ name: "一等奖", date: "2021", description: "" }],
  };
}

const base: ResumeContent = ensureIds(content());

interface Overlay {
  raw: string;
  base: string;
}

interface Annotation {
  path: string;
  origin: string;
  object_id?: string;
  point_id?: string;
}

function applyRemap(command: Parameters<typeof applyOutlineCommand>[1]): {
  before: ResumeContent;
  after: ResumeContent;
  remap: PathRemap;
} {
  const result = applyOutlineCommand(base, command);
  if (!result.ok) throw new Error(`命令被拒绝：${result.reason}`);
  return { before: base, after: result.content, remap: buildPathRemap(base, result.content) };
}

describe("buildPathRemap：移动第二个项目到第一位", () => {
  const secondProjectId = entryIdOf(entriesOf(base, "projects")[1]);
  const moved = applyRemap({
    type: "reorder-entry",
    field: "projects",
    objectId: secondProjectId,
    toIndex: 0,
  });

  it("加粗 overlay 跟着项目走：映射后在新路径上读到的仍是项目乙", () => {
    const overlays: Record<string, Overlay> = {
      "projects.1.name": { raw: "**项目乙**", base: "项目乙" },
      "projects.1.description.1": { raw: "**做了乙二**", base: "做了乙二" },
      "projects.0.name": { raw: "**项目甲**", base: "项目甲" },
    };
    const next = remapPathMap(overlays, moved.remap);

    // 原 projects.1 的内容现在在 projects.0；overlay 键必须跟过去。
    const movedName = entriesOf(moved.after, "projects")[0].name;
    expect(movedName).toBe("项目乙");
    expect(next["projects.0.name"]?.base).toBe(movedName);
    // 旧下标那条现在属于项目甲：不该有任何"项目乙"的 overlay 落在它上面。
    expect(next["projects.1.name"]?.base).toBe("项目甲");
    // 两条 overlay 一个不丢。
    expect(Object.keys(next)).toHaveLength(3);
  });

  it("事实标注的 path 改到新下标，object_id / point_id 原地不动", () => {
    const project = entriesOf(base, "projects")[1];
    const pointId = pointIdsOf(project, "description")[1];
    const annotations: Annotation[] = [
      {
        path: "projects.1.description.1",
        origin: "user_added",
        object_id: secondProjectId,
        point_id: pointId,
      },
      // 项目甲本身也被挤到第二位：它的标注同样要跟到新下标（"没动的条目"只是相对而言）。
      { path: "projects.0.description.0", origin: "grounded" },
      // 真正没被结构命令碰过的字段：原引用复用，下游不必无谓重渲染。
      { path: "experience.0.description.0", origin: "grounded" },
    ];
    const next = remapAnnotationPaths(annotations, moved.remap);
    expect(next[0].path).toBe("projects.0.description.1");
    expect(next[0].object_id).toBe(secondProjectId);
    expect(next[0].point_id).toBe(pointId);
    expect(next[1].path).toBe("projects.1.description.0");
    expect(next[2]).toBe(annotations[2]);
  });
});

describe("buildPathRemap：同一条目内移动要点", () => {
  it("要点路径按 point id 对齐：第 2 条移到第 1 条后，overlay 跟随原要点", () => {
    const project = entriesOf(base, "projects")[1];
    const objectId = entryIdOf(project);
    const ids = pointIdsOf(project, "description");
    const result = applyOutlineCommand(base, {
      type: "reorder-point",
      field: "projects",
      objectId,
      pointField: "description",
      pointId: ids[1],
      toIndex: 0,
    });
    if (!result.ok) throw new Error(result.reason);
    const remap = buildPathRemap(base, result.content);
    const overlays: Record<string, Overlay> = {
      "projects.1.description.0": { raw: "**做了乙一**", base: "做了乙一" },
      "projects.1.description.1": { raw: "**做了乙二**", base: "做了乙二" },
    };
    const next = remapPathMap(overlays, remap);
    // 移动后：description.0 = 做了乙二（原 .1），description.1 = 做了乙一（原 .0）。
    expect(next["projects.1.description.0"].base).toBe("做了乙二");
    expect(next["projects.1.description.1"].base).toBe("做了乙一");
    // 用映射后的键去新内容里读，确实各自对上原对象。
    expect(entriesOf(result.content, "projects")[1].description).toEqual(["做了乙二", "做了乙一"]);
  });
});

describe("buildPathRemap：复制与无变化", () => {
  it("复制出来的新条目不进映射（它的 overlay 本来就该是空的）", () => {
    const sourceId = entryIdOf(entriesOf(base, "projects")[1]);
    const result = applyOutlineCommand(base, {
      type: "clone-entry",
      field: "projects",
      objectId: sourceId,
    });
    if (!result.ok) throw new Error(result.reason);
    const remap = buildPathRemap(base, result.content);
    // 副本插在下标 2；base 里没有 projects.2，所以不该有以它为旧键的映射。
    expect([...remap.keys()].some((path) => path.startsWith("projects.2."))).toBe(false);
    expect(remap.get("projects.1.name")).toBe("projects.1.name");
  });

  it("内容没变时映射全是恒等，remapPathMap 复用原对象", () => {
    const remap = buildPathRemap(base, base);
    expect(remap.get("projects.0.name")).toBe("projects.0.name");
    const overlays: Record<string, Overlay> = {
      "projects.0.name": { raw: "**项目甲**", base: "项目甲" },
    };
    expect(remapPathMap(overlays, remap)).toBe(overlays);
  });
});
